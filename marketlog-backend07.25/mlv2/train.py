"""학습 루프.

기존 `train_item_recognition.py` 대비 바뀐 것 다섯. 전부 v4 실패(실사진 22/30 → 14/30)에
대한 대응이다.

1. **best 갱신 조건이 `>=` 에서 `>` 로 바뀌었다.** 이게 v4 실패의 직접적 기여자다.
   val_acc 는 epoch 4에 1.0000 으로 포화하는데, `>=` 면 그 뒤 모든 epoch 이 매번
   덮어써서 **가장 오래 과적합된 마지막 체크포인트**가 남는다. 정확히 반대로 골라온 것이다.

2. **모델 선택 기준이 실사진이다** (`--select-by real`, 기본값).
   스튜디오 val_acc 는 v3/v4 둘 다 1.0000 이라 변별력이 0이다.

3. **조기 종료**가 있다. 포화 뒤 epoch 은 도움이 안 되는 정도가 아니라 해롭다.

4. **매 epoch 실사진 성적을 같이 찍는다.** "언제부터 나빠지는가" 를 눈으로 본다.

5. **학습 이력 전체를 JSON 으로 남긴다.** 나중에 "그때 몇 epoch 이 최고였나" 를
   기억이 아니라 파일로 확인한다.
"""
from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from pathlib import Path

import torch
import torch.nn as nn

from mlv2 import evaluate as eval_mod
from mlv2.compat import set_seed, setup_stdout
from mlv2.dataset import build_dataloaders
from mlv2.model import (
    build_model,
    describe,
    freeze_backbone,
    unfreeze_all,
)

setup_stdout()


def add_arguments(p):
    p.add_argument("--manifest", default="data/manifests/item_v3.csv",
                   help="mlv2 manifest 로 만든 CSV. 분할이 여기 박혀 있다")
    p.add_argument("--root", default=".", help="매니페스트 경로의 기준 디렉터리")
    p.add_argument("--backbone", default="effv2s")
    p.add_argument("--img-size", type=int, default=224)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--epochs", type=int, default=12,
                   help="기본 12. 기존 20은 포화 후 16 epoch 을 과적합에 쓴 값이다")
    p.add_argument("--freeze-epochs", type=int, default=2,
                   help="헤드만 학습할 초기 epoch 수")
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--unfreeze-lr-scale", type=float, default=0.05,
                   help="백본 해제 후 lr 배율. 3e-4 * 0.05 = 1.5e-5. "
                        "1.0 으로 두면 사전학습 가중치가 파괴된다(2026-08-11 실측)")
    p.add_argument("--weight-decay", type=float, default=1e-4)
    p.add_argument("--label-smoothing", type=float, default=0.1)
    p.add_argument("--aug-level", default="strong",
                   choices=["none", "standard", "strong", "extreme",
                            "crop_standard", "crop_strong", "crop_extreme"],
                   help="crop_* 는 YOLO 크롭을 입력으로 받는 2단 파이프라인용")
    p.add_argument("--backgrounds-dir", default="data/backgrounds")
    p.add_argument("--bg-prob", type=float, default=0.5)
    p.add_argument("--num-workers", type=int, default=4)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--deterministic", action="store_true")
    p.add_argument("--select-by", default="real", choices=["real", "val"],
                   help="best 체크포인트 선정 기준. real=실사진(권장), val=스튜디오")
    p.add_argument("--real-dir", default="test_image",
                   help="실사진 평가셋 폴더. --select-by real 이면 매 epoch 평가한다")
    p.add_argument("--patience", type=int, default=4,
                   help="선정 기준이 이 횟수만큼 안 오르면 조기 종료. 0이면 끔")
    p.add_argument("--output", default="checkpoints/mlv2_item.pt")
    p.add_argument("--history", default=None,
                   help="학습 이력 JSON 경로. 기본은 <output>.history.json")
    p.add_argument("--device", default=None)
    p.add_argument("--limit-batches", type=int, default=0,
                   help="스모크테스트용. epoch 당 배치 수 제한(0=제한없음)")
    return p


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="mlv2 품목 인식 학습")
    return add_arguments(p).parse_args(argv)


