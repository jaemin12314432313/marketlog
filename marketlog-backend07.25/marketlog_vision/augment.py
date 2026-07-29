"""배경 무작위화 증강 — 제안서 §4-3 (Copy-Paste 스타일).
B-A05 원본이 거의 균일한 흰 배경이라는 특성을 이용해, 딥러닝 분할 없이
테두리 색상 기반 임계값으로 전경 마스크를 빠르게 추정하고 무작위 배경과 합성한다.
(실제 다양한 배경의 추론 이미지에는 이 방식이 안 맞으므로 segmentation.py의 rembg를 쓴다.)
"""
from __future__ import annotations

import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


class BackgroundRandomize:
    def __init__(
        self,
        backgrounds_dir,
        p: float = 0.5,
        tolerance: float = 30.0,
        crop_prob: float = 0.4,
        crop_padding_range: tuple[float, float] = (0.02, 0.25),
    ):
        self.p = p
        self.tolerance = tolerance
        self.crop_prob = crop_prob
        self.crop_padding_range = crop_padding_range
        bg_dir = Path(backgrounds_dir)
        self.bg_paths = []
        if bg_dir.is_dir():
            for ext in ("*.jpg", "*.jpeg", "*.png"):
                self.bg_paths.extend(bg_dir.glob(ext))

    def _estimate_mask_array(self, arr: np.ndarray) -> np.ndarray:
        border = np.concatenate([
            arr[0:5, :, :].reshape(-1, 3),
            arr[-5:, :, :].reshape(-1, 3),
            arr[:, 0:5, :].reshape(-1, 3),
            arr[:, -5:, :].reshape(-1, 3),
        ], axis=0)
        bg_color = np.median(border, axis=0)
        dist = np.sqrt(((arr.astype(np.float32) - bg_color) ** 2).sum(axis=2))
        return (dist > self.tolerance).astype(np.uint8) * 255

    def _foreground_bbox(self, mask: np.ndarray, padding_ratio: float):
        ys, xs = np.where(mask > 0)
        if len(xs) == 0:
            return None
        h, w = mask.shape
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        pad_x = int((x1 - x0) * padding_ratio) + 1
        pad_y = int((y1 - y0) * padding_ratio) + 1
        return (
            max(0, x0 - pad_x), max(0, y0 - pad_y),
            min(w, x1 + pad_x), min(h, y1 + pad_y),
        )

    def __call__(self, img: Image.Image) -> Image.Image:
        if not self.bg_paths or random.random() > self.p:
            return img

        img = img.convert("RGB")

        # 확률적으로 전경 bbox 기준 크롭(여유 패딩 랜덤) 후 배경 합성 — 현장 스캔의
        # 프레이밍 편차(품목이 화면을 꽉 채우거나 작게 찍히는 경우)를 모사한다.
        if random.random() < self.crop_prob:
            mask = self._estimate_mask_array(np.array(img))
            padding = random.uniform(*self.crop_padding_range)
            bbox = self._foreground_bbox(mask, padding)
            if bbox is not None:
                img = img.crop(bbox)

        arr = np.array(img)
        mask_img = Image.fromarray(self._estimate_mask_array(arr), mode="L").filter(ImageFilter.GaussianBlur(2))

        bg_path = random.choice(self.bg_paths)
        bg = Image.open(bg_path).convert("RGB").resize(img.size)

        return Image.composite(img, bg, mask_img)
