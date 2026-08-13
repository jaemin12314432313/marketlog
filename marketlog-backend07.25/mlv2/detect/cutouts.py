"""누끼 뱅크 구축 — 원본 zip 21만 장 → 쓸 만한 RGBA 누끼만 골라낸다.

## 왜 v2(5만 장)가 아니라 원본에서 뜨는가

600장 표본에서 "잘리지 않은 개체"(테두리 접촉 5% 미만) 비율을 쟀다.

    감귤 65% / 감자 40% / 배 38% / 감 35% / 사과 32%
    무 22% / 마늘 18% / 배추 18% / 양배추 15% / **양파 2%**

전체 평균 28%. 양파는 50장을 훑어야 1장이 나온다. v2 는 품목당 5,000장이라
양파 누끼가 100개밖에 안 나오고, 그마저 개체가 편중된다. 원본은 품목당 2만 장이
넘으므로 여기서 떠야 한다. **어차피 통과 못 한 것은 디코딩만 하고 버리므로,
zip 을 푸는 게 아니라 스트리밍으로 읽는다.**

## 개체당 상한을 두는 이유

같은 개체를 40~175장 찍은 데이터다. 상한이 없으면 뱅크가 몇몇 개체로 도배되고,
합성 이미지마다 같은 사과가 반복 등장한다. YOLO 는 그 개체의 얼룩까지 외운다.
`--per-specimen` 기본 3 은 "각도는 다양하게, 개체는 넓게" 를 노린 값이다.

## 물리 크기를 같이 저장한다

`data/label_metadata.csv` 의 `width`(cm), `weight`(g) 를 `image_key` 로 조인해
인덱스에 남긴다. 합성기가 이 값으로 상대 스케일을 정한다 — 이게 합성 접근의 핵심 이득이다.
메타데이터가 없으면 품목 중앙값으로 대체한다.
"""
from __future__ import annotations

import argparse
import csv
import io
import random
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from mlv2 import compat
from mlv2.compat import setup_stdout
from mlv2.detect import PHYSICAL_WIDTH_CM
from mlv2.detect import matting
from mlv2.items import IMAGE_EXTS, grade_from_zip_name, item_from_zip_name, specimen_key

setup_stdout()

INDEX_FIELDS = ["file", "item", "specimen", "grade", "width_cm", "weight_g",
                "angle", "fg_ratio", "edge_contact", "solidity", "src_zip", "src_name"]

# 양파처럼 통과율이 낮은 품목은 기준을 풀어야 뱅크가 빈다. 값은 표본 통과율의 역수 감각.
PER_ITEM_MAX_EDGE = {
    "양파": 0.15,
    "양배추": 0.12,
    "배추": 0.12,
    "마늘": 0.10,
}


def load_metadata(csv_path):
    """image_key -> {width_cm, weight_g, angle} 사전. 없으면 빈 사전."""
    p = Path(csv_path)
    if not p.is_file():
        print("[알림] 메타데이터 CSV 가 없어 품목 중앙값으로 대체한다: {}".format(p))
        return {}
    meta = {}
    with p.open("r", encoding="utf-8-sig", newline="") as fh:
        for r in csv.DictReader(fh):
            try:
                w = float(r["width"])
            except (KeyError, ValueError, TypeError):
                w = None
            try:
                g = float(r["weight"])
            except (KeyError, ValueError, TypeError):
                g = None
            meta[r.get("image_key", "")] = {
                "width_cm": w, "weight_g": g,
                "angle": r.get("angle_direction", ""),
            }
    print("메타데이터 {:,}건 로드".format(len(meta)))
    return meta


def iter_zip_entries(zip_path):
    """zip 안의 이미지 항목을 (내부경로, image_key) 로 흘려준다. 압축은 풀지 않는다."""
    try:
        zf = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile:
        print("  [건너뜀] 열 수 없는 zip: {}".format(zip_path))
        return
    with zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = Path(info.filename)
            if name.suffix.lower() not in IMAGE_EXTS:
                continue
            key = "{}_{}".format(Path(zip_path).stem, name.stem)
            yield info.filename, key


