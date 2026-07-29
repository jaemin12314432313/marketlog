"""전경 분할(배경 제거) — 제안서 §4-2. 서버 경로 기본값은 U2-Net(rembg).
분류 전에 배경을 중립색(흰색)으로 치환해 학습 분포(깨끗한 전경)와 정렬시킨다.
"""
from functools import lru_cache

import numpy as np
from PIL import Image


@lru_cache(maxsize=1)
def _get_session():
    from rembg import new_session
    return new_session("u2net")


def remove_background(image: Image.Image, bg_color=(255, 255, 255)) -> Image.Image:
    from rembg import remove

    image = image.convert("RGB")
    cutout = remove(image, session=_get_session())  # RGBA, 배경 alpha=0

    bg = Image.new("RGB", cutout.size, bg_color)
    bg.paste(cutout, mask=cutout.split()[3])
    return bg


def crop_to_foreground(image: Image.Image, padding_ratio: float = 0.05) -> Image.Image:
    """알파 마스크의 bounding box로 크롭 (여백 padding_ratio만큼 유지)."""
    from rembg import remove

    image = image.convert("RGB")
    cutout = remove(image, session=_get_session())
    alpha = np.array(cutout.split()[3])
    ys, xs = np.where(alpha > 10)
    if len(xs) == 0:
        return image

    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    w, h = image.size
    pad_x = int((x1 - x0) * padding_ratio)
    pad_y = int((y1 - y0) * padding_ratio)
    x0, y0 = max(0, x0 - pad_x), max(0, y0 - pad_y)
    x1, y1 = min(w, x1 + pad_x), min(h, y1 + pad_y)

    bg = Image.new("RGB", cutout.size, (255, 255, 255))
    bg.paste(cutout, mask=cutout.split()[3])
    return bg.crop((x0, y0, x1, y1))
