from __future__ import annotations

import argparse

import torch
from PIL import Image
from torchvision import transforms

from marketlog_vision.data.datasets import IMAGENET_MEAN, IMAGENET_STD
from marketlog_vision.models.quality_grading import build_grading_model, predict_ranks


def parse_args():
    p = argparse.ArgumentParser(description="품질 등급 단일 이미지 추론")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--image", required=True)
    p.add_argument("--segment", action="store_true", help="분류 전에 배경 제거 (rembg)")
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    return p.parse_args()


def load_model(checkpoint_path, device):
    ckpt = torch.load(checkpoint_path, map_location=device, weights_only=False)
    model = build_grading_model(ckpt["backbone"], num_grades=len(ckpt["grade_order"]), pretrained=False)
    model.load_state_dict(ckpt["model_state"])
    model.to(device).eval()
    return model, ckpt["grade_order"], ckpt["img_size"]


def predict(model, grade_order, img_size, image_path, device, segment=False):
    tf = transforms.Compose([
        transforms.Resize(int(img_size * 1.14)),
        transforms.CenterCrop(img_size),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ])
    image = Image.open(image_path).convert("RGB")
    if segment:
        from marketlog_vision.segmentation import crop_to_foreground
        image = crop_to_foreground(image)
    x = tf(image).unsqueeze(0).to(device)
    with torch.no_grad():
        logits = model(x)
        rank = predict_ranks(logits).item()
        probs = torch.sigmoid(logits).squeeze(0).tolist()
    return grade_order[rank], rank, probs


def main():
    args = parse_args()
    device = torch.device(args.device)
    model, grade_order, img_size = load_model(args.checkpoint, device)
    grade, rank, probs = predict(model, grade_order, img_size, args.image, device, args.segment)
    print(f"등급: {grade} (rank={rank}/{len(grade_order)-1})")
    print(f"P(rank>k) per threshold: {[f'{p:.3f}' for p in probs]}")


if __name__ == "__main__":
    main()
