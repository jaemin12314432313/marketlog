"""현장 사진에 YOLO 로 박스를 미리 그려 둔다 — 손 라벨링의 출발점.

빈 화면에 처음부터 박스를 그리는 것과, 이미 그려진 박스를 **고치는** 것은 속도가
몇 배 차이 난다. 합성 데이터로 학습한 검출기가 완벽하지 않아도 상관없다. 목적이
'정답 생산'이 아니라 '사람의 타이핑 줄이기'이기 때문이다.

## 클래스를 10품목으로 두는 이유

검출 학습은 1클래스(`produce`)로 하지만, **라벨은 10품목으로 받는다.** 같은 사진으로
두 가지를 다 재기 위해서다.

- 검출 평가 → 클래스를 무시하고 박스만 본다
- 분류 평가 → 박스로 크롭해서 품목 정답으로 쓴다

나중에 1클래스로 접는 것은 `--collapse` 한 번이면 되지만, 품목 없이 받은 라벨에
품목을 되살릴 방법은 없다. 정보는 버리기 쉽고 만들기 어렵다.

## 검출기는 품목을 모른다

우리 검출기는 1클래스라 "물체가 있다"까지만 말한다. 그래서 여기서 찍히는 품목은
**전부 0번(첫 품목)으로 채워진 자리표시자**다. 사람이 GUI 에서 숫자키로 고친다.
파일명에 품목이 들어 있으면(`배추_1.jpg`) 그걸로 초기값을 채운다 — 한 사진에 한 품목만
찍었다면 이것만으로 대부분 맞는다.

## 사용

    python -m mlv2.detect.prelabel --images data/real_photos --out data/real_detect
    python -m mlv2.detect.label_tool --dir data/real_detect      # 손으로 교정
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from mlv2 import compat
from mlv2.compat import setup_stdout
from mlv2.items import ITEM_CLASSES, IMAGE_EXTS, item_from_filename

setup_stdout()


def write_classes(out_dir):
    """classes.txt — GUI 와 다른 라벨링 도구가 공통으로 읽는 파일."""
    p = Path(out_dir) / "classes.txt"
    p.write_text("\n".join(ITEM_CLASSES) + "\n", encoding="utf-8")
    return p


def run(images_dir, out_dir, weights=None, conf=0.25, iou=0.6, imgsz=768,
        copy_images=True, verbose=True):
    images_dir, out_dir = Path(images_dir), Path(out_dir)
    files = [p for p in sorted(images_dir.rglob("*"))
             if p.suffix.lower() in IMAGE_EXTS]
    if not files:
        raise SystemExit("이미지가 없다: {}".format(images_dir))

    img_out = out_dir / "images"
    lab_out = out_dir / "labels"
    img_out.mkdir(parents=True, exist_ok=True)
    lab_out.mkdir(parents=True, exist_ok=True)
    write_classes(out_dir)

    model = None
    if weights:
        try:
            from ultralytics import YOLO
        except ImportError:
            raise SystemExit(
                "ultralytics 가 없다. 사전 라벨링을 건너뛰려면 --weights 를 빼고 실행할 것.\n"
                "  pip install ultralytics")
        model = YOLO(str(weights))

    n_box = 0
    for i, src in enumerate(files, 1):
        # 파일명 충돌을 피하려고 순번을 붙인다. 원본 이름은 뒤에 남겨 추적 가능하게.
        stem = "{:04d}_{}".format(i, src.stem)
        dst = img_out / (stem + src.suffix.lower())
        if copy_images and not dst.exists():
            shutil.copy2(str(src), str(dst))

        lab = lab_out / (stem + ".txt")
        if lab.exists():          # 이미 손을 댄 것은 절대 덮어쓰지 않는다
            continue

        # 파일명에서 품목을 유추해 초기 클래스로 쓴다(예: 배추_1.jpg → 배추)
        guess = item_from_filename(src.name)
        cls0 = ITEM_CLASSES.index(guess) if guess in ITEM_CLASSES else 0

        lines = []
        if model is not None:
            r = model.predict(str(dst), conf=conf, iou=iou, imgsz=imgsz,
                              verbose=False)[0]
            h, w = r.orig_shape
            for b in r.boxes.xyxy.tolist():
                x0, y0, x1, y1 = b
                cx, cy = (x0 + x1) / 2.0 / w, (y0 + y1) / 2.0 / h
                bw, bh = (x1 - x0) / w, (y1 - y0) / h
                if bw <= 0 or bh <= 0:
                    continue
                lines.append("{} {:.6f} {:.6f} {:.6f} {:.6f}".format(
                    cls0, cx, cy, bw, bh))
        lab.write_text("\n".join(lines), encoding="utf-8")
        n_box += len(lines)
        if verbose and i % 25 == 0:
            print("  {}/{}".format(i, len(files)))

    if verbose:
        print("사진 {:,}장 / 자동 박스 {:,}개 (장당 {:.1f})".format(
            len(files), n_box, n_box / max(1, len(files))))
        print("출력: {}".format(out_dir))
        print("\n다음: python -m mlv2.detect.label_tool --dir {}".format(out_dir))
        if model is None:
            print("※ --weights 를 안 줘서 박스는 비어 있다. 전부 손으로 그려야 한다.")
        else:
            print("※ 이 박스는 **초안**이다. 합성 학습 모델이라 현장에서 틀린다.")
            print("  틀린 것을 고치는 게 목적이지, 맞다고 믿는 게 목적이 아니다.")


def collapse_to_single(label_dir, verbose=True):
    """10품목 라벨 → 1클래스(produce). 검출 학습·평가용."""
    n = 0
    for p in sorted(Path(label_dir).rglob("*.txt")):
        if p.name == "classes.txt":
            continue
        out = []
        for line in p.read_text(encoding="utf-8").splitlines():
            f = line.split()
            if len(f) >= 5:
                out.append(" ".join(["0"] + f[1:5]))
        p.write_text("\n".join(out), encoding="utf-8")
        n += 1
    if verbose:
        print("{}개 라벨 파일을 1클래스로 접었다".format(n))


def main(argv=None):
    p = argparse.ArgumentParser(description="현장 사진 사전 라벨링")
    p.add_argument("--images", required=True, help="현장 사진 폴더")
    p.add_argument("--out", default="data/real_detect")
    p.add_argument("--weights", default="checkpoints/yolo11s_synth_v1.pt",
                   help="사전 라벨용 검출기. 빈 문자열이면 박스 없이 시작")
    p.add_argument("--conf", type=float, default=0.25,
                   help="낮출수록 박스가 많아진다. 지우는 게 그리는 것보다 빠르므로 낮게 둔다")
    p.add_argument("--iou", type=float, default=0.6)
    p.add_argument("--imgsz", type=int, default=768)
    p.add_argument("--collapse", action="store_true",
                   help="기존 라벨을 1클래스로 접기만 하고 끝낸다")
    a = p.parse_args(argv)

    if a.collapse:
        collapse_to_single(Path(a.out) / "labels")
        return
    run(a.images, a.out, weights=(a.weights or None), conf=a.conf, iou=a.iou,
        imgsz=a.imgsz)


if __name__ == "__main__":
    main()
