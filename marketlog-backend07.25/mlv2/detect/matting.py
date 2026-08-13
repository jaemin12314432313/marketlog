"""누끼(matting) — 합성 파이프라인 전체의 품질 상한을 정하는 지점.

여기서 배경이 조금이라도 딸려오면 YOLO 는 "흰 받침이 달린 물체"를 농산물로 배운다.
바운딩 박스도 그만큼 커져서 뒤단 분류기에 배경이 섞인 크롭이 넘어간다. 그래서 이 모듈은
정확도보다 **실패를 걸러내는 것**에 무게를 뒀다 — 애매한 누끼는 뱅크에 넣지 않는다.
원본이 21만 장이라 30%를 버려도 6만 장이 남는다. 아쉬워할 이유가 없다.

## 왜 Lab 색도인가 (실측 근거)

처음엔 기존 `augment.py` 와 같은 방식, 즉 **RGB 거리**로 떴다. 테두리 색의 중앙값을
배경으로 잡고 거기서 멀면 전경으로 본다. 흰 배경이라 될 것 같지만 두 군데서 무너진다.

  ① **그림자.** 그림자는 배경과 색은 같고 밝기만 낮다. RGB 거리는 밝기 차를 그대로
     반영하므로 그림자가 전경으로 잡힌다.
  ② **흰 물체.** 무·마늘처럼 흰 물체는 흰 배경과 RGB 거리가 가깝다. 임계값을 낮추면
     그림자가 더 들어오고, 높이면 물체가 잘린다. 빠져나갈 구멍이 없다.

Lab 색공간에서 **L(밝기)을 버리고 a*,b*(색도)만** 쓰면 ①이 원리적으로 해결된다.
그림자는 색도가 배경과 같기 때문이다. ②는 색도로 안 되니 밝기 항을 **따로, 큰 임계값으로**
OR 로 붙인다 — 흰 물체는 배경보다 확실히 밝거나 어둡다.

실측(무, 300x300):

    방식            전경 비율
    RGB 거리        0.614   ← 배경째 전경으로 잡힘. 사실상 실패
    Lab 색도        0.270   ← 물체만 정확히
    + GrabCut       0.269

GrabCut 은 다른 품목에서 전경을 **넓히는** 방향으로 움직였다(사과 0.883→0.913).
경계를 다듬어 주기는 하나 배경을 더 먹는 경우가 있어 기본값은 끔(`refine_grabcut=False`)이다.
"""
from __future__ import annotations

import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None


def _require_cv2():
    if cv2 is None:
        raise ImportError(
            "opencv 가 필요하다: pip install opencv-python-headless")


def _border_pixels(img, k=6):
    """테두리 k픽셀을 모은다. 여기 있는 것은 배경이라고 가정한다.

    개체가 프레임을 꽉 채운 이미지에서는 이 가정이 깨진다 — 그래서 `quality()` 가
    테두리 접촉률을 재서 그런 이미지를 아예 걸러낸다.
    """
    c = img.shape[2]
    return np.concatenate([
        img[:k].reshape(-1, c), img[-k:].reshape(-1, c),
        img[:, :k].reshape(-1, c), img[:, -k:].reshape(-1, c),
    ])


def chroma_mask(bgr, chroma_tol=8.0, lum_tol=38.0, border=6):
    """Lab 색도 기반 전경 마스크. 이 모듈의 기본 방식이다.

    chroma_tol: a*,b* 거리 임계. 낮을수록 색이 조금만 달라도 전경. 기본 8.
    lum_tol:    L 거리 임계. 흰/검은 물체를 건지는 용도라 **크게** 잡는다. 기본 38.
                작게 잡으면 그림자가 다시 들어온다 — 이 값이 그림자와의 트레이드오프다.
    """
    _require_cv2()
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2Lab).astype(np.float32)
    med = np.median(_border_pixels(lab, border), axis=0)
    d_chroma = np.sqrt(((lab[..., 1:] - med[1:]) ** 2).sum(axis=2))
    d_lum = np.abs(lab[..., 0] - med[0])
    return (((d_chroma > chroma_tol) | (d_lum > lum_tol)).astype(np.uint8)) * 255


def rgb_mask(bgr, tol=30.0, border=6):
    """구식 RGB 거리 방식. 비교·대조군용으로만 남겨둔다. 실사용 금지."""
    _require_cv2()
    med = np.median(_border_pixels(bgr, border), axis=0)
    d = np.sqrt(((bgr.astype(np.float32) - med) ** 2).sum(axis=2))
    return ((d > tol).astype(np.uint8)) * 255


