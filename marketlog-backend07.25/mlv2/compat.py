"""환경 차이를 한 곳에서 흡수한다.

이 프로젝트에서 반복적으로 시간을 잡아먹은 네 가지가 있다.

- Windows 콘솔이 cp949 라, 한글이나 em-dash 를 print 하는 순간 UnicodeEncodeError 로 죽는다.
- 서버 Python 이 3.8.10 이라 `str | None` 같은 3.9+ 문법이 즉시 SyntaxError 를 낸다.
- 체크포인트에 sklearn 의 numpy 스칼라가 섞여 있어 `torch.load` 기본값으로는 못 읽는다.
- **`cv2.imread`/`imwrite` 가 한글 경로를 못 읽고 못 쓴다** (Windows 한정).

새 모듈은 맨 위에서 `from mlv2.compat import setup_stdout` 를 부르는 것으로 첫 번째를
해결하고, `from __future__ import annotations` 로 두 번째를 해결한다.
세 번째는 `load_checkpoint()`, 네 번째는 `imread`/`imwrite` 를 쓰면 된다.
"""
from __future__ import annotations

import os
import random
import sys

MIN_SERVER_PYTHON = (3, 8)


def setup_stdout():
    """stdout/stderr 를 UTF-8 로 돌린다. 3.7+ 에서만 reconfigure 가 있다."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                # 파이프로 리다이렉트된 경우 등. 죽이지는 않는다.
                pass


def register_heif():
    """아이폰 사진(.heic)을 PIL 이 열 수 있게 한다. 없으면 조용히 넘어간다.

    실사진 테스트는 대부분 폰으로 찍은 사진으로 하는데, iOS 기본 포맷이 HEIC 다.
    PIL 은 기본적으로 이걸 못 열어서 "파일이 멀쩡한데 안 된다" 로 보인다.
    `pi-heif`(또는 `pillow-heif`)가 깔려 있으면 여기서 등록해 준다.

    반환값은 등록 성공 여부다. 학습 경로에는 HEIC 가 없으므로 실패해도 문제없다.
    """
    for mod in ("pi_heif", "pillow_heif"):
        try:
            __import__(mod)
            sys.modules[mod].register_heif_opener()
            return True
        except Exception:                          # noqa: BLE001
            continue
    return False


def set_seed(seed, deterministic=False):
    """random / numpy / torch 시드를 한 번에 고정한다.

    deterministic=True 는 cuDNN 을 결정론 모드로 돌린다. 재현성은 올라가지만
    conv 가 느려지므로 기본은 False 다. 실험 비교 시에만 켤 것.
    """
    random.seed(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)
    try:
        import numpy as np

        np.random.seed(seed)
    except ImportError:
        pass
    try:
        import torch

        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        if deterministic:
            torch.backends.cudnn.deterministic = True
            torch.backends.cudnn.benchmark = False
        else:
            torch.backends.cudnn.benchmark = True
    except ImportError:
        pass


def load_checkpoint(path, map_location="cpu"):
    """체크포인트를 읽는다.

    `weights_only=False` 를 명시하는 이유: 체크포인트에 sklearn/numpy 스칼라(val_qwk 등)가
    들어 있어서 최신 torch 기본값(True)으로는 UnpicklingError 가 난다. 우리가 직접 만든
    파일이므로 안전하다. 외부에서 받은 .pt 에는 쓰지 말 것.
    """
    import torch

    return torch.load(path, map_location=map_location, weights_only=False)


def state_dict_from(ckpt):
    """체크포인트에서 가중치를 꺼낸다. 키 이름이 프로젝트마다 다른 게 함정이라 흡수한다."""
    for key in ("model_state", "state_dict", "model"):
        if isinstance(ckpt, dict) and key in ckpt:
            return ckpt[key]
    if isinstance(ckpt, dict) and all(hasattr(v, "shape") for v in ckpt.values()):
        return ckpt  # 가중치만 저장된 경우
    raise KeyError(
        "체크포인트에서 가중치를 찾지 못했다. 가진 키: {}".format(
            sorted(ckpt.keys()) if isinstance(ckpt, dict) else type(ckpt)
        )
    )


def imread(path, flags=None):
    """한글 경로에서도 동작하는 `cv2.imread`.

    Windows 의 `cv2.imread` 는 경로를 ANSI(cp949) 로 변환해 C 런타임에 넘기므로,
    이 프로젝트 경로처럼 한글이 섞이면 **파일이 멀쩡한데도** None 을 돌려준다.
    실패가 예외가 아니라 None 이라 '이미지가 깨졌나' 로 오진하기 쉽다 — 실제로
    2026-08-10 에 누끼 시험 실행이 전 품목 통과율 0.0% 로 나온 원인이 이것이었다.

    `np.fromfile` 로 바이트를 직접 읽어 `imdecode` 에 넘기면 경로 인코딩을
    파이썬이 처리하므로 문제가 사라진다. 반환 규약은 `cv2.imread` 와 같다(실패 시 None).
    """
    import cv2
    import numpy as np

    if flags is None:
        flags = cv2.IMREAD_COLOR
    try:
        buf = np.fromfile(str(path), dtype=np.uint8)
    except (OSError, ValueError):
        return None
    if buf.size == 0:
        return None
    return cv2.imdecode(buf, flags)


def imwrite(path, img, params=None):
    """한글 경로에서도 동작하는 `cv2.imwrite`. 반환 규약도 동일(bool)."""
    import cv2
    import numpy as np

    path = str(path)
    ext = os.path.splitext(path)[1] or ".jpg"
    ok, buf = cv2.imencode(ext, img, params if params is not None else [])
    if not ok:
        return False
    try:
        np.asarray(buf).tofile(path)
    except (OSError, ValueError):
        return False
    return True


def check_python_version(verbose=True):
    """3.8 에서 죽을 문법을 로컬에서 미리 눈치채도록 알려주는 안내용."""
    v = sys.version_info
    if verbose and v[:2] > MIN_SERVER_PYTHON:
        print(
            "[compat] 로컬 Python {}.{} / 서버 3.8.10. "
            "새 파일에는 반드시 `from __future__ import annotations` 를 넣을 것.".format(
                v[0], v[1]
            )
        )
    return v[:2]