def run_epoch(model, loader, criterion, optimizer, device, train,
              limit_batches=0, num_classes=10):
    model.train(mode=train)
    total_loss, correct, total = 0.0, 0, 0
    per_class_hit = Counter()
    per_class_tot = Counter()

    context = torch.enable_grad() if train else torch.no_grad()
    with context:
        for i, (images, labels) in enumerate(loader):
            if limit_batches and i >= limit_batches:
                break
            images = images.to(device, non_blocking=True)
            labels = labels.to(device, non_blocking=True)
            if train:
                optimizer.zero_grad(set_to_none=True)
            logits = model(images)
            loss = criterion(logits, labels)
            if train:
                loss.backward()
                # 그래디언트 클리핑. 낮은 lr 과 함께 쓰는 이중 안전장치다 —
                # 증강이 강해 가끔 튀는 배치가 나오는데, 한 번의 큰 스텝이
                # 사전학습 가중치를 망가뜨리면 회복되지 않는다.
                torch.nn.utils.clip_grad_norm_(
                    [p for p in model.parameters() if p.requires_grad], 1.0)
                optimizer.step()

            preds = logits.argmax(1)
            total_loss += loss.item() * images.size(0)
            correct += (preds == labels).sum().item()
            total += images.size(0)
            for c in range(num_classes):
                m = labels == c
                n = int(m.sum())
                if n:
                    per_class_tot[c] += n
                    per_class_hit[c] += int((preds[m] == c).sum())

    if total == 0:
        return 0.0, 0.0, {}
    per_class = dict(
        (c, per_class_hit[c] / per_class_tot[c]) for c in per_class_tot)
    return total_loss / total, correct / total, per_class


