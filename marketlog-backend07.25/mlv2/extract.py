"""AI-Hub B-A05 원천 zip → 학습용 이미지 폴더 + 매니페스트.

원본은 224GB / zip 54개다. **절대 통째로 풀지 말 것.** 필요한 항목만 `zipfile` 로
읽어 추출한다. (그리고 서버 `unzip` 은 한글 파일명을 디스크에 손상된 채로 쓴다 —
표시 문제가 아니라 실제 손상이다. 압축·해제는 항상 Python 으로.)

이 데이터셋의 구조적 사실 셋. 추출 전략은 전부 여기서 나온다.

  ① 개체 하나를 40~175장 다각도로 찍었다. 총 214,931장이 실제로는 **3,350개체**다.
     → 무작위 샘플링은 특정 개체에 표본이 쏠려 개체 다양성을 낭비한다. 개체 단위로 뜬다.
  ② 개체 수가 품목별로 4.47배 차이난다 (양파 545 vs 감자 122).
     → 품목별 총 장수만 맞추면 감자는 개체당 41장, 양파는 9장이 되어 중복도가 딴판이 된다.
       그래서 `--per-specimen` 으로 **개체당 장수**를 맞추는 모드를 기본으로 뒀다.
  ③ 등급(zip 파일명 끝 L/M/S)이 곧 촬영 배치이고, **배치마다 조명이 다르다.**
     → 품목 인식에 등급은 쓸모없지만, 한 등급 배치에서만 뽑으면 그 품목이 특정 조명에
       묶인다. 등급을 고르게 섞어 뜬다.

★ 그리고 가장 중요한 것: **장수를 늘리는 게 목표가 아니다.**
   학습셋을 5,000 → 50,000장으로 늘린 v4 는 실사진이 22/30 → 14/30 으로 떨어졌다.
   개체가 3,350으로 고정이라 장수를 늘려도 새 정보가 없고, 같은 개체를 더 많은 각도로
   반복 학습해 스튜디오 도메인에 더 붙을 뿐이다. 기본값을 개체당 6장(약 20,000장)으로
   잡은 이유다. 늘리고 싶어지면 먼저 `docs/SETUP.md` 9절(재시도 금지 목록)을 볼 것.
"""
from __future__ import annotations

import argparse
import io
import zipfile
from collections import defaultdict
from pathlib import Path

from PIL import Image

from mlv2 import manifest as manifest_mod
from mlv2.compat import setup_stdout
from mlv2.items import (
    IMAGE_EXTS,
    grade_from_zip_name,
    item_from_zip_name,
    specimen_key,
)

setup_stdout()


def even_stride(items, k):
    """items 에서 k개를 균등 간격으로 고른다.

    촬영 순서(img_no)가 수직/수평 각도를 체계적으로 스윕하므로, 균등 간격 추출이
    곧 각도 커버리지다. 앞에서 k장을 자르면 한쪽 각도만 모인다.

    >>> even_stride(list(range(10)), 3)
    [0, 3, 6]
    >>> even_stride([1, 2], 5)
    [1, 2]
    """
    n = len(items)
    if k <= 0:
        return []
    if k >= n:
        return list(items)
    return [items[int(i * n / k)] for i in range(k)]


def index_specimens(zip_paths, verbose=True):
    """zip 목록을 훑어 개체 -> [(zip, 내부경로, 등급)] 인덱스를 만든다.

    zip 을 열어 infolist 만 읽으므로 이미지 디코딩은 안 한다. 224GB 라도 빠르다.
    """
    specimens = defaultdict(list)
    for zip_path in zip_paths:
        grade = grade_from_zip_name(zip_path) or ""
        try:
            with zipfile.ZipFile(zip_path) as zf:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    name = Path(info.filename)
                    if name.suffix.lower() not in IMAGE_EXTS:
                        continue
                    key = specimen_key("{}_{}.jpg".format(
                        Path(zip_path).stem, name.stem))
                    specimens[key].append((zip_path, info.filename, grade))
        except zipfile.BadZipFile:
            if verbose:
                print("  [건너뜀] 열 수 없는 zip: {}".format(zip_path))
    # 촬영 순서 정렬 — stride 가 각도를 고르게 덮으려면 필수다
    for key in specimens:
        specimens[key].sort(key=lambda t: t[1])
    return specimens


def plan_item(specimens, per_specimen=None, quota=None):
    """개체 인덱스에서 뽑을 목록을 정한다.

    per_specimen 이 주어지면 개체당 그 장수(부족하면 있는 만큼).
    quota 만 주어지면 총 장수를 개체에 고르게 나눈다.
    등급이 고르게 섞이도록 개체를 등급별로 라운드로빈 정렬한다.
    """
    keys = sorted(specimens)
    if not keys:
        return []

    # 등급별로 개체를 나눈 뒤 번갈아 꺼내 순서를 만든다. quota 때문에 뒤쪽이 잘려도
    # 한 등급만 통째로 빠지는 일이 없게 하기 위함이다.
    by_grade = defaultdict(list)
    for k in keys:
        by_grade[specimens[k][0][2]].append(k)
    ordered = []
    grades = sorted(by_grade)
    i = 0
    while len(ordered) < len(keys):
        g = grades[i % len(grades)]
        if by_grade[g]:
            ordered.append(by_grade[g].pop(0))
        i += 1

    if per_specimen:
        selected = []
        for key in ordered:
            selected.extend(even_stride(specimens[key], per_specimen))
        if quota:
            selected = selected[:quota]
        return selected

    quota = quota or len(keys) * 6
    base, extra = divmod(quota, len(ordered))
    selected = []
    for i, key in enumerate(ordered):
        selected.extend(even_stride(specimens[key], base + (1 if i < extra else 0)))
    return selected


