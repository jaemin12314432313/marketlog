"""매니페스트 — 이 재작성의 핵심 아이디어.

기존 코드는 `build_dataloaders()` 안에서 매번 난수로 train/val 을 갈랐다. 그래서:
  - 데이터가 한 장만 늘어도 분할 전체가 바뀐다(시드가 같아도).
  - 학습이 끝난 뒤 "이 체크포인트가 어떤 개체로 평가됐는가" 를 알 수 없다.
  - 개체 누수가 없다는 것을 **주장만** 할 수 있고 증명할 수 없다.

여기서는 (이미지 경로, 품목, 개체ID, split) 을 CSV 한 장에 못박는다.
학습·평가·감사가 전부 같은 파일을 읽으므로 셋이 어긋날 수 없다.

또 하나 바뀐 것: **분할을 품목별로 층화한다.** 기존 코드는 전체 개체를 한 덩어리로
섞어 15% 를 val 로 떼었는데, 개체 수가 품목별로 4.47배까지 차이나므로(양파 545 vs
감자 122) val 의 품목 구성이 매번 들쭉날쭉했다. 품목별로 15% 씩 떼면 그 문제가 없다.

CSV 스키마:
    path         프로젝트 루트 기준 상대경로 (POSIX 구분자)
    item         품목명(한글)
    specimen     개체 ID  ← split 은 항상 이 단위
    split        "train" | "val"
    source       추출 출처 zip 이름 (없으면 빈 칸)
    grade        원천 등급코드 유래(특/상/보통). 품목 인식에는 안 쓰고 균형 감사용
"""
from __future__ import annotations

import csv
import random
from collections import Counter, defaultdict
from pathlib import Path

from mlv2.items import is_image, item_from_filename, specimen_key

FIELDNAMES = ["path", "item", "specimen", "split", "source", "grade"]


def scan_data_dir(data_dir, root=None):
    """`<data_dir>/<품목명>/*.jpg` 구조를 훑어 매니페스트 행 목록을 만든다.

    split 은 아직 비워 둔다. `assign_split()` 이 채운다.
    ImageFolder 를 쓰지 않는 이유: 기존 코드는 같은 폴더를 ImageFolder 로 세 번
    생성해서(분할 계산 1회 + train/val 각 1회) 디스크를 3번 훑었다. OneDrive 경로에서는
    이게 체감될 만큼 느리다.
    """
    data_dir = Path(data_dir)
    root = Path(root) if root else Path.cwd()
    if not data_dir.is_dir():
        raise FileNotFoundError("데이터 폴더가 없다: {}".format(data_dir))

    rows = []
    skipped = []
    for cls_dir in sorted(p for p in data_dir.iterdir() if p.is_dir()):
        item = cls_dir.name
        for img_path in sorted(cls_dir.iterdir()):
            if not img_path.is_file() or not is_image(img_path):
                continue
            name = img_path.name
            # 폴더명이 곧 라벨이다. 다만 파일명에서 유도한 품목과 어긋나면 알려준다 —
            # 추출 스크립트가 잘못 배치한 것을 조용히 학습하는 사고를 막는다.
            derived = item_from_filename(name)
            if derived is not None and derived != item:
                skipped.append((str(img_path), item, derived))
                continue
            rows.append({
                "path": _relpath(img_path, root),
                "item": item,
                "specimen": "{}/{}".format(item, specimen_key(name)),
                "split": "",
                "source": name.split("_")[0] if "_" in name else "",
                "grade": "",
            })
    return rows, skipped


