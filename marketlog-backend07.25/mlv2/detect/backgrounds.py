"""배경 수집·검증.

합성 데이터에서 **배경 다양성이 배경 강건성의 상한**이다. 배경이 3장이면 YOLO 는
그 3장의 텍스처를 "배경" 으로 외우고, 처음 보는 매대에서 무너진다. 누끼가 1만 개라도
배경이 3장이면 실질 다양성은 3이다. 최소 200장, 가능하면 500장을 목표로 한다.

## 카테고리와 목표 장수

'농산물이 놓일 법한 면' 을 골고루 덮는 것이 목적이다. 예쁜 사진이 아니라 **지루한 바닥**
이 필요하다.

    stall_empty     빈 매대·진열대·좌판                    60장
    cardboard       종이박스·과일상자·골판지               50장   ← 시장에서 제일 흔한 받침
    white_paper     흰 종이·신문지·스티로폼 트레이·부직포   50장   ← 아래 설명 참조
    basket_crate    플라스틱 바구니·그물망·나무 궤짝        40장
    floor_table     시멘트·아스팔트·타일·나무 테이블        60장
    mart_shelf      마트 매대·냉장 진열대                   40장
    misc_cloth      천·비닐·방수포                          30장

**흰 종이/스티로폼을 따로 둔 이유가 있다.** 이 배경은 원본 스튜디오 배경(균일한 흰색)과
거의 같다. 그래서 두 가지를 동시에 한다.
  - 도메인 연속성: 학습 데이터의 원래 분포와 실사용 분포 사이에 다리를 놓는다.
  - hard negative: 흰 배경에서 물체 경계를 찾는 법을 강제로 배우게 한다. 누끼 잔재가
    흰색이라 흰 배경 위에서는 티가 안 나는데, 역설적으로 그래서 모델이 진짜 경계를
    봐야만 한다.
실제 매대에서도 스티로폼 트레이·흰 부직포는 매우 흔하다.

## 라이선스 — 반드시 확인할 것

산학협력 결과물이라 상업적 이용 가능 여부가 중요하다. 아래 셋은 상업적 이용이 명시적으로
허용되고 출처 표기도 필수가 아니다(2026-08 기준, 사용 전 각 사이트에서 재확인할 것).

    Unsplash   https://unsplash.com/license          API 키 무료
    Pexels     https://www.pexels.com/license/       API 키 무료
    Pixabay    https://pixabay.com/service/license/  API 키 무료

⚠️ 구글 이미지 검색 결과를 그대로 긁는 것은 하지 말 것. 대부분 저작권이 살아 있다.

**가장 좋은 배경은 직접 찍은 것이다.** 실제로 쓸 시장에서 빈 매대를 30~50장만 찍어도
위 어떤 데이터셋보다 도메인이 정확하다. 어차피 평가용 현장 사진을 찍어야 하니
그때 같이 찍는 것을 권한다.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from collections import Counter
from pathlib import Path

from mlv2 import compat
from mlv2.compat import setup_stdout

setup_stdout()

# ⚠️ 검색어에 "empty" 를 넣어도 스톡 사이트는 그 단어를 사실상 무시한다.
# 2026-08-10 실측: `empty market stall` 로 받은 58장 중 43장이 농산물이 가득 찬 시장
# 사진이었다(사과 상자·양파 상자까지). 라벨 없는 객체가 되어 YOLO 에게 정확히
# 반대되는 것을 가르치므로 최악의 오염이다.
# → 부정어("empty") 대신 **재질·구조**를 지칭하는 검색어가 훨씬 잘 먹는다.
#   "wooden shelf background" 는 되고 "supermarket shelf empty" 는 안 된다.
CATEGORIES = {
    "stall_empty": {
        "target": 60,
        "ko": ["전통시장 빈 매대", "재래시장 좌판", "채소가게 진열대"],
        "en": ["wooden market stall structure", "market stall canopy",
               "wooden display stand", "empty wooden counter top",
               "market stall roof frame", "closed shop shutter street"],
    },
    "cardboard": {
        "target": 50,
        "ko": ["종이박스", "과일 상자", "골판지 박스"],
        "en": ["cardboard box texture", "produce crate cardboard",
               "corrugated cardboard background", "fruit box cardboard"],
    },
    "white_paper": {
        "target": 50,
        "ko": ["흰 종이", "신문지", "스티로폼 트레이", "부직포"],
        "en": ["white paper texture", "newspaper background",
               "styrofoam tray", "white nonwoven fabric", "butcher paper"],
    },
    "basket_crate": {
        "target": 40,
        "ko": ["플라스틱 바구니", "과일 그물망", "나무 궤짝"],
        "en": ["plastic crate empty", "wicker basket empty",
               "wooden crate background", "mesh net bag"],
    },
    "floor_table": {
        "target": 60,
        "ko": ["시멘트 바닥", "나무 테이블", "타일 바닥"],
        "en": ["concrete floor texture", "wooden table top",
               "tile floor texture", "asphalt texture"],
    },
    "mart_shelf": {
        "target": 40,
        "ko": ["마트 진열대", "슈퍼마켓 매대"],
        "en": ["wooden shelf background", "empty shelf wall",
               "metal wire shelf rack", "white shelf board",
               "wooden plank shelf", "steel rack industrial"],
    },
    "misc_cloth": {
        "target": 30,
        "ko": ["천 배경", "비닐 배경", "방수포"],
        "en": ["fabric texture background", "tarpaulin texture",
               "plastic sheet texture"],
    },
}


def print_guide():
    total = sum(c["target"] for c in CATEGORIES.values())
    print("=" * 66)
    print("배경 이미지 수집 가이드 — 목표 {}장".format(total))
    print("=" * 66)
    print("\n[가장 좋은 방법] 실제 쓸 시장에서 '빈 매대'를 직접 촬영.")
    print("  평가용 현장 사진을 찍을 때 같이 찍으면 한 번에 끝난다.")
    print("  물건이 없는 상태의 바닥·상자·좌판을 여러 각도로.\n")
    print("[보완] 무료 스톡 사이트. 상업적 이용 가능 + 출처표기 불필요:")
    print("  Unsplash / Pexels / Pixabay  (구글 이미지 긁기는 금지)\n")
    for name, c in CATEGORIES.items():
        print("● {} — {}장".format(name, c["target"]))
        print("   한글 검색어: {}".format(" / ".join(c["ko"])))
        print("   영문 검색어: {}".format(" / ".join(c["en"])))
    print("\n" + "-" * 66)
    print("저장 위치: data/backgrounds/<카테고리명>/*.jpg")
    print("자동 수집:  python -m mlv2.detect.backgrounds --download --provider pexels")
    print("            (환경변수 PEXELS_API_KEY 또는 PIXABAY_API_KEY 필요)")
    print("검증:       python -m mlv2.detect.backgrounds --verify")
    print("\n※ 배경에 농산물이 이미 찍혀 있으면 안 된다. 라벨 없는 객체가 되어")
    print("  YOLO 에게 '여기 물체가 있는데 없다고 배워라' 를 가르치게 된다.")
    print("  --verify 가 의심스러운 파일을 짚어 주지만 최종 확인은 눈으로 할 것.")


# Pexels 는 Cloudflare 뒤에 있고, urllib 기본 UA("Python-urllib/3.x")는
# 브라우저 무결성 검사에 걸려 403(error code 1010)으로 잘린다. 키가 멀쩡한데도
# 전 카테고리가 0장으로 끝나므로 '키가 틀렸나' 로 오진하기 쉽다. UA 하나면 200 이 온다.
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def _download(url, dest, timeout=30):
    import urllib.request

    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    dest.write_bytes(data)
    return len(data)


def download(out_dir="data/backgrounds", provider="pexels", per_query=15,
             categories=None, sleep=0.6, verbose=True):
    """스톡 사이트 API 로 배경을 받는다. API 키는 각 사이트에서 무료 발급.

    키가 없으면 아무것도 안 하고 가이드만 띄운다 — 조용히 실패하지 않게.
    """
    import urllib.parse
    import urllib.request

    out_dir = Path(out_dir)
    key = os.environ.get(
        "PEXELS_API_KEY" if provider == "pexels" else "PIXABAY_API_KEY", "")
    if not key:
        env = "PEXELS_API_KEY" if provider == "pexels" else "PIXABAY_API_KEY"
        print("[중단] 환경변수 {} 가 없다.".format(env))
        print("  Windows PowerShell:")
        print('    [Environment]::SetEnvironmentVariable("{}","<키>","User")'.format(env))
        print("  등록 후 새 터미널을 열어야 반영된다.")
        return {}

    # 한 번 걸러낸 파일이 재다운로드로 되살아나는 것을 막는다.
    # `dest.exists()` 만 보면, 눈으로 확인해 격리한 오염 배경이 다음 실행에서 그대로
    # 다시 들어온다(실제로 2026-08-10 에 사과·감자 상자 12장이 이렇게 되돌아왔다).
    rejected_dir = Path(str(out_dir) + "_rejected")
    rejected = {p.stem for p in rejected_dir.rglob("*") if p.is_file()}
    if rejected:
        print("격리 목록 {}건은 건너뛴다 ({})".format(len(rejected), rejected_dir))

    cats = categories or list(CATEGORIES)
    got = Counter()
    for cat in cats:
        spec = CATEGORIES[cat]
        cdir = out_dir / cat
        cdir.mkdir(parents=True, exist_ok=True)
        for q in spec["en"]:
            if got[cat] >= spec["target"]:
                break
            try:
                if provider == "pexels":
                    url = ("https://api.pexels.com/v1/search?query={}&per_page={}"
                           "&orientation=landscape".format(
                               urllib.parse.quote(q), per_query))
                    req = urllib.request.Request(
                        url, headers={"Authorization": key, "User-Agent": _UA})
                    with urllib.request.urlopen(req, timeout=30) as r:
                        js = json.loads(r.read())
                    urls = [p["src"]["large"] for p in js.get("photos", [])]
                else:
                    url = ("https://pixabay.com/api/?key={}&q={}&per_page={}"
                           "&image_type=photo&orientation=horizontal".format(
                               key, urllib.parse.quote(q), per_query))
                    req = urllib.request.Request(url, headers={"User-Agent": _UA})
                    with urllib.request.urlopen(req, timeout=30) as r:
                        js = json.loads(r.read())
                    urls = [h["largeImageURL"] for h in js.get("hits", [])]
            except Exception as exc:
                print("  [실패] {} / {}: {}".format(cat, q, exc))
                continue

            for u in urls:
                if got[cat] >= spec["target"]:
                    break
                h = hashlib.md5(u.encode()).hexdigest()[:12]
                dest = cdir / "{}_{}.jpg".format(cat, h)
                if dest.stem in rejected:
                    continue
                if dest.exists():
                    got[cat] += 1
                    continue
                try:
                    _download(u, dest)
                    got[cat] += 1
                except Exception:
                    continue
                time.sleep(sleep)
        if verbose:
            print("{:<14} {:>3}/{}".format(cat, got[cat], spec["target"]))
    return dict(got)


def verify(bg_dir="data/backgrounds", min_side=480, verbose=True):
    """수집된 배경을 점검한다.

    보는 것: 장수, 해상도, 중복(해시), 그리고 '농산물이 이미 찍혀 있을 가능성'.
    마지막 항목은 채도가 높은 주황/빨강/초록 화소 비율로 대충 거른다. 완벽하지 않으니
    의심 목록은 눈으로 확인할 것.
    """
    import cv2
    import numpy as np

    bg_dir = Path(bg_dir)
    files = [p for p in sorted(bg_dir.rglob("*"))
             if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")]
    if not files:
        print("배경이 하나도 없다: {}".format(bg_dir))
        print("`python -m mlv2.detect.backgrounds --guide` 를 볼 것.")
        return {}

    by_cat = Counter()
    hashes = {}
    dups, small, suspicious = [], [], []
    for p in files:
        cat = p.parent.name if p.parent != bg_dir else "(root)"
        by_cat[cat] += 1
        img = compat.imread(str(p))
        if img is None:
            continue
        h, w = img.shape[:2]
        if min(h, w) < min_side:
            small.append((p.name, w, h))
        d = hashlib.md5(cv2.resize(img, (16, 16)).tobytes()).hexdigest()
        if d in hashes:
            dups.append((p.name, hashes[d]))
        else:
            hashes[d] = p.name

        hsv = cv2.cvtColor(cv2.resize(img, (128, 128)), cv2.COLOR_BGR2HSV)
        hue, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
        vivid = ((sat > 120) & (val > 90) &
                 (((hue < 20) | (hue > 165)) | ((hue > 35) & (hue < 85))))
        if vivid.mean() > 0.18:
            suspicious.append((p.name, round(float(vivid.mean()), 2)))

    if verbose:
        print("배경 {:,}장".format(len(files)))
        print("-" * 46)
        for cat in sorted(by_cat):
            target = CATEGORIES.get(cat, {}).get("target")
            mark = ""
            if target:
                mark = " (목표 {}{})".format(target, " ✓" if by_cat[cat] >= target else "")
            print("  {:<14}{:>4}{}".format(cat, by_cat[cat], mark))
        print("-" * 46)
        if len(files) < 100:
            print("[경고] 100장 미만이다. 배경 다양성이 배경 강건성의 상한이다.")
        if dups:
            print("중복 의심 {}건 (예: {})".format(
                len(dups), ", ".join(n for n, _ in dups[:3])))
        if small:
            print("해상도 부족 {}건 — {}px 미만은 합성 시 뭉개진다".format(len(small), min_side))
        if suspicious:
            print("농산물이 이미 찍혀 있을 가능성 {}건 — 눈으로 확인할 것:".format(
                len(suspicious)))
            for n, v in suspicious[:8]:
                print("   {} (선명한 색 비율 {})".format(n, v))
    return {"total": len(files), "by_cat": dict(by_cat), "dups": len(dups),
            "small": len(small), "suspicious": [n for n, _ in suspicious]}


def main(argv=None):
    p = argparse.ArgumentParser(description="배경 수집·검증")
    p.add_argument("--guide", action="store_true", help="수집 가이드 출력")
    p.add_argument("--download", action="store_true")
    p.add_argument("--verify", action="store_true")
    p.add_argument("--provider", default="pexels", choices=["pexels", "pixabay"])
    p.add_argument("--out", default="data/backgrounds")
    p.add_argument("--categories", nargs="*", default=None)
    a = p.parse_args(argv)

    if a.download:
        download(a.out, provider=a.provider, categories=a.categories)
        verify(a.out)
    elif a.verify:
        verify(a.out)
    else:
        print_guide()


if __name__ == "__main__":
    main()