def build_bank(source_dir, out_dir, metadata_csv="data/label_metadata.csv",
               per_item=1200, per_specimen=3, max_side=384, seed=42,
               items=None, scan_limit=0, verbose=True):
    """원본 zip → 누끼 뱅크. 인덱스 CSV 경로를 돌려준다."""
    import cv2

    source_dir = Path(source_dir)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = load_metadata(metadata_csv)
    rng = random.Random(seed)

    zips_by_item = defaultdict(list)
    for zp in sorted(source_dir.glob("*.zip")):
        it = item_from_zip_name(zp)
        if it and (not items or it in items):
            zips_by_item[it].append(zp)
    if not zips_by_item:
        raise RuntimeError("품목을 알아볼 zip 이 없다: {}".format(source_dir))

    index_rows = []
    stats = {}

    for item in sorted(zips_by_item):
        max_edge = PER_ITEM_MAX_EDGE.get(item, 0.05)
        item_dir = out_dir / item
        item_dir.mkdir(parents=True, exist_ok=True)

        # 등급(=촬영 배치) 을 섞어야 뱅크가 한 조명에 묶이지 않는다.
        entries = []
        for zp in zips_by_item[item]:
            grade = grade_from_zip_name(zp) or ""
            for inner, key in iter_zip_entries(zp):
                entries.append((zp, inner, key, grade))
        rng.shuffle(entries)
        if scan_limit:
            entries = entries[:scan_limit]

        per_spec = Counter()
        kept = 0
        seen = 0
        reject = Counter()
        by_zip = defaultdict(list)
        for e in entries:
            by_zip[e[0]].append(e)

        for zp, group in by_zip.items():
            if kept >= per_item:
                break
            with zipfile.ZipFile(zp) as zf:
                for _zp, inner, key, grade in group:
                    if kept >= per_item:
                        break
                    spec = specimen_key(Path(inner).name)
                    if per_spec[spec] >= per_specimen:
                        continue
                    seen += 1
                    try:
                        raw = zf.read(inner)
                        arr = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
                    except Exception:
                        reject["디코딩실패"] += 1
                        continue
                    if arr is None:
                        reject["디코딩실패"] += 1
                        continue

                    rgba, q = matting.cut_out(arr)
                    if rgba is None:
                        reject["마스크없음"] += 1
                        continue
                    if not matting.is_usable(q, max_edge_contact=max_edge):
                        if q["edge_contact"] > max_edge:
                            reject["잘림"] += 1
                        elif q["solidity"] < 0.80:
                            reject["그림자/지저분"] += 1
                        else:
                            reject["면적범위"] += 1
                        continue

                    rgba = matting.trim_ground_shadow(rgba)
                    h, w = rgba.shape[:2]
                    if max(h, w) > max_side:
                        s = max_side / float(max(h, w))
                        rgba = cv2.resize(rgba, (max(1, int(w * s)), max(1, int(h * s))),
                                          interpolation=cv2.INTER_AREA)

                    fname = "{}.png".format(key)
                    compat.imwrite(str(item_dir / fname), rgba)
                    per_spec[spec] += 1
                    kept += 1

                    m = meta.get(key, {})
                    index_rows.append({
                        "file": "{}/{}".format(item, fname),
                        "item": item,
                        "specimen": spec,
                        "grade": grade,
                        "width_cm": m.get("width_cm") or PHYSICAL_WIDTH_CM.get(item, 8.0),
                        "weight_g": m.get("weight_g") or "",
                        "angle": m.get("angle", ""),
                        "fg_ratio": round(q["fg_ratio"], 4),
                        "edge_contact": round(q["edge_contact"], 4),
                        "solidity": round(q["solidity"], 4),
                        "src_zip": Path(zp).name,
                        "src_name": inner,
                    })

        stats[item] = (seen, kept, len(per_spec), reject)
        if verbose:
            print("{:<5} 훑음 {:>6} → 채택 {:>5} (개체 {:>4}, 통과율 {:>5.1f}%)  기각: {}".format(
                item, seen, kept, len(per_spec),
                100.0 * kept / max(1, seen),
                ", ".join("{} {}".format(k, v) for k, v in reject.most_common(3)) or "-"))

    index_path = out_dir / "index.csv"
    with index_path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=INDEX_FIELDS)
        w.writeheader()
        for r in index_rows:
            w.writerow(r)

    if verbose:
        print("\n누끼 뱅크 {:,}개 / 인덱스: {}".format(len(index_rows), index_path))
        thin = [i for i, (_, k, _, _) in stats.items() if k < per_item * 0.3]
        if thin:
            print("[주의] 뱅크가 얇은 품목: {}".format(", ".join(thin)))
            print("       --scan-limit 를 늘리거나 PER_ITEM_MAX_EDGE 를 완화할 것.")
    return index_path


