"""검출 결과에서 **측정 대상 하나**를 고른다.

앱은 "측정할 상품을 화면 중앙에 맞추세요" 라는 preview 를 띄우고, 찍힌 사진에서
대상 하나만 골라 품목을 판정한다. 그러면 검출기의 역할이 바뀐다 — '모든 객체를
빠짐없이' 가 아니라 '**중앙 대상 하나의 박스를 정확히**' 다. 매대 구석의 작은 객체를
놓쳐도 상관없어지는 대신, 고른 박스가 곧 분류기 입력이 되므로 박스 정확도가 중요해진다.

## 왜 "중앙에 가장 가까운 박스" 로는 부족한가

중앙에 작은 마늘이 걸쳐 있고 옆에 큰 배추가 있으면, 중심 거리만으로는 마늘이 뽑힌다.
반대로 면적만 보면 프레임을 가로지르는 이웃이 항상 이긴다. 그래서 중앙성·크기·신뢰도를
함께 본다. 가중치는 `tune` 으로 실측해서 정하는 값이지 감으로 정할 값이 아니다.

## 평가 방법

`compose.py` 가 합성할 때 주 피사체가 누구인지 알고 있으므로 `subjects_<split>.csv` 에
정답을 남겨 둔다. 그 정답으로 두 가지를 잰다.

1. **상한** — GT 박스를 넣었을 때의 정확도. 검출기가 완벽해도 이 값을 못 넘는다.
   여기서 낮게 나오면 규칙 자체가 틀린 것이므로 검출기를 아무리 키워도 소용없다.
2. **실측** — YOLO 예측 박스를 넣었을 때의 정확도.

`python -m mlv2.detect.select --synth data/synth_detect --split val` 로 1번을 잰다.
"""
from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path

from mlv2.compat import setup_stdout

setup_stdout()

# 실측으로 정할 값이다. 아래 기본값은 `tune` 의 출발점일 뿐 근거가 있는 수치가 아니다.
DEFAULT_WEIGHTS = {"center": 0.50, "area": 0.35, "conf": 0.15}


