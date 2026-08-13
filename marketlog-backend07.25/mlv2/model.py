"""백본 생성과 검증.

timm 의 `.num_features` 를 믿지 않는다. 일부 모델(MobileNetV4 등)은 conv_head 때문에
`.num_features` 와 실제 forward 출력 차원이 다르다. 여기서는 항상 더미 forward 로
실측한다 — 배치는 2 이상이어야 한다(BatchNorm 이 배치 1에서 터진다).
"""
from __future__ import annotations

import timm
import torch
import torch.nn as nn

# 친숙한 이름 -> timm 태그.
BACKBONE_REGISTRY = {
    "effv2s": "tf_efficientnetv2_s.in1k",                      # 기본. v3 가 이걸로 나왔다
    "effv2b0": "tf_efficientnetv2_b0.in1k",                    # 더 작고 빠름
    "convnext_t": "convnext_tiny.fb_in1k",                     # QWK 실험에서 과적합했었다
    "mobilenetv4": "mobilenetv4_conv_medium.e500_r256_in1k",   # 온디바이스
    "efflite4": "tf_efficientnet_lite4.in1k",                  # 저사양 온디바이스
    "resnet50": "resnet50.a1_in1k",                            # 대조군
}

HEAD_NAMES = ("classifier", "fc", "head")


def resolve(backbone):
    return BACKBONE_REGISTRY.get(backbone, backbone)


def build_model(backbone="effv2s", num_classes=10, pretrained=True, drop_rate=0.2):
    """timm 모델 하나. backbone 은 레지스트리 키이거나 임의의 timm 이름."""
    return timm.create_model(
        resolve(backbone),
        pretrained=pretrained,
        num_classes=num_classes,
        drop_rate=drop_rate,
    )


def verify_output_dim(model, num_classes, img_size=224, device=None):
    """더미 forward 로 출력 차원을 실측한다. 기대와 다르면 즉시 예외.

    학습을 몇 시간 돌린 뒤에 헤드 차원이 틀렸다는 걸 아는 것보다 여기서 죽는 게 낫다.

    device 기본값이 "cpu" 였는데 None(모델을 따라감)으로 바꿨다. 모델이 이미 GPU 로
    옮겨진 뒤에 불리므로, 더미만 CPU 에 있으면
    `Input type (torch.FloatTensor) and weight type (torch.cuda.FloatTensor)` 로 죽는다.
    **로컬 CPU 스모크테스트로는 절대 안 잡히고 GPU 서버에서만 터진다** — 2026-08-11 에
    실제로 학습 첫 줄에서 터졌다.
    """
    if device is None:
        try:
            device = next(model.parameters()).device
        except StopIteration:
            device = "cpu"
    was_training = model.training
    model.eval()
    with torch.no_grad():
        # batch=2: BatchNorm 이 batch=1 에서 "Expected more than 1 value" 로 죽는다
        dummy = torch.zeros(2, 3, img_size, img_size, device=device)
        out = model(dummy)
    model.train(was_training)

    if out.ndim != 2 or out.shape[1] != num_classes:
        raise RuntimeError(
            "출력 차원이 기대와 다르다: 실측 {} / 기대 (2, {}). "
            "timm 의 .num_features 는 믿지 말 것.".format(tuple(out.shape), num_classes)
        )
    return tuple(out.shape)


def freeze_backbone(model):
    """분류 헤드만 남기고 동결. 워밍업 구간에서 쓴다."""
    n_train = 0
    for name, param in model.named_parameters():
        trainable = name.split(".")[0] in HEAD_NAMES
        param.requires_grad = trainable
        n_train += int(trainable)
    if n_train == 0:
        # 헤드 이름이 레지스트리에 없는 모델. 조용히 전부 동결되면 학습이 안 되는데
        # loss 는 그냥 안 줄 뿐이라 눈치채기 어렵다.
        raise RuntimeError(
            "헤드를 못 찾아 전부 동결됐다. 이 모델의 헤드 이름을 HEAD_NAMES 에 추가할 것: {}".format(
                sorted(set(n.split(".")[0] for n, _ in model.named_parameters()))
            )
        )
    return n_train


def unfreeze_all(model):
    for param in model.parameters():
        param.requires_grad = True


def count_params(model):
    total = sum(p.numel() for p in model.parameters())
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    return total, trainable


def describe(model, backbone, num_classes, img_size=224):
    total, trainable = count_params(model)
    shape = verify_output_dim(model, num_classes, img_size)
    return (
        "백본 {} ({})\n"
        "  파라미터 {:,} (학습가능 {:,})\n"
        "  더미 forward 출력 {} — 검증 통과".format(
            backbone, resolve(backbone), total, trainable, shape)
    )


def load_for_inference(ckpt_path, device="cpu"):
    """체크포인트에서 (model, classes, img_size) 를 복원한다."""
    from mlv2.compat import load_checkpoint, state_dict_from

    ckpt = load_checkpoint(ckpt_path, map_location=device)
    classes = ckpt.get("classes")
    if not classes:
        raise KeyError("체크포인트에 classes 가 없다: {}".format(ckpt_path))
    backbone = ckpt.get("backbone", "effv2s")
    img_size = int(ckpt.get("img_size", 224))

    model = build_model(backbone, num_classes=len(classes), pretrained=False)
    model.load_state_dict(state_dict_from(ckpt))
    model.to(device).eval()
    return model, classes, img_size, ckpt