def resize_max_side(img, max_side):
    w, h = img.size
    scale = max_side / float(max(w, h))
    if scale >= 1:
        return img
    return img.resize((int(w * scale), int(h * scale)), Image.BILINEAR)


def extract(source_dir, out_dir, per_specimen=6, quota=None, max_side=512,
            quality=90, items=None, overwrite=False, verbose=True):
    source_dir = Path(source_dir)
    out_dir = Path(out_dir)
    if not source_dir.is_dir():
        raise FileNotFoundError("원천 폴더가 없다: {}".format(source_dir))

    zips_by_item = defaultdict(list)
    for zip_path in sorted(source_dir.glob("*.zip")):
        item = item_from_zip_name(zip_path)
        if item is None:
            continue
        if items and item not in items:
            continue
        zips_by_item[item].append(zip_path)

    if not zips_by_item:
        raise RuntimeError(
            "품목을 알아볼 수 있는 zip 이 없다: {}\n"
            "  파일명 규칙은 <품목영문>_<품종>_<등급코드>.zip 이다.".format(source_dir))

    summary = []
    for item in sorted(zips_by_item):
        zip_paths = zips_by_item[item]
        cls_dir = out_dir / item
        cls_dir.mkdir(parents=True, exist_ok=True)

        specimens = index_specimens(zip_paths, verbose=verbose)
        selected = plan_item(specimens, per_specimen=per_specimen, quota=quota)
        if verbose:
            print("{}: zip {}개 / 개체 {}개 → {}장 추출 (개체당 {:.1f}장)".format(
                item, len(zip_paths), len(specimens), len(selected),
                len(selected) / max(1, len(specimens))))

        by_zip = defaultdict(list)
        for zip_path, name, grade in selected:
            by_zip[zip_path].append((name, grade))

        saved = 0
        for zip_path, entries in by_zip.items():
            with zipfile.ZipFile(zip_path) as zf:
                for name, _grade in entries:
                    out_name = "{}_{}.jpg".format(Path(zip_path).stem, Path(name).stem)
                    dest = cls_dir / out_name
                    if dest.exists() and not overwrite:
                        saved += 1
                        continue
                    with zf.open(name) as fh:
                        img = Image.open(io.BytesIO(fh.read())).convert("RGB")
                    resize_max_side(img, max_side).save(dest, quality=quality)
                    saved += 1
        summary.append((item, len(specimens), saved))

    if verbose:
        print("\n" + "=" * 52)
        print("{:<8}{:>10}{:>10}{:>14}".format("품목", "개체", "추출", "장/개체"))
        print("-" * 52)
        for item, n_spec, saved in summary:
            print("{:<8}{:>10}{:>10}{:>14.1f}".format(
                item, n_spec, saved, saved / max(1, n_spec)))
        print("-" * 52)
        print("총 {:,}장 / {:,}개체".format(
            sum(s for _, _, s in summary), sum(n for _, n, _ in summary)))
        print("\n※ 장수를 더 늘리고 싶어지면 docs/SETUP.md 9절을 먼저 읽을 것.")
        print("  v4(50,000장)는 v3(5,000장)보다 실사진에서 나빴다.")
    return summary


def add_arguments(p):
    p.add_argument("--source-dir", required=True,
                   help="원천 zip 폴더. 예) ...\\1.Training\\원천데이터_230921_add")
    p.add_argument("--out", default="data/raw/item_v3")
    p.add_argument("--per-specimen", type=int, default=6,
                   help="개체당 추출 장수. 기본 6 (약 20,000장). 늘리기 전에 문서를 읽을 것")
    p.add_argument("--quota", type=int, default=0,
                   help="품목당 총 장수 상한. 0이면 제한 없음")
    p.add_argument("--max-side", type=int, default=512)
    p.add_argument("--quality", type=int, default=90)
    p.add_argument("--items", nargs="*", default=None, help="특정 품목만 추출")
    p.add_argument("--overwrite", action="store_true")
    p.add_argument("--manifest", default="data/manifests/item_v3.csv",
                   help="추출 후 바로 만들 매니페스트 경로. 빈 문자열이면 안 만든다")
    p.add_argument("--val-ratio", type=float, default=0.15)
    p.add_argument("--seed", type=int, default=42)
    return p


def main(argv=None):
    p = argparse.ArgumentParser(description="B-A05 원천 zip → 학습 데이터 + 매니페스트")
    args = add_arguments(p).parse_args(argv)

    extract(
        args.source_dir, args.out,
        per_specimen=args.per_specimen or None,
        quota=args.quota or None,
        max_side=args.max_side, quality=args.quality,
        items=args.items, overwrite=args.overwrite,
    )
    if args.manifest:
        print("\n매니페스트 생성 중...")
        manifest_mod.build(args.out, args.manifest,
                           val_ratio=args.val_ratio, seed=args.seed)


if __name__ == "__main__":
    main()
