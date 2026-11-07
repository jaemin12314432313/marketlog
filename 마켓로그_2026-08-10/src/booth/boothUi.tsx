// 부스 화면 3종(태블릿/모니터/QR 결과)이 같이 쓰는 표시 컴포넌트.
import React from "react";
import type { AttributeGradeLabel } from "../types";
import type { AttributeLabels } from "./boothApi";

export function gradeText(grade: string): string {
  return grade === "A+" ? "특상" : "보통";
}

// AiScanModal/ProductDetailModal과 같은 순위 기준: 특상·적음이 가장 좋고, 중·많음이 가장 나쁘다.
const GRADE_RANK: Record<AttributeGradeLabel, 0 | 1 | 2> = { 특상: 0, 적음: 0, 상: 1, 보통: 1, 중: 2, 많음: 2 };
const RANK_COLOR = ["#10B981", "#F59E0B", "#F87171"];
const RANK_WIDTH = ["92%", "62%", "30%"];

export function GradeBadge({
  grade,
  confidence,
  size = "md",
}: {
  grade: string;
  confidence?: number | null;
  size?: "md" | "lg" | "xl";
}) {
  const premium = grade === "A+";
  const sizeClass = {
    md: "text-sm px-3 py-1",
    lg: "text-xl px-4 py-1.5",
    xl: "text-3xl px-6 py-2",
  }[size];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-extrabold ${sizeClass} ${
        premium ? "bg-emerald-500 text-white" : "bg-amber-400 text-amber-950"
      }`}
    >
      <span className="material-symbols-outlined" style={{ fontSize: "1.1em" }}>
        verified
      </span>
      {gradeText(grade)}
      {confidence != null && <span className="font-semibold opacity-80" style={{ fontSize: "0.75em" }}>{confidence}%</span>}
    </span>
  );
}

export function AttributeBars({ labels, dark = false }: { labels?: AttributeLabels | null; dark?: boolean }) {
  const entries = Object.entries(labels || {});
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2.5">
      {entries.map(([name, info]) => {
        const rank = GRADE_RANK[info.grade] ?? 1;
        return (
          <div key={name}>
            <div className={`flex justify-between text-sm font-semibold mb-1 ${dark ? "text-white/85" : "text-slate-700"}`}>
              <span>{name}</span>
              <span style={{ color: RANK_COLOR[rank] }}>{info.grade}</span>
            </div>
            <div className={`h-2.5 rounded-full overflow-hidden ${dark ? "bg-white/15" : "bg-slate-200"}`}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: RANK_WIDTH[rank], backgroundColor: RANK_COLOR[rank] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function priceDiffText(price: number, publicPrice: number): { text: string; tone: "good" | "same" | "high" } {
  if (!publicPrice) return { text: "", tone: "same" };
  const diff = Math.round(((publicPrice - price) / publicPrice) * 100);
  if (diff > 0) return { text: `공공 시세보다 ${diff}% 저렴`, tone: "good" };
  if (diff < 0) return { text: `공공 시세보다 ${-diff}% 비쌈`, tone: "high" };
  return { text: "공공 시세와 같은 가격", tone: "same" };
}

export function won(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

export function PriceCompare({ price, publicPrice, dark = false }: { price: number; publicPrice: number; dark?: boolean }) {
  const diff = priceDiffText(price, publicPrice);
  const toneClass = { good: "text-emerald-500", same: dark ? "text-white/70" : "text-slate-500", high: "text-rose-500" }[diff.tone];
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className={`rounded-2xl p-3 ${dark ? "bg-white/10" : "bg-slate-50 border border-slate-200"}`}>
        <p className={`text-xs font-semibold ${dark ? "text-white/60" : "text-slate-500"}`}>우리 가게 (1kg)</p>
        <p className={`text-xl font-extrabold ${dark ? "text-white" : "text-slate-900"}`}>{won(price)}</p>
      </div>
      <div className={`rounded-2xl p-3 ${dark ? "bg-white/10" : "bg-slate-50 border border-slate-200"}`}>
        <p className={`text-xs font-semibold ${dark ? "text-white/60" : "text-slate-500"}`}>공공 시세 (1kg)</p>
        <p className={`text-xl font-extrabold ${dark ? "text-white" : "text-slate-900"}`}>{won(publicPrice)}</p>
      </div>
      {diff.text && <p className={`col-span-2 text-sm font-bold ${toneClass}`}>{diff.text}</p>}
    </div>
  );
}

export function BrandMark({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-9 h-9 rounded-xl bg-[#0052FF] flex items-center justify-center shadow">
        <span className="material-symbols-outlined text-white text-xl">storefront</span>
      </div>
      <div className="leading-tight">
        <p className={`font-extrabold text-base ${dark ? "text-white" : "text-slate-900"}`}>마켓로그</p>
        <p className={`text-[11px] font-semibold whitespace-nowrap ${dark ? "text-white/60" : "text-slate-500"}`}>CO-SHOW 2026 · 테라바이트</p>
      </div>
    </div>
  );
}

// 카메라 프레임을 업로드용 JPEG로 만든다. 전시장 네트워크가 느릴 수 있어 긴 변을 1280px로 줄인다.
export function captureVideoFrame(video: HTMLVideoElement, maxSide = 1280): string {
  const { videoWidth: w, videoHeight: h } = video;
  if (!w || !h) return "";
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export const FullCenter: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`min-h-[100dvh] w-full flex flex-col items-center justify-center p-6 ${className}`}>{children}</div>
);
