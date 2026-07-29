"""품질 등급(CORAL 순서형) 데이터로더. 품목인식과 동일하게 개체(specimen) 단위로
train/val을 분할해 데이터 누수를 막고, 폴더명(특/상/보통)을 고정된 순서형 인덱스로 매핑한다.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path

import torch
from torch.utils.data import DataLoader, Dataset, Subset
from torchvision.datasets import ImageFolder

from marketlog_vision.data.datasets import _specimen_key, build_transforms
from marketlog_vision.models.quality_grading import GRADE_ORDER


class _OrdinalRemap(Dataset):
    """ImageFolder의 알파벳순 class index를 GRADE_ORDER 기준 순서형 인덱스로 재매핑."""

    def __init__(self, subset, idx_to_ordinal: list[int]):
        self.subset = subset
        self.idx_to_ordinal = idx_to_ordinal

    def __len__(self):
        return len(self.subset)

    def __getitem__(self, i):
        img, cls_idx = self.subset[i]
        return img, self.idx_to_ordinal[cls_idx]


def build_grading_dataloaders(
    data_dir: str,
    img_size: int = 224,
    batch_size: int = 32,
    val_ratio: float = 0.15,
    num_workers: int = 4,
    seed: int = 42,
    backgrounds_dir: str | None = None,
    bg_prob: float = 0.3,
):
    """data_dir 아래 <특|상|보통>/*.jpg 형태를 기대한다."""
    data_dir = Path(data_dir)
    train_tf, eval_tf = build_transforms(img_size, backgrounds_dir, bg_prob)

    base = ImageFolder(str(data_dir))
    missing = set(base.classes) - set(GRADE_ORDER)
    if missing:
        raise ValueError(f"알 수 없는 등급 폴더: {missing} (GRADE_ORDER={GRADE_ORDER})")
    idx_to_ordinal = [GRADE_ORDER.index(c) for c in base.classes]

    groups: dict[tuple[str, str], list[int]] = defaultdict(list)
    for idx, (path, _) in enumerate(base.samples):
        p = Path(path)
        key = (p.parent.name, _specimen_key(p.name))
        groups[key].append(idx)

    group_keys = sorted(groups.keys())
    generator = torch.Generator().manual_seed(seed)
    perm = torch.randperm(len(group_keys), generator=generator).tolist()
    n_val_groups = max(1, int(len(group_keys) * val_ratio))
    val_group_pos = set(perm[:n_val_groups])

    train_idx, val_idx = [], []
    for i, key in enumerate(group_keys):
        (val_idx if i in val_group_pos else train_idx).extend(groups[key])

    train_ds = _OrdinalRemap(
        Subset(ImageFolder(str(data_dir), transform=train_tf), train_idx), idx_to_ordinal)
    val_ds = _OrdinalRemap(
        Subset(ImageFolder(str(data_dir), transform=eval_tf), val_idx), idx_to_ordinal)

    train_loader = DataLoader(
        train_ds, batch_size=batch_size, shuffle=True,
        num_workers=num_workers, pin_memory=True, drop_last=True,
    )
    val_loader = DataLoader(
        val_ds, batch_size=batch_size, shuffle=False,
        num_workers=num_workers, pin_memory=True,
    )
    return train_loader, val_loader
