"""품질 등급(특/상/보통) 순서형(ordinal) 분류 — CORAL (Cao, Mirjalili, Raschka 2020).
일반 softmax 3-class는 "특↔보통" 오류와 "특↔상" 오류를 동일하게 취급하지만,
CORAL은 순서를 학습에 반영해 인접 등급 오류에 강해진다 (제안서 §3-2).
"""
from __future__ import annotations

import timm
import torch
import torch.nn as nn
import torch.nn.functional as F

from marketlog_vision.models.item_recognition import BACKBONE_REGISTRY

GRADE_ORDER = ["보통", "상", "특"]  # 순서형 인덱스 0,1,2 (오름차순)


class CoralLayer(nn.Module):
    """공유 가중치 + 등급별(rank) 편향(bias)으로 순서 일관성(rank-consistency)을 보장."""

    def __init__(self, in_features: int, num_classes: int):
        super().__init__()
        self.fc = nn.Linear(in_features, 1, bias=False)
        self.bias = nn.Parameter(torch.zeros(num_classes - 1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.fc(x) + self.bias  # (batch, num_classes-1)


def coral_loss(logits: torch.Tensor, levels: torch.Tensor) -> torch.Tensor:
    """levels: (batch, num_classes-1) 확장 이진 라벨 (y > k 이면 1)."""
    log_sig = F.logsigmoid(logits)
    term = log_sig * levels + (log_sig - logits) * (1 - levels)
    return -term.sum(dim=1).mean()


def levels_from_labels(labels: torch.Tensor, num_classes: int) -> torch.Tensor:
    thresholds = torch.arange(num_classes - 1, device=labels.device).unsqueeze(0)
    return (labels.unsqueeze(1) > thresholds).float()


def predict_ranks(logits: torch.Tensor) -> torch.Tensor:
    probs = torch.sigmoid(logits)
    return (probs > 0.5).sum(dim=1)


def build_grading_model(backbone: str, num_grades: int = 3, pretrained: bool = True) -> nn.Module:
    timm_name = BACKBONE_REGISTRY.get(backbone, backbone)
    feature_extractor = timm.create_model(timm_name, pretrained=pretrained, num_classes=0)
    # timm 모델마다 num_features 속성이 실제 forward 출력 차원과 다를 수 있어(conv_head 등),
    # 더미 forward로 실제 차원을 직접 확인한다 (BatchNorm 문제 피하려고 eval 모드로).
    feature_extractor.eval()
    with torch.no_grad():
        feat_dim = feature_extractor(torch.zeros(2, 3, 224, 224)).shape[1]
    coral = CoralLayer(feat_dim, num_grades)

    class GradingModel(nn.Module):
        def __init__(self):
            super().__init__()
            self.backbone = feature_extractor
            self.coral = coral

        def forward(self, x):
            feats = self.backbone(x)
            return self.coral(feats)

    return GradingModel()


def freeze_backbone(model: nn.Module) -> None:
    for name, param in model.named_parameters():
        param.requires_grad = name.split(".")[0] == "coral"


def unfreeze_all(model: nn.Module) -> None:
    for param in model.parameters():
        param.requires_grad = True


class MultiHeadCoralModel(nn.Module):
    """공유 백본 + 품목별 CORAL 헤드. 배추의 결구, 사과의 광택·반점처럼 품목마다
    품질 신호가 달라, 품목 인식 결과로 라우팅되는 전용 등급 헤드를 둔다 (제안서 §5)."""

    def __init__(self, backbone: nn.Module, feat_dim: int, items: list[str], num_grades: int):
        super().__init__()
        self.backbone = backbone
        self.items = list(items)
        self.heads = nn.ModuleDict({item: CoralLayer(feat_dim, num_grades) for item in items})

    def forward(self, x: torch.Tensor, item_names: list[str]) -> torch.Tensor:
        feats = self.backbone(x)
        results: list[torch.Tensor | None] = [None] * x.size(0)
        for item in set(item_names):
            idx = [i for i, n in enumerate(item_names) if n == item]
            idx_t = torch.tensor(idx, device=x.device, dtype=torch.long)
            out = self.heads[item](feats.index_select(0, idx_t))
            for j, i in enumerate(idx):
                results[i] = out[j]
        return torch.stack(results, dim=0)


def build_multihead_grading_model(
    backbone: str, items: list[str], num_grades: int = 3, pretrained: bool = True,
) -> MultiHeadCoralModel:
    timm_name = BACKBONE_REGISTRY.get(backbone, backbone)
    feature_extractor = timm.create_model(timm_name, pretrained=pretrained, num_classes=0)
    feature_extractor.eval()
    with torch.no_grad():
        feat_dim = feature_extractor(torch.zeros(2, 3, 224, 224)).shape[1]
    return MultiHeadCoralModel(feature_extractor, feat_dim, items, num_grades)


def freeze_backbone_multihead(model: nn.Module) -> None:
    for name, param in model.named_parameters():
        param.requires_grad = name.split(".")[0] == "heads"
