import React, { useState } from "react";
import { ProductItem, MarketInfo } from "../types";

interface ProductDetailModalProps {
  product: ProductItem | null;
  marketInfo: MarketInfo;
  onClose: () => void;
  isBookmarked: boolean;
  onToggleBookmark: (product: ProductItem) => void;
  onNavigateToMap: () => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  marketInfo,
  onClose,
  isBookmarked,
  onToggleBookmark,
  onNavigateToMap,
}) => {
  if (!product) return null;

  const handleToggle = () => {
    onToggleBookmark(product);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="bg-surface-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col animation-slide-up">
        {/* Header Image banner */}
        <div className="relative h-64 w-full bg-slate-900 flex-shrink-0">
          <img
            src={product.imageUrl}
            alt={product.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"></div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 left-4 w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/60 transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>

          {/* AI Grade Badge */}
          <div className="absolute top-4 right-4 bg-safe-emerald text-white px-3.5 py-1 rounded-full flex items-center gap-1.5 shadow-lg border border-white/30">
            <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
              verified
            </span>
            <span className="text-xs font-extrabold">최상등급 (AI {product.grade})</span>
          </div>

          <div className="absolute bottom-4 left-4 right-4 text-white">
            <div className="text-xs font-semibold text-white/80">{product.shopName} · {product.distance}</div>
            <h2 className="text-2xl font-bold">{product.title}</h2>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Price Transparency Comparison */}
          <div className="bg-surface-container-low rounded-2xl p-4 border border-outline-variant/30 space-y-3">
            <div className="text-xs font-bold text-outline">실시간 공공 시세 검증 가격</div>
            <div className="flex gap-3">
              {/* Today Selling Price */}
              <div className="flex-1 p-3.5 rounded-xl bg-surface-white border-2 border-trust-blue shadow-sm relative">
                <div className="absolute -top-2.5 right-3 bg-trust-blue text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                  추천가
                </div>
                <div className="text-xs font-bold text-trust-blue flex items-center gap-1 mb-1">
                  <span className="material-symbols-outlined text-sm">storefront</span> 오늘 판매가
                </div>
                <div className="text-2xl font-extrabold text-on-surface">
                  {product.price.toLocaleString()}<span className="text-sm font-normal text-on-surface-variant ml-0.5">원</span>
                </div>
              </div>

              {/* Public Price */}
              <div className="flex-1 p-3.5 rounded-xl bg-surface-container/50 border border-outline-variant/30">
                <div className="text-xs font-bold text-outline flex items-center gap-1 mb-1">
                  <span className="material-symbols-outlined text-sm">account_balance</span> 공공 싯가
                </div>
                <div className="text-2xl font-extrabold text-outline">
                  {product.publicPrice.toLocaleString()}<span className="text-sm font-normal text-outline/80 ml-0.5">원</span>
                </div>
              </div>
            </div>

            <div className="text-xs font-semibold text-trust-blue bg-trust-blue/10 px-3 py-1.5 rounded-lg flex items-center justify-between">
              <span>{product.priceTag}</span>
              <span className="text-[11px] text-outline">KAMIS 공공데이터 연동</span>
            </div>
          </div>

          {/* AI Metrics Breakdown */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-on-surface flex items-center gap-1.5">
              <span className="material-symbols-outlined text-trust-blue text-base">analytics</span>
              AI 정밀 분석 지표
            </h3>

            <div className="space-y-2.5 bg-surface-white p-4 rounded-2xl border border-surface-container shadow-sm">
              <div>
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="font-medium text-on-surface-variant">신선도 (은백색 광택/수분감)</span>
                  <span className="font-bold text-safe-emerald">{product.freshnessScore}%</span>
                </div>
                <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
                  <div className="h-full bg-safe-emerald rounded-full" style={{ width: `${product.freshnessScore}%` }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="font-medium text-on-surface-variant">표면 결함 (상처/무름 유무)</span>
                  <span className="font-bold text-safe-emerald">{product.defectScore}%</span>
                </div>
                <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
                  <div className="h-full bg-safe-emerald rounded-full" style={{ width: `${product.defectScore}%` }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="font-medium text-on-surface-variant">크기/두께 균일도</span>
                  <span className="font-bold text-trust-blue">{product.uniformityScore}%</span>
                </div>
                <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
                  <div className="h-full bg-trust-blue rounded-full" style={{ width: `${product.uniformityScore}%` }}></div>
                </div>
              </div>
            </div>
          </div>

          {/* Product AI Description */}
          <div className="text-xs text-on-surface-variant bg-surface-container-low p-3.5 rounded-xl border border-trust-blue/10 leading-relaxed">
            <span className="font-bold text-trust-blue">AI 검증 의견: </span>
            {product.description}
          </div>

          {/* Cross-Selling Recipe Quest Link */}
          <div className="bg-gradient-to-r from-trust-blue/10 via-safe-emerald/10 to-trust-blue/10 p-4 rounded-2xl border border-trust-blue/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-trust-blue flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">soup_kitchen</span>
                연관 소비 추천 퀘스트
              </span>
              <span className="text-[11px] font-bold text-safe-emerald bg-white px-2 py-0.5 rounded-full">
                50m 이내
              </span>
            </div>
            <p className="text-sm font-bold text-on-surface">
              {product.title}와 조합하는 <span className="text-trust-blue">"갈치조림 완성 패키지"</span>
            </p>
            <div className="text-xs text-on-surface-variant">
              인근 <span className="font-bold text-on-surface">호남상회 (가을무 20% OFF 쿠폰)</span>와 연계 동선을 추천합니다.
            </div>
            <button
              onClick={() => {
                onClose();
                onNavigateToMap();
              }}
              className="w-full mt-1 bg-surface-white hover:bg-surface-container text-trust-blue border border-trust-blue/30 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 shadow-sm"
            >
              <span className="material-symbols-outlined text-sm">map</span>
              추천 이동 동선 및 상점 보기
            </button>
          </div>

          {/* Warranty Stamp */}
          <div className="py-2.5 px-4 bg-surface-container rounded-xl flex items-center justify-center gap-2 text-xs font-semibold text-on-surface-variant">
            <span className="material-symbols-outlined text-trust-blue text-base" style={{ fontVariationSettings: "'FILL' 1" }}>
              security
            </span>
            <span>농림축산식품부 공공데이터 연동 보증</span>
          </div>
        </div>

        {/* Footer Action */}
        <div className="p-4 border-t border-surface-container bg-surface-white flex gap-3">
          <button
            onClick={handleToggle}
            className={`flex-1 py-4 rounded-2xl font-extrabold text-sm shadow-md transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${
              isBookmarked
                ? "bg-slate-800 text-white hover:bg-slate-900"
                : "bg-trust-blue text-white hover:bg-trust-blue/90"
            }`}
          >
            <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
              {isBookmarked ? "bookmark_added" : "bookmark"}
            </span>
            <span>{isBookmarked ? "저장한 상품 목록에 저장됨 ✓" : "저장한 상품 리스트에 추가"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
