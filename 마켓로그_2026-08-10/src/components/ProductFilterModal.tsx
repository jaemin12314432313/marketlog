import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ProductItem } from "../types";

function displayGrade(grade: string): string {
  return grade === "A+" ? "특상" : "보통";
}

interface ProductFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  // 지역/검색어까지는 이미 반영된, 카테고리/등급/가격 필터링 이전 상품 목록.
  // 여기서 실시간 개수·가격 범위를 계산한다.
  products: ProductItem[];
  categories: string[];
  // 카테고리별로 그 아래 펼쳐질 품종 목록 — 없는 카테고리(수산물/정육/건어물 등)는 그냥
  // 서브 목록 없이 카테고리 칩만 있는다.
  itemTypesByCategory: Record<string, string[]>;
  selectedCategories: string[];
  selectedItemTypes: string[];
  selectedGrades: string[];
  priceRange: [number, number];
  onApply: (result: {
    categories: string[];
    itemTypes: string[];
    grades: string[];
    priceRange: [number, number];
  }) => void;
}

const GRADE_OPTIONS = ["특상", "보통"];

export const ProductFilterModal: React.FC<ProductFilterModalProps> = ({
  isOpen,
  onClose,
  products,
  categories,
  itemTypesByCategory,
  selectedCategories,
  selectedItemTypes,
  selectedGrades,
  priceRange,
  onApply,
}) => {
  const bounds = useMemo(() => {
    if (products.length === 0) return { min: 0, max: 100000 };
    const prices = products.map((p) => p.price);
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [products]);

  const [draftCategories, setDraftCategories] = useState<string[]>(selectedCategories);
  const [draftItemTypes, setDraftItemTypes] = useState<string[]>(selectedItemTypes);
  const [draftGrades, setDraftGrades] = useState<string[]>(selectedGrades);
  const [draftMin, setDraftMin] = useState<number>(priceRange[0]);
  const [draftMax, setDraftMax] = useState<number>(priceRange[1]);

  // 모달 열릴 때마다 지금 실제로 적용돼있는 값으로 초안을 다시 맞춘다 — 닫았다 다시
  // 열었을 때 이전에 만지작거리던 값이 아니라 실제 적용 상태부터 보여주기 위함.
  useEffect(() => {
    if (!isOpen) return;
    setDraftCategories(selectedCategories);
    setDraftItemTypes(selectedItemTypes);
    setDraftGrades(selectedGrades);
    setDraftMin(priceRange[0]);
    setDraftMax(priceRange[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const toggleCategory = (cat: string) => {
    setDraftCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const toggleItemType = (item: string) => {
    setDraftItemTypes((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  };

  const toggleGrade = (grade: string) => {
    setDraftGrades((prev) =>
      prev.includes(grade) ? prev.filter((g) => g !== grade) : [...prev, grade]
    );
  };

  const matchesDraftCategory = (p: ProductItem) => {
    if (draftCategories.length === 0) return true;
    if (draftCategories.includes(p.category)) return true;
    if (draftCategories.includes("야채") && (p.category as string) === "신선야채") return true;
    return false;
  };

  const liveCount = useMemo(() => {
    return products.filter((p) => {
      const matchesCategory = matchesDraftCategory(p);
      const matchesItemType =
        draftItemTypes.length === 0 || draftItemTypes.some((item) => p.title.includes(item));
      const matchesGrade = draftGrades.length === 0 || draftGrades.includes(displayGrade(p.grade));
      const matchesPrice = p.price >= draftMin && p.price <= draftMax;
      return matchesCategory && matchesItemType && matchesGrade && matchesPrice;
    }).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, draftCategories, draftItemTypes, draftGrades, draftMin, draftMax]);

  const handleReset = () => {
    setDraftCategories([]);
    setDraftItemTypes([]);
    setDraftGrades([]);
    setDraftMin(bounds.min);
    setDraftMax(bounds.max);
  };

  const handleApply = () => {
    onApply({
      categories: draftCategories,
      itemTypes: draftItemTypes,
      grades: draftGrades,
      priceRange: [draftMin, draftMax],
    });
    onClose();
  };

  if (!isOpen) return null;

  // 숫자 입력창에는 자유롭게(범위를 벗어나는 값도 잠깐은) 타이핑할 수 있게 두되,
  // 슬라이더 손잡이는 항상 이 값으로 그려서 트랙 밖으로 튀어나가는 일이 없게 한다.
  const clampedMin = Math.min(Math.max(draftMin, bounds.min), bounds.max);
  const clampedMax = Math.min(Math.max(draftMax, bounds.min), bounds.max);

  const range = Math.max(1, bounds.max - bounds.min);
  const leftPct = ((clampedMin - bounds.min) / range) * 100;
  const rightPct = ((clampedMax - bounds.min) / range) * 100;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-2xl flex flex-col max-h-[85vh] animate-in slide-in-from-bottom sm:zoom-in-95 duration-200">
        {/* Drag handle + header */}
        <div className="shrink-0 pt-3 px-5">
          <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto mb-3 sm:hidden" />
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="font-extrabold text-slate-900 text-base">필터</h3>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* Category multi-select — 선택한 카테고리 밑에 그 카테고리에 속하는 품종
              (AI가 실제로 인식하는 10개 중 해당 카테고리 것만)이 바로 펼쳐진다. */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">카테고리</h4>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => {
                const isActive = draftCategories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`px-3.5 py-2 rounded-full text-sm font-bold transition-all active:scale-95 ${
                      isActive
                        ? "bg-[#0052FF] text-white shadow-sm"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            {categories
              .filter((cat) => draftCategories.includes(cat) && itemTypesByCategory[cat]?.length)
              .map((cat) => (
                <div key={cat} className="pl-3 border-l-2 border-blue-100 space-y-1.5 mt-3">
                  <p className="text-[11px] font-bold text-slate-400">{cat} 품종</p>
                  <div className="flex flex-wrap gap-2">
                    {itemTypesByCategory[cat].map((item) => {
                      const isActive = draftItemTypes.includes(item);
                      return (
                        <button
                          key={item}
                          type="button"
                          onClick={() => toggleItemType(item)}
                          className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 ${
                            isActive
                              ? "bg-emerald-600 text-white shadow-sm"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          {item}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>

          {/* Grade multi-select */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">등급</h4>
            <div className="flex flex-wrap gap-2">
              {GRADE_OPTIONS.map((grade) => {
                const isActive = draftGrades.includes(grade);
                return (
                  <button
                    key={grade}
                    type="button"
                    onClick={() => toggleGrade(grade)}
                    className={`px-3.5 py-2 rounded-full text-sm font-bold transition-all active:scale-95 ${
                      isActive
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {grade}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Price range slider */}
          <div className="space-y-3">
            <h4 className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">가격 범위</h4>
            <div className="relative h-6 mt-2">
              <div className="absolute top-1/2 -translate-y-1/2 w-full h-1.5 bg-slate-200 rounded-full" />
              <div
                className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-[#0052FF] rounded-full"
                style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
              />
              <input
                type="range"
                className="range-slider"
                min={bounds.min}
                max={bounds.max}
                value={clampedMin}
                onChange={(e) => setDraftMin(Math.min(Number(e.target.value), draftMax))}
              />
              <input
                type="range"
                className="range-slider"
                min={bounds.min}
                max={bounds.max}
                value={clampedMax}
                onChange={(e) => setDraftMax(Math.max(Number(e.target.value), draftMin))}
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus-within:border-[#0052FF]">
                <input
                  type="number"
                  inputMode="numeric"
                  value={draftMin}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setDraftMin(Number.isNaN(v) ? 0 : v);
                  }}
                  onBlur={() => setDraftMin(clampedMin)}
                  className="w-full min-w-0 bg-transparent border-none focus:outline-none text-sm font-bold text-slate-800 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-sm font-bold text-slate-500 shrink-0">원</span>
              </div>
              <span className="text-slate-400">—</span>
              <div className="flex-1 flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus-within:border-[#0052FF]">
                <input
                  type="number"
                  inputMode="numeric"
                  value={draftMax}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setDraftMax(Number.isNaN(v) ? 0 : v);
                  }}
                  onBlur={() => setDraftMax(clampedMax)}
                  className="w-full min-w-0 bg-transparent border-none focus:outline-none text-sm font-bold text-slate-800 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-sm font-bold text-slate-500 shrink-0">원</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="shrink-0 border-t border-slate-100 p-4 flex items-center gap-2.5 content-pb-safe">
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-3.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 transition-colors flex items-center gap-1 shrink-0"
          >
            <span className="material-symbols-outlined text-base">refresh</span>
            초기화
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="flex-1 py-3.5 rounded-xl bg-[#0052FF] hover:bg-[#0043D6] text-white font-extrabold text-sm shadow-md transition-all active:scale-[0.98]"
          >
            {liveCount}개 상품 보기
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
