import argparse

import torch
from PIL import Image

from marketlog_vision.data.datasets import IMAGENET_MEAN, IMAGENET_STD
from marketlog_vision.models.item_recognition import build_model
from torchvision import transforms


def parse_args():
    p = argparse.ArgumentParser(description="품목 인식 단일 이미지 추론")
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--image", required=True)
    p.add_argument("--topk", type=int, default=3)
    p.add_argument("--segment", action="store_true",
                    help="분류 전에 배경을 제거하고 흰 배경으로 치환 (rembg/U2-Net)")
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    return p.parse_args()


def load_model(checkpoint_path, device):
    ckpt = torch.load(checkpoint_path, map_location=device, weights_only=False)
    model = build_model(ckpt["backbone"], num_classes=len(ckpt["classes"]), pretrained=False)
    model.load_state_dict(ckpt["model_state"])
    model.to(device).eval()
    return model, ckpt["classes"], ckpt["img_size"]


def predict(model, classes, img_size, image_path, device, topk=3, segment=False):
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
        probs = model(x).softmax(dim=1).squeeze(0)
    top_probs, top_idx = probs.topk(min(topk, len(classes)))
    return [(classes[i], p.item()) for p, i in zip(top_probs, top_idx)]


def main():
    args = parse_args()
    device = torch.device(args.device)
    model, classes, img_size = load_model(args.checkpoint, device)
    results = predict(model, classes, img_size, args.image, device, args.topk, args.segment)
    for name, prob in results:
        print(f"{name}: {prob:.4f}")


if __name__ == "__main__":
    main()