def cleanup(mask, keep_largest=True, fill_holes=True, kernel=9):
    """형태학 정리 + 최대 연결성분 + 구멍 메우기.

    최대 연결성분만 남기는 이유: 스튜디오 사진은 개체가 하나다. 남는 조각은 그림자
    잔재나 노이즈다. 다만 꼭지·잎이 본체와 떨어져 보이면 같이 날아가므로,
    `keep_largest=False` 로 끌 수 있게 뒀다(배추·무 잎에서 필요할 수 있다).
    """
    _require_cv2()
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel, kernel))
    m = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=2)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k, iterations=1)

    if keep_largest:
        n, lab, stats, _ = cv2.connectedComponentsWithStats((m > 0).astype(np.uint8), 8)
        if n > 1:
            biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
            m = ((lab == biggest).astype(np.uint8)) * 255

    if fill_holes:
        ff = m.copy()
        h, w = m.shape
        # (0,0) 이 전경이면 floodFill 이 전체를 채워버린다. 배경 모서리를 찾아 시작점으로.
        seed = None
        for pt in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
            if m[pt[1], pt[0]] == 0:
                seed = pt
                break
        if seed is not None:
            cv2.floodFill(ff, np.zeros((h + 2, w + 2), np.uint8), seed, 255)
            m = m | cv2.bitwise_not(ff)
    return m


