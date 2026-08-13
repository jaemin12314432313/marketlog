"""합성기 — 누끼 + 배경 → 학습 이미지 + YOLO 라벨.

## 이 파일에서 제일 중요한 세 가지

**① 물리 크기 비율로 배치한다.**
`data/label_metadata.csv` 의 실측 폭(cm)을 쓴다. 배추 18.0cm, 마늘 3.7cm — 4.9배다.
원본 스튜디오 사진은 모든 품목이 프레임을 꽉 채워서 이 정보가 **삭제된** 상태다.
합성에서 이걸 복원하는 것이 이 접근의 최대 이득이다. 한 장면 안의 상대 크기가
학습 신호가 되므로, {감자↔마늘} 처럼 모양이 비슷하고 크기만 다른 쌍이 분리된다.

**② 라벨은 '보이는 부분'으로만 만든다.**
겹쳐 놓고 원래 bbox 를 그대로 쓰면, 완전히 가려진 물체에도 박스가 생긴다. YOLO 는
"아무것도 없는데 물체가 있다" 를 배우고 오검출이 폭증한다. 그래서 객체마다 캔버스 크기
가시성 마스크를 들고 다니면서, 나중에 그린 것이 덮으면 앞선 것의 가시 영역을 깎는다.
가시 픽셀이 임계 미만이면 **라벨에서 아예 뺀다**(그림은 남는다 — 가려진 물체는 실제로도
거기 있으니까).

**③ 조명은 장면 전체에 한 번만 건다.**
누끼마다 다른 색보정을 하면 "잘라 붙인 티" 가 나고, YOLO 가 그 경계 불연속을 물체
탐지 단서로 삼아버린다(합성 데이터의 전형적 함정). 개체별 변형은 기하 변환까지만 하고,
색온도·노출·노이즈·블러는 마지막에 캔버스 전체에 한 번 적용한다.

## 나중에 mosaic/mixup 과 겹치는 문제

Ultralytics 는 mosaic(4장 이어붙이기)과 mixup 을 학습 중에 건다. 여기서 이미 여러 개체를
합성했으므로 **이중 합성**이 된다. 과하면 실제 장면 통계에서 멀어지므로 `train_yolo.py`
기본값을 mosaic 0.5 / mixup 0.1 로 낮춰 뒀다(Ultralytics 기본은 1.0 / 0.0).
"""
from __future__ import annotations

import argparse
import csv
import math
import random
from collections import defaultdict
from pathlib import Path

import numpy as np

from mlv2 import compat
from mlv2.compat import setup_stdout
from mlv2.detect import PHYSICAL_WIDTH_CM
from mlv2.detect import matting
from mlv2.detect.cutouts import read_index, split_bank

# 데모 시나리오의 핵심 품목(2026-08-10, 사용자 지정). 검출은 1클래스라 품목 구성에
# 덜 민감하지만, **중앙 구도의 주 피사체**를 이쪽으로 기울이면 실제로 쓸 경로의
# 학습 비중이 올라간다. 나머지 7품목은 방해물·배경 역할로 계속 들어간다.
PRIORITY_ITEMS = ("배추", "사과", "배")

setup_stdout()


def _cv2():
    import cv2
    return cv2


class CutoutBank:
    """누끼 인덱스를 메모리에 올리고 품목별로 뽑아준다. 이미지는 지연 로딩 + 캐시."""

    def __init__(self, index_path, rows=None, root=None, cache_size=800):
        self.index_path = Path(index_path)
        self.root = Path(root) if root else self.index_path.parent
        self.rows = rows if rows is not None else read_index(index_path)
        self.by_item = defaultdict(list)
        for r in self.rows:
            self.by_item[r["item"]].append(r)
        self.items = sorted(self.by_item)
        self._cache = {}
        self._cache_size = cache_size
        if not self.items:
            raise RuntimeError("누끼 뱅크가 비었다: {}".format(index_path))

    def __len__(self):
        return len(self.rows)

    def load(self, row):
        key = row["file"]
        if key in self._cache:
            return self._cache[key]
        cv2 = _cv2()
        img = compat.imread(str(self.root / key), cv2.IMREAD_UNCHANGED)
        if img is None or img.shape[2] != 4:
            return None
        if len(self._cache) >= self._cache_size:
            self._cache.pop(next(iter(self._cache)))
        self._cache[key] = img
        return img

    def sample(self, rng, item=None):
        item = item or rng.choice(self.items)
        return rng.choice(self.by_item[item])

    def width_cm(self, row):
        try:
            v = float(row.get("width_cm") or 0)
            if v > 0:
                return v
        except (TypeError, ValueError):
            pass
        return PHYSICAL_WIDTH_CM.get(row["item"], 8.0)


