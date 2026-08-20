"""속성 기반 품질 판정 모델(attribute_quality_v3, 2026-08-18 비전팀 인계) 추론.

기존 quality_grading_effv2s_v2(CORAL, 2단계 특상/보통, grade_reliable=False)를
대체한다 — 품목별로 실제 눈에 보이는 속성(착색도·신선도·손상 등)을 상/중/하로 따로
판정한 뒤 `attribute_final_grade.py`의 품목별 가중치로 합산해 최종 상/중/하를 낸다.

품목 9종만 지원한다(감·감귤·마늘·무·배·배추·사과·양배추·양파) — **감자는 제외**.
호출부(mlv2/pipeline.py)가 감자는 기존 2단계 그레이더로 폴백해야 한다.
"""
from __future__ import annotations

import torch
import torch.nn as nn
from torchvision import transforms

from mlv2.attribute_final_grade import ITEM_POLICIES, calculate_final_grade

ATTRIBUTE_NAMES = ("착색도", "신선도", "손상", "흠집", "껍질상태", "표면상태", "손질상태", "모양상태")

# 원본(train_attribute_quality.py)과 동일한 구조 — 체크포인트 state_dict 키가
# 이 클래스 정의에 그대로 묶여 있으므로 필드/구조를 바꾸지 말 것.
class AttributeQualityModel(nn.Module):
    def __init__(self, backbone_name: str, item_count: int, pretrained: bool, conditioned: bool = True):
        super().__init__()
        import timm

        self.conditioned = conditioned
        self.backbone = timm.create_model(backbone_name, pretrained=pretrained, num_classes=0)
        self.backbone.eval()
        with torch.no_grad():
            feature_dim = self.backbone(torch.zeros(2, 3, 224, 224)).shape[1]
        self.item_head = nn.Sequential(nn.Dropout(0.20), nn.Linear(feature_dim, item_count))
        self.item_embedding = nn.Embedding(item_count, 32) if conditioned else None
        attribute_input_dim = feature_dim + 32 if conditioned else feature_dim
        self.attribute_heads = nn.ModuleList(
            [nn.Sequential(nn.Dropout(0.20), nn.Linear(attribute_input_dim, 3)) for _ in ATTRIBUTE_NAMES]
        )

    def forward(self, images: torch.Tensor):
        features = self.backbone(images)
        item_logits = self.item_head(features)
        if self.conditioned:
            routes = item_logits.argmax(1)
            attribute_features = torch.cat([features, self.item_embedding(routes)], dim=1)
        else:
            attribute_features = features
        return item_logits, [head(attribute_features) for head in self.attribute_heads]


def display_grade(attribute: str, internal_grade: str) -> str:
    """학습용 상/중/하 코드를 구매자 화면용 표현으로 변환한다 (2026-08-18 비전팀 인계분).

    손상·흠집은 값이 높을수록 좋지 않은 역방향 지표이므로 양이 보이는 표현을 쓴다.
    나머지 품질 지표는 상위 품질부터 특상/상/중으로 표시한다.
    """
    if attribute in {"손상", "흠집"}:
        return {"상": "많음", "중": "보통", "하": "적음"}[internal_grade]
    return {"상": "특상", "중": "상", "하": "중"}[internal_grade]


def display_final_grade(internal_grade: str) -> str:
    """구매자 표시용 최종 등급: 내부 상·중은 특상, 하는 보통."""
    return {"상": "특상", "중": "특상", "하": "보통"}[internal_grade]


def make_eval_transform(size: int):
    return transforms.Compose([
        transforms.Resize(int(size * 1.14)),
        transforms.CenterCrop(size),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])


