"""손으로 라벨링한 사진으로 검출기를 채점한다 — **이게 진짜 지표다.**

합성 val 의 mAP 는 같은 합성기가 만든 데이터라 분포가 같다. 이 프로젝트는 이미 그
함정을 겪었다(스튜디오 val_acc 1.0000 인 모델 둘이 실사진에서 22/30 과 14/30).
그래서 사람이 그린 박스로만 성능을 말한다.

## 왜 ultralytics val 을 안 쓰고 직접 계산하는가

`model.val()` 은 dataset.yaml·폴더 구조를 맞춰야 하고, 우리가 알고 싶은 것을 바로
못 준다. 여기서 필요한 것은 전체 mAP 하나가 아니라 **어디서 실패하는지**다.

- 장면 밀집도별 재현율 — 실측에서 무더기 사진이 특히 약했다
- 품목별 재현율 — 흰 물체(마늘)가 통째로 0 이었다
- 신뢰도 임계별 P/R — 앱이 '중앙 하나'만 고른다면 임계를 높게 잡아도 된다

검출은 1클래스(`produce`)라 채점에서 품목은 무시한다. 다만 라벨에 품목이 들어 있으므로
품목별로 쪼개서 볼 수는 있다.

## 사용

    python -m mlv2.detect.eval_detect --dir data/real_detect_test \\
        --weights checkpoints/yolo11s_synth_v1.pt
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

from mlv2.compat import setup_stdout
from mlv2.items import IMAGE_EXTS, ITEM_CLASSES

setup_stdout()


def _iou(a, b):
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    ua = ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)
    return inter / ua if ua > 0 else 0.0


def load_gt(work_dir, size_of):
    """사람이 그린 라벨을 픽셀 박스로. {파일명: [(cls, x0,y0,x1,y1)]}"""
    work = Path(work_dir)
    out = {}
    for p in sorted((work / "images").rglob("*")):
        if p.suffix.lower() not in IMAGE_EXTS:
            continue
        lp = work / "labels" / (p.stem + ".txt")
        w, h = size_of(p)
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
        out[p.name] = boxes
    return out


def match(gt, pred, thr=0.5):
    """탐욕적 1:1 매칭. (TP, FP, FN, 매칭된 GT 인덱스 집합)"""
    used = set()
    tp = 0
    for pb in pred:                      # 신뢰도 내림차순이 들어온다고 가정
        best, best_i = 0.0, None
        for i, gb in enumerate(gt):
            if i in used:
                continue
            v = _iou(pb, gb[1:])
            if v > best:
                best, best_i = v, i
        if best >= thr and best_i is not None:
            used.add(best_i)
            tp += 1
    return tp, len(pred) - tp, len(gt) - tp, used


def ap50(records, n_gt):
    """단일 클래스 AP@0.5. records = [(conf, is_tp)] 전체 이미지 통합."""
    if n_gt == 0 or not records:
        return 0.0
    records = sorted(records, key=lambda r: -r[0])
    tp = fp = 0
    prev_recall, ap = 0.0, 0.0
    for conf, is_tp in records:
        if is_tp:
            tp += 1
        else:
            fp += 1
        recall = tp / float(n_gt)
        precision = tp / float(tp + fp)
        ap += (recall - prev_recall) * precision   # 계단 적분
        prev_recall = recall
    return ap


def run(work_dir, weights, conf=0.25, iou_nms=0.6, imgsz=768, thr=0.5,
        verbose=True):
    from PIL import Image
    try:
        from ultralytics import YOLO
    except ImportError:
        raise SystemExit("ultralytics 가 없다: pip install ultralytics")

    work = Path(work_dir)
    sizes = {}

    def size_of(p):
        if p.name not in sizes:
            with Image.open(str(p)) as im:
                sizes[p.name] = im.size
        return sizes[p.name]

    gt_all = load_gt(work, size_of)
    model = YOLO(str(weights))

    n_gt = sum(len(v) for v in gt_all.values())
    recs = []                       # (conf, is_tp) — AP 계산용
    per_item = defaultdict(lambda: [0, 0])       # 품목: [맞힘, 전체]
    per_density = defaultdict(lambda: [0, 0])    # 밀집도 구간: [맞힘, 전체]
    tot_tp = tot_fp = tot_fn = 0

    for p in sorted((work / "images").rglob("*")):
        if p.suffix.lower() not in IMAGE_EXTS:
            continue
        gt = gt_all.get(p.name, [])
        r = model.predict(str(p), conf=conf, iou=iou_nms, imgsz=imgsz,
                          verbose=False)[0]
        order = sorted(zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist()),
                       key=lambda t: -t[1])
        pred = [b for b, _ in order]
        confs = [c for _, c in order]

        tp, fp, fn, used = match(gt, pred, thr)
        tot_tp += tp
        tot_fp += fp
        tot_fn += fn

        # AP 용 기록: 각 예측이 TP 인지 다시 판정(매칭 순서 동일)
        used2 = set()
        for b, c in zip(pred, confs):
            best, bi = 0.0, None
            for i, gb in enumerate(gt):
                if i in used2:
                    continue
                v = _iou(b, gb[1:])
                if v > best:
                    best, bi = v, i
            hit = best >= thr and bi is not None
            if hit:
                used2.add(bi)
            recs.append((c, hit))

        for i, gb in enumerate(gt):
            name = ITEM_CLASSES[gb[0]] if gb[0] < len(ITEM_CLASSES) else "?"
            per_item[name][1] += 1
            if i in used:
                per_item[name][0] += 1

        band = "1-3개" if len(gt) <= 3 else ("4-9개" if len(gt) <= 9 else "10개+")
        per_density[band][1] += len(gt)
        per_density[band][0] += tp

    prec = tot_tp / float(tot_tp + tot_fp) if (tot_tp + tot_fp) else 0.0
    rec = tot_tp / float(tot_tp + tot_fn) if (tot_tp + tot_fn) else 0.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0

    if verbose:
        print("=" * 58)
        print("현장 사진 검출 성능 (사람 라벨 기준, IoU>={})".format(thr))
        print("=" * 58)
        print("사진 {:,}장 / 정답 박스 {:,}개 / conf>={}".format(
            len(gt_all), n_gt, conf))
        print()
        print("  precision {:.3f}   recall {:.3f}   F1 {:.3f}   AP50 {:.3f}".format(
            prec, rec, f1, ap50(recs, n_gt)))
        print("  TP {}  FP {}  FN {}".format(tot_tp, tot_fp, tot_fn))
        print()
        print("장면 밀집도별 재현율 — 무더기에서 무너지는지 본다")
        for band in ("1-3개", "4-9개", "10개+"):
            hit, tot = per_density[band]
            if tot:
                print("  {:<6} {:>3}/{:<3}  {:.3f}".format(
                    band, hit, tot, hit / float(tot)))
        print()
        print("품목별 재현율")
        for name in sorted(per_item, key=lambda k: per_item[k][0] / max(1, per_item[k][1])):
            hit, tot = per_item[name]
            print("  {:<4} {:>3}/{:<3}  {:.3f}".format(
                name, hit, tot, hit / float(tot)))
        print()
        print("※ 표본이 작으므로 소수점 뒤를 과신하지 말 것. 방향만 읽는다.")
    return {"precision": prec, "recall": rec, "f1": f1,
            "ap50": ap50(recs, n_gt), "n_gt": n_gt}


def main(argv=None):
    p = argparse.ArgumentParser(description="현장 사진 검출 평가")
    p.add_argument("--dir", default="data/real_detect_test")
    p.add_argument("--weights", default="checkpoints/yolo11s_synth_v1.pt")
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--iou-nms", type=float, default=0.6)
    p.add_argument("--imgsz", type=int, default=768)
    p.add_argument("--thr", type=float, default=0.5, help="TP 로 칠 IoU 문턱")
    a = p.parse_args(argv)
    run(a.dir, a.weights, conf=a.conf, iou_nms=a.iou_nms, imgsz=a.imgsz,
        thr=a.thr)


if __name__ == "__main__":
    main()
