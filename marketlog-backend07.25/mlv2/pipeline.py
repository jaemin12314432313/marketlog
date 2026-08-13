"""사진 한 장 → 품목 + 등급. **앱·백엔드가 호출하는 진입점.**

    검출(YOLO 1클래스) → 중앙 대상 선택 → 크롭 → 품목 분류 → 등급 판정

품목 분류기는 `item_crop_v1` **단독**이다. 한때 v3 와의 앙상블이 기본이었는데,
그 이득이 전부 마늘에서 나온 것이라 마늘을 시나리오에서 뺀 뒤 되돌렸다.
경위와 복귀 방법은 `DEFAULT_CLASSIFIERS` 위의 주석에 있다.

지금까지 이 파이프라인은 평가 스크립트 안에만 있었다. 여기서 하나로 묶어 재사용 가능한
함수로 만든다. 앱이 "중앙에 상품을 맞추세요" preview 를 띄우는 것을 전제로,
**대상 하나만** 판정한다(`analyze`). 매대 전체를 훑고 싶으면 `analyze_all` 을 쓴다.

## 등급은 2단계다 — 그리고 그 이유

`grade_order = ['보통','상','특']` 로 학습된 CORAL 모델은 임계값 로짓 2개를 낸다.

    logit[0] = P(등급 > 보통)  = P(특상)  ← **이것이 2등급 판정이다**
    logit[1] = P(등급 > 상)    = P(특)

CORAL 은 순서형이라 첫 로짓이 그대로 "특상(특+상) vs 보통" 이다. 2등급용으로
**재학습할 필요가 없다.** 기존 `quality_grading_effv2s_v2.pt` 를 그대로 쓴다.

## ⚠️ 등급 판정의 신뢰도에 대해

이 저장소는 **이 데이터셋으로 품질 등급을 시각 학습하는 것이 불가능하다**고 결론지었다
(`docs/HANDOFF_BINARY_GRADING.md`). 근거는 세 층이다.

  ① 정답이 상당 부분 **무게**로 정해진다 — 사진에 없는 정보다(무게만으로 2등급 AUC 0.845)
  ② 등급별로 **촬영 조명이 다르다** — 농산물이 0픽셀인 배경만으로 양파 AUROC 0.993
  ③ 조명 정규화 + 크기 통제를 둘 다 하면 남는 신호가 0 (bacc 0.477)

보고된 QWK 0.764 는 촬영 세션 누수가 섞인 값이고, 세션을 분리하면 0.421 로 떨어진다.
그래서 결과에 `grade_reliable=False` 와 경고를 **항상** 실어 보낸다. 데모에서 값을
보여주는 것은 괜찮지만, 실제 거래 판단의 근거로 쓰면 안 된다.

## 사용

    from mlv2.pipeline import Pipeline
    pipe = Pipeline()                      # 기본 체크포인트 자동 로드
    r = pipe.analyze("photo.jpg")
    print(r["item"], r["item_conf"], r["grade"], r["grade_conf"])

CLI:

    python -m mlv2.pipeline --image test_image/배추_1.jpeg
    python -m mlv2.pipeline --dir test_image --json out.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from mlv2.compat import (load_checkpoint, register_heif, setup_stdout,
                         state_dict_from)
from mlv2.items import IMAGE_EXTS, ITEM_CLASSES

setup_stdout()
HEIF_OK = register_heif()   # 아이폰 사진(.heic) 지원. 없으면 False

# 기본 체크포인트 경로는 프로젝트 루트 기준이다. 그런데 백엔드는 **자기 서비스
# 디렉터리에서** 이 모듈을 부르므로, 상대경로 그대로 두면 cwd 가 다른 순간
# raw 트레이스백으로 죽는다. cwd → 프로젝트 루트 순으로 찾아 준다.
_ROOT = Path(__file__).resolve().parents[2]


def _resolve(path):
    """cwd 기준으로 없으면 프로젝트 루트 기준으로 찾는다. 둘 다 없으면 원본을 돌려준다
    (호출부가 '없다' 는 메시지에 원래 경로를 그대로 실을 수 있게)."""
    p = Path(path)
    if p.is_file() or p.is_absolute():
        return str(p)
    alt = _ROOT / p
    return str(alt) if alt.is_file() else str(p)


DEFAULT_DETECTOR = "checkpoints/yolo11s_synth_v1.pt"
DEFAULT_GRADER = "checkpoints/quality_grading_effv2s_v2.pt"

# ---------------------------------------------------------------------------
# 품목 분류기는 `item_crop_v1` **단독**이다 (2026-08-12, 마늘 제외 결정 반영).
#
# ## 왜 단독인가 — 한 번 앙상블로 갔다가 되돌아온 경로를 남긴다
#
# 두 모델은 각각 다른 품목에 '오답 자석' 을 가지고 있다(data/real_v2, gtbox 122박스):
#
#     v3       오답 18건 → 마늘 12 · 배추 2 · 감 2   (흰 배경 위 창백한 덩어리 편향)
#     crop_v1  오답 14건 → 무 7 · 양배추 3 · 마늘 2  (크롭 적응이 마늘 자석을 없앤 대신
#                                                     무에 새 자석을 만들었다)
#
# 자석 위치가 다르니 오류가 상관되지 않아 앙상블이 통했다 — 114/122(93.4%)로
# 두 단독 모델(104 / 108)을 모두 넘었다. 그래서 한동안 앙상블이 기본값이었다.
#
# **그런데 그 이득이 전부 마늘에서 나왔다.** 마늘을 빼고 다시 세면 정확히 상쇄된다:
#
#     앙상블 − crop_v1 = 114 − 108 = +6
#       ├ 마늘에서:      11/12 − 4/12  = +7
#       └ 나머지에서:   103    − 104    = −1     ← 오히려 crop_v1 이 낫다
#
# 마늘은 시나리오 품목이 아니다(사용자 결정, 2026-08-12). 그러면 앙상블은 **추론을
# 2배로 내면서 쓰지 않는 품목을 지키는** 구조가 된다. 그래서 단독으로 되돌렸다.
#
#     마늘 제외 기준   v3 93/110 (84.5%)   crop_v1 104/110 (94.5%)   앙상블 103/110
#     앱 성공 기준     v3 24/25            crop_v1 25/25             앙상블 24/25
#
# ## ⚠️ 이 선택의 대가
#
# **마늘을 스캔하면 틀린 답을 자신 있게 내놓는다** (마늘 4/12, 오답은 무 5·양배추 2).
# 침묵하는 실패가 아니라 확신에 찬 오답이다. 앱이 마늘을 지원한다고 표방하게 되면
# 이 결정을 되돌려야 한다 — 아래 한 줄이면 앙상블로 복귀한다.
#
#     Pipeline(classifier=["checkpoints/item_recognition_effv2s_v3.pt",
#                          "checkpoints/item_crop_v1.pt"])
#
# ⚠️ 표본이 사진 28장 / 박스 122개다. 25/25 는 "천장을 쳤다" 는 뜻이지 100% 라는
# 뜻이 아니다. 평가셋을 늘리면 다시 잴 것.
DEFAULT_CLASSIFIERS = ["checkpoints/item_crop_v1.pt"]
DEFAULT_CLASSIFIER_WEIGHTS = [1.0]

# v3 를 되살릴 때 쓰는 짝. 위 주석의 복귀 경로다.
ENSEMBLE_CLASSIFIERS = ["checkpoints/item_recognition_effv2s_v3.pt",
                        "checkpoints/item_crop_v1.pt"]

# 예전 이름. 단독 모델을 쓰던 코드가 깨지지 않도록 남겨 둔다.
DEFAULT_CLASSIFIER = DEFAULT_CLASSIFIERS[0]

# 2등급 라벨. '특'+'상' 을 하나로 묶는다(사용자 지정, 2026-08-12).
#
# 표시 이름은 '특상' 이다(2026-08-12 변경, 이전 '상급'). 묶인 원본 등급이 특과 상이므로
# 이쪽이 무엇을 합친 것인지 그대로 드러난다.
# ⚠️ 이건 **출력 라벨**이다. 학습 쪽(`marketlog_vision.models.quality_grading` 의
# `GRADE_ORDER_BINARY`)은 여전히 '상급' 이고 체크포인트에 그대로 박혀 있으니 같이
# 바꾸지 말 것. JSON 키 `grade_p_high` 도 백엔드 계약이라 유지한다.
GRADE_HIGH = "특상"
GRADE_LOW = "보통"

# 검증셋(1,479장)에서 balanced accuracy 가 최대가 되는 지점.
# `scripts/tune_grade_threshold.py` 로 구했다 — 감으로 정한 값이 아니다.
#   임계 0.52 → bacc 0.854 / 상급재현 0.870 / 보통재현 0.837 / AUROC 0.905
# 정확도로 고르면 안 된다: 2:1 불균형이라 "전부 상급" 이 0.626 을 찍는다.
#
# ⚠️ 기본값 0.5(bacc 0.851)와 사실상 같다. **임계값은 원래 문제가 아니었다.**
# 실사진에서 26장 중 24장이 상급으로 쏠리는 것은 임계값이 아니라 도메인 갭 탓이다 —
# 모델이 등급이 아니라 촬영 배치의 조명을 학습해서, 실사진 조명이 '상급 배치' 와
# 비슷하면 확률이 통째로 올라간다. 임계값을 옮겨도 해결되지 않는다.
# 그래서 라벨과 **함께 확률을 항상 내보낸다**(`grade_p_high`). UI 는 그쪽을 쓸 것.
GRADE_THRESHOLD = 0.52

GRADE_WARNING = (
    "등급은 참고용이다. 이 데이터셋에서 등급 정답은 상당 부분 무게로 정해지고"
    "(사진에 없는 정보), 등급별로 촬영 조명이 달라 모델이 그 지문을 학습했다."
    " 세션을 분리하면 QWK 0.764 → 0.421 로 떨어진다. 거래 판단 근거로 쓰지 말 것."
)


CHECKPOINT_HELP = """
체크포인트는 용량(약 174MB) 때문에 코드 패키지에 들어 있지 않다.
비전 담당자에게 받아 프로젝트 루트의 `checkpoints/` 아래에 그대로 두면 된다.
확인: python -c "from mlv2.pipeline import missing_checkpoints; print(missing_checkpoints())"
""".strip()


def missing_checkpoints(detector=DEFAULT_DETECTOR, classifier=None,
                        grader=DEFAULT_GRADER):
    """없는 체크포인트를 **한꺼번에** 돌려준다.

    하나씩 알려주면 받는 사람이 세 번 실패하고 세 번 물어보게 된다.
    """
    paths = [detector] + list(classifier or DEFAULT_CLASSIFIERS) + [grader]
    return [p for p in paths if not Path(_resolve(p)).is_file()]


class Pipeline(object):
    def __init__(self, detector=DEFAULT_DETECTOR, classifier=None,
                 grader=DEFAULT_GRADER, device=None, conf=0.25, imgsz=768,
                 grade_threshold=GRADE_THRESHOLD, classifier_weights=None):
        """`classifier` 는 경로 하나 또는 여러 개다. 여러 개면 확률을 가중평균한다."""
        import torch

        self.device = torch.device(
            device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.conf = conf
        self.imgsz = imgsz
        self.grade_threshold = grade_threshold

        try:
            from ultralytics import YOLO
        except ImportError:
            raise SystemExit(
                "ultralytics 가 없다.  pip install -r requirements.txt")

        # 없는 것을 전부 모아 한 번에 알린다. 하나씩 알려주면 받는 사람이 세 번
        # 실패하고 세 번 물어보게 된다.
        #
        # 무엇을 '필수' 로 볼지가 중요하다.
        #  - 검출기: 없으면 아무것도 못 한다 → 필수
        #  - 분류기: **하나라도** 있으면 된다. 앙상블 중 한쪽만 빠진 경우는 경고 후
        #    단독으로 진행한다(아래 `missing`). 전부 없을 때만 멈춘다
        #  - 등급 모델: 없어도 품목 판정은 되므로(`grade=None`) 필수가 아니다
        det_path = _resolve(detector)
        want = list(classifier if classifier is not None else DEFAULT_CLASSIFIERS)
        if not isinstance(want, list):
            want = [want]
        need = [detector] if not Path(det_path).is_file() else []
        if all(not Path(_resolve(p)).is_file() for p in want):
            need += want
        if need:
            raise SystemExit("체크포인트가 없다:\n{}\n\n{}".format(
                "\n".join("  - " + str(p) for p in need), CHECKPOINT_HELP))
        self.det = YOLO(det_path)

        if classifier is None:
            paths = list(DEFAULT_CLASSIFIERS)
            if classifier_weights is None:
                classifier_weights = list(DEFAULT_CLASSIFIER_WEIGHTS)
        elif isinstance(classifier, (list, tuple)):
            paths = list(classifier)
        else:
            paths = [classifier]

        # 존재하지 않는 체크포인트는 조용히 건너뛴다 — 앙상블 기본값을 쓰는 배포에
        # 두 번째 파일이 없을 수 있고, 그때 파이프라인이 통째로 죽는 것보다는
        # 단독 모델로라도 도는 편이 낫다. 다만 무슨 일이 있었는지는 알려 준다.
        paths = [_resolve(p) for p in paths]
        missing = [p for p in paths if not Path(p).is_file()]
        paths = [p for p in paths if Path(p).is_file()]
        if not paths:
            raise SystemExit("분류기 체크포인트가 없다: {}".format(missing))
        if missing:
            print("경고: 분류기 {} 를 찾지 못해 빼고 진행한다".format(missing))
            classifier_weights = None

        loaded = [self._load_classifier(p) for p in paths]
        self.clfs = [m for m, _, _ in loaded]
        self.clf_sizes = [s for _, _, s in loaded]
        self.classifier_paths = paths

        # 클래스 순서가 다르면 확률을 더하는 것 자체가 의미 없다. 조용히 틀리느니
        # 여기서 멈춘다.
        class_sets = [c for _, c, _ in loaded]
        for c in class_sets[1:]:
            if c != class_sets[0]:
                raise SystemExit(
                    "체크포인트끼리 클래스 순서가 다르다. 앙상블 불가:\n  {}\n  {}"
                    .format(class_sets[0], c))
        self.classes = class_sets[0]

        if classifier_weights is None:
            classifier_weights = [1.0 / len(paths)] * len(paths)
        if len(classifier_weights) != len(paths):
            raise SystemExit("가중치 개수({})가 체크포인트 개수({})와 다르다".format(
                len(classifier_weights), len(paths)))
        total = float(sum(classifier_weights))
        self.classifier_weights = [w / total for w in classifier_weights]

        # 단독 모델만 쓰는 기존 코드를 위한 별칭
        self.clf, self.clf_size = self.clfs[0], self.clf_sizes[0]

        self.grader, self.grade_order, self.grader_size = self._load_grader(grader)

    # ---------- 로딩 ----------
    def _load_classifier(self, path):
        from mlv2.model import build_model

        ck = load_checkpoint(path, map_location=self.device)
        classes = ck.get("classes", list(ITEM_CLASSES))
        model = build_model(ck.get("backbone", "effv2s"),
                            num_classes=len(classes), pretrained=False)
        model.load_state_dict(state_dict_from(ck))
        model.to(self.device).eval()
        return model, classes, ck.get("img_size", 224)

    def _load_grader(self, path):
        path = _resolve(path)
        if not Path(path).is_file():
            return None, None, 224
        from marketlog_vision.models.quality_grading import build_grading_model

        ck = load_checkpoint(path, map_location=self.device)
        order = ck.get("grade_order", ["보통", "상", "특"])
        model = build_grading_model(ck.get("backbone", "efficientnetv2_s"),
                                    num_grades=len(order), pretrained=False)
        model.load_state_dict(state_dict_from(ck))
        model.to(self.device).eval()
        return model, order, ck.get("img_size", 224)

    # ---------- 전처리 ----------
    def _tensor(self, pil, size):
        from torchvision import transforms

        from mlv2.augment import IMAGENET_MEAN, IMAGENET_STD

        tf = transforms.Compose([
            transforms.Resize((size, size)),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ])
        return tf(pil).unsqueeze(0).to(self.device)

    # ---------- 판정 ----------
    def classify(self, crop):
        """품목 판정. 분류기가 여러 개면 **확률을 가중평균**한 뒤 argmax 한다.

        로짓이 아니라 softmax 확률을 더한다. 두 모델의 로짓 스케일이 서로 다른데
        (학습 길이·증강이 다르다) 로짓 평균은 확신이 센 쪽으로 결과가 끌려간다.
        확률 평균은 각 모델을 [0,1] 로 맞춰 놓고 더하므로 그 편향이 없다.
        """
        import torch

        acc = None
        with torch.no_grad():
            for model, size, w in zip(self.clfs, self.clf_sizes,
                                      self.classifier_weights):
                p = torch.softmax(model(self._tensor(crop, size)), 1)[0] * w
                acc = p if acc is None else acc + p
        i = int(acc.argmax())
        return self.classes[i], float(acc[i])

    def grade(self, crop):
        """2등급 판정. (라벨, 특상확률) 을 돌려준다.

        두 번째 값은 **항상 '특상 확률'** 이다(선택된 라벨의 확률이 아니다).
        라벨은 임계값에 좌우되지만 확률은 그렇지 않으므로, 화면에는 확률을 쓰는 편이
        정직하다 — 0.53 과 0.99 가 똑같이 "특상" 으로 보이면 안 된다.
        """
        import torch

        if self.grader is None:
            return None, 0.0
        with torch.no_grad():
            logits = self.grader(self._tensor(crop, self.grader_size))[0]
        p_high = float(torch.sigmoid(logits[0]))     # P(등급 > 보통) = P(특+상)
        return (GRADE_HIGH if p_high >= self.grade_threshold else GRADE_LOW), p_high

    # ---------- 진입점 ----------
    def _detect(self, pil):
        r = self.det.predict(pil, conf=self.conf, imgsz=self.imgsz,
                             verbose=False)[0]
        pairs = sorted(zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist()),
                       key=lambda t: -t[1])
        return [b for b, _ in pairs], [c for _, c in pairs]

    def analyze(self, image, pad=0.0):
        """앱 경로: 중앙 대상 **하나**를 판정한다."""
        from PIL import Image

        from mlv2.detect.select import pick_subject

        pil = image if hasattr(image, "size") else Image.open(str(image))
        pil = pil.convert("RGB")
        W, H = pil.size

        boxes, confs = self._detect(pil)
        if not boxes:
            return {"ok": False, "reason": "검출된 농산물이 없다",
                    "hint": "상품이 화면 중앙에 오도록 다시 촬영해 주세요."}
        sel = pick_subject(boxes, W, H, confs=confs)
        if sel is None:
            return {"ok": False, "reason": "대상을 고르지 못했다"}

        box = boxes[sel[0]]
        crop = _crop(pil, box, pad)
        item, item_conf = self.classify(crop)
        grade, p_high = self.grade(crop)
        return {
            "ok": True,
            "item": item, "item_conf": round(item_conf, 4),
            "grade": grade,
            "grade_p_high": round(p_high, 4),
            "grade_display": "{} ({:.0%})".format(grade, p_high if grade == GRADE_HIGH
                                                  else 1.0 - p_high),
            "grade_threshold": self.grade_threshold,
            "grade_scheme": "2단계({} / {})".format(GRADE_HIGH, GRADE_LOW),
            "grade_reliable": False,
            "grade_warning": GRADE_WARNING,
            "box": [int(v) for v in box],
            "det_conf": round(float(confs[sel[0]]), 4),
            "n_detected": len(boxes),
        }

    def analyze_all(self, image, pad=0.0):
        """매대 스캔: 검출된 모든 객체를 판정한다. 앱 기본 경로는 아니다."""
        from PIL import Image

        pil = image if hasattr(image, "size") else Image.open(str(image))
        pil = pil.convert("RGB")
        boxes, confs = self._detect(pil)
        out = []
        for b, c in zip(boxes, confs):
            crop = _crop(pil, b, pad)
            item, item_conf = self.classify(crop)
            grade, p_high = self.grade(crop)
            out.append({"item": item, "item_conf": round(item_conf, 4),
                        "grade": grade, "grade_p_high": round(p_high, 4),
                        "box": [int(v) for v in b],
                        "det_conf": round(float(c), 4)})
        return {"ok": bool(out), "objects": out, "grade_reliable": False,
                "grade_warning": GRADE_WARNING}


# Windows 바탕화면은 OneDrive 로 리디렉션돼 있는 경우가 많다. `C:\바탕화면` 같은
# 경로를 손으로 적으면 없는 폴더라 그대로 실패한다 — 실제로 한 번 겪었다.
_DESKTOP_HINT = (
    "힌트: 탐색기에서 파일을 끌어다 터미널에 놓으면 경로가 따옴표까지 붙어 들어간다.\n"
    "      바탕화면 경로는 이걸로 확인: [Environment]::GetFolderPath('Desktop')"
)


def _no_file_message(path):
    """없는 파일일 때, 같은 폴더에 뭐가 있는지까지 알려 준다."""
    p = Path(path)
    lines = ["사진 파일이 없다: {}".format(path)]
    parent = p.parent
    if not parent.exists():
        lines.append("폴더 자체가 없다: {}".format(parent))
    else:
        near = [q.name for q in sorted(parent.iterdir())
                if q.suffix.lower() in IMAGE_EXTS][:8]
        if near:
            lines.append("이 폴더의 이미지: {}".format(", ".join(near)))
        else:
            lines.append("이 폴더에는 이미지 파일이 없다: {}".format(parent))
    lines.append(_DESKTOP_HINT)
    return "\n".join(lines)


def _crop(pil, box, pad=0.0):
    W, H = pil.size
    x0, y0, x1, y1 = box
    if pad:
        bw, bh = x1 - x0, y1 - y0
        x0, x1 = x0 - bw * pad, x1 + bw * pad
        y0, y1 = y0 - bh * pad, y1 + bh * pad
    return pil.crop((max(0, int(x0)), max(0, int(y0)),
                     min(W, int(x1)), min(H, int(y1))))


def main(argv=None):
    p = argparse.ArgumentParser(description="사진 → 품목 + 등급(2단계)")
    p.add_argument("--image")
    p.add_argument("--dir", help="폴더 전체를 처리")
    p.add_argument("--all", action="store_true", help="객체 전부(매대 스캔)")
    p.add_argument("--detector", default=DEFAULT_DETECTOR)
    p.add_argument("--classifier", nargs="+", default=None,
                   help="기본값은 item_crop_v1 단독. 여러 개를 주면 확률을 평균한다")
    p.add_argument("--ensemble", action="store_true",
                   help="v3 + crop_v1 앙상블로 돌린다. 마늘 정확도가 4/12 → 11/12 로 "
                        "오르는 대신 추론이 2회가 된다")
    p.add_argument("--classifier-weights", nargs="+", type=float, default=None,
                   help="분류기별 가중치. 생략하면 동등가중")
    p.add_argument("--grader", default=DEFAULT_GRADER)
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--pad", type=float, default=0.0)
    p.add_argument("--grade-threshold", type=float, default=GRADE_THRESHOLD,
                   help="검증셋에서 구한 값. 바꿀 근거가 없으면 두 것")
    p.add_argument("--device", default=None)
    p.add_argument("--json", help="결과를 JSON 으로 저장")
    a = p.parse_args(argv)

    if not a.image and not a.dir:
        raise SystemExit("--image 또는 --dir 중 하나가 필요하다")

    # 입력 확인을 **모델 로딩 앞**에 전부 끝낸다. 뒤에 두면 5초 기다린 끝에 오류를
    # 보게 되는데, 경로 오타는 테스트할 때 가장 흔한 실수다.
    if a.image and not Path(a.image).is_file():
        raise SystemExit(_no_file_message(a.image))
    if a.dir and not Path(a.dir).is_dir():
        raise SystemExit("폴더가 없다: {}\n{}".format(a.dir, _DESKTOP_HINT))

    targets = ([Path(a.image)] if a.image else
               [q for q in sorted(Path(a.dir).iterdir())
                if q.suffix.lower() in IMAGE_EXTS])
    if not targets:
        raise SystemExit(
            "폴더에 이미지가 없다: {}\n인식하는 확장자: {}".format(
                a.dir, ", ".join(sorted(IMAGE_EXTS))))
    if not HEIF_OK:
        heic = [q.name for q in targets if q.suffix.lower() in (".heic", ".heif")]
        if heic:
            raise SystemExit(
                "아이폰 사진(.heic)을 열 수 없다: {}\n"
                "설치: pip install pi-heif\n"
                "또는 폰에서 '설정 > 카메라 > 포맷 > 높은 호환성' 으로 바꿔 찍을 것"
                .format(", ".join(heic[:5])))

    if a.ensemble and a.classifier:
        raise SystemExit("--ensemble 과 --classifier 는 같이 못 쓴다")
    classifier = ENSEMBLE_CLASSIFIERS if a.ensemble else a.classifier

    pipe = Pipeline(a.detector, classifier, a.grader, device=a.device,
                    conf=a.conf, grade_threshold=a.grade_threshold,
                    classifier_weights=a.classifier_weights)
    if len(pipe.classifier_paths) > 1:
        print("분류기 앙상블: " + ", ".join(
            "{}({:.2f})".format(Path(q).stem, w) for q, w
            in zip(pipe.classifier_paths, pipe.classifier_weights)) + "\n")

    results = {}
    for q in targets:
        r = (pipe.analyze_all(q, pad=a.pad) if a.all
             else pipe.analyze(q, pad=a.pad))
        results[q.name] = r
        if a.all:
            print("{:<24} 객체 {}개".format(q.name, len(r.get("objects", []))))
            for o in r.get("objects", []):
                print("    {:<4} {:.2f}   {} (특상확률 {:.2f})".format(
                    o["item"], o["item_conf"], o["grade"], o["grade_p_high"]))
        elif r["ok"]:
            print("{:<24} {:<4} {:.2f}   {:<11} 특상확률 {:.2f}   (검출 {}개)".format(
                q.name, r["item"], r["item_conf"], r["grade_display"],
                r["grade_p_high"], r["n_detected"]))
        else:
            print("{:<24} — {}".format(q.name, r["reason"]))

    print("\n※ " + GRADE_WARNING)
    if a.json:
        Path(a.json).write_text(
            json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print("저장: {}".format(a.json))


if __name__ == "__main__":
    main()