class AttributeQualityPredictor:
    """체크포인트 한 번 로드 + 반복 추론용 얇은 래퍼."""

    def __init__(self, checkpoint_path: str, device: "torch.device | str" = "cpu"):
        from mlv2.compat import load_checkpoint, state_dict_from

        self.device = torch.device(device)
        ckpt = load_checkpoint(checkpoint_path, map_location=self.device)
        self.items: list[str] = ckpt["items"]
        self.grade_names: tuple[str, ...] = tuple(ckpt["grade_names"])
        self.model = AttributeQualityModel(
            ckpt["backbone"], len(self.items), pretrained=False, conditioned=ckpt.get("conditioned", False),
        ).to(self.device)
        self.model.load_state_dict(state_dict_from(ckpt))
        self.model.eval()
        self.transform = make_eval_transform(ckpt["image_size"])

    def predict(self, crop, item: "str | None" = None) -> dict:
        """크롭된 PIL 이미지 한 장 -> 품목/속성/최종등급 JSON.

        `item`을 넘기면(권장) 이 모델 자체의 품목 분류는 참고용으로만 계산하고,
        실제 등급 산정은 이미 신뢰하는 다른 품목 분류기(item_crop_v1, 10종 지원)의
        결과를 그대로 쓴다 — 이 모델은 9종만 배웠으므로(감자 제외), 감자 사진을
        줘도 소프트맥스는 무조건 그 9종 중 하나를 골라버려서 "감자인데 양파로
        은근슬쩍 넘어가는" 조용한 오분류가 생길 수 있다. item을 미리 정해두면
        호출부가 ITEM_POLICIES에 없는 품목일 때 아예 이 모델을 부르지 않고
        기존 2단계 그레이더로 폴백할 수 있다.

        지원 품목이 아니면(예: 감자) ValueError를 낸다 — 호출부가 잡아서 기존
        2단계 그레이더로 폴백해야 한다.
        """
        image = self.transform(crop.convert("RGB")).unsqueeze(0).to(self.device)
        with torch.no_grad():
            item_logits, attribute_logits = self.model(image)
        item_prob = item_logits.softmax(1)[0]
        predicted_item = self.items[int(item_prob.argmax())]
        item = item or predicted_item
        if item not in ITEM_POLICIES:
            raise ValueError(f"attribute_quality_v3가 지원하지 않는 품목: {item!r}")

        # grades(내부 상/중/하)는 calculate_final_grade/buyer_summary가 그대로 쓰고,
        # labels/final_grade에 노출하는 건 display_grade/display_final_grade로 변환한
        # 구매자용 표현이다(비전팀 2026-08-18 인계분 — 예전엔 내부 코드를 그대로 노출해서
        # "손상: 하"처럼 좋은 상태인데 나쁘게 읽히는 문제가 있었다).
        grades: dict[str, str] = {}
        labels: dict[str, dict] = {}
        for name in ITEM_POLICIES[item].weights:
            attr_index = ATTRIBUTE_NAMES.index(name)
            probs = attribute_logits[attr_index].softmax(1)[0]
            grade_index = int(probs.argmax())
            grades[name] = self.grade_names[grade_index]
            labels[name] = {
                "grade": display_grade(name, self.grade_names[grade_index]),
                "confidence": round(float(probs[grade_index]), 4),
            }

        final_grade, final_score, final_reason = calculate_final_grade(item, grades)
        # item을 외부에서 넘겼으면(권장 경로) 이 모델 자체 기준으로 그 품목일 확률을,
        # 안 넘겼으면 이 모델이 고른 1위 확률을 그대로 쓴다.
        item_confidence = float(item_prob[self.items.index(item)]) if item in self.items else float(item_prob.max())
        return {
            "item": item,
            "item_confidence": round(item_confidence, 4),
            "labels": labels,
            "final_grade": display_final_grade(final_grade),
            "final_score": round(final_score, 4),
            "final_reason": final_reason,
            "ai_scan_summary": buyer_summary(item, grades),
        }


def buyer_summary(item: str, grades: dict[str, str]) -> str:
    """예측 등급만으로 만드는 API 없는 구매자용 기본 문장 (원본 infer_attribute_quality.py 포팅)."""
    positive = []
    for name in ("착색도", "신선도", "껍질상태", "표면상태", "모양상태", "손질상태"):
        if name not in grades:
            continue
        if grades[name] == "상":
            positive.append({
                "착색도": "품종 고유색이 비교적 고르게 형성되어 있고",
                "신선도": "신선한 외관이 유지되어 있고",
                "껍질상태": "과피 상태가 안정적으로 보이고",
                "표면상태": "표면이 비교적 매끄럽고",
                "모양상태": "형태가 비교적 고르고",
                "손질상태": "손질 상태가 깔끔해 보이고",
            }[name])
    first = " ".join(positive[:2]).strip()
    if not first:
        first = f"{item}의 외관 상태는 보통 수준으로 보이며"
    damage, scratch = grades["손상"], grades["흠집"]
    if damage == "상":
        defect = "부패·깊은 상처 등 주요 손상 가능성이 있어 구매 전 상태 확인이 필요합니다."
    elif damage == "중":
        defect = "주요 손상 가능성이 일부 있어 상태를 확인하는 것이 좋습니다."
    elif scratch == "상":
        defect = "표면 흠집이 여러 곳에 보여 외관 품질이 낮아질 수 있습니다."
    elif scratch == "중":
        defect = "다만 경미한 표면 흠집 또는 반점이 일부 보일 수 있습니다."
    else:
        defect = "뚜렷한 주요 손상이나 표면 흠집은 많지 않은 것으로 보입니다."
    return f"{first} {defect}".replace("  ", " ")
