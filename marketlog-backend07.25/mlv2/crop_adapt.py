"""분류기 현장 적응 — YOLO 가 잘라 준 크롭에서도 품목을 맞히게 만든다.

기존 분류기는 **스튜디오 사진 한 장을 통째로** 입력받는 전제로 학습됐다. 그런데 2단
파이프라인에서 실제로 들어오는 것은 YOLO 가 자른 조각이고, 그건 세 가지가 다르다.

  ① 박스가 헐겁다 → 배경이 섞여 들어온다
  ② 박스가 타이트하다 → 농산물이 잘려 들어온다
  ③ 옆 물건에 가려진 부분이 있다

그래서 학습 때 **YOLO 크롭을 흉내낸 입력**을 만들어 준다. 진혁님이 짚은 Random Crop /
Cutout / 강한 ColorJitter 가 정확히 이 셋에 대응한다. 여기서는 그걸 "박스 지터" 라는
형태로 좀 더 직접적으로 모사한다 — 무작위 크롭이 아니라 **탐지 박스가 틀리는 방식**으로
틀리게 자른다.

## CropJitter 가 RandomResizedCrop 과 다른 점

`RandomResizedCrop(scale=(0.7,1.0))` 은 이미지 안쪽만 자른다. 즉 항상 "너무 타이트한"
쪽으로만 틀린다. 실제 YOLO 는 **바깥으로도 틀린다**(배경 포함). CropJitter 는 박스를
안팎 양쪽으로 흔들어서 두 실패 모드를 다 만든다. 기본 범위 -0.15~+0.30 은 배경을 무는
쪽으로 살짝 치우쳐 있는데, 실제 검출기가 그쪽으로 더 자주 틀리기 때문이다.

## 사용

    from mlv2.crop_adapt import build_crop_transforms
    train_tf, eval_tf = build_crop_transforms(224, level="strong")

또는 학습 시:

    python -m mlv2.train --aug-level crop_strong ...
"""
from __future__ import annotations

import random

import numpy as np
from PIL import Image
from torchvision import transforms

from mlv2.augment import IMAGENET_MEAN, IMAGENET_STD, JPEGArtifact, SensorNoise


class CropJitter:
    """탐지 박스가 틀리는 방식으로 자른다.

    pad_range: 박스 각 변을 물체 크기 대비 이 비율만큼 넓히거나(양수) 좁힌다(음수).
               변마다 독립적으로 뽑으므로 한쪽만 잘린 비대칭 크롭도 나온다 —
               실제 검출 실패가 그렇게 생겼다.
    """

    def __init__(self, pad_range=(-0.15, 0.30), p=0.9, independent_sides=True):
        self.pad_range = pad_range
        self.p = p
        self.independent_sides = independent_sides

    def __call__(self, img):
        if random.random() >= self.p:
            return img
        w, h = img.size
        if self.independent_sides:
            l, r, t, b = [random.uniform(*self.pad_range) for _ in range(4)]
        else:
            v = random.uniform(*self.pad_range)
            l = r = t = b = v
        x0 = int(-l * w)
        y0 = int(-t * h)
        x1 = int(w + r * w)
        y1 = int(h + b * h)
        # 완전히 뒤집히거나 너무 작아지면 원본 유지
        if x1 - x0 < w * 0.35 or y1 - y0 < h * 0.35:
            return img
        # 바깥으로 넓히면 없는 영역이 생긴다. 가장자리 색으로 채운다 —
        # 검은색으로 채우면 모델이 '검은 테두리 = 크롭' 이라는 지름길을 배운다.
        arr = np.array(img.convert("RGB"))
        pad_l, pad_t = max(0, -x0), max(0, -y0)
        pad_r, pad_b = max(0, x1 - w), max(0, y1 - h)
        if pad_l or pad_t or pad_r or pad_b:
            arr = np.pad(arr, ((pad_t, pad_b), (pad_l, pad_r), (0, 0)), mode="edge")
            x0, y0 = x0 + pad_l, y0 + pad_t
            x1, y1 = x1 + pad_l, y1 + pad_t
        return Image.fromarray(arr).crop((x0, y0, x1, y1))