def build_bank_from_dir(data_dir, out_dir, metadata_csv="data/label_metadata.csv",
                        per_item=400, per_specimen=3, max_side=384, seed=42,
                        items=None, scan_limit=0, verbose=True):
    """이미 추출된 `<품목>/*.jpg` 폴더에서 뱅크를 만든다.

    원본 zip(224GB)을 돌리기 전에 파이프라인을 시험하는 용도다. 통과율·누끼 품질을
    몇 분 안에 확인할 수 있어서, 임계값을 조정할 때 여기서 반복하는 게 훨씬 빠르다.
    본 뱅크는 `build_bank()` 로 원본에서 뜰 것 — v2 는 잘리지 않은 개체가 부족하다.
    """
    import cv2

    data_dir = Path(data_dir)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = load_metadata(metadata_csv)
    rng = random.Random(seed)

    index_rows = []
    for item in sorted(p.name for p in data_dir.iterdir() if p.is_dir()):
        if items and item not in items:
            continue
        max_edge = PER_ITEM_MAX_EDGE.get(item, 0.05)
        item_dir = out_dir / item
        item_dir.mkdir(parents=True, exist_ok=True)

        files = sorted((data_dir / item).iterdir())
        rng.shuffle(files)
        if scan_limit:
            files = files[:scan_limit]

        per_spec = Counter()
        kept = seen = 0
        reject = Counter()
        for fp in files:
            if kept >= per_item:
                break
            if fp.suffix.lower() not in IMAGE_EXTS:
                continue
            spec = specimen_key(fp.name)
            if per_spec[spec] >= per_specimen:
                continue
            seen += 1
            arr = compat.imread(str(fp))
            if arr is None:
                reject["디코딩실패"] += 1
                continue
            rgba, q = matting.cut_out(arr)
            if rgba is None:
                reject["마스크없음"] += 1
                continue
            if not matting.is_usable(q, max_edge_contact=max_edge):
                reject["잘림" if q["edge_contact"] > max_edge else "그림자/면적"] += 1
                continue

            rgba = matting.trim_ground_shadow(rgba)
            h, w = rgba.shape[:2]
            if max(h, w) > max_side:
                s = max_side / float(max(h, w))
                rgba = cv2.resize(rgba, (max(1, int(w * s)), max(1, int(h * s))),
                                  interpolation=cv2.INTER_AREA)
            fname = fp.stem + ".png"
            compat.imwrite(str(item_dir / fname), rgba)
            per_spec[spec] += 1
            kept += 1

            m = meta.get(fp.stem, {})
            index_rows.append({
                "file": "{}/{}".format(item, fname),
                "item": item, "specimen": spec, "grade": "",
                "width_cm": m.get("width_cm") or PHYSICAL_WIDTH_CM.get(item, 8.0),
                "weight_g": m.get("weight_g") or "",
                "angle": m.get("angle", ""),
                "fg_ratio": round(q["fg_ratio"], 4),
                "edge_contact": round(q["edge_contact"], 4),
                "solidity": round(q["solidity"], 4),
                "src_zip": "", "src_name": fp.name,
            })
        if verbose:
            print("{:<5} 훑음 {:>5} → 채택 {:>4} (개체 {:>3}, 통과율 {:>5.1f}%)  기각: {}".format(
                item, seen, kept, len(per_spec), 100.0 * kept / max(1, seen),
                ", ".join("{} {}".format(k, v) for k, v in reject.most_common(2)) or "-"))

    index_path = out_dir / "index.csv"
    with index_path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=INDEX_FIELDS)
        w.writeheader()
        for r in index_rows:
            w.writerow(r)
    if verbose:
        print("\n누끼 {:,}개 / 인덱스: {}".format(len(index_rows), index_path))
    return index_path


