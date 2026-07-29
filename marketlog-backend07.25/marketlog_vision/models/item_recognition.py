import timm
import torch.nn as nn

# 친숙한 이름 -> timm 모델 태그. 제안서 §3-1 백본 비교표 기준.
BACKBONE_REGISTRY = {
    "efficientnetv2_s": "tf_efficientnetv2_s.in1k",      # 서버 정밀 추론(업로드)
    "convnext_t": "convnext_tiny.fb_in1k",                # 서버 정밀 추론 대안
    "mobilenetv4": "mobilenetv4_conv_medium.e500_r256_in1k",  # 온디바이스 실시간 스캔
    "efficientnet_lite4": "tf_efficientnet_lite4.in1k",   # 저사양 온디바이스
}


def build_model(backbone: str, num_classes: int, pretrained: bool = True, drop_rate: float = 0.2) -> nn.Module:
    """backbone은 BACKBONE_REGISTRY의 키이거나, 임의의 timm 모델 이름이어도 된다."""
    timm_name = BACKBONE_REGISTRY.get(backbone, backbone)
    model = timm.create_model(
        timm_name,
        pretrained=pretrained,
        num_classes=num_classes,
        drop_rate=drop_rate,
    )
    return model


def freeze_backbone(model: nn.Module) -> None:
    """timm 분류 헤드(classifier/fc/head)를 제외한 파라미터를 동결한다."""
    head_names = {"classifier", "fc", "head"}
    for name, param in model.named_parameters():
        top_level = name.split(".")[0]
        param.requires_grad = top_level in head_names


def unfreeze_all(model: nn.Module) -> None:
    for param in model.parameters():
        param.requires_grad = True