def train(args):
    set_seed(args.seed, deterministic=args.deterministic)
    device = torch.device(
        args.device or ("cuda" if torch.cuda.is_available() else "cpu"))
    if device.type == "cpu":
        print("[주의] CPU 로 학습한다. 로컬 torch 는 CPU 빌드이므로 정상이지만,")
        print("       본 학습은 GPU 서버에서 할 것. 지금은 스모크테스트로만 쓸 것.")

    train_loader, val_loader, classes = build_dataloaders(
        args.manifest, img_size=args.img_size, batch_size=args.batch_size,
        num_workers=args.num_workers, aug_level=args.aug_level,
        backgrounds_dir=args.backgrounds_dir, bg_prob=args.bg_prob,
        root=args.root,
    )

    model = build_model(args.backbone, num_classes=len(classes)).to(device)
    print(describe(model, args.backbone, len(classes), args.img_size))

    criterion = nn.CrossEntropyLoss(label_smoothing=args.label_smoothing)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    history = []
    best_score = -1.0
    best_epoch = -1
    stale = 0
    optimizer = None
    scheduler = None
    started = time.time()

    print("\n선정 기준: {}".format(
        "실사진 정확도 (스튜디오 val_acc 는 포화되어 변별력이 없다)"
        if args.select_by == "real" else "스튜디오 val_acc (변별력 없음에 주의)"))
    print("=" * 62)

    for epoch in range(args.epochs):
        # 워밍업: 헤드만 먼저 맞춘 뒤 전체를 푼다. 옵티마이저는 그때 새로 만든다
        # (파라미터 그룹이 바뀌었는데 기존 옵티마이저를 재사용하면 조용히 무시된다).
        if epoch == 0:
            freeze_backbone(model)
            optimizer = scheduler = None
        elif epoch == args.freeze_epochs:
            unfreeze_all(model)
            optimizer = scheduler = None

        if optimizer is None:
            params = [p for p in model.parameters() if p.requires_grad]
            # 백본을 푼 뒤에는 lr 을 크게 낮춘다.
            #
            # 이게 없으면 사전학습 가중치가 첫 스텝에 파괴된다. 2026-08-11 실측:
            # 동결 구간(epoch 1~2)에서는 실사진 3/27 → 6/27 로 오르다가, unfreeze 한
            # epoch 3 에서 즉시 3/27 로 떨어지고 그 뒤 loss 가 ln(10)=2.303 에 고착됐다.
            # 모델이 "균등 분포를 내는 것이 최선" 인 상태로 붕괴한 것이다.
            # 헤드에 맞춘 3e-4 를 백본 전체에 그대로 쓰면 안 된다(보통 1e-5~5e-5).
            lr = args.lr if epoch < args.freeze_epochs else args.lr * args.unfreeze_lr_scale
            optimizer = torch.optim.AdamW(
                params, lr=lr, weight_decay=args.weight_decay)
            remaining = max(1, args.epochs - epoch)
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
                optimizer, T_max=remaining)
            print("       [lr] epoch {} 부터 lr={:.2e} ({})".format(
                epoch + 1, lr, "헤드만" if epoch < args.freeze_epochs else "전체"))

        tr_loss, tr_acc, _ = run_epoch(
            model, train_loader, criterion, optimizer, device, True,
            args.limit_batches, len(classes))
        va_loss, va_acc, va_per_class = run_epoch(
            model, val_loader, criterion, optimizer, device, False,
            args.limit_batches, len(classes))
        scheduler.step()

        line = "[{:>2}/{}] train {:.4f}/{:.4f}  val {:.4f}/{:.4f}".format(
            epoch + 1, args.epochs, tr_loss, tr_acc, va_loss, va_acc)

        real_acc = None
        real_result = None
        if args.select_by == "real" or args.real_dir:
            try:
                real_result = eval_mod.evaluate(
                    model, classes, eval_dir=args.real_dir,
                    img_size=args.img_size, device=device)
                real_acc = real_result["accuracy"]
                line += "  실사진 {}/{} ({:.1%})".format(
                    real_result["correct"], real_result["total"], real_acc)
            except Exception as exc:
                if args.select_by == "real":
                    raise RuntimeError(
                        "실사진 평가에 실패했는데 --select-by real 이다: {}".format(exc))
                line += "  실사진 평가 실패({})".format(exc)

        score = real_acc if args.select_by == "real" else va_acc
        if score is None:
            score = va_acc

        history.append({
            "epoch": epoch + 1,
            "train_loss": tr_loss, "train_acc": tr_acc,
            "val_loss": va_loss, "val_acc": va_acc,
            "real_acc": real_acc,
            "val_per_class": dict((classes[c], v) for c, v in va_per_class.items()),
            "lr": optimizer.param_groups[0]["lr"],
        })

        # ★ `>` 다. `>=` 로 두면 포화 구간에서 매 epoch 덮어써서
        #    '가장 오래 과적합된' 체크포인트가 남는다. v4 가 그렇게 나왔다.
        if score > best_score:
            best_score, best_epoch, stale = score, epoch + 1, 0
            torch.save({
                "model_state": model.state_dict(),
                "backbone": args.backbone,
                "classes": classes,
                "img_size": args.img_size,
                "val_acc": va_acc,
                "real_acc": real_acc,
                "epoch": epoch + 1,
                "select_by": args.select_by,
                "train_config": vars(args),
            }, out_path)
            line += "  ← best 저장"
        else:
            stale += 1
            line += "  (best epoch {} 이후 {}회 정체)".format(best_epoch, stale)

        print(line)

        if args.patience and stale >= args.patience:
            print("\n조기 종료: {}회 연속 개선 없음. 포화 뒤 epoch 은 도움이 아니라 해롭다.".format(stale))
            break

    elapsed = time.time() - started
    hist_path = Path(args.history or (str(out_path) + ".history.json"))
    hist_path.parent.mkdir(parents=True, exist_ok=True)
    with hist_path.open("w", encoding="utf-8") as fh:
        json.dump({
            "config": vars(args),
            "classes": classes,
            "best_epoch": best_epoch,
            "best_score": best_score,
            "select_by": args.select_by,
            "elapsed_sec": elapsed,
            "history": history,
        }, fh, ensure_ascii=False, indent=2)

    print("=" * 62)
    print("best epoch {} / {} = {:.4f}".format(best_epoch, args.select_by, best_score))
    print("체크포인트: {}".format(out_path))
    print("이력: {}".format(hist_path))
    print("소요 {:.1f}분".format(elapsed / 60))

    if real_result is not None:
        saturated = [h for h in history if h["val_acc"] >= 0.999]
        if saturated:
            print("\n[관찰] val_acc 가 epoch {} 에서 이미 1.0 에 도달했다.".format(
                saturated[0]["epoch"]))
            print("       그 이후 val_acc 는 모델을 고르는 데 아무 정보도 주지 않는다.")
    return history


def main(argv=None):
    return train(parse_args(argv))


if __name__ == "__main__":
    main()
