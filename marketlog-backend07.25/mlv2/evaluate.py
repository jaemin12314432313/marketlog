"""실사진 평가 하네스 — **이 프로젝트에서 모델을 판단하는 유일한 기준.**

왜 스튜디오 val_acc 로 판단하면 안 되는가:
  v3 와 v4 의 스튜디오 val_acc 는 **둘 다 1.0000** 이다. 변별력이 0이다.
  같은 두 모델의 실사진 성적은 22/30 과 14/30 으로 갈린다.
  val_acc 는 epoch 4에 이미 포화하므로, 그 뒤 epoch 은 전부 스튜디오 과적합에 쓰인다.

그래서 학습 루프가 매 epoch 이 함수를 호출한다(`--select-by real`).
평가셋이 30장뿐이라 한 장이 3.3%p 다. 수치를 소수점까지 믿지 말고,
**품목별 표와 혼동쌍**을 같이 볼 것. 그래서 이 모듈은 정확도 하나가 아니라
표를 통째로 돌려준다.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path

import torch
from PIL import Image

from mlv2.augment import build_transforms
from mlv2.items import is_image, item_from_filename


def collect_eval_images(eval_dir, extra_paths=None):
    """평가 폴더에서 (경로, 정답품목) 목록을 만든다. 정답은 파일명에서 유도한다.

    파일명에서 품목을 못 읽으면 **조용히 넘기지 않고** 별도로 돌려준다 —
    정답이 없는 파일이 섞여 분모가 달라지는 사고를 막기 위함이다.
    """
    paths = []
    eval_dir = Path(eval_dir)
    if eval_dir.is_dir():
        paths.extend(sorted(p for p in eval_dir.iterdir() if p.is_file() and is_image(p)))
    for extra in (extra_paths or []):
        p = Path(extra)
        if p.is_file() and is_image(p):
            paths.append(p)

    labeled, unlabeled = [], []
    for p in paths:
        item = item_from_filename(p.name)
        if item is None:
            unlabeled.append(p)
        else:
            labeled.append((p, item))
    return labeled, unlabeled


@torch.no_grad()
def predict_paths(model, classes, paths, img_size=224, device="cpu", batch_size=16):
    """이미지 경로 목록 → [(경로, 예측품목, 확신도, 확률벡터)].

    학습 루프에서 매 epoch 불리므로 배치로 돈다. 30장이면 CPU 로도 몇 초다.
    """
    _, eval_tf = build_transforms(img_size=img_size, level="none")
    was_training = model.training
    model.eval()

    results = []
    skipped = []
    buf_tensors, buf_paths = [], []

    def flush():
        if not buf_tensors:
            return
        batch = torch.stack(buf_tensors).to(device)
        probs = torch.softmax(model(batch), dim=1).cpu()
        for p, prob in zip(buf_paths, probs):
            idx = int(prob.argmax())
            results.append((p, classes[idx], float(prob[idx]), prob))
        buf_tensors.clear()
        buf_paths.clear()

    for path in paths:
        try:
            img = Image.open(path).convert("RGB")
        except Exception as exc:
            # .avif 는 pillow-avif-plugin 이 있어야 열린다. 없으면 여기로 온다.
            skipped.append((Path(path).name, str(exc).split("\n")[0]))
            continue
        buf_tensors.append(eval_tf(img))
        buf_paths.append(path)
        if len(buf_tensors) >= batch_size:
            flush()
    flush()

    model.train(was_training)
    return results, skipped


def evaluate(model, classes, eval_dir="test_image", extra_paths=None,
             img_size=224, device="cpu"):
    """실사진 평가. 요약 dict 를 돌려준다.

    반환 키:
        correct, total, accuracy
        per_item      품목 -> (맞음, 전체)
        confusions    (정답, 예측) -> 건수   ※ 오답만
        rows          [(파일명, 정답, 예측, 확신도, 맞았는지)]
        skipped       열지 못한 파일
        unlabeled     정답을 못 읽은 파일
    """
    labeled, unlabeled = collect_eval_images(eval_dir, extra_paths)
    if not labeled:
        raise RuntimeError(
            "평가 이미지를 못 찾았다: {}. 파일명이 '<품목>_1.jpg' 규칙인지 확인할 것.".format(eval_dir))

    paths = [p for p, _ in labeled]
    truth = dict((str(p), t) for p, t in labeled)
    preds, skipped = predict_paths(model, classes, paths,
                                   img_size=img_size, device=device)

    per_item = defaultdict(lambda: [0, 0])
    confusions = Counter()
    rows = []
    for path, pred, conf, _prob in preds:
        gt = truth[str(path)]
        hit = (pred == gt)
        per_item[gt][1] += 1
        per_item[gt][0] += int(hit)
        if not hit:
            confusions[(gt, pred)] += 1
        rows.append((Path(path).name, gt, pred, conf, hit))

    total = sum(v[1] for v in per_item.values())
    correct = sum(v[0] for v in per_item.values())
    return {
        "correct": correct,
        "total": total,
        "accuracy": (correct / total) if total else 0.0,
        "per_item": dict((k, tuple(v)) for k, v in per_item.items()),
        "confusions": confusions,
        "rows": rows,
        "skipped": skipped,
        "unlabeled": [p.name for p in unlabeled],
    }


def format_report(result, title="실사진 평가"):
    lines = []
    lines.append("=" * 58)
    lines.append("{}: {}/{}  ({:.1%})".format(
        title, result["correct"], result["total"], result["accuracy"]))
    lines.append("=" * 58)

    lines.append("{:<8}{:>8}{:>10}".format("품목", "맞음/전체", "정확도"))
    lines.append("-" * 30)
    for item in sorted(result["per_item"]):
        hit, tot = result["per_item"][item]
        lines.append("{:<8}{:>8}{:>10.0%}".format(
            item, "{}/{}".format(hit, tot), hit / tot if tot else 0))

    if result["confusions"]:
        lines.append("")
        lines.append("혼동쌍 (정답 → 예측):")
        for (gt, pred), n in result["confusions"].most_common():
            lines.append("  {} → {}   {}건".format(gt, pred, n))

    wrong = [r for r in result["rows"] if not r[4]]
    if wrong:
        lines.append("")
        lines.append("틀린 사진 (확신도 높은 순 — 확신하며 틀리는 게 제일 위험하다):")
        for name, gt, pred, conf, _ in sorted(wrong, key=lambda r: -r[3]):
            lines.append("  {:<18} 정답 {:<5} 예측 {:<5} 확신 {:.1%}".format(
                name, gt, pred, conf))

    if result["skipped"]:
        lines.append("")
        lines.append("열지 못한 파일 {}개 (분모에서 제외됨):".format(len(result["skipped"])))
        for name, err in result["skipped"]:
            lines.append("  {} — {}".format(name, err))
        lines.append("  ※ .avif 는 `pip install pillow-avif-plugin` 이 필요하다.")

    if result["unlabeled"]:
        lines.append("")
        lines.append("파일명에서 정답을 못 읽은 파일 {}개: {}".format(
            len(result["unlabeled"]), ", ".join(result["unlabeled"])))
    return "\n".join(lines)


def write_csv(result, out_path):
    import csv

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["file", "truth", "pred", "confidence", "correct"])
        for name, gt, pred, conf, hit in result["rows"]:
            w.writerow([name, gt, pred, "{:.4f}".format(conf), int(hit)])
    return out_path


def compare(ckpt_paths, eval_dir="test_image", device="cpu"):
    """여러 체크포인트를 같은 평가셋으로 나란히 본다. 모델 채택 판단용.

    품목별로 나란히 찍는 이유: v3→v4 때처럼 '전체 정확도는 비슷한데 품목별로는
    전면 열화' 인 경우를 총점만 보면 놓친다.
    """
    from mlv2.model import load_for_inference

    results = []
    for path in ckpt_paths:
        model, classes, img_size, ckpt = load_for_inference(path, device=device)
        res = evaluate(model, classes, eval_dir=eval_dir,
                       img_size=img_size, device=device)
        results.append((Path(path).stem, res, ckpt))
        del model

    names = [n for n, _, _ in results]
    lines = []
    lines.append("체크포인트 비교 (평가셋: {})".format(eval_dir))
    lines.append("")
    header = "{:<8}".format("품목") + "".join("{:>14}".format(n[:13]) for n in names)
    lines.append(header)
    lines.append("-" * len(header))

    all_items = sorted(set(i for _, r, _ in results for i in r["per_item"]))
    for item in all_items:
        cells = []
        for _, r, _ in results:
            hit, tot = r["per_item"].get(item, (0, 0))
            cells.append("{:>14}".format("{}/{}".format(hit, tot)))
        lines.append("{:<8}".format(item) + "".join(cells))
    lines.append("-" * len(header))
    lines.append("{:<8}".format("합계") + "".join(
        "{:>14}".format("{}/{}".format(r["correct"], r["total"])) for _, r, _ in results))
    lines.append("{:<8}".format("스튜디오") + "".join(
        "{:>14}".format(
            "{:.4f}".format(c["val_acc"]) if c.get("val_acc") is not None else "-")
        for _, _, c in results))
    lines.append("")
    lines.append("※ 스튜디오 val_acc 가 서로 같아도 실사진은 갈린다. 판단은 위쪽 표로 할 것.")
    return "\n".join(lines), results
