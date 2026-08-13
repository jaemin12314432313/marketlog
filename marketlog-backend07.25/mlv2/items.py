"""품목 이름과 파일명 규칙. 데이터셋의 '진실'이 모이는 곳이다.

여기 있는 두 함수(`specimen_key`, `item_from_filename`)가 파이프라인 전체의 기반이다.
- `specimen_key` 가 틀리면 train/val 개체 누수가 생기는데, 겉으로는 val_acc 가 **올라가서**
  성공처럼 보인다. 그래서 아래 doctest 로 못박아 뒀다.
- `item_from_filename` 이 틀리면 실사진 평가의 정답이 틀리는데, 이것도 조용히 틀린다.
"""
from __future__ import annotations

import re
from pathlib import Path

# 학습 클래스 10종. 순서는 정렬 기준이며 체크포인트에 함께 저장되므로 임의로 바꾸지 말 것.
ITEM_CLASSES = [
    "감", "감귤", "감자", "마늘", "무",
    "배", "배추", "사과", "양배추", "양파",
]

# AI-Hub B-A05 원천 zip 파일명 접두어(영문) -> 품목명(한글).
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

# zip 파일명 끝의 등급코드. 품목 인식에는 안 쓰지만, 추출 시 등급이 한쪽으로
# 쏠리지 않게 층화하는 데 필요하다(등급 = 촬영 배치라 조명이 갈린다).
GRADE_CODE_TO_NAME = {"L": "특", "M": "상", "S": "보통"}

# .heic/.heif 는 아이폰 기본 포맷이다. 학습 데이터에는 없지만 실사진 테스트는
# 폰 사진으로 하므로 여기 포함시킨다. PIL 이 열려면 `mlv2.compat.register_heif()` 가
# 먼저 불려야 한다(`mlv2.pipeline` 은 import 시점에 부른다).
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".avif", ".heic", ".heif"}

# B-A05 촬영 방식: 개체 하나를 40~175장 다각도 촬영.
# 파일명 "..._<group>-<imgno>[_<각도코드>].<ext>" 에서 <group>이 개체 식별자다.
#
# <group> 을 `\d+` 가 아니라 `\d*` 로 둔 이유(2026-08-10):
# 배(pear)에만 개체번호가 **빈** 파일이 있다 — `pear_chuhwang_L_..._-1_1TOP.jpg`.
# `\d+` 로는 이것들이 전부 매칭에 실패해 파일명 자체가 키가 되는데, 각도 코드가
# 1TOP→2FR45→3FR90→4DI45→5DI90 으로 순환하는 걸 보면 **같은 개체의 다른 각도**다.
# 즉 한 개체의 사진들이 train/val 양쪽으로 흩어진다. 이 저장소가 등급 모델에서
# 이미 한 번 데인 바로 그 누수다(QWK 0.765 → 0.421).
_SPECIMEN_RE = re.compile(r"^(.*)_(\d*)-\d+(?:_[^_.]+)?\.[^.]+$")


def specimen_key(filename):
    """같은 개체를 다른 각도에서 찍은 사진들이 같은 키를 갖게 한다.

    >>> specimen_key("onion_red_M_0012-003_TOP.jpg")
    'onion_red_M_0012'
    >>> specimen_key("onion_red_M_0012-047.jpg")
    'onion_red_M_0012'
    >>> specimen_key("onion_red_M_0013-003_TOP.jpg")
    'onion_red_M_0013'

    개체번호가 비어 있으면 품종 단위로 뭉친다. 서로 다른 개체를 합칠 수는 있지만
    그 방향은 분할을 보수적으로 만들 뿐이고, 반대(같은 개체가 갈리는 것)는 누수다.

    >>> specimen_key("pear_chuhwang_L_pear_chuhwang_L_-1_1TOP.jpg")
    'pear_chuhwang_L_pear_chuhwang_L_'
    >>> specimen_key("pear_chuhwang_L_pear_chuhwang_L_-7_2FR45.jpg")
    'pear_chuhwang_L_pear_chuhwang_L_'
    >>> specimen_key("pear_chuhwang_L_pear_chuhwang_L_1-1.jpg")
    'pear_chuhwang_L_pear_chuhwang_L_1'

    그래도 패턴에 안 맞으면 파일명 자체를 키로 쓴다.
    """
    m = _SPECIMEN_RE.match(filename)
    if m:
        return "{}_{}".format(m.group(1), m.group(2))
    return filename


def item_from_filename(filename):
    """파일명에서 품목(정답)을 유도한다. 한글/영문 접두어를 모두 받는다.

    실사진 평가셋 `test_image/` 에는 두 규칙이 섞여 있다.
    한글 `<품목>_N.jpg` 와 영문 `apple.png` / `cabbage2.png` 형태다.

    >>> item_from_filename("배추_1.jpeg")
    '배추'
    >>> item_from_filename("apple.png")
    '사과'
    >>> item_from_filename("cabbage2.png")
    '양배추'
    >>> item_from_filename("chinese-cabbage_green_L_0001-002.jpg")
    '배추'
    >>> item_from_filename("무관한파일.txt") is None
    True
    """
    stem = Path(filename).stem

    # 1) 한글 품목명이 접두어인 경우. 긴 이름부터 봐야 '배'가 '배추'를 잡아먹지 않는다.
    for item in sorted(ITEM_CLASSES, key=len, reverse=True):
        if stem.startswith(item):
            rest = stem[len(item):]
            # "배추_1" 은 통과, "배추말이" 같은 건 거른다.
            if rest == "" or rest[0] in "_-0123456789":
                return item

    # 2) 영문 접두어. 'chinese-cabbage' 가 'cabbage' 보다 먼저 매칭돼야 한다.
    lowered = stem.lower()
    for prefix in sorted(PREFIX_TO_ITEM, key=len, reverse=True):
        if lowered.startswith(prefix):
            rest = lowered[len(prefix):]
            if rest == "" or not rest[0].isalpha():
                return PREFIX_TO_ITEM[prefix]
            # "cabbage2" 처럼 숫자가 바로 붙는 경우도 위 조건에서 걸린다.
    # 3) 첫 토큰만 따로 한 번 더 (원천 zip 유래 파일명)
    first = lowered.split("_")[0]
    return PREFIX_TO_ITEM.get(first)


def item_from_zip_name(zip_path):
    """원천 zip 파일명에서 품목을 유도한다. `<품목영문>_<품종>_<등급코드>.zip`"""
    return PREFIX_TO_ITEM.get(Path(zip_path).stem.split("_")[0].lower())


def grade_from_zip_name(zip_path):
    """zip 파일명 끝의 등급코드 L/M/S -> 특/상/보통. 못 읽으면 None."""
    code = Path(zip_path).stem.split("_")[-1].upper()
    return GRADE_CODE_TO_NAME.get(code)


def is_image(path):
    return Path(path).suffix.lower() in IMAGE_EXTS