def _rotate_rgba(rgba, angle):
    cv2 = _cv2()
    h, w = rgba.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), angle, 1.0)
    cos, sin = abs(M[0, 0]), abs(M[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    M[0, 2] += nw / 2.0 - w / 2.0
    M[1, 2] += nh / 2.0 - h / 2.0
    return cv2.warpAffine(rgba, M, (nw, nh), flags=cv2.INTER_LINEAR,
                          borderValue=(0, 0, 0, 0))


def _drop_shadow(canvas, alpha_full, offset=(6, 8), blur=21, strength=0.35):
    """접지 그림자를 캔버스에 깐다.

    그림자가 없으면 물체가 배경 위에 떠 보이고, 사람 눈에 부자연스러운 만큼 신경망에도
    '경계가 너무 선명한 물체' 라는 지름길 단서를 준다. 실제 그림자는 광원 방향에
    의존하므로 장면마다 방향을 고정해서 건다.
    """
    cv2 = _cv2()
    h, w = canvas.shape[:2]
    sh = np.zeros((h, w), np.float32)
    ys, xs = np.where(alpha_full)
    if len(xs) == 0:
        return canvas
    dy, dx = offset
    ys2, xs2 = np.clip(ys + dy, 0, h - 1), np.clip(xs + dx, 0, w - 1)
    sh[ys2, xs2] = 1.0
    k = blur if blur % 2 else blur + 1
    sh = cv2.GaussianBlur(sh, (k, k), 0)
    sh = np.clip(sh * strength, 0, 1)[..., None]
    return (canvas.astype(np.float32) * (1 - sh)).astype(np.uint8)


def _paste(canvas, rgba, cx, cy):
    """rgba 를 (cx, cy) 중심으로 알파 합성. 캔버스 크기 가시 마스크를 돌려준다."""
    H, W = canvas.shape[:2]
    h, w = rgba.shape[:2]
    x0, y0 = int(cx - w / 2.0), int(cy - h / 2.0)
    xs0, ys0 = max(0, x0), max(0, y0)
    xs1, ys1 = min(W, x0 + w), min(H, y0 + h)
    if xs1 <= xs0 or ys1 <= ys0:
        return None
    sx0, sy0 = xs0 - x0, ys0 - y0
    sx1, sy1 = sx0 + (xs1 - xs0), sy0 + (ys1 - ys0)

    patch = rgba[sy0:sy1, sx0:sx1]
    al = (patch[..., 3:4].astype(np.float32) / 255.0)
    roi = canvas[ys0:ys1, xs0:xs1].astype(np.float32)
    canvas[ys0:ys1, xs0:xs1] = (patch[..., :3] * al + roi * (1 - al)).astype(np.uint8)

    full = np.zeros((H, W), bool)
    full[ys0:ys1, xs0:xs1] = al[..., 0] > 0.5
    return full


def _global_photometric(canvas, rng, strong=True):
    """장면 전체에 조명·색온도·노이즈·블러를 한 번 건다. 개체별로 걸면 안 된다."""
    cv2 = _cv2()
    img = canvas.astype(np.float32)

    gain = rng.uniform(0.72, 1.30) if strong else rng.uniform(0.9, 1.1)
    img *= gain
    # 색온도: 백열등(붉음) ↔ 형광등/그늘(푸름). B,G,R 순서(OpenCV)
    warm = rng.uniform(-0.10, 0.10)
    img[..., 0] *= (1 - warm)
    img[..., 2] *= (1 + warm)
    # 대비
    mean = img.mean()
    img = (img - mean) * rng.uniform(0.85, 1.20) + mean
    img = np.clip(img, 0, 255)

    if rng.random() < 0.35:
        k = rng.choice([3, 5])
        img = cv2.GaussianBlur(img, (k, k), 0)
    if rng.random() < 0.5:
        img += np.random.normal(0, rng.uniform(1.5, 7.0), img.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


# 미리보기에 한글을 쓰려면 폰트 파일이 필요한데 서버·샌드박스에 없을 수 있다.
# cv2.putText 는 한글을 '????' 로 그린다. 로마자로 대체한다 — 미리보기 전용이라
# 라벨 파일(YOLO txt)에는 영향이 없다.
ROMAN = {"감": "gam", "감귤": "citrus", "감자": "potato", "마늘": "garlic",
         "무": "radish", "배": "pear", "배추": "napa", "사과": "apple",
         "양배추": "cabbage", "양파": "onion"}


def compose_one(bank, backgrounds, rng, size=768, n_obj=(4, 14),
                min_visible_px=250, min_visible_frac=0.25,
                scene_fill=(0.13, 0.42), shadows=True, allow_partial_edge=True,
                scene_mode="scan", priority_ratio=0.6):
    """장면 하나 합성. (이미지, 라벨목록) 을 돌려준다.

    라벨은 [(item, x0, y0, x1, y1)] 픽셀 좌표다.

    `scene_mode` 가 장면의 구도를 정한다. 실사용 입력이 두 종류이기 때문이다.

    - ``"scan"``  — 매대를 한 컷에 담는 구도. 물체가 여기저기 흩어져 있다.
    - ``"centered"`` — **앱의 촬영 가이드** 구도. 앱이 "측정할 상품을 화면 중앙에
      맞추세요" 라는 preview 를 띄울 예정이므로, 실제로 들어올 사진은 대상 하나가
      중앙에 크게 놓이고 주변에는 옆 물건이 걸쳐 있는 형태가 된다. 이 분포를 학습에
      넣지 않으면 검출기가 정작 주 사용 경로에서 약해진다.

    두 모드를 섞는 것이 중요하다. ``centered`` 만으로 학습하면 "물체는 중앙에 있다"는
    위치 편향이 생겨 매대 전체 스캔에서 가장자리 물체를 놓친다.
    """
    cv2 = _cv2()
    bg_path = rng.choice(backgrounds)
    bg = compat.imread(str(bg_path))
    if bg is None:
        raise RuntimeError("배경을 못 읽었다: {}".format(bg_path))

    # 배경은 랜덤 크롭 후 리사이즈 — 같은 배경이 반복돼도 구도가 달라진다
    bh, bw = bg.shape[:2]
    s = rng.uniform(0.55, 1.0)
    cw, ch = int(bw * s), int(bh * s)
    x = rng.randint(0, max(0, bw - cw))
    y = rng.randint(0, max(0, bh - ch))
    bg = cv2.resize(bg[y:y + ch, x:x + cw], (size, size))
    if rng.random() < 0.5:
        bg = cv2.flip(bg, 1)
    # 매대 촬영은 배경이 살짝 아웃포커스인 경우가 많다
    if rng.random() < 0.6:
        bg = cv2.GaussianBlur(bg, (0, 0), rng.uniform(0.6, 2.0))

    canvas = bg.copy()
    centered = (scene_mode == "centered")
    # 중앙 구도는 '대상 하나 + 주변 방해물 몇 개'다. 매대 스캔보다 객체 수가 훨씬 적다.
    k = rng.randint(1, 5) if centered else rng.randint(*n_obj)

    # 한 장면의 품목 구성: 매대는 같은 품목이 무더기로 쌓인 경우가 많다.
    # 그래서 2~4종만 고르고 그 안에서 반복 추출한다(완전 무작위보다 실제에 가깝다).
    n_kinds = min(len(bank.items), rng.randint(2, 4))
    kinds = rng.sample(bank.items, n_kinds)
    rows = [bank.sample(rng, rng.choice(kinds)) for _ in range(k)]

    # 중앙 구도의 주 피사체(rows[0])를 시나리오 품목 쪽으로 기울인다.
    if centered and rows and rng.random() < priority_ratio:
        avail = [it for it in PRIORITY_ITEMS if it in bank.items]
        if avail:
            rows[0] = bank.sample(rng, rng.choice(avail))

    # cm → px 배율: 장면에서 가장 큰 품목이 캔버스의 fill 만큼 차지하도록.
    # fill 을 넓게 흔드는 것이 중요하다. 실사용에는 '매대를 멀리서 한 컷'(작게 여러 개)과
    # '하나를 가까이 스캔'(크게 하나)이 둘 다 있는데, 좁게 고정하면 한쪽만 배운다.
    # 첫 미리보기에서 0.42 고정이라 모든 장면이 클로즈업처럼 나왔다.
    if isinstance(scene_fill, (tuple, list)):
        fill = rng.uniform(*scene_fill)
    else:
        fill = scene_fill

    subject = 0 if centered else None
    if centered:
        # 배율을 '가장 큰 품목' 이 아니라 **주 피사체** 기준으로 잡는다.
        # 앱 사용자는 특정 상품을 화면에 맞춰 찍으므로, 화면을 채우는 것은 그 상품이다.
        # 이 계산의 부수 효과가 오히려 정확하다 — 마늘(3.7cm)을 스캔하면 옆에 놓인
        # 배추(18.0cm)는 프레임을 벗어날 만큼 크게 잡힌다. 실제로도 그렇게 찍힌다.
        fill = rng.uniform(0.30, 0.62)
        px_per_cm = (size * fill) / bank.width_cm(rows[subject])
    else:
        max_cm = max(bank.width_cm(r) for r in rows)
        px_per_cm = (size * fill) / max_cm

    shadow_off = (rng.randint(3, 12), rng.randint(-10, 12))

    if centered:
        # 주 피사체를 **맨 마지막에** 그린다. 앱 구도에서 대상은 가려지지 않는다.
        order = [i for i in range(len(rows)) if i != subject] + [subject]
    else:
        # 큰 것부터 그린다 = 큰 것이 뒤, 작은 것이 앞. 매대에서 실제로 그렇게 쌓인다.
        order = sorted(range(len(rows)), key=lambda i: -bank.width_cm(rows[i]))
    placed = []          # [(item, 캔버스크기 가시마스크)]
    for i in order:
        row = rows[i]
        rgba = bank.load(row)
        if rgba is None:
            continue

        target_w = bank.width_cm(row) * px_per_cm * rng.uniform(0.85, 1.15)
        if centered and i != subject:
            # 물리 비율을 그대로 두면 마늘(3.7cm)을 스캔할 때 옆의 배추(18.0cm)가
            # 화면을 통째로 덮어 주 피사체가 묻힌다. 비율상 맞지만 실제 입력과는 다르다 —
            # 앱 사용자는 대상만 담으려 하므로 그렇게 큰 이웃은 프레임에 안 들어온다.
            # 방해물은 화면 절반까지만 허용하고, 넘으면 잘라 맞춘다.
            target_w = min(target_w, size * 0.55)
        h, w = rgba.shape[:2]
        scale = target_w / float(w)
        nw, nh = int(w * scale), int(h * scale)
        if nw < 12 or nh < 12 or nw > size * 1.2 or nh > size * 1.2:
            continue
        obj = cv2.resize(rgba, (nw, nh), interpolation=cv2.INTER_AREA)
        obj = _rotate_rgba(obj, rng.uniform(-30, 30))
        if rng.random() < 0.5:
            obj = cv2.flip(obj, 1)

        if centered and i == subject:
            # 가이드 preview 가 있어도 사람이 정확히 중앙에 맞추지는 못한다.
            # 흔들어 두지 않으면 '정확히 중앙' 만 학습해 실사용에서 흔들린 사진에 약해진다.
            #
            # 폭을 ±8% → ±13% 로 넓힌 이유(2026-08-10): ±8% 로는 `select.py` 평가에서
            # **중앙성만 써도 정확도 1.000** 이 나왔다. 규칙이 좋아서가 아니라 문제가
            # 너무 쉬웠던 것이다. 대상 선택이 자명한 데이터로는 선택 규칙을 고를 수 없다.
            cx = size * (0.5 + rng.uniform(-0.13, 0.13))
            cy = size * (0.5 + rng.uniform(-0.13, 0.13))
        elif centered:
            # 방해물은 중앙을 비켜 놓되, 완전히 배제하지는 않는다. 매대가 빽빽하면
            # 옆 물건이 중앙 가까이 들어온다 — 그때가 선택 규칙이 실제로 필요한 순간이다.
            ang = rng.uniform(0, 2 * math.pi)
            rad = size * rng.uniform(0.26, 0.62)
            cx = size * 0.5 + math.cos(ang) * rad
            cy = size * 0.5 + math.sin(ang) * rad
        else:
            margin = 0.02 if allow_partial_edge else 0.12
            cx = rng.uniform(size * margin, size * (1 - margin))
            cy = rng.uniform(size * margin, size * (1 - margin))

        if shadows and rng.random() < 0.8:
            a_tmp = np.zeros(canvas.shape[:2], bool)
            probe = _paste(canvas.copy(), obj, cx, cy)
            if probe is not None:
                a_tmp = probe
                canvas = _drop_shadow(canvas, a_tmp, offset=shadow_off,
                                      strength=rng.uniform(0.18, 0.42))

        vis = _paste(canvas, obj, cx, cy)
        if vis is None:
            continue
        # 박스는 alpha 전체가 아니라 **본체**에만 맞춘다. 누끼 하단에 남은 촬영대 반사가
        # alpha 에 붙어 있어서, 그대로 두면 박스가 물체보다 아래로 늘어난다. 단일 객체를
        # 골라 크롭하는 앱 경로에서는 그 여백이 곧 분류기 입력의 오염이 된다.
        # 이미지에는 반사를 남긴다 — 실제 매대에도 그림자가 있으므로 도메인상 틀리지 않고,
        # 박스가 정확하면 오히려 '받침은 물체가 아니다' 를 배운다.
        y_body = matting.body_bottom(obj)
        label_cut = int(cy - obj.shape[0] / 2.0) + y_body
        # 새로 그린 것이 앞선 것들을 가린다 → 앞선 것들의 가시 영역을 깎는다
        for prev in placed:
            prev[1] &= ~vis
        placed.append([row["item"], vis, label_cut, (centered and i == subject)])

    labels = []
    for item, vis, label_cut, is_subject in placed:
        if 0 < label_cut < vis.shape[0]:
            vis = vis.copy()
            vis[label_cut:] = False
        n_vis = int(vis.sum())
        if n_vis < min_visible_px:
            continue
        ys, xs = np.where(vis)
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
        # 가시 영역이 자기 bbox 의 일부밖에 안 되면(심하게 가려짐) 라벨에서 뺀다
        box_area = max(1, (x1 - x0 + 1) * (y1 - y0 + 1))
        if n_vis / box_area < min_visible_frac:
            continue
        if x1 - x0 < 8 or y1 - y0 < 8:
            continue
        labels.append((item, x0, y0, x1, y1, is_subject))

    canvas = _global_photometric(canvas, rng)
    return canvas, labels


def to_yolo_lines(labels, size, class_index=None):
    """픽셀 bbox → YOLO txt 라인 (cls cx cy w h, 0~1 정규화).

    class_index 가 None 이면 전부 클래스 0 ('produce'). 1클래스 검출 설계다.
    """
    lines = []
    for item, x0, y0, x1, y1, _subj in labels:
        cls = 0 if class_index is None else class_index.get(item, 0)
        cx = (x0 + x1) / 2.0 / size
        cy = (y0 + y1) / 2.0 / size
        w = (x1 - x0) / float(size)
        h = (y1 - y0) / float(size)
        if w <= 0 or h <= 0:
            continue
        lines.append("{} {:.6f} {:.6f} {:.6f} {:.6f}".format(cls, cx, cy, w, h))
    return lines


def draw_labels(img, labels):
    """디버그용 시각화. 합성이 이상하면 눈으로 먼저 확인하는 게 제일 빠르다."""
    cv2 = _cv2()
    vis = img.copy()
    for item, x0, y0, x1, y1, subj in labels:
        tag = ROMAN.get(item, item)
        color = (0, 200, 255) if subj else (0, 230, 0)   # 주 피사체는 주황
        cv2.rectangle(vis, (x0, y0), (x1, y1), color, 3 if subj else 2)
        tw = 8 * len(tag) + 6
        cv2.rectangle(vis, (x0, max(0, y0 - 16)), (x0 + tw, y0), color, -1)
        cv2.putText(vis, tag, (x0 + 3, max(11, y0 - 4)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 1)
    return vis


def generate(index_path, backgrounds_dir, out_dir, n_train=4000, n_val=600,
             size=768, seed=42, per_class=False, preview=12, verbose=True,
             center_ratio=0.5, priority_ratio=0.6):
    """합성 데이터셋 생성. YOLO 표준 폴더 구조로 쓴다.

        out_dir/
          images/train/*.jpg   labels/train/*.txt
          images/val/*.jpg     labels/val/*.txt
          preview/*.jpg        (라벨 그린 미리보기)
          dataset.yaml

    `center_ratio` 는 '앱 촬영 가이드' 구도(중앙에 대상 하나)의 비율이다. 나머지는
    매대 스캔 구도. 앱이 주 사용 경로이므로 기본 0.5 로 반씩 섞는다. 1.0 으로 두지
    않는 이유는 `compose_one` 문서에 적어 뒀다 — 위치 편향이 생긴다.
    """
    cv2 = _cv2()
    out_dir = Path(out_dir)
    bgs = [p for p in sorted(Path(backgrounds_dir).rglob("*"))
           if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")]
    if not bgs:
        raise RuntimeError(
            "배경 이미지가 없다: {}\n"
            "  `python -m mlv2.detect.backgrounds --guide` 로 수집 방법을 볼 것.".format(
                backgrounds_dir))

    all_rows = read_index(index_path)
    train_rows, val_rows = split_bank(all_rows, val_ratio=0.15, seed=seed)
    if verbose:
        print("누끼 {:,}개 → train {:,} / val {:,} (개체 단위 분리)".format(
            len(all_rows), len(train_rows), len(val_rows)))
        print("배경 {:,}장".format(len(bgs)))
        # 배경도 나눠야 한다. 안 나누면 val 이 train 과 같은 배경을 보게 된다.
    n_bg_val = max(1, int(len(bgs) * 0.2))
    bg_val, bg_train = bgs[:n_bg_val], bgs[n_bg_val:] or bgs

    class_index = None
    if per_class:
        items = sorted(set(r["item"] for r in all_rows))
        class_index = dict((it, i) for i, it in enumerate(items))
        names = items
    else:
        names = ["produce"]

    (out_dir / "preview").mkdir(parents=True, exist_ok=True)
    counts = {}
    for split, rows, bgset, n in (("train", train_rows, bg_train, n_train),
                                  ("val", val_rows, bg_val, n_val)):
        img_dir = out_dir / "images" / split
        lab_dir = out_dir / "labels" / split
        img_dir.mkdir(parents=True, exist_ok=True)
        lab_dir.mkdir(parents=True, exist_ok=True)
        bank = CutoutBank(index_path, rows=rows)
        rng = random.Random(seed + (0 if split == "train" else 9999))

        n_obj_total = 0
        n_centered = 0
        # 주 피사체 정답. '중앙 객체 하나만 골라 크롭' 하는 앱 경로에서는 **선택 규칙**이
        # 별도 부품이고, 그 정확도를 재려면 정답이 있어야 한다. 합성기는 누가 대상인지
        # 알고 있으니 여기서 흘려버리지 않고 남긴다.
        subj_rows = [("image", "item", "x0", "y0", "x1", "y1")]
        for i in range(n):
            mode = "centered" if rng.random() < center_ratio else "scan"
            n_centered += (mode == "centered")
            img, labels = compose_one(bank, bgset, rng, size=size, scene_mode=mode,
                                      priority_ratio=priority_ratio)
            stem = "{}_{:06d}".format(split, i)
            for lb in labels:
                if lb[5]:
                    subj_rows.append((stem + ".jpg", lb[0]) + tuple(lb[1:5]))
            compat.imwrite(str(img_dir / (stem + ".jpg")), img,
                        [cv2.IMWRITE_JPEG_QUALITY, 90])
            lines = to_yolo_lines(labels, size, class_index)
            (lab_dir / (stem + ".txt")).write_text("\n".join(lines), encoding="utf-8")
            n_obj_total += len(lines)
            if i < preview and split == "train":
                compat.imwrite(str(out_dir / "preview" / (stem + "_" + mode + ".jpg")),
                            draw_labels(img, labels))
            if verbose and n >= 200 and (i + 1) % max(1, n // 5) == 0:
                print("  {} {:,}/{:,}".format(split, i + 1, n))
        with open(str(out_dir / ("subjects_" + split + ".csv")), "w",
                  encoding="utf-8", newline="") as fh:
            csv.writer(fh).writerows(subj_rows)
        counts[split] = (n, n_obj_total)
        if verbose:
            print("{}: 이미지 {:,}장 / 객체 {:,}개 (장당 평균 {:.1f}) "
                  "— 중앙구도 {:,} / 매대구도 {:,}".format(
                      split, n, n_obj_total, n_obj_total / max(1, n),
                      n_centered, n - n_centered))

    yaml_path = out_dir / "dataset.yaml"
    yaml_path.write_text(
        "# mlv2 합성 검출 데이터셋\n"
        "path: {}\n"
        "train: images/train\n"
        "val: images/val\n"
        "nc: {}\n"
        "names: [{}]\n".format(
            out_dir.resolve().as_posix(), len(names),
            ", ".join("'{}'".format(n) for n in names)),
        encoding="utf-8")

    if verbose:
        print("\ndataset.yaml: {}".format(yaml_path))
        print("미리보기: {} — **학습 전에 반드시 눈으로 확인할 것.**".format(out_dir / "preview"))
        print("  합성 파이프라인의 버그는 지표로 안 잡히고 그림으로만 보인다.")
    return yaml_path, counts


def main(argv=None):
    p = argparse.ArgumentParser(description="누끼 + 배경 → YOLO 합성 데이터셋")
    p.add_argument("--index", default="data/cutouts/index.csv")
    p.add_argument("--backgrounds", default="data/backgrounds")
    p.add_argument("--out", default="data/synth_detect")
    p.add_argument("--n-train", type=int, default=4000)
    p.add_argument("--n-val", type=int, default=600)
    p.add_argument("--size", type=int, default=768)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--per-class", action="store_true",
                   help="10품목을 각각 검출 클래스로. 기본은 1클래스(produce)")
    p.add_argument("--preview", type=int, default=12)
    p.add_argument("--priority-ratio", type=float, default=0.6,
                   help="중앙 구도의 주 피사체를 시나리오 품목(배추·사과·배)에서 "
                        "뽑을 확률. 0 이면 10품목 균등")
    p.add_argument("--center-ratio", type=float, default=0.5,
                   help="앱 촬영 가이드 구도(중앙에 대상 하나)의 비율. "
                        "나머지는 매대 스캔 구도. 1.0 은 위치 편향이 생기니 피할 것")
    a = p.parse_args(argv)
    generate(a.index, a.backgrounds, a.out, n_train=a.n_train, n_val=a.n_val,
             size=a.size, seed=a.seed, per_class=a.per_class, preview=a.preview,
             center_ratio=a.center_ratio, priority_ratio=a.priority_ratio)


if __name__ == "__main__":
    main()
