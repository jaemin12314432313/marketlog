"""증강 — 이 프로젝트에서 증강은 '정규화'가 아니라 **도메인 이동**이 목적이다.

학습 데이터는 스튜디오(균일 흰 배경, 통제 조명, 개체 단독)이고, 실사용 사진은
시장 매대(잡다한 배경, 형광등/자연광, 여러 개체)다. 실측된 병목은 데이터 양이 아니라
이 도메인 갭이다 — 학습셋을 10배(5,000→50,000장)로 늘렸더니 실사진이 22/30 → 14/30 으로
**떨어졌다.** 개체 수가 3,350으로 고정이라 새 정보가 없고, 같은 개체를 더 많은 각도로
반복 학습해 스튜디오 쪽으로 더 끌려간 것이다.

그래서 여기서는 증강 강도를 4단계로 두고, 기본값을 `strong` 으로 잡았다.
(기존 코드의 기본값 `standard` 는 ColorJitter 0.2 뿐이라 도메인 갭에 거의 무력했다.)

    none      기하 변환만. 증강 자체의 효과를 재는 대조군용
    standard  기존 marketlog_vision 과 동일. 비교 기준선
    strong    ★ 기본. 색온도·노출·초점·노이즈를 넓게 흔든다
    extreme   위 + RandomErasing + 원근 변형. 과하면 학습이 안 붙으니 실험용

**주의**: 여기의 배경 합성(BackgroundRandomize)은 학습 증강 전용이다.
추론 시 rembg 배경제거(`--segment`)는 쓰지 말 것 — 실사진 22/30 → 17/30 으로 떨어지고,
실패 6건 중 5건이 전부 '마늘'로 붕괴한다(학습셋의 마늘이 정확히 '흰 배경 위 창백한
덩어리'라 배경을 지운 다른 품목이 그쪽으로 끌려간다).
"""
from __future__ import annotations

import random
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageFilter
from torchvision import transforms

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

# crop_* 는 2단 파이프라인(YOLO → 크롭 → 분류)의 분류기용이다. 박스 지터·가림막이 붙는다.
# 구현은 crop_adapt.py 에 있고, 여기서는 이름만 받아 위임한다.
LEVELS = ("none", "standard", "strong", "extreme",
          "crop_standard", "crop_strong", "crop_extreme")


class BackgroundRandomize:
    """흰 배경을 무작위 텍스처로 갈아끼운다.

    학습 데이터가 거의 균일한 흰 배경이라 가능한 최적화다: 딥러닝 분할 없이
    테두리 색 기준 임계값만으로 전경 마스크가 충분히 나온다. 매 epoch 수만 장을
    rembg 로 돌리는 건 현실적으로 불가능하다.
    """

    def __init__(self, backgrounds_dir, p=0.5, tolerance=30.0,
                 crop_prob=0.4, crop_padding_range=(0.02, 0.25)):
        self.p = p
        self.tolerance = tolerance
        self.crop_prob = crop_prob
        self.crop_padding_range = crop_padding_range
        self.bg_paths = []
        bg_dir = Path(backgrounds_dir) if backgrounds_dir else None
        if bg_dir and bg_dir.is_dir():
            for ext in ("*.jpg", "*.jpeg", "*.png"):
                self.bg_paths.extend(sorted(bg_dir.glob(ext)))

    @property
    def enabled(self):
        return bool(self.bg_paths)

    def _mask(self, arr):
        border = np.concatenate([
            arr[0:5, :, :].reshape(-1, 3),
            arr[-5:, :, :].reshape(-1, 3),
            arr[:, 0:5, :].reshape(-1, 3),
            arr[:, -5:, :].reshape(-1, 3),
        ], axis=0)
        bg_color = np.median(border, axis=0)
        dist = np.sqrt(((arr.astype(np.float32) - bg_color) ** 2).sum(axis=2))
        return (dist > self.tolerance).astype(np.uint8) * 255

    def _bbox(self, mask, padding_ratio):
        ys, xs = np.where(mask > 0)
        if len(xs) == 0:
            return None
        h, w = mask.shape
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        pad_x = int((x1 - x0) * padding_ratio) + 1
        pad_y = int((y1 - y0) * padding_ratio) + 1
        return (max(0, x0 - pad_x), max(0, y0 - pad_y),
                min(w, x1 + pad_x), min(h, y1 + pad_y))

    def __call__(self, img):
        if not self.bg_paths or random.random() > self.p:
            return img
        img = img.convert("RGB")
        # 프레이밍 편차 모사: 실사용 사진은 품목이 화면을 꽉 채우기도, 작게 찍히기도 한다.
        if random.random() < self.crop_prob:
            bbox = self._bbox(self._mask(np.array(img)),
                              random.uniform(*self.crop_padding_range))
            if bbox is not None:
                img = img.crop(bbox)
        mask_img = Image.fromarray(self._mask(np.array(img)), mode="L")
        mask_img = mask_img.filter(ImageFilter.GaussianBlur(2))
        bg = Image.open(random.choice(self.bg_paths)).convert("RGB").resize(img.size)
        return Image.composite(img, bg, mask_img)