def read_index(index_path):
    with Path(index_path).open("r", encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def split_bank(rows, val_ratio=0.15, seed=42):
    """누끼를 개체 단위로 train/val 로 나눈다.

    **이게 없으면 합성 데이터의 검증 성능이 통째로 거짓이 된다.** train 합성 이미지와
    val 합성 이미지에 같은 개체 누끼가 들어가면, YOLO 는 그 개체를 외워서 val 에서
    맞힌다. 기존 프로젝트가 촬영 세션 누수로 QWK 0.765 → 0.421 을 겪은 것과 같은 종류의
    사고이며, 합성 파이프라인에서는 더 쉽게 일어난다.
    """
    by_item = defaultdict(set)
    for r in rows:
        by_item[r["item"]].add(r["specimen"])
    rng = random.Random(seed)
    val_spec = set()
    for item in sorted(by_item):
        specs = sorted(by_item[item])
        rng.shuffle(specs)
        n = max(1, int(round(len(specs) * val_ratio)))
        val_spec.update(specs[:n])
    train = [r for r in rows if r["specimen"] not in val_spec]
    val = [r for r in rows if r["specimen"] in val_spec]
    return train, val


def main(argv=None):
    p = argparse.ArgumentParser(description="원본 zip → 누끼 뱅크")
    p.add_argument("--source-dir", required=True,
                   help="원천 zip 폴더 (1.Training\\원천데이터_230921_add). "
                        "--from-dir 를 주면 추출된 <품목>/*.jpg 폴더로 해석한다")
    p.add_argument("--from-dir", action="store_true",
                   help="zip 대신 이미 추출된 이미지 폴더에서 만든다(시험용, 빠름)")
    p.add_argument("--out", default="data/cutouts")
    p.add_argument("--metadata-csv", default="data/label_metadata.csv")
    p.add_argument("--per-item", type=int, default=1200,
                   help="품목당 채택 상한. 10품목 × 1200 = 12,000개")
    p.add_argument("--per-specimen", type=int, default=3,
                   help="개체당 상한. 늘리면 같은 개체가 합성에 반복 등장한다")
    p.add_argument("--max-side", type=int, default=384)
    p.add_argument("--scan-limit", type=int, default=0,
                   help="품목당 훑을 최대 장수(0=전부). 시험 실행 시 3000 정도로")
    p.add_argument("--items", nargs="*", default=None)
    p.add_argument("--seed", type=int, default=42)
    a = p.parse_args(argv)

    fn = build_bank_from_dir if a.from_dir else build_bank
    fn(a.source_dir, a.out, metadata_csv=a.metadata_csv,
       per_item=a.per_item, per_specimen=a.per_specimen,
       max_side=a.max_side, seed=a.seed, items=a.items,
       scan_limit=a.scan_limit)


if __name__ == "__main__":
    main()