class OccluderPaste:
    """다른 물체에 가려진 상황을 모사한다. Cutout 과 다르게 **색이 있는** 가림막이다.

    Cutout(RandomErasing)은 회색/노이즈 사각형을 덮는데, 실제 매대에서 가리는 것은
    옆에 놓인 다른 농산물이다. 즉 가림막에도 색과 질감이 있다. 그래서 이미지 자체의
    다른 부분을 잘라 붙인다 — 색 통계가 장면과 일치해서 더 그럴듯하다.
    """

    def __init__(self, p=0.3, area=(0.05, 0.25), count=(1, 2)):
        self.p = p
        self.area = area
        self.count = count

    def __call__(self, img):
        if random.random() >= self.p:
            return img
        arr = np.array(img.convert("RGB"))
        h, w = arr.shape[:2]
        for _ in range(random.randint(*self.count)):
            a = random.uniform(*self.area) * h * w
            ar = random.uniform(0.6, 1.7)
            ph, pw = int((a / ar) ** 0.5), int((a * ar) ** 0.5)
            if ph < 4 or pw < 4 or ph >= h or pw >= w:
                continue
            sy, sx = random.randint(0, h - ph), random.randint(0, w - pw)
            dy, dx = random.randint(0, h - ph), random.randint(0, w - pw)
            patch = arr[sy:sy + ph, sx:sx + pw].copy()
            # 가림막은 앞에 있으니 살짝 밝기가 다르다
            patch = np.clip(patch.astype(np.float32) * random.uniform(0.75, 1.15),
                            0, 255).astype(np.uint8)
            arr[dy:dy + ph, dx:dx + pw] = patch
        return Image.fromarray(arr)