class SensorNoise:
    """ISO 차이를 흉내내는 가우시안 노이즈. ToTensor 뒤, Normalize 앞([0,1] 구간)에 넣는다."""

    def __init__(self, std_range=(0.0, 0.06), p=0.5):
        self.std_range = std_range
        self.p = p

    def __call__(self, tensor):
        if random.random() >= self.p:
            return tensor
        std = random.uniform(*self.std_range)
        return (tensor + torch.randn_like(tensor) * std).clamp(0.0, 1.0)


class JPEGArtifact:
    """휴대폰 사진의 압축 열화를 모사한다.

    학습셋은 품질 90으로 저장된 깔끔한 이미지인데, 실사용 사진은 메신저·업로드를 거치며
    품질이 더 떨어진다. 이 차이도 도메인 갭의 일부다.
    """

    def __init__(self, quality_range=(35, 90), p=0.3):
        self.quality_range = quality_range
        self.p = p

    def __call__(self, img):
        if random.random() >= self.p:
            return img
        import io

        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG",
                                quality=random.randint(*self.quality_range))
        buf.seek(0)
        return Image.open(buf).convert("RGB")


def _pil_steps(level, img_size):
    """ToTensor 앞에 오는 PIL 단계. 각 항목이 겨냥하는 실사용 변수를 주석에 남긴다."""
    if level == "none":
        return [transforms.Resize((img_size, img_size))]

    base = [
        transforms.RandomResizedCrop(img_size, scale=(0.7, 1.0)),   # 거리·프레이밍
        transforms.RandomHorizontalFlip(),
    ]
    if level == "standard":
        return base + [
            transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
        ]

    strong = base + [
        transforms.RandomApply([transforms.RandomRotation(20)], p=0.3),   # 손각도
        # hue 가 화이트밸런스를 직접 흔든다. 매대 조명(형광등/백열등)이 여기 해당.
        transforms.ColorJitter(brightness=0.5, contrast=0.5, saturation=0.5, hue=0.08),
        transforms.RandomGrayscale(p=0.10),                               # 색 의존 억제
        transforms.RandomApply([transforms.GaussianBlur(5, sigma=(0.1, 2.0))], p=0.3),
        transforms.RandomAdjustSharpness(sharpness_factor=2.0, p=0.2),
        transforms.RandomAutocontrast(p=0.3),
        JPEGArtifact(p=0.3),
    ]
    if level == "strong":
        return strong
    # extreme
    return strong + [
        transforms.RandomApply([transforms.RandomPerspective(0.3, p=1.0)], p=0.3),
        transforms.RandomApply([transforms.RandomAffine(0, shear=10)], p=0.2),
    ]


def _tensor_steps(level):
    if level in ("none", "standard"):
        return []
    steps = [SensorNoise(p=0.4)]
    return steps


def build_transforms(img_size=224, level="strong",
                     backgrounds_dir=None, bg_prob=0.5):
    """(train_tf, eval_tf) 를 만든다.

    eval_tf 는 어떤 level 에서도 동일하다 — 평가 파이프라인이 실험마다 달라지면
    수치를 비교할 수 없다. 이건 의도적으로 고정이다.
    """
    if level not in LEVELS:
        raise ValueError("level 은 {} 중 하나여야 한다: {}".format(LEVELS, level))

    if level.startswith("crop_"):
        # YOLO 크롭을 입력으로 받는 분류기용. 배경 치환은 안 쓴다 —
        # 이미 검출기가 배경을 대부분 걷어냈고, 남은 배경 조각은 CropJitter 가 만든다.
        from mlv2.crop_adapt import build_crop_transforms

        return build_crop_transforms(img_size, level=level[len("crop_"):])

    steps = []
    if backgrounds_dir and level != "none":
        bg = BackgroundRandomize(backgrounds_dir, p=bg_prob)
        if bg.enabled:
            steps.append(bg)   # 크롭 전에 와야 원본 해상도에서 마스크가 정확하다

    steps += _pil_steps(level, img_size)
    steps.append(transforms.ToTensor())
    steps += _tensor_steps(level)          # 노이즈는 정규화 전 [0,1] 구간에서
    steps.append(transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD))
    if level == "extreme":
        steps.append(transforms.RandomErasing(p=0.25, scale=(0.02, 0.15)))

    train_tf = transforms.Compose(steps)
    eval_tf = transforms.Compose([
        transforms.Resize(int(img_size * 1.14)),
        transforms.CenterCrop(img_size),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ])
    return train_tf, eval_tf
