// QR로 여는 공개 페이지(/s, /r)를 마켓로그 앱과 같은 모양으로 그리기 위한 공용 부품.
// 앱의 Header·ProductDetailModal과 같은 색/테두리/배지/분석 막대 규칙을 따른다.
import React from "react";
import logoIcon from "../assets/logo-icon.png";
import type { AttributeGradeLabel } from "../types";

export const APP_BG = "bg-[#F1F5F9]";
// 앱 카드: 흰 바탕 + 연한 테두리 + 얕은 그림자
export const APP_CARD =
  "bg-white rounded-2xl border border-[#E2E8F0] shadow-[0_4px_12px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.9)]";

// 앱 상단 헤더(로고 + MarketLog). right에 공유 버튼 등을 넣는다.
export function AppHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-[#E2E8F0] shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      <div className="max-w-md mx-auto h-16 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={logoIcon} alt="MarketLog" className="w-9 h-9 object-contain" />
          <span className="text-lg font-bold tracking-tight text-[#0F172A]">MarketLog</span>
        </div>
        {right}
      </div>
    </header>
  );
}

// 헤더 오른쪽 둥근 아이콘 버튼(앱의 알림 버튼과 같은 모양)
export function HeaderIconButton({ icon, label, onClick }: { icon: string; label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="h-10 px-3 rounded-xl bg-slate-50 border border-[#E2E8F0] text-[#0F172A] flex items-center gap-1 text-sm font-bold active:scale-95 transition"
    >
      <span className="material-symbols-outlined text-xl">{icon}</span>
      {label}
    </button>
  );
}

// 앱의 "특상" 배지(초록, 체크 아이콘). 보통은 파랑.
export function GradePill({ grade, confidence, solid = false, showIcon = true }: { grade: string; confidence?: number | null; solid?: boolean; showIcon?: boolean }) {
  const premium = grade === "A+";
  const tone = solid
    ? premium
      ? "bg-[#10B981] text-white border-transparent shadow-md"
      : "bg-[#0052FF] text-white border-transparent shadow-md"
    : premium
      ? "text-[#10B981] bg-emerald-50 border-emerald-200"
      : "text-[#0052FF] bg-blue-50 border-blue-200";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-extrabold px-2.5 py-1 rounded-full border ${tone}`}>
      {showIcon && <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
        verified
      </span>}
      {premium ? "특상" : "보통"}
      {confidence != null && <span className="opacity-75 font-bold">{confidence}%</span>}
    </span>
  );
}

// 앱의 "AI 정밀 분석 지표" 3칸 막대
const GRADE_RANK: Record<AttributeGradeLabel, 0 | 1 | 2> = { 특상: 0, 적음: 0, 상: 1, 보통: 1, 중: 2, 많음: 2 };
const RANK_COLOR = ["#10B981", "#F59E0B", "#F87171"];

export function MetricBars({ labels }: { labels?: Record<string, { grade: AttributeGradeLabel; confidence?: number }> | null }) {
  const entries = Object.entries(labels || {});
  if (!entries.length) return null;
  return (
    <div className="space-y-3 pt-1">
      {entries.map(([name, info], index) => {
        const rank = GRADE_RANK[info.grade] ?? 1;
        const color = RANK_COLOR[rank];
        return (
          <div key={name} className={index > 0 ? "border-t border-[#D1D1D1] pt-3" : ""}>
            <div className="flex justify-between items-center text-xs mb-1">
              <span className="font-bold" style={{ color: /(모양|형태|손상|흠집)/.test(name) ? "#0F172A" : "#334155" }}>{name}</span>
              <span className="text-sm font-black" style={{ color }}>
                {info.grade}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="relative h-2.5 rounded-md overflow-hidden border border-slate-300 border-t-white/70 bg-slate-200 shadow-[inset_0_2px_4px_rgba(15,23,42,0.16),inset_0_-1px_1px_rgba(255,255,255,0.75)]"
                  style={i <= 2 - rank ? { backgroundColor: color } : undefined}
                >
                  <div aria-hidden className="pointer-events-none absolute inset-x-1 top-px h-px rounded-full bg-white/60" />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 앱의 "현장 판매가 / 공공 시세" 두 칸
export function PriceRow({ price, publicPrice }: { price: number; publicPrice: number }) {
  const pct = publicPrice > 0 ? Math.round(((publicPrice - price) / publicPrice) * 100) : null;
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <span className="text-xs font-bold text-[#0F172A]">현장 판매가</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="text-xl font-semibold text-[#0F172A] mt-0.5">{price ? `${price.toLocaleString()}원` : "-"}</div>
          {pct != null && pct > 0 && (
            <span className="text-[11px] font-semibold text-[#0052FF] bg-blue-50 px-1.5 py-0.5 rounded-full">{pct}% 저렴</span>
          )}
        </div>
      </div>
      <div>
        <span className="text-xs font-bold text-[#0F172A]">공공 시세</span>
        <div className="text-xl font-semibold text-[#0F172A] mt-0.5">{publicPrice ? `${publicPrice.toLocaleString()}원` : "-"}</div>
      </div>
    </div>
  );
}

// 카드 제목(앱의 "추천 레시피"처럼 동그란 아이콘 + 제목)
export function CardTitle({ icon, children, right }: { icon: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
          <span className="material-symbols-outlined text-lg text-[#0052FF]">{icon}</span>
        </span>
        <h3 className="text-[15px] font-extrabold text-[#0F172A]">{children}</h3>
      </div>
      {right}
    </div>
  );
}

// 앱 버튼: 파랑(주) / 남색(보조) / 흰색(테두리)
export const BTN_PRIMARY =
  "w-full bg-[#0052FF] hover:bg-[#0046E0] text-white py-3.5 px-4 rounded-xl font-extrabold text-sm shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60";
export const BTN_DARK =
  "w-full bg-[#0F172A] hover:bg-black text-white py-3.5 px-4 rounded-xl font-extrabold text-sm shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2";
export const BTN_OUTLINE =
  "w-full bg-white text-[#0F172A] border border-[#E2E8F0] py-3.5 px-4 rounded-xl font-extrabold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2";
