"""통합 추론 파이프라인 — 제안서 §5.
[입력 이미지] -> ① 전경 분할(선택) -> ② 품목 인식 -> ③ 품질 등급(CORAL) -> 결과.
"""
from __future__ import annotations

import argparse

import torch
from PIL import Image
from torchvision import transforms

from marketlog_vision.data.datasets import IMAGENET_MEAN, IMAGENET_STD
from marketlog_vision.models.item_recognition import build_model
from marketlog_vision.models.quality_grading import build_grading_model, predict_ranks


def parse_args():
    p = argparse.ArgumentParser(description="품목인식 + 품질등급 통합 파이프라인")
    p.add_argument("--item-checkpoint", required=True)
    p.add_argument("--grading-checkpoint", required=True)
    p.add_argument("--image", required=True)
    p.add_argument("--segment", action="store_true",
                    help="분류 전에 배경을 제거/크롭 (rembg/U2-Net) — 현장 사진에 권장")
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    return p.parse_args()


def _build_transform(img_size: int):
    return transforms.Compose([
        transforms.Resize(int(img_size * 1.14)),
        transforms.CenterCrop(img_size),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ])


def load_item_model(checkpoint_path, device):
    ckpt = torch.load(checkpoint_path, map_location=device, weights_only=False)
    model = build_model(ckpt["backbone"], num_classes=len(ckpt["classes"]), pretrained=False)
    model.load_state_dict(ckpt["model_state"])
    model.to(device).eval()
    return model, ckpt["classes"], ckpt["img_size"]


def load_grading_model(checkpoint_path, device):
    ckpt = torch.load(checkpoint_path, map_location=device, weights_only=False)
    model = build_grading_model(ckpt["backbone"], num_grades=len(ckpt["grade_order"]), pretrained=False)
    model.load_state_dict(ckpt["model_state"])
    model.to(device).eval()
    return model, ckpt["grade_order"], ckpt["img_size"]


def run_pipeline(
    image_path: str,
    item_model, item_classes, item_img_size,
    grading_model, grade_order, grading_img_size,
    device, segment: bool = False,
) -> dict:
    image = Image.open(image_path).convert("RGB")
    if segment:
        from marketlog_vision.segmentation import crop_to_foreground
        image = crop_to_foreground(image)

    item_tf = _build_transform(item_img_size)
    x_item = item_tf(image).unsqueeze(0).to(device)
    with torch.no_grad():
        item_probs = item_model(x_item).softmax(dim=1).squeeze(0)
    item_top_prob, item_top_idx = item_probs.max(dim=0)
    item_name = item_classes[item_top_idx.item()]

    grading_tf = _build_transform(grading_img_size)
    x_grade = grading_tf(image).unsqueeze(0).to(device)
    with torch.no_grad():
        grade_logits = grading_model(x_grade)
        grade_rank = predict_ranks(grade_logits).item()
        grade_probs = torch.sigmoid(grade_logits).squeeze(0).tolist()
    grade_name = grade_order[grade_rank]

    return {
        "item": item_name,
        "item_confidence": item_top_prob.item(),
        "grade": grade_name,
        "grade_rank": grade_rank,
        "grade_max_rank": len(grade_order) - 1,
        "grade_thresholds": grade_probs,
    }


def main():
    args = parse_args()
    device = torch.device(args.device)

    item_model, item_classes, item_img_size = load_item_model(args.item_checkpoint, device)
    grading_model, grade_order, grading_img_size = load_grading_model(args.grading_checkpoint, device)

    result = run_pipeline(
        args.image,
        item_model, item_classes, item_img_size,
        grading_model, grade_order, grading_img_size,
        device, args.segment,
    )

    print(f"품목: {result['item']} ({result['item_confidence']*100:.1f}%)")
    print(f"등급: {result['grade']} (rank={result['grade_rank']}/{result['grade_max_rank']})")
    print(f"  P(rank>k): {[f'{p:.3f}' for p in result['grade_thresholds']]}")


if __name__ == "__main__":
    main()