def grabcut_refine(bgr, mask, iterations=3, erode=15, dilate=21):
    """GrabCut 으로 경계를 다듬는다. **기본은 끔.**

    실측에서 전경을 넓히는 방향으로 움직였다(사과 0.883 → 0.913). 배경을 더 먹는다는
    뜻이라 합성용으로는 위험하다. 경계가 지저분한 특정 품목에서만 켜 볼 것.
    """
    _require_cv2()
    g = np.full(mask.shape, cv2.GC_PR_BGD, np.uint8)
    er = cv2.erode(mask, np.ones((erode, erode), np.uint8))
    dl = cv2.dilate(mask, np.ones((dilate, dilate), np.uint8))
    g[dl > 0] = cv2.GC_PR_FGD
    g[er > 0] = cv2.GC_FGD
    g[dl == 0] = cv2.GC_BGD
    if (g == cv2.GC_FGD).sum() == 0 or (g == cv2.GC_BGD).sum() == 0:
        return mask
    try:
        cv2.grabCut(bgr, g, None, np.zeros((1, 65), np.float64),
                    np.zeros((1, 65), np.float64), iterations, cv2.GC_INIT_WITH_MASK)
    except cv2.error:
        return mask
    return np.where((g == cv2.GC_FGD) | (g == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)


def edge_contact(mask):
    """테두리 픽셀 중 전경이 차지하는 비율. **잘림(truncation) 지표**다.

    라벨의 `truncated` 컬럼은 21만 건 전부 'on' 이라 못 쓴다. 픽셀로 직접 잰다.
    이 값이 크면 개체가 프레임 밖으로 잘린 것이고, 그런 누끼를 배경 위에 붙이면
    단면이 노출된 물체가 공중에 뜬다.
    """
    e = np.concatenate([mask[0], mask[-1], mask[:, 0], mask[:, -1]])
    return float((e > 0).mean())


def solidity(mask):
    """마스크 면적 / 볼록껍질 면적. 1에 가까울수록 매끈하다.

    그림자가 딸려오면 마스크에 얇게 뻗은 꼬리가 생겨 이 값이 떨어진다.
    즉 '누끼가 지저분한가'를 정답 없이 잴 수 있는 대리 지표다.
    """
    _require_cv2()
    cnts, _ = cv2.findContours((mask > 0).astype(np.uint8),
                               cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return 0.0
    c = max(cnts, key=cv2.contourArea)
    area = cv2.contourArea(c)
    hull = cv2.contourArea(cv2.convexHull(c))
    return float(area / hull) if hull > 0 else 0.0


def quality(mask):
    """누끼 품질 지표 묶음. 뱅크 채택 여부를 이걸로 판단한다."""
    fg = float((mask > 0).mean())
    return {
        "fg_ratio": fg,
        "edge_contact": edge_contact(mask),
        "solidity": solidity(mask),
    }


def is_usable(q, max_edge_contact=0.05, min_solidity=0.88,
              min_fg=0.02, max_fg=0.88):
    """뱅크에 넣을 만한 누끼인지.

    **필터를 조이는 편이 알고리즘을 정교하게 만드는 것보다 안전하다.** 원본이 21만 장이라
    90% 를 버려도 2만 장이 남는다. 반면 잔재가 붙은 누끼 하나는 학습 내내 잘못된 신호를
    준다. 그래서 기준을 애매한 쪽이 아니라 확실한 쪽으로 잡았다.

      max_edge_contact 0.05 — 600장 표본에서 통과율 28%. 양파(2%)처럼 낮은 품목은
          `cutouts.PER_ITEM_MAX_EDGE` 에서 품목별로 완화한다.
      min_solidity 0.88 — 첫 시도의 0.80 은 느슨했다. 미리보기에서 접지 반사가 붙은
          누끼가 그대로 통과했다. 볼록껍질 대비 88% 는 '군더더기 없는 덩어리' 기준이다.
      max_fg 0.88 — 전경이 프레임의 88% 를 넘으면 사실상 잘린 것이다(0.92 에서 하향).
      min_fg 0.02 — 마스크가 거의 비었으면 매팅 실패다.
    """
    return (q["edge_contact"] <= max_edge_contact
            and q["solidity"] >= min_solidity
            and min_fg <= q["fg_ratio"] <= max_fg)


def cut_out(bgr, chroma_tol=8.0, lum_tol=38.0, refine_grabcut=False,
            feather=5, keep_largest=True):
    """이미지 하나 → (rgba, quality). 실패하면 (None, quality).

    rgba 는 전경 bbox 로 크롭된 BGRA 배열이다. 알파는 경계를 페더링해서
    합성했을 때 톱니가 안 보이게 한다.
    """
    _require_cv2()
    m = chroma_mask(bgr, chroma_tol=chroma_tol, lum_tol=lum_tol)
    m = cleanup(m, keep_largest=keep_largest)
    if refine_grabcut:
        m = cleanup(grabcut_refine(bgr, m), keep_largest=keep_largest)

    q = quality(m)
    ys, xs = np.where(m > 0)
    if len(xs) < 64:
        return None, q

    y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
    crop = bgr[y0:y1 + 1, x0:x1 + 1]
    alpha = m[y0:y1 + 1, x0:x1 + 1]
    if feather:
        f = feather if feather % 2 else feather + 1
        alpha = cv2.GaussianBlur(alpha, (f, f), 0)

    rgba = np.dstack([crop, alpha])
    return rgba, q


def trim_ground_shadow(rgba, band=0.25, width_jump=0.20, gloss_sat=45,
                       gloss_val=200):
    """바닥 접지면(흰 반사·받침)을 잘라낸다.

    첫 버전은 '아래쪽에서 폭이 갑자기 넓어지는 행' 만 찾았는데, 실제 미리보기를 보니
    접지면이 물체보다 **좁은** 경우가 더 많아서 거의 안 걸렸다. 사과·감자 밑에 흰
    반원이 그대로 남았다. 그래서 판정을 둘로 늘렸다.

      ① 폭 급증 — 원래 방식. 그림자가 옆으로 퍼지는 경우.
      ② 흰 반사 — 아래쪽 band 구간에서 **채도가 낮고 명도가 높은**(=흰) 행이
         그 행 전체를 지배하면 접지면으로 본다. 촬영대 반사가 정확히 이 모양이다.

    흰 농산물(무·마늘)이 잘려나가지 않도록 두 가지 보호를 뒀다.
      - band 를 아래 25% 로 제한한다. 물체 본체는 그 위에 있다.
      - 잘라낸 뒤 남는 높이가 원래의 60% 미만이면 취소하고 원본을 돌려준다.

    보수적으로 동작한다: 조건에 안 맞으면 원본 그대로.
    """
    _require_cv2()
    h, w = rgba.shape[:2]
    if h < 24:
        return rgba
    a = rgba[..., 3]
    fg = a > 127
    widths = fg.sum(axis=1)
    if widths.max() == 0:
        return rgba

    start = int(h * (1 - band))
    body = widths[:start]
    body_med = float(np.median(body[body > 0])) if (body > 0).any() else 0.0
    if body_med <= 0:
        return rgba

    hsv = cv2.cvtColor(rgba[..., :3], cv2.COLOR_BGR2HSV)
    sat, val = hsv[..., 1], hsv[..., 2]
    whitish = (sat < gloss_sat) & (val > gloss_val)

    cut = None
    for y in range(start, h):
        n = widths[y]
        if n == 0:
            continue
        if n > body_med * (1.0 + width_jump):          # ① 폭 급증
            cut = y
            break
        if (whitish[y] & fg[y]).sum() / float(n) > 0.85:  # ② 흰 반사 지배
            cut = y
            break

    # ③ 잘록한 목(neck). 촬영대 반사상은 물체와 **딱 붙어** 있어서 연결성분으로도
    #    색으로도 안 떨어진다. 대신 접지점에서 폭이 국소 최소가 된다 — 물체가 좁아졌다가
    #    반사가 다시 넓어지는 모래시계 형태다. 형태만 보므로 색에 의존하지 않는다.
    #    (미리보기에서 배·사과 밑의 흰 반원이 ①②를 다 빠져나가서 추가했다.)
    if cut is None:
        lo, hi = int(h * 0.55), int(h * 0.95)
        if hi > lo + 2:
            seg = widths[lo:hi]
            nz = seg > 0
            if nz.any():
                y_rel = int(np.argmin(np.where(nz, seg, seg.max() + 1)))
                y_abs = lo + y_rel
                above = widths[:y_abs]
                if above.size and seg[y_rel] > 0:
                    if seg[y_rel] < 0.55 * float(above.max()):
                        below = widths[y_abs:]
                        # 아래쪽이 다시 넓어져야 '반사'다. 그냥 뾰족한 끝이면 두어야 한다.
                        if below.size and below.max() > seg[y_rel] * 1.25:
                            cut = y_abs

    if cut is None or cut < h * 0.60:
        return rgba
    return rgba[:cut]


def body_bottom(rgba, band=0.30, gloss_sat=60, gloss_val=165, dom=0.62,
                min_keep=0.62):
    """**라벨용** 본체 하단 y 를 돌려준다. 이미지는 건드리지 않는다.

    `trim_ground_shadow` 와 목적이 다르다. 저쪽은 픽셀을 잘라내므로 잘못 자르면
    물체가 손상돼 보수적이어야 한다. 이쪽은 **YOLO 박스를 어디서 끊을지**만 정하므로,
    남은 받침이 이미지에 보이더라도 박스만 본체에 맞으면 된다. 그래서 판정을
    더 과감하게 잡을 수 있다.

    임계가 저쪽보다 느슨한 이유(2026-08-10 실측): 남아 있는 받침은 순백이 아니라
    **그림자가 섞인 회색**이라 `gloss_val=200` 에 안 걸린다. 색 기반 점수로 배를
    골라내려다 확인한 사실이다 — 점수 0.00 인 누끼에 오히려 큰 회색 받침이 붙어 있었다.
    그래서 명도 문턱을 165 로 낮추고 지배 비율도 0.85 → 0.62 로 완화했다.

    돌려주는 값은 y(행 인덱스)다. 잘라낼 게 없으면 이미지 높이를 그대로 준다.
    """
    _require_cv2()
    h, w = rgba.shape[:2]
    if h < 24:
        return h
    fg = rgba[..., 3] > 127
    widths = fg.sum(axis=1)
    if widths.max() == 0:
        return h

    start = int(h * (1 - band))
    body = widths[:start]
    body_med = float(np.median(body[body > 0])) if (body > 0).any() else 0.0
    if body_med <= 0:
        return h

    hsv = cv2.cvtColor(rgba[..., :3], cv2.COLOR_BGR2HSV)
    whitish = (hsv[..., 1] < gloss_sat) & (hsv[..., 2] > gloss_val)

    cut = None
    for y in range(start, h):
        n = widths[y]
        if n == 0:
            continue
        if n > body_med * 1.20:
            cut = y
            break
        if (whitish[y] & fg[y]).sum() / float(n) > dom:
            cut = y
            break

    if cut is None:                     # 잘록한 목(neck) — 형태만 본다
        lo, hi = int(h * 0.55), int(h * 0.97)
        if hi > lo + 2:
            seg = widths[lo:hi]
            nz = seg > 0
            if nz.any():
                y_rel = int(np.argmin(np.where(nz, seg, seg.max() + 1)))
                y_abs = lo + y_rel
                above = widths[:y_abs]
                if above.size and seg[y_rel] > 0 and \
                        seg[y_rel] < 0.62 * float(above.max()):
                    below = widths[y_abs:]
                    if below.size and below.max() > seg[y_rel] * 1.15:
                        cut = y_abs

    if cut is None or cut < h * min_keep:
        return h
    return int(cut)


def to_png_bytes(rgba):
    """BGRA 배열 → PNG 바이트. 알파 보존."""
    _require_cv2()
    ok, buf = cv2.imencode(".png", rgba)
    if not ok:
        raise RuntimeError("PNG 인코딩 실패")
    return buf.tobytes()