def _centerness(box, w, h):
    """0~1. 박스 중심이 화면 중심에 가까울수록 1."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    d = math.hypot(cx - w / 2.0, cy - h / 2.0)
    dmax = math.hypot(w / 2.0, h / 2.0)
    return max(0.0, 1.0 - d / dmax) if dmax > 0 else 0.0


def _area_norm(box, w, h):
    """0~1. 넓이의 제곱근을 쓴다 — 면적은 길이의 제곱이라 그대로 쓰면 큰 것이 과도하게 이긴다."""
    x0, y0, x1, y1 = box
    a = max(0.0, (x1 - x0)) * max(0.0, (y1 - y0))
    return math.sqrt(a / float(w * h)) if w > 0 and h > 0 else 0.0


def score_box(box, img_w, img_h, conf=1.0, weights=None):
    wt = weights or DEFAULT_WEIGHTS
    return (wt["center"] * _centerness(box, img_w, img_h)
            + wt["area"] * _area_norm(box, img_w, img_h)
            + wt["conf"] * float(conf))


def pick_subject(boxes, img_w, img_h, confs=None, weights=None,
                 min_center=0.0):
    """대상 박스 하나를 고른다. 후보가 없으면 None.

    `boxes` 는 [(x0, y0, x1, y1)] 픽셀 좌표. `min_center` 를 올리면 화면 가장자리
    후보를 아예 배제한다(앱 가이드 프레임이 있다면 그 바깥을 버리는 용도).

    돌려주는 값은 (인덱스, 점수)다.
    """
    if not boxes:
        return None
    confs = confs or [1.0] * len(boxes)
    best, best_s = None, -1.0
    for i, b in enumerate(boxes):
        if _centerness(b, img_w, img_h) < min_center:
            continue
        s = score_box(b, img_w, img_h, confs[i], weights)
        if s > best_s:
            best, best_s = i, s
    return None if best is None else (best, best_s)


def _iou(a, b):
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    ua = ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)
    return inter / ua if ua > 0 else 0.0


def load_synth(synth_dir, split="val", size=768):
    """합성 데이터셋에서 (이미지별 GT 박스들, 주 피사체 박스) 를 읽는다."""
    synth_dir = Path(synth_dir)
    subj = {}
    p = synth_dir / ("subjects_" + split + ".csv")
    if not p.is_file():
        raise SystemExit(
            "{} 가 없다.\n"
            "  주 피사체 정답은 compose.py 가 만든다. 합성을 다시 돌릴 것.".format(p))
    with open(str(p), encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            subj[r["image"]] = (r["item"], (float(r["x0"]), float(r["y0"]),
                                            float(r["x1"]), float(r["y1"])))

    out = []
    lab_dir = synth_dir / "labels" / split
    for img_name, (item, sbox) in sorted(subj.items()):
        lp = lab_dir / (Path(img_name).stem + ".txt")
        if not lp.is_file():
            continue
        boxes = []
        for line in lp.read_text(encoding="utf-8").splitlines():
            f = line.split()
            if len(f) < 5:
                continue
            cx, cy, w, h = (float(v) * size for v in f[1:5])
            boxes.append((cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2))
        if boxes:
            out.append((img_name, item, sbox, boxes))
    return out


def evaluate(samples, weights=None, size=768, iou_thr=0.5):
    """고른 박스가 주 피사체와 IoU>=thr 이면 정답."""
    ok = 0
    for _, _, sbox, boxes in samples:
        r = pick_subject(boxes, size, size, weights=weights)
        if r is not None and _iou(boxes[r[0]], sbox) >= iou_thr:
            ok += 1
    return ok / float(len(samples)) if samples else 0.0


def tune(samples, size=768, verbose=True):
    """가중치 격자 탐색. 감으로 정하지 말고 여기서 나온 값을 쓸 것."""
    best, best_acc = None, -1.0
    grid = [i / 10.0 for i in range(0, 11)]
    for wc in grid:
        for wa in grid:
            if wc + wa > 1.0:
                continue
            wt = {"center": wc, "area": wa, "conf": round(1.0 - wc - wa, 3)}
            acc = evaluate(samples, wt, size=size)
            if acc > best_acc:
                best, best_acc = wt, acc
    if verbose:
        print("최적 가중치 {} → 정확도 {:.3f}".format(best, best_acc))
    return best, best_acc


def main(argv=None):
    p = argparse.ArgumentParser(description="중앙 대상 선택 규칙 평가")
    p.add_argument("--synth", default="data/synth_detect")
    p.add_argument("--split", default="val")
    p.add_argument("--size", type=int, default=768)
    p.add_argument("--tune", action="store_true", help="가중치 격자 탐색")
    a = p.parse_args(argv)

    s = load_synth(a.synth, a.split, a.size)
    print("표본 {:,}장 (장당 평균 객체 {:.1f})".format(
        len(s), sum(len(x[3]) for x in s) / max(1, len(s))))
    print("※ 이건 **상한**이다 — GT 박스를 넣은 값이라 검출 오차가 빠져 있다.")
    print("기본 가중치 {} → 정확도 {:.3f}".format(
        DEFAULT_WEIGHTS, evaluate(s, size=a.size)))
    # 비교용 단순 규칙: 무엇을 개선한 것인지 알려면 기준선이 있어야 한다
    print("  (참고) 중앙성만  → {:.3f}".format(
        evaluate(s, {"center": 1.0, "area": 0.0, "conf": 0.0}, size=a.size)))
    print("  (참고) 면적만    → {:.3f}".format(
        evaluate(s, {"center": 0.0, "area": 1.0, "conf": 0.0}, size=a.size)))
    if a.tune:
        tune(s, size=a.size)


if __name__ == "__main__":
    main()