def _relpath(path, root):
    path = Path(path).resolve()
    try:
        return path.relative_to(Path(root).resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def assign_split(rows, val_ratio=0.15, seed=42):
    """개체 단위로, 품목별 층화하여 train/val 을 나눈다. rows 를 제자리에서 수정한다.

    같은 개체의 사진은 전부 같은 쪽으로 간다. 이게 무너지면 val_acc 가 **올라가므로**
    실패가 성공처럼 보인다 — 이 프로젝트에서 실제로 겪은 일이다.
    """
    if not 0.0 < val_ratio < 1.0:
        raise ValueError("val_ratio 는 0과 1 사이여야 한다: {}".format(val_ratio))

    by_item = defaultdict(set)
    for r in rows:
        by_item[r["item"]].add(r["specimen"])

    rng = random.Random(seed)
    val_specimens = set()
    for item in sorted(by_item):
        specs = sorted(by_item[item])
        rng.shuffle(specs)
        n_val = max(1, int(round(len(specs) * val_ratio)))
        if n_val >= len(specs):
            raise ValueError(
                "'{}' 개체가 {}개뿐이라 val_ratio={} 로는 train 이 비어버린다".format(
                    item, len(specs), val_ratio)
            )
        val_specimens.update(specs[:n_val])

    for r in rows:
        r["split"] = "val" if r["specimen"] in val_specimens else "train"
    return rows


def verify_split(rows):
    """개체 누수가 없는지 실제로 센다. 학습 시작 전에 반드시 호출할 것.

    반환: (ok, 문제요약 문자열)
    """
    train_spec = set(r["specimen"] for r in rows if r["split"] == "train")
    val_spec = set(r["specimen"] for r in rows if r["split"] == "val")
    unassigned = [r for r in rows if r["split"] not in ("train", "val")]

    problems = []
    overlap = train_spec & val_spec
    if overlap:
        sample = sorted(overlap)[:5]
        problems.append("개체 누수 {}건 (예: {})".format(len(overlap), ", ".join(sample)))
    if unassigned:
        problems.append("split 미배정 {}행".format(len(unassigned)))
    if not train_spec:
        problems.append("train 이 비어 있다")
    if not val_spec:
        problems.append("val 이 비어 있다")

    # 품목이 한쪽에만 있는 경우도 사고다 (val 에 없는 클래스는 평가가 안 된다)
    train_items = set(r["item"] for r in rows if r["split"] == "train")
    val_items = set(r["item"] for r in rows if r["split"] == "val")
    only_train = train_items - val_items
    only_val = val_items - train_items
    if only_train:
        problems.append("val 에 없는 품목: {}".format(", ".join(sorted(only_train))))
    if only_val:
        problems.append("train 에 없는 품목: {}".format(", ".join(sorted(only_val))))

    return (not problems), "; ".join(problems)


def summarize(rows):
    """사람이 읽을 요약표. 이미지 수와 개체 수를 나란히 보여준다.

    이미지 수만 보면 균형이 맞아 보이는 착시가 생긴다 — 실제 유효 표본은 개체 수다
    (이미지 기준 불균형 1.05배 vs 개체 기준 4.47배).
    """
    lines = []
    header = "{:<8}{:>9}{:>9}{:>8}{:>8}{:>10}".format(
        "품목", "train", "val", "개체", "val개체", "장/개체")
    lines.append(header)
    lines.append("-" * len(header))

    img_counts, spec_counts = Counter(), {}
    by_item = defaultdict(lambda: {"train": 0, "val": 0, "spec": set(), "vspec": set()})
    for r in rows:
        d = by_item[r["item"]]
        d[r["split"]] = d.get(r["split"], 0) + 1
        d["spec"].add(r["specimen"])
        if r["split"] == "val":
            d["vspec"].add(r["specimen"])

    for item in sorted(by_item):
        d = by_item[item]
        n_img = d["train"] + d["val"]
        n_spec = len(d["spec"])
        img_counts[item] = n_img
        spec_counts[item] = n_spec
        lines.append("{:<8}{:>9}{:>9}{:>8}{:>8}{:>10.1f}".format(
            item, d["train"], d["val"], n_spec, len(d["vspec"]),
            n_img / n_spec if n_spec else 0.0))

    lines.append("-" * len(header))
    lines.append("합계    {:>9}{:>9}{:>8}".format(
        sum(1 for r in rows if r["split"] == "train"),
        sum(1 for r in rows if r["split"] == "val"),
        len(set(r["specimen"] for r in rows))))

    if img_counts and spec_counts and min(spec_counts.values()) > 0:
        img_ratio = max(img_counts.values()) / max(1, min(img_counts.values()))
        spec_ratio = max(spec_counts.values()) / max(1, min(spec_counts.values()))
        lines.append("")
        lines.append("불균형: 이미지 기준 {:.2f}배 / **개체 기준 {:.2f}배**".format(
            img_ratio, spec_ratio))
        lines.append("→ 유효 표본은 개체 수다. 이미지 기준 균형은 착시다.")
    return "\n".join(lines)


def write(rows, out_path):
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDNAMES)
        writer.writeheader()
        for r in rows:
            writer.writerow({k: r.get(k, "") for k in FIELDNAMES})
    return out_path


def read(path):
    with Path(path).open("r", encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def classes(rows):
    """체크포인트에 저장될 클래스 순서. 정렬 고정이라 재현된다."""
    return sorted(set(r["item"] for r in rows))


def build(data_dir, out_path, val_ratio=0.15, seed=42, root=None, verbose=True):
    """스캔 → 분할 → 검증 → 저장을 한 번에. 검증 실패면 예외를 던진다."""
    rows, skipped = scan_data_dir(data_dir, root=root)
    if not rows:
        raise RuntimeError("이미지를 한 장도 못 찾았다: {}".format(data_dir))
    assign_split(rows, val_ratio=val_ratio, seed=seed)
    ok, problems = verify_split(rows)
    if not ok:
        raise RuntimeError("매니페스트 검증 실패 — {}".format(problems))

    write(rows, out_path)
    if verbose:
        if skipped:
            print("[경고] 폴더명과 파일명 품목이 어긋나 {}장을 제외했다.".format(len(skipped)))
            for p, folder, derived in skipped[:5]:
                print("       {} (폴더={}, 파일명유도={})".format(p, folder, derived))
        print(summarize(rows))
        print("\n개체 누수 검사: 통과 (train∩val = 0개체)")
        print("저장: {}".format(out_path))
    return rows
