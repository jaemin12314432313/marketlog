"""YOLO11 학습 래퍼 (Ultralytics).

## mosaic / mixup 을 왜 기본값보다 낮추는가

진혁님 제안대로 mosaic·mixup 은 쓴다. 다만 **우리 데이터는 이미 합성이다.**
Ultralytics 기본값(mosaic 1.0)은 매 이미지를 4장 이어붙이는데, 그 4장이 각각 이미
5~14개 객체를 붙여 만든 것이라 결과가 실제 매대 통계에서 멀어진다. 객체가 40개씩 들어간
장면을 학습하면 작은 객체 위주로 치우친다.

    mosaic 0.5   절반만 적용
    mixup  0.1   두 장면을 반투명 겹침. 과하면 물체 경계가 흐려진다
    close_mosaic 10   마지막 10 epoch 은 mosaic 을 끈다 ← 이건 표준이고 중요하다
                      끄지 않으면 모델이 '항상 이어붙인 이미지' 분포에 맞춰진 채 끝난다

## 검증 지표를 믿을 때 주의할 것

합성 val 의 mAP 는 **실사용 성능이 아니다.** 같은 합성기가 만든 데이터라 분포가 같다.
이 프로젝트는 이미 같은 함정을 겪었다 — 스튜디오 val_acc 1.0000 인 모델 두 개가
실사진에서 22/30 과 14/30 으로 갈렸다.

그래서 `--real-data` 로 **손으로 라벨링한 현장 사진**을 따로 지정할 수 있게 했다.
100~200장이면 충분하다. 합성 mAP 는 "학습이 도는가" 를 보는 용도, 현장 mAP 가 진짜 지표다.

## 실행 (GPU 서버)

    ssh abrm02
    tmux new -s work
    srun --gres=gpu:1 -p p02 --job-name "mlv2-yolo" --pty bash
    cd /raid/jn_hack10/project
    PYTHONPATH=src python3 -m mlv2.detect.train_yolo \
        --data data/synth_detect/dataset.yaml --model yolo11s.pt --epochs 60

⚠️ Ultralytics 는 AGPL-3.0 이다. 해커톤·연구 범위면 문제없지만 상용 배포 계획이 있으면
라이선스를 먼저 확인할 것. 데이터셋은 표준 YOLO 포맷이라 모델만 갈아끼울 수 있다.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from mlv2.compat import setup_stdout

setup_stdout()

DEFAULT_HYP = {
    # --- 진혁님 요청: mosaic / mixup ---
    "mosaic": 0.5,
    "mixup": 0.1,
    "close_mosaic": 10,
    "copy_paste": 0.0,      # 우리가 이미 copy-paste 로 데이터를 만들었다. 중복 금지
    # --- 조명/색: 스튜디오↔시장 갭 대응. Ultralytics 기본보다 세게 ---
    "hsv_h": 0.020,         # 기본 0.015. 화이트밸런스
    "hsv_s": 0.80,          # 기본 0.7
    "hsv_v": 0.50,          # 기본 0.4. 백열등/그늘 노출차
    # --- 기하 ---
    "degrees": 12.0,        # 기본 0. 손으로 든 카메라 기울기
    "translate": 0.15,
    "scale": 0.60,          # 거리 변화
    "shear": 3.0,
    "perspective": 0.0005,
    "flipud": 0.10,         # 위에서 내려찍는 경우가 많아 상하반전도 의미가 있다
    "fliplr": 0.50,
    "erasing": 0.25,        # 가림(occlusion) 내성
}


def _rebase_yaml_path(data):
    """dataset.yaml 의 `path` 를 yaml 파일이 실제로 놓인 위치로 다시 맞춘다.

    `compose.py` 는 생성 시점의 절대경로를 박아 넣는다. 합성은 로컬 Windows 에서 하고
    학습은 GPU 서버에서 하므로, 그대로 옮기면 `path: C:/Users/...` 를 리눅스에서 찾다가
    죽는다. 데이터 폴더를 통째로 옮기면 yaml 과 images/ labels/ 의 상대 위치는 그대로이니,
    yaml 자신의 부모 디렉터리를 정답으로 삼으면 어느 머신에서든 맞는다.

    `path` 가 이미 맞으면 아무것도 하지 않는다. 고칠 게 있으면 원본을 건드리지 않고
    보정본을 같은 폴더에 `dataset.resolved.yaml` 로 쓴 뒤 그 경로를 돌려준다.
    """
    import re

    text = data.read_text(encoding="utf-8")
    root = data.parent.resolve()
    m = re.search(r"^path:\s*(.+?)\s*$", text, re.M)
    if m:
        cur = m.group(1).strip().strip("'\"")
        if cur and Path(cur) == root:
            return data
    new_line = "path: {}".format(root.as_posix())
    text2 = (re.sub(r"^path:\s*.+?$", new_line, text, count=1, flags=re.M)
             if m else new_line + "\n" + text)
    out = data.parent / "dataset.resolved.yaml"
    out.write_text(text2, encoding="utf-8")
    print("[data] path 를 현재 위치로 보정했다 → {}".format(root.as_posix()))
    return out


def train(args):
    try:
        from ultralytics import YOLO
    except ImportError:
        raise SystemExit(
            "ultralytics 가 없다.\n"
            "  로컬:  pip install ultralytics\n"
            "  서버:  pip install --user ultralytics\n"
            "  ⚠️ AGPL-3.0 라이선스다. 상용 배포 계획이 있으면 먼저 확인할 것.")

    data = Path(args.data)
    if not data.is_file():
        raise SystemExit(
            "dataset.yaml 이 없다: {}\n"
            "  `python -m mlv2.detect.compose` 로 먼저 합성 데이터를 만들 것.".format(data))
    data = _rebase_yaml_path(data)

    hyp = dict(DEFAULT_HYP)
    if args.no_mosaic:
        hyp["mosaic"] = 0.0
        hyp["close_mosaic"] = 0
    if args.mosaic is not None:
        hyp["mosaic"] = args.mosaic
    if args.mixup is not None:
        hyp["mixup"] = args.mixup

    print("=" * 60)
    print("YOLO 학습: {}".format(args.model))
    print("데이터: {}".format(data))
    print("증강: mosaic={mosaic} mixup={mixup} close_mosaic={close_mosaic}".format(**hyp))
    print("       hsv_v={hsv_v} scale={scale} erasing={erasing}".format(**hyp))
    print("=" * 60)
    print("※ 여기서 나오는 mAP 는 합성 val 기준이다. 실사용 성능이 아니다.")
    print("   학습이 끝나면 반드시 --real-data 로 현장 사진 mAP 를 따로 잴 것.\n")

    # `project` 는 **절대경로**로 넘긴다. 상대경로를 주면 Ultralytics 가 자기 설정의
    # runs_dir("runs/detect") 아래에 또 붙여서 `runs/detect/runs/detect/<name>` 이 된다.
    # 2026-08-11 첫 학습에서 실제로 그렇게 돼 체크포인트를 한참 찾아다녔다.
    project = Path(args.project).resolve()
    model = YOLO(args.model)
    model.train(
        data=str(data),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        workers=args.workers,
        project=str(project),
        name=args.name,
        seed=args.seed,
        patience=args.patience,
        pretrained=True,
        optimizer="auto",
        cos_lr=True,
        val=True,
        plots=True,
        **hyp
    )

    best = project / args.name / "weights" / "best.pt"
    print("\n체크포인트: {}".format(best))

    if args.real_data:
        print("\n" + "=" * 60)
        print("현장 사진 평가 — 이게 진짜 지표다")
        print("=" * 60)
        m = YOLO(str(best))
        m.val(data=str(_rebase_yaml_path(Path(args.real_data))), imgsz=args.imgsz,
              device=args.device, split="val", plots=True,
              name=args.name + "_real", project=str(project))
    else:
        print("\n[다음 할 일] 현장 사진 100~200장을 손으로 라벨링해서 --real-data 로 재라.")
        print("  합성 mAP 만 보고 성능을 판단하면 이 프로젝트가 이미 한 번 한 실수를 반복한다.")
    return best


def main(argv=None):
    p = argparse.ArgumentParser(description="YOLO11 합성 데이터 학습")
    p.add_argument("--data", default="data/synth_detect/dataset.yaml")
    p.add_argument("--model", default="yolo11s.pt",
                   help="yolo11n/s/m. 온디바이스 목표면 n, 서버 추론이면 s~m")
    p.add_argument("--epochs", type=int, default=60)
    p.add_argument("--imgsz", type=int, default=768)
    p.add_argument("--batch", type=int, default=16)
    p.add_argument("--device", default=0)
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--project", default="runs/detect")
    p.add_argument("--name", default="mlv2_synth")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--patience", type=int, default=15)
    p.add_argument("--mosaic", type=float, default=None)
    p.add_argument("--mixup", type=float, default=None)
    p.add_argument("--no-mosaic", action="store_true",
                   help="mosaic 대조 실험용. 효과를 재려면 이것과 기본값을 비교")
    p.add_argument("--real-data", default=None,
                   help="손으로 라벨링한 현장 사진 dataset.yaml. 진짜 지표")
    return train(p.parse_args(argv))


if __name__ == "__main__":
    main()
