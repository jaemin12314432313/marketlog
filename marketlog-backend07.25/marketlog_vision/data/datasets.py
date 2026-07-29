from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

import torch
from torch.utils.data import DataLoader, Subset
from torchvision import transforms
from torchvision.datasets import ImageFolder

from marketlog_vision.augment import BackgroundRandomize

# B-A05 촬영 방식: 실물 개체 하나를 여러 각도(TOP/FR90/DI45 등)로 여러 장 촬영함.
# 파일명 패턴: "..._<group>-<imgno>[_<각도코드>].<ext>" 에서 <group>이 개체 식별자.
_SPECIMEN_RE = re.compile(r"^(.*)_(\d+)-\d+(?:_[^_.]+)?\.[^.]+$")


def _specimen_key(filename: str) -> str:
    """같은 개체(specimen)를 다른 각도에서 찍은 사진들이 같은 키를 갖도록 한다."""
    m = _SPECIMEN_RE.match(filename)
    if m:
        return f"{m.group(1)}_{m.group(2)}"
    return filename

# B-A08 (AI-Hub 농산물 품목 이미지) 10종
ITEM_CLASS_NAMES = [
    "무", "배추", "양파", "마늘", "양배추",
    "감", "사과", "배", "감귤", "감자",
]

# 원천 zip 파일명 접두어(영문) -> 품목명(한글). 추출된 이미지 파일명 첫 토큰에서
# 품목을 역산할 때 공용으로 사용 (scripts/extract_real_item_data.py 와 동일한 매핑).
PREFIX_TO_ITEM = {
    "apple": "사과",
    "cabbage": "양배추",
    "chinese-cabbage": "배추",
    "garlic": "마늘",
    "mandarine": "감귤",
    "onion": "양파",
    "pear": "배",
    "persimmon": "감",
    "potato": "감자",
    "radish": "무",
}


def item_from_filename(filename: str) -> str | None:
    prefix = filename.split("_")[0].lower()
    return PREFIX_TO_ITEM.get(prefix)


IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]


def build_transforms(img_size: int = 224, backgrounds_dir: str | None = None, bg_prob: float = 0.5):
    train_steps = []
    if backgrounds_dir:
        train_steps.append(BackgroundRandomize(backgrounds_dir, p=bg_prob))
    train_steps += [
        transforms.RandomResizedCrop(img_size, scale=(0.7, 1.0)),
        transforms.RandomHorizontalFlip(),
        transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ]
    train_tf = transforms.Compose(train_steps)
    eval_tf = transforms.Compose([
        transforms.Resize(int(img_size * 1.14)),
        transforms.CenterCrop(img_size),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ])
    return train_tf, eval_tf


def build_dataloaders(
    data_dir: str,
    img_size: int = 224,
    batch_size: int = 32,
    val_ratio: float = 0.15,
    num_workers: int = 4,
    seed: int = 42,
    backgrounds_dir: str | None = None,
    bg_prob: float = 0.5,
):
    """data_dir 아래 <클래스명>/*.jpg 형태(ImageFolder 규격)를 기대한다.
    같은 실물 개체를 여러 각도에서 찍은 사진이 train/val에 동시에 들어가지 않도록,
    개체(specimen) 단위로 묶어서 분할한다 (이미지 단위 랜덤 분할은 데이터 누수를 유발함).
    backgrounds_dir가 주어지면 학습 이미지의 bg_prob 비율만큼 배경을 무작위 치환한다.
    """
    data_dir = Path(data_dir)
    train_tf, eval_tf = build_transforms(img_size, backgrounds_dir, bg_prob)

    base = ImageFolder(str(data_dir))

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

    train_ds = Subset(ImageFolder(str(data_dir), transform=train_tf), train_idx)
    val_ds = Subset(ImageFolder(str(data_dir), transform=eval_tf), val_idx)

    train_loader = DataLoader(
        train_ds, batch_size=batch_size, shuffle=True,
        num_workers=num_workers, pin_memory=True, drop_last=True,
    )
    val_loader = DataLoader(
        val_ds, batch_size=batch_size, shuffle=False,
        num_workers=num_workers, pin_memory=True,
    )
    return train_loader, val_loader, base.classes
