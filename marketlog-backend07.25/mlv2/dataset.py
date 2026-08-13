"""매니페스트 기반 Dataset / DataLoader.

`torchvision.datasets.ImageFolder` 를 안 쓴다. 이유 둘:
  1. 기존 코드는 같은 폴더에 ImageFolder 를 세 번 만들어(분할 계산 + train + val)
     디스크를 3회 훑었다. OneDrive 동기화 폴더에서는 이게 분 단위로 체감된다.
  2. ImageFolder 는 클래스 순서를 폴더 이름 정렬로 정하는데, 폴더가 하나 사라지면
     인덱스가 조용히 밀린다. 매니페스트에 classes 를 박아두면 그 사고가 없다.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image
from torch.utils.data import DataLoader, Dataset

from mlv2 import manifest as manifest_mod
from mlv2.augment import build_transforms


class ManifestDataset(Dataset):
    """매니페스트 행 목록을 그대로 받는 Dataset.

    `strict=False` 면 읽기 실패한 이미지를 건너뛰는 대신 검은 이미지를 돌려준다.
    학습 도중 파일 하나 때문에 몇 시간짜리 job 이 죽는 것을 막기 위함이며,
    몇 장이 그렇게 됐는지는 `.broken` 에 쌓인다.
    """

    def __init__(self, rows, classes, transform=None, root=None, strict=True):
        self.rows = list(rows)
        self.classes = list(classes)
        self.class_to_idx = dict((c, i) for i, c in enumerate(self.classes))
        self.transform = transform
        self.root = Path(root) if root else Path.cwd()
        self.strict = strict
        self.broken = []

        unknown = sorted(set(r["item"] for r in self.rows) - set(self.classes))
        if unknown:
            raise ValueError("classes 에 없는 품목이 매니페스트에 있다: {}".format(unknown))

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, idx):
        row = self.rows[idx]
        path = self.root / row["path"]
        try:
            img = Image.open(path).convert("RGB")
        except Exception as exc:
            if self.strict:
                raise RuntimeError("이미지 읽기 실패: {} ({})".format(path, exc))
            self.broken.append(str(path))
            img = Image.new("RGB", (256, 256), (0, 0, 0))
        if self.transform is not None:
            img = self.transform(img)
        return img, self.class_to_idx[row["item"]]

    def class_counts(self):
        from collections import Counter

        return Counter(r["item"] for r in self.rows)

    def majority_baseline(self):
        """'전부 최빈 클래스로 찍기' 의 정확도. 이 값을 못 넘으면 학습이 안 된 것이다."""
        counts = self.class_counts()
        if not counts:
            return 0.0
        return max(counts.values()) / sum(counts.values())


def _probe_readable(dataset, root, n=48, max_fail=0.10):
    """학습 시작 전에 이미지가 **실제로 읽히는지** 표본으로 확인한다.

    `strict=False` 는 읽기 실패를 검은 이미지로 대체한다. 파일 하나 때문에 몇 시간짜리
    job 이 죽는 걸 막으려는 장치인데, **전부 실패해도 조용히 학습이 진행된다**는 구멍이
    있었다. 2026-08-12 에 실제로 당했다 — 서버에 학습 이미지를 안 올린 상태로 돌려서
    42,446장이 전부 검은 화면이 됐고, train acc 가 정확히 0.10(랜덤), loss 가 정확히
    ln(10)=2.303 에 고착됐다. 원인을 찾는 데 학습 두 번(약 1시간)을 썼다.

    표본 몇 장만 열어보면 1초에 잡히는 문제다.
    """
    import random as _random
    from PIL import Image

    if len(dataset) == 0:
        return
    rng = _random.Random(0)
    idxs = rng.sample(range(len(dataset)), min(n, len(dataset)))
    bad = []
    for i in idxs:
        p = dataset.root / dataset.rows[i]["path"]
        try:
            with Image.open(p) as im:
                im.verify()
        except Exception as exc:
            bad.append((str(p), type(exc).__name__))

    ratio = len(bad) / float(len(idxs))
    if ratio > max_fail:
        lines = "\n".join("    {} ({})".format(p, e) for p, e in bad[:5])
        raise RuntimeError(
            "학습 이미지를 읽을 수 없다 — 표본 {}장 중 {}장 실패({:.0%}).\n"
            "{}\n"
            "  매니페스트의 경로는 **실행 위치 기준 상대경로**다.\n"
            "  현재 root: {}\n"
            "  데이터를 이 위치로 옮기거나 --data-root 로 실제 위치를 지정할 것.\n"
            "  (이대로 두면 검은 이미지로 학습돼 정확도가 랜덤에 고정된다)".format(
                len(idxs), len(bad), ratio, lines, Path(root or ".").resolve()))
    if bad:
        print("[경고] 표본 {}장 중 {}장을 못 읽었다. 학습은 진행하지만 확인할 것.".format(
            len(idxs), len(bad)))


def build_dataloaders(manifest_path, img_size=224, batch_size=32, num_workers=4,
                      aug_level="strong", backgrounds_dir=None, bg_prob=0.5,
                      root=None, strict=False, verbose=True):
    """매니페스트 CSV → (train_loader, val_loader, classes).

    분할은 여기서 계산하지 않는다. 이미 CSV 에 박혀 있는 것을 읽기만 한다.
    """
    rows = manifest_mod.read(manifest_path)
    ok, problems = manifest_mod.verify_split(rows)
    if not ok:
        raise RuntimeError(
            "매니페스트에 문제가 있어 학습을 시작하지 않는다 — {}\n"
            "  `python -m mlv2 manifest --data-dir ...` 로 다시 만들 것.".format(problems)
        )

    classes = manifest_mod.classes(rows)
    train_rows = [r for r in rows if r["split"] == "train"]
    val_rows = [r for r in rows if r["split"] == "val"]

    train_tf, eval_tf = build_transforms(
        img_size=img_size, level=aug_level,
        backgrounds_dir=backgrounds_dir, bg_prob=bg_prob,
    )

    train_ds = ManifestDataset(train_rows, classes, train_tf, root=root, strict=strict)
    val_ds = ManifestDataset(val_rows, classes, eval_tf, root=root, strict=strict)

    _probe_readable(train_ds, root)

    if verbose:
        print("클래스 {}개: {}".format(len(classes), classes))
        print("train {:,}장 / val {:,}장 (개체 {:,}개)".format(
            len(train_ds), len(val_ds), len(set(r["specimen"] for r in rows))))
        print("val 최빈클래스 비율(= 아무것도 안 배운 모델의 정확도): {:.4f}".format(
            val_ds.majority_baseline()))
        print("증강 강도: {}{}".format(
            aug_level,
            " + 배경치환 p={}".format(bg_prob) if backgrounds_dir else ""))

    # drop_last=True 는 BatchNorm 이 배치 1에서 터지는 것을 막는다.
    train_loader = DataLoader(
        train_ds, batch_size=batch_size, shuffle=True, num_workers=num_workers,
        pin_memory=True, drop_last=len(train_ds) > batch_size,
        persistent_workers=num_workers > 0,
    )
    val_loader = DataLoader(
        val_ds, batch_size=batch_size, shuffle=False, num_workers=num_workers,
        pin_memory=True, persistent_workers=num_workers > 0,
    )
    return train_loader, val_loader, classes
