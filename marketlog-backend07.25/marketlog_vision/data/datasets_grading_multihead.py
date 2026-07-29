"""품목별 등급 헤드 분리용 데이터로더 — 배추의 결구, 사과의 광택·반점처럼
품목마다 품질 신호가 다르므로, 품목별로 별도 CORAL 헤드를 두기 위한 (이미지, 등급, 품목) 샘플셋.
파일명 접두어(zip stem)에서 품목을 역산한다 (예: onion_white_S_... -> 양파).
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path

import torch
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision.datasets import ImageFolder

from marketlog_vision.data.datasets import _specimen_key, build_transforms, item_from_filename
from marketlog_vision.models.quality_grading import GRADE_ORDER


class _GradingItemDataset(Dataset):
    def __init__(self, samples: list[tuple[str, int, str]], transform):
        self.samples = samples  # (path, ordinal_grade, item_name)
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, i):
        path, grade, item = self.samples[i]
        img = Image.open(path).convert("RGB")
        if self.transform:
            img = self.transform(img)
        return img, grade, item


def _collate(batch):
    imgs = torch.stack([b[0] for b in batch])
    grades = torch.tensor([b[1] for b in batch], dtype=torch.long)
    items = [b[2] for b in batch]
    return imgs, grades, items


def build_multihead_grading_dataloaders(
    data_dir: str,
    img_size: int = 224,
    batch_size: int = 32,
    val_ratio: float = 0.15,
    num_workers: int = 4,
    seed: int = 42,
    backgrounds_dir: str | None = None,
    bg_prob: float = 0.3,
):
    """data_dir 아래 <특|상|보통>/*.jpg 형태를 기대한다. 개체(specimen) 단위로 분할해
    데이터 누수를 막고, 파일명에서 역산한 품목별로 라우팅할 수 있도록 품목 라벨도 반환한다.
    """
    data_dir = Path(data_dir)
    train_tf, eval_tf = build_transforms(img_size, backgrounds_dir, bg_prob)

    base = ImageFolder(str(data_dir))
    missing = set(base.classes) - set(GRADE_ORDER)
    if missing:
        raise ValueError(f"알 수 없는 등급 폴더: {missing} (GRADE_ORDER={GRADE_ORDER})")

    all_samples: list[tuple[str, int, str]] = []
    unknown = 0
    for path, cls_idx in base.samples:
        grade_name = base.classes[cls_idx]
        item = item_from_filename(Path(path).name)
        if item is None:
            unknown += 1
            continue
        all_samples.append((path, GRADE_ORDER.index(grade_name), item))
    if unknown:
        print(f"[경고] 품목을 알 수 없어 제외된 샘플: {unknown}개")

    groups: dict[tuple[str, str], list[int]] = defaultdict(list)
    for idx, (path, _, _) in enumerate(all_samples):
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

    train_samples = [all_samples[i] for i in train_idx]
    val_samples = [all_samples[i] for i in val_idx]

    train_loader = DataLoader(
        _GradingItemDataset(train_samples, train_tf), batch_size=batch_size, shuffle=True,
        num_workers=num_workers, pin_memory=True, drop_last=True, collate_fn=_collate,
    )
    val_loader = DataLoader(
        _GradingItemDataset(val_samples, eval_tf), batch_size=batch_size, shuffle=False,
        num_workers=num_workers, pin_memory=True, collate_fn=_collate,
    )

    items_present = sorted({s[2] for s in all_samples})
    return train_loader, val_loader, items_present
