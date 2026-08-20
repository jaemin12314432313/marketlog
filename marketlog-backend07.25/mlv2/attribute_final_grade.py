"""품목별 품질 항목을 구매자용 최종 상·중·하로 합산하는 고정 정책.

attribute_quality_v3(2026-08-18, 비전팀 인계) 체크포인트와 함께 온 정책을 그대로
포팅했다 — 가중치/임계값을 바꾸지 말 것(비전팀이 검증한 값).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


FINAL_GRADE_POLICY_VERSION = "attribute-final-grade-v1"
GRADE_TO_SCORE = {"하": 0, "중": 1, "상": 2}
REVERSED_ATTRIBUTES = frozenset({"손상", "흠집"})


@dataclass(frozen=True)
class ItemGradePolicy:
    weights: Mapping[str, float]


# ⚠️ 감자는 이 v3 모델의 학습 대상에서 제외돼 있어 정책이 없다. mlv2/pipeline.py는
# 감자를 판정할 때 이 정책을 쓰지 않고 기존 quality_grading_effv2s_v2(2단계)로 폴백한다.
ITEM_POLICIES: dict[str, ItemGradePolicy] = {
    "사과": ItemGradePolicy({"착색도": 0.30, "신선도": 0.30, "손상": 0.25, "흠집": 0.15}),
    "배": ItemGradePolicy({"착색도": 0.25, "신선도": 0.35, "손상": 0.25, "흠집": 0.15}),
    "감귤": ItemGradePolicy({"착색도": 0.30, "껍질상태": 0.30, "손상": 0.25, "흠집": 0.15}),
    "감": ItemGradePolicy({"착색도": 0.45, "손상": 0.35, "흠집": 0.20}),
    "무": ItemGradePolicy({"표면상태": 0.30, "신선도": 0.30, "손상": 0.25, "흠집": 0.15}),
    "배추": ItemGradePolicy({"신선도": 0.35, "손질상태": 0.25, "손상": 0.25, "흠집": 0.15}),
    "양배추": ItemGradePolicy({"신선도": 0.35, "손질상태": 0.25, "손상": 0.25, "흠집": 0.15}),
    "양파": ItemGradePolicy({"모양상태": 0.25, "착색도": 0.20, "손질상태": 0.20, "손상": 0.25, "흠집": 0.10}),
    "마늘": ItemGradePolicy({"모양상태": 0.45, "손상": 0.35, "흠집": 0.20}),
}


def quality_score(attribute: str, grade: str) -> int:
    if grade not in GRADE_TO_SCORE:
        raise ValueError(f"알 수 없는 등급: {attribute}={grade!r}")
    score = GRADE_TO_SCORE[grade]
    return 2 - score if attribute in REVERSED_ATTRIBUTES else score


def calculate_final_grade(
    item: str,
    grades: Mapping[str, str],
    *,
    critical_defect: bool = False,
) -> tuple[str, float, str]:
    """(최종등급, 가중평균, 결정사유)를 반환한다.

    강제 규칙을 먼저 적용한다. 손상·흠집의 상/중/하는 결점의 심각도 방향이므로
    일반 품질 항목과 반대로 점수화한다.
    """
    policy = ITEM_POLICIES.get(item)
    if policy is None:
        raise ValueError(f"정책이 없는 품목: {item!r}")
    missing = set(policy.weights) - set(grades)
    if missing:
        raise ValueError(f"{item}의 품질 항목 누락: {sorted(missing)}")

    weighted_score = sum(quality_score(name, grades[name]) * weight for name, weight in policy.weights.items())
    core_low_count = sum(
        grades[name] == "하" for name in policy.weights if name not in REVERSED_ATTRIBUTES
    )
    damage = grades["손상"]
    scratch = grades["흠집"]

    if critical_defect or damage == "상":
        return "하", weighted_score, "critical_defect 또는 손상 상"
    if damage == "중":
        return ("하" if weighted_score < 0.90 else "중"), weighted_score, "손상 중: 최종 상 제한"
    if scratch == "상":
        return ("하" if weighted_score < 0.90 else "중"), weighted_score, "흠집 상: 최종 상 제한"
    if core_low_count >= 2:
        return "하", weighted_score, "핵심 외관 항목 2개 이상 하"
    if weighted_score >= 1.60:
        return "상", weighted_score, "가중 평균 1.60 이상"
    if weighted_score >= 0.90:
        return "중", weighted_score, "가중 평균 0.90 이상"
    return "하", weighted_score, "가중 평균 0.90 미만"
