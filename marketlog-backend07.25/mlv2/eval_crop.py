"""**앱 경로 그대로** 분류기를 채점한다 — 검출 → 크롭 → 품목 판정.

온전한 사진 한 장을 통째로 분류기에 넣어 재는 것은 실사용과 다르다. 실제로 들어오는
것은 YOLO 가 자른 조각이고, 그 조각은 박스가 안팎으로 틀린 상태다. `crop_adapt` 증강이
겨냥한 것이 정확히 그 상황이므로, **크롭으로 재지 않으면 그 효과가 드러나지 않는다.**

## 세 가지 모드 — 무엇을 재는지가 다르다

    app       ★★ **앱의 실제 성공 기준.** 검출 → 중앙 대상 하나 → 크롭 → 분류한 결과가
              그 사진의 품목과 같으면 정답. IoU 매칭을 하지 않는다.

              `subject` 와의 차이가 중요하다. 검출기는 무더기를 **덩어리 하나**로 잡는
              경향이 있어서 사람이 그린 개별 박스와는 IoU 0.3 수준으로 어긋난다.
              그런데 사과 무더기를 통째로 크롭해도 분류기는 "사과" 라고 답한다 —
              사용자 입장에서는 맞은 것이다. IoU 는 검출 품질 지표이지 앱 성공 기준이
              아니므로, 앱을 평가할 때 그것으로 탈락시키면 실패를 과대평가한다.

    subject   앱 경로이되 **검출 품질까지** 따진다. 선택된 박스가 GT 와 IoU>=0.5 여야
              평가에 들어간다. 크롭이 얼마나 정확한지 보고 싶을 때 쓴다.
    all       검출된 모든 박스를 각각 분류. 표본이 많아 분류기 자체 성능을 보기에 좋지만
              매대 스캔 시나리오라 앱과는 다르다.
    gtbox     사람이 그린 박스로 크롭. **검출 오차가 빠진 상한**이다.
              subject/all 이 낮을 때 원인이 검출인지 분류인지 가르는 데 쓴다.

`gtbox` 와 `all` 의 차이가 크면 검출이 문제고, 둘 다 낮으면 분류기가 문제다.

## 정답은 어디서 오는가

사람이 라벨링한 박스(`label_tool.py` 산출물)다. 예측 박스는 GT 와 IoU 로 매칭해
그 GT 의 품목을 정답으로 삼는다. 매칭이 안 되는 예측(오검출)은 분류 채점에서 제외한다 —
그건 분류기 잘못이 아니라 검출기 잘못이고, `eval_detect.py` 가 이미 재고 있다.

## 사용

    python -m mlv2.eval_crop --dir data/real_detect_test \\
        --checkpoints checkpoints/item_recognition_effv2s_v3.pt \\
                      checkpoints/item_crop_v1.pt \\
        --weights checkpoints/yolo11s_synth_v1.pt
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

from mlv2.compat import load_checkpoint, setup_stdout, state_dict_from
from mlv2.items import IMAGE_EXTS, ITEM_CLASSES

setup_stdout()


def _iou(a, b):
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    ua = ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)
    return inter / ua if ua > 0 else 0.0


def load_gt(work_dir):
    """{이미지경로: [(cls, x0,y0,x1,y1)]} — 좌표는 픽셀."""
    from PIL import Image

    work = Path(work_dir)
    out = {}
    for p in sorted((work / "images").rglob("*")):
        if p.suffix.lower() not in IMAGE_EXTS:
            continue
        lp = work / "labels" / (p.stem + ".txt")
        with Image.open(str(p)) as im:
            w, h = im.size
        boxes = []
        if lp.is_file():
            for line in lp.read_text(encoding="utf-8").splitlines():
                f = line.split()
                if len(f) < 5:
                    continue
                c = int(float(f[0]))
                cx, cy, bw, bh = (float(v) for v in f[1:5])
                boxes.append((c, (cx - bw / 2) * w, (cy - bh / 2) * h,
                              (cx + bw / 2) * w, (cy + bh / 2) * h))
        if boxes:
            out[p] = boxes
    return out


def load_classifier(path, device):
    import torch

    from mlv2.model import build_model

    ck = load_checkpoint(path, map_location=device)
    classes = ck.get("classes", list(ITEM_CLASSES)) if isinstance(ck, dict) else list(ITEM_CLASSES)
    backbone = ck.get("backbone", "effv2s") if isinstance(ck, dict) else "effv2s"
    img_size = ck.get("img_size", 224) if isinstance(ck, dict) else 224
    model = build_model(backbone, num_classes=len(classes), pretrained=False)
    model.load_state_dict(state_dict_from(ck))
    model.to(device).eval()
    return model, classes, img_size


def crop_and_classify(model, classes, img_size, pil, boxes, device, pad=0.0):
    """박스들을 잘라 한 배치로 분류. [(pred_cls, conf)] 를 돌려준다.

    `model`/`img_size` 에 리스트를 주면 **앙상블**이다 — 각 모델의 softmax 확률을
    동등가중으로 평균한 뒤 argmax 한다. 로짓이 아니라 확률을 더하는 이유는
    `mlv2.pipeline.Pipeline.classify` 주석에 있다.
    """
    import torch
    from torchvision import transforms

    from mlv2.augment import IMAGENET_MEAN, IMAGENET_STD

    models = model if isinstance(model, (list, tuple)) else [model]
    sizes = img_size if isinstance(img_size, (list, tuple)) else [img_size]

    W, H = pil.size
    crops = []
    for x0, y0, x1, y1 in boxes:
        if pad:
            bw, bh = x1 - x0, y1 - y0
            x0, x1 = x0 - bw * pad, x1 + bw * pad
            y0, y1 = y0 - bh * pad, y1 + bh * pad
        x0, y0 = max(0, int(x0)), max(0, int(y0))
        x1, y1 = min(W, int(x1)), min(H, int(y1))
        if x1 - x0 < 4 or y1 - y0 < 4:
            crops.append(None)
            continue
        crops.append(pil.crop((x0, y0, x1, y1)))
    valid = [(i, c) for i, c in enumerate(crops) if c is not None]
    out = [(None, 0.0)] * len(boxes)
    if not valid:
        return out

    acc = None
    for m, size in zip(models, sizes):
        tf = transforms.Compose([
            transforms.Resize((size, size)),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ])
        batch = torch.stack([tf(c) for _, c in valid]).to(device)
        with torch.no_grad():
            probs = torch.softmax(m(batch), dim=1)
        acc = probs if acc is None else acc + probs
    acc = acc / float(len(models))

    conf, pred = acc.max(1)
    for (i, _), c, p in zip(valid, conf.tolist(), pred.tolist()):
        out[i] = (p, c)
    return out


def run(work_dir, checkpoints, det_weights=None, mode="subject", conf=0.25,
        imgsz=768, iou_thr=0.5, device=None, pad=0.0, verbose=True,
        ensemble=False):
    import torch
    from PIL import Image

    device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    gt = load_gt(work_dir)
    if not gt:
        raise SystemExit("라벨이 없다: {}".format(work_dir))

    det = None
    if mode != "gtbox":
        try:
            from ultralytics import YOLO
        except ImportError:
            raise SystemExit("ultralytics 가 없다: pip install ultralytics")
        det = YOLO(str(det_weights))

    loaded = [load_classifier(c, device) for c in checkpoints]
    if ensemble:
        # 체크포인트 전부를 하나의 '모델' 로 묶어 한 번만 돈다.
        for _, cls, _ in loaded[1:]:
            if cls != loaded[0][1]:
                raise SystemExit("체크포인트끼리 클래스 순서가 달라 앙상블 불가")
        runs = [("+".join(Path(c).stem for c in checkpoints),
                 [m for m, _, _ in loaded], loaded[0][1],
                 [s for _, _, s in loaded])]
    else:
        runs = [(Path(c).stem, m, cls, size)
                for c, (m, cls, size) in zip(checkpoints, loaded)]

    results = {}
    for name, model, classes, img_size in runs:
        hit = tot = 0
        per_item = defaultdict(lambda: [0, 0])
        confusions = defaultdict(int)

        for path, gboxes in gt.items():
            pil = Image.open(str(path)).convert("RGB")
            if mode == "gtbox":
                boxes = [g[1:] for g in gboxes]
                truth = [g[0] for g in gboxes]
            else:
                r = det.predict(str(path), conf=conf, imgsz=imgsz,
                                verbose=False)[0]
                pb = sorted(zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist()),
                            key=lambda t: -t[1])
                cand = [b for b, _ in pb]
                confs = [c for _, c in pb]
                if not cand:
                    continue
                if mode in ("subject", "app"):
                    from mlv2.detect.select import pick_subject
                    W, H = pil.size
                    sel = pick_subject(cand, W, H, confs=confs)
                    if sel is None:
                        continue
                    cand = [cand[sel[0]]]

                if mode == "app":
                    # IoU 를 따지지 않는다. 정답은 '이 사진의 품목'(다수결)이다.
                    counts = {}
                    for g in gboxes:
                        counts[g[0]] = counts.get(g[0], 0) + 1
                    boxes = cand
                    truth = [max(counts, key=lambda k: counts[k])] * len(cand)
                else:
                    # 예측 박스마다 가장 겹치는 GT 를 찾아 그 품목을 정답으로 삼는다
                    boxes, truth = [], []
                    for b in cand:
                        best, bi = 0.0, None
                        for i, g in enumerate(gboxes):
                            v = _iou(b, g[1:])
                            if v > best:
                                best, bi = v, i
                        if best >= iou_thr and bi is not None:
                            boxes.append(b)
                            truth.append(gboxes[bi][0])

            if not boxes:
                continue
            preds = crop_and_classify(model, classes, img_size, pil, boxes,
                                      device, pad=pad)
            for (p, _), t in zip(preds, truth):
                if p is None:
                    continue
                name_t = ITEM_CLASSES[t] if t < len(ITEM_CLASSES) else "?"
                name_p = classes[p] if p < len(classes) else "?"
                tot += 1
                per_item[name_t][1] += 1
                if name_p == name_t:
                    hit += 1
                    per_item[name_t][0] += 1
                else:
                    confusions[(name_t, name_p)] += 1

        acc = hit / float(tot) if tot else 0.0
        results[name] = {"acc": acc, "hit": hit, "tot": tot,
                         "per_item": dict(per_item),
                         "confusions": dict(confusions)}
        if verbose:
            print("\n{}  →  {}/{} = {:.3f}".format(name, hit, tot, acc))
            for name in sorted(per_item):
                h, t = per_item[name]
                print("    {:<4} {:>3}/{:<3} {:.2f}".format(name, h, t, h / float(t)))
            top = sorted(confusions.items(), key=lambda kv: -kv[1])[:4]
            if top:
                print("    주요 혼동: " + ", ".join(
                    "{}→{} {}회".format(a, b, n) for (a, b), n in top))

    if verbose:
        print("\n" + "=" * 54)
        print("모드 '{}' — {}".format(mode, {
            "app": "앱의 실제 성공 기준(품목이 맞는가). IoU 미적용",
            "subject": "앱 경로 + 검출 품질(IoU>=thr)까지 요구",
            "all": "검출된 모든 박스. 표본이 많지만 매대 스캔 시나리오다",
            "gtbox": "사람 박스. 검출 오차가 빠진 상한이다"}[mode]))
        print("표본이 작으므로 2~3개 이상 차이가 날 때만 의미를 둘 것.")
    return results


def main(argv=None):
    p = argparse.ArgumentParser(description="크롭 기반 분류 평가 (앱 경로)")
    p.add_argument("--dir", default="data/real_detect_test")
    p.add_argument("--checkpoints", nargs="+", required=True)
    p.add_argument("--weights", default="checkpoints/yolo11s_synth_v1.pt",
                   help="검출기. mode=gtbox 면 안 쓴다")
    p.add_argument("--mode", default="app",
                   choices=["app", "subject", "all", "gtbox"])
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--imgsz", type=int, default=768)
    p.add_argument("--iou-thr", type=float, default=0.5)
    p.add_argument("--pad", type=float, default=0.0,
                   help="크롭에 여백을 준다. 0.1 이면 각 변 10%% 확장")
    p.add_argument("--ensemble", action="store_true",
                   help="--checkpoints 를 따로 채점하지 않고 하나로 묶어 확률평균한다")
    p.add_argument("--device", default=None)
    a = p.parse_args(argv)
    run(a.dir, a.checkpoints, det_weights=a.weights, mode=a.mode, conf=a.conf,
        imgsz=a.imgsz, iou_thr=a.iou_thr, device=a.device, pad=a.pad,
        ensemble=a.ensemble)


if __name__ == "__main__":
    main()