def build_crop_transforms(img_size=224, level="strong", jitter_p=0.9):
    """YOLO 크롭 입력용 (train_tf, eval_tf).

    level:
        standard  박스 지터 + 보통 색 증강
        strong    ★ 권장. + Cutout/가림막 + 강한 ColorJitter + JPEG 열화
        extreme   + 원근/전단. 과하면 학습이 안 붙으니 대조 실험용

    eval_tf 는 **박스 지터를 안 건다.** 평가는 항상 같은 방식이어야 실험 간 비교가 된다.
    """
    if level not in ("standard", "strong", "extreme"):
        raise ValueError("level: standard|strong|extreme")

    steps = [
        # ① 박스가 틀리는 방식으로 자른다 (진혁님 항목 2-1)
        CropJitter(p=jitter_p),
    ]
    if level != "standard":
        # 회전은 **RandomResizedCrop 앞**에 둔다. 뒤에 두면 회전이 만든 빈 모서리가
        # 검은 삼각형으로 그대로 남고, 모델이 '검은 귀퉁이 = 크롭된 물체' 라는 지름길을
        # 배운다. `CropJitter` 가 edge 패딩을 쓰는 이유와 같은 문제다(2026-08-11 실측).
        # 앞에 두면 뒤따르는 크롭이 그 모서리를 잘라낸다.
        steps.append(transforms.RandomApply(
            [transforms.RandomRotation(20)], p=0.35))
    steps += [
        transforms.RandomResizedCrop(img_size, scale=(0.65, 1.0), ratio=(0.75, 1.33)),
        transforms.RandomHorizontalFlip(),
    ]

    if level == "standard":
        steps.append(transforms.ColorJitter(0.3, 0.3, 0.3, 0.03))
    else:
        steps += [
            # ② 조명 차이 (진혁님 항목 2-2). hue 가 백열등↔형광등을 직접 흔든다.
            #
            # 강도를 0.55/0.10 → 0.40/0.06 으로 낮추고 RandomApply 로 감쌌다
            # (2026-08-11, 미리보기 실측). 원래는 매 이미지에 **무조건** 걸려서,
            # 8장 중 2장이 무지개색 배경에 형광 초록 배추가 되고 1장은 거의 흑백이었다.
            # 실제 매대에 존재하지 않는 분포이므로 학습 용량만 쓰고 도메인 갭은 안 줄인다.
            # 조명 대응이 목적이지 색을 파괴하는 게 목적이 아니다.
            transforms.RandomApply([transforms.ColorJitter(
                brightness=0.40, contrast=0.40, saturation=0.40, hue=0.06)], p=0.85),
            transforms.RandomGrayscale(p=0.08),
            transforms.RandomAutocontrast(p=0.3),
            transforms.RandomApply(
                [transforms.GaussianBlur(5, sigma=(0.1, 2.0))], p=0.3),
            # ③ 가림 (진혁님 항목 2-1 의 Cutout)
            OccluderPaste(p=0.30),
            JPEGArtifact(p=0.35),
        ]
    if level == "extreme":
        steps += [
            transforms.RandomApply([transforms.RandomPerspective(0.3, p=1.0)], p=0.3),
            transforms.RandomApply([transforms.RandomAffine(0, shear=12)], p=0.25),
        ]

    steps.append(transforms.ToTensor())
    if level != "standard":
        steps.append(SensorNoise(p=0.4))
    steps.append(transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD))
    if level != "standard":
        # 회색 사각형 Cutout. OccluderPaste 와 성격이 달라 둘 다 쓴다.
        #
        # value="random" 을 0 으로 바꿨다(2026-08-11, 미리보기 실측). 이 단계는
        # **Normalize 뒤**라서 "random" 이 정규화 공간의 난수가 된다 — 원래 화소로
        # 되돌리면 [-2,2]σ 를 넘나드는 형광색 노이즈 블록이 찍힌다. 미리보기에서
        # 무지개 사각형으로 보이던 것이 이것이다. 정규화 공간의 0 은 채널 평균색이라
        # '가려서 정보가 없다'는 뜻을 정확히 전달한다.
        steps.append(transforms.RandomErasing(p=0.30, scale=(0.02, 0.20), value=0))

    train_tf = transforms.Compose(steps)
    eval_tf = transforms.Compose([
        transforms.Resize(int(img_size * 1.14)),
        transforms.CenterCrop(img_size),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ])
    return train_tf, eval_tf


def preview(img_path, out_path, img_size=224, level="strong", n=8):
    """증강 결과를 눈으로 확인한다.

    증강은 숫자로 검증하기 어렵다. 너무 세면 학습이 안 붙고 너무 약하면 효과가 없는데,
    둘 다 학습을 다 돌려봐야 안다. 그림을 먼저 보면 명백히 과한 설정을 미리 걸러낼 수 있다.
    """
    import torch

    train_tf, _ = build_crop_transforms(img_size, level=level)
    img = Image.open(img_path).convert("RGB")
    mean = torch.tensor(IMAGENET_MEAN).view(3, 1, 1)
    std = torch.tensor(IMAGENET_STD).view(3, 1, 1)

    tiles = []
    for _ in range(n):
        t = train_tf(img) * std + mean
        tiles.append((t.clamp(0, 1).permute(1, 2, 0).numpy() * 255).astype("uint8"))
    cols = 4
    rows = [np.hstack(tiles[i:i + cols]) for i in range(0, len(tiles), cols)]
    grid = np.vstack([r for r in rows if r.shape[1] == rows[0].shape[1]])
    Image.fromarray(grid).save(out_path)
    return out_path


if __name__ == "__main__":
    import argparse

    from mlv2.compat import setup_stdout

    setup_stdout()
    p = argparse.ArgumentParser(description="크롭 적응 증강 미리보기")
    p.add_argument("--image", required=True)
    p.add_argument("--out", default="reports/crop_aug_preview.jpg")
    p.add_argument("--level", default="strong")
    p.add_argument("--img-size", type=int, default=224)
    a = p.parse_args()
    from pathlib import Path

    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    print("저장: {}".format(preview(a.image, a.out, a.img_size, a.level)))
