import React, { useState } from "react";
import { ProductItem } from "../types";

// 비전 파이프라인이 2단계(특상/보통) 등급으로 바뀌어서, 화면에도 A+/B 같은 영문 등급
// 대신 실제 판정 체계와 맞는 한글 표기를 쓴다 (HomeFeed 등과 동일 규칙).
function displayGrade(grade: string): string {
  return grade === "A+" ? "특상" : "보통";
}

// product.timeAgo는 등록 시점에 박제된 고정 문자열이라 시간이 지나도 안 바뀐다 — HomeFeed와
// 동일하게 실제 경과 시간은 createdAt에서 매번 다시 계산한다.
function formatRelativeTime(createdAt?: string): string {
  if (!createdAt) return "";
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return "";
  const diffMin = Math.floor((Date.now() - created) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}일 전`;
}

// HomeFeed와 동일한 공공시세 대비 할인율 계산 — 저장한 상품 카드도 피드와 같은 기준으로 보여준다.
function discountPercent(product: ProductItem): number | null {
  if (!product.publicPrice || product.publicPrice <= 0) return null;
  const percent = Math.round(((product.publicPrice - product.price) / product.publicPrice) * 100);
  return percent > 0 ? percent : null;
}

// 원산지/단위를 따로따로 흩어놓는 대신, "[국내산] 해남 알배기 배추 1포기"처럼 하나의
// 자연스러운 문장으로 합쳐서 보여준다 (HomeFeed와 동일 규칙) — 대분류(국내산/수입산)만
// 대괄호 태그로 남기고 상세 산지는 상품명 앞에 자연스럽게 붙인다.
function formatProductDisplayTitle(product: ProductItem): string {
  const [originType, originDetail] = (product.origin || "").split(" · ").map((s) => s.trim());
  const typePart = originType ? `[${originType}] ` : "";
  const detailPart = originDetail ? `${originDetail} ` : "";
  const unitPart = product.unit ? ` ${product.unit}` : "";
  return `${typePart}${detailPart}${product.title}${unitPart}`;
}

interface SavedViewProps {
  scannedProducts: ProductItem[];
  bookmarkedProducts: ProductItem[];
  onSelectProduct: (product: ProductItem) => void;
  onNavigateToMap: () => void;
  onRemoveScannedProduct?: (id: string) => void;
  onRemoveBookmarkedProduct?: (id: string) => void;
  isLoggedIn?: boolean;
  onOpenLogin?: () => void;
}

export const SavedView: React.FC<SavedViewProps> = ({
  scannedProducts,
  bookmarkedProducts,
  onSelectProduct,
  onRemoveScannedProduct,
  onRemoveBookmarkedProduct,
  isLoggedIn = false,
  onOpenLogin,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<"scanned" | "bookmarked">("scanned");

  if (!isLoggedIn) {
    return (
      <div className="w-full max-w-[600px] mx-auto content-pt-safe content-pb-safe px-4">
        <div className="bg-surface-white rounded-2xl border border-[#E2E8F0] p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 text-trust-blue flex items-center justify-center mx-auto">
            <span className="material-symbols-outlined text-3xl">bookmark</span>
          </div>
          <div>
            <h2 className="text-base font-extrabold text-on-surface">로그인이 필요합니다</h2>
            <p className="text-xs text-outline mt-1.5 leading-relaxed">
              로그인하면 찜한 상품과 AI 스캔 저장목록을 확인할 수 있어요.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenLogin}
            className="w-full py-3 bg-trust-blue hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-md transition-colors"
          >
            로그인 / 회원가입
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[600px] mx-auto content-pt-safe content-pb-safe px-4 space-y-5">
      {/* Page Title Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-extrabold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-trust-blue" style={{ fontVariationSettings: "'FILL' 1" }}>
              bookmark
            </span>
            저장 목록
          </h1>
          <p className="text-xs text-outline font-medium mt-0.5">
            스캔 상품 및 관심 상품 관리
          </p>
        </div>
      </div>

      {/* 2 Sub Tabs: 스캔 상품 vs 저장한 상품 */}
      <div className="flex border-b border-[#E2E8F0]">
        <button
          type="button"
          onClick={() => setActiveSubTab("scanned")}
          className={`flex-1 py-3 text-xs font-extrabold text-center border-b-2 transition-all flex items-center justify-center gap-1.5 ${
            activeSubTab === "scanned"
              ? "border-trust-blue text-trust-blue bg-blue-50/50"
              : "border-transparent text-outline hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-base">photo_camera</span>
          <span>스캔 상품 ({scannedProducts.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("bookmarked")}
          className={`flex-1 py-3 text-xs font-extrabold text-center border-b-2 transition-all flex items-center justify-center gap-1.5 ${
            activeSubTab === "bookmarked"
              ? "border-trust-blue text-trust-blue bg-blue-50/50"
              : "border-transparent text-outline hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>
            bookmark
          </span>
          <span>저장한 상품 ({bookmarkedProducts.length})</span>
        </button>
      </div>

      {/* Sub Tab 1: 스캔 상품 */}
      {activeSubTab === "scanned" && (
        <section className="space-y-3">
          {scannedProducts.length === 0 ? (
            <div className="bg-surface-white rounded-2xl p-8 text-center border border-[#E2E8F0] space-y-2">
              <span className="material-symbols-outlined text-4xl text-outline">photo_camera</span>
              <p className="text-sm font-bold text-on-surface">스캔한 상품이 없습니다.</p>
              <p className="text-xs text-outline leading-relaxed max-w-xs mx-auto">
                AI SCAN 버튼을 눌러 매대의 과일, 수산물, 정육 신선도를 측정한 후 저장목록에 저장해 보세요.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {scannedProducts.map((product) => {
                const relativeTime = formatRelativeTime(product.createdAt);
                return (
                  <article
                    key={product.id}
                    onClick={() => onSelectProduct({ ...product, isScannedProduct: true })}
                    className="py-3 sm:py-3.5 border-b border-[#E2E8F0] last:border-b-0 transition-all flex gap-3.5 items-center cursor-pointer group"
                  >
                    {/* Left Thumbnail Container */}
                    <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-2xl overflow-hidden flex-shrink-0 border border-[#E2E8F0] bg-slate-100">
                      <img
                        src={product.imageUrl}
                        alt={product.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div
                        className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-extrabold text-white flex items-center gap-1 shadow-sm z-10 ${
                          product.grade?.startsWith("A") ? "bg-[#00C875]" : "bg-[#0052FF]"
                        }`}
                      >
                        <span
                          className="material-symbols-outlined text-[13px] font-extrabold"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          check_circle
                        </span>
                        <span>{displayGrade(product.grade)}</span>
                      </div>
                    </div>

                    {/* Right Details Container */}
                    <div className="flex-1 flex flex-col justify-between self-stretch py-0.5 min-w-0">
                      <div>
                        <div className="flex justify-between items-start gap-1">
                          <div className="min-w-0">
                            {/* 특정 점포에 등록된 상품이 아니라 내가 직접 스캔한 개인 기록이라
                                가게명 대신, 실제로 있는 데이터인 카테고리를 라벨로 보여준다. */}
                            <p className="text-xs font-black text-[#0052FF] truncate">{product.category}</p>
                            <h3 className="text-sm sm:text-base font-extrabold text-[#0F172A] leading-snug line-clamp-2 group-hover:text-[#0052FF] transition-colors mt-0.5">
                              {formatProductDisplayTitle(product)}
                            </h3>
                            {relativeTime && (
                              <p className="text-[11px] text-[#94A3B8] font-medium mt-0.5">{relativeTime}</p>
                            )}
                            {/* 스캔 당시 위치 — 저장 시점에 위치 권한을 거부/실패했으면
                                비어있으니 그때는 아무것도 표시하지 않는다. */}
                            {product.distance && (
                              <p className="flex items-center gap-0.5 text-[11px] text-[#94A3B8] font-medium mt-0.5">
                                <span className="material-symbols-outlined text-[13px]">location_on</span>
                                {product.distance}
                              </p>
                            )}
                          </div>
                          {onRemoveScannedProduct && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveScannedProduct(product.id);
                              }}
                              className="p-1 rounded-full transition-colors flex-shrink-0 text-[#94A3B8] hover:text-red-500 hover:bg-red-50"
                              title="스캔 목록에서 삭제"
                            >
                              <span className="material-symbols-outlined text-xl">delete</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Price Section */}
                      <div className="mt-2">
                        <div className="flex items-baseline gap-1 whitespace-nowrap">
                          {discountPercent(product) !== null && (
                            <span className="text-[#0052FF] font-black text-lg sm:text-xl">
                              {discountPercent(product)}%
                            </span>
                          )}
                          <div className="text-xl sm:text-2xl font-black text-[#0F172A] tracking-tight">
                            {product.price.toLocaleString()}
                            <span className="text-base font-bold text-[#0F172A] ml-0.5">원</span>
                          </div>
                        </div>
                        {discountPercent(product) !== null && (
                          <span className="block text-[11px] font-bold text-[#94A3B8] mt-0.5">
                            공공시세 대비 저렴
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Sub Tab 2: 저장한 상품 (Home feed bookmarks) */}
      {activeSubTab === "bookmarked" && (
        <section className="space-y-3">
          {bookmarkedProducts.length === 0 ? (
            <div className="bg-surface-white rounded-2xl p-8 text-center border border-[#E2E8F0] space-y-2">
              <span className="material-symbols-outlined text-4xl text-outline">bookmark_border</span>
              <p className="text-sm font-bold text-on-surface">저장한 상품이 없습니다.</p>
              <p className="text-xs text-outline leading-relaxed max-w-xs mx-auto">
                Home 화면 피드에서 마음에 드는 상품 오른쪽의 북마크 버튼을 눌러 관심 상품에 추가해 보세요.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {bookmarkedProducts.map((product) => {
                const relativeTime = formatRelativeTime(product.createdAt);
                return (
                  <article
                    key={product.id}
                    onClick={() => onSelectProduct(product)}
                    className="py-3 sm:py-3.5 border-b border-[#E2E8F0] last:border-b-0 transition-all flex gap-3.5 items-center cursor-pointer group"
                  >
                    {/* Left Thumbnail Container */}
                    <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-2xl overflow-hidden flex-shrink-0 border border-[#E2E8F0] bg-slate-100">
                      <img
                        src={product.imageUrl}
                        alt={product.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div
                        className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-extrabold text-white flex items-center gap-1 shadow-sm z-10 ${
                          product.grade?.startsWith("A") ? "bg-[#00C875]" : "bg-[#0052FF]"
                        }`}
                      >
                        <span
                          className="material-symbols-outlined text-[13px] font-extrabold"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          check_circle
                        </span>
                        <span>{displayGrade(product.grade)}</span>
                      </div>
                    </div>

                    {/* Right Details Container */}
                    <div className="flex-1 flex flex-col justify-between self-stretch py-0.5 min-w-0">
                      <div>
                        <div className="flex justify-between items-start gap-1">
                          <div className="min-w-0">
                            {product.shopName && (
                              <p className="text-xs font-black text-[#0052FF] truncate">{product.shopName}</p>
                            )}
                            <h3 className="text-sm sm:text-base font-extrabold text-[#0F172A] leading-snug line-clamp-2 group-hover:text-[#0052FF] transition-colors mt-0.5">
                              {formatProductDisplayTitle(product)}
                            </h3>
                            {relativeTime && (
                              <p className="text-[11px] text-[#94A3B8] font-medium mt-0.5">{relativeTime}</p>
                            )}
                          </div>
                          {onRemoveBookmarkedProduct && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveBookmarkedProduct(product.id);
                              }}
                              className="p-1 rounded-full transition-colors flex-shrink-0 text-[#0052FF] bg-blue-50 hover:bg-blue-100"
                              title="저장 해제"
                            >
                              <span
                                className="material-symbols-outlined text-xl"
                                style={{ fontVariationSettings: "'FILL' 1" }}
                              >
                                bookmark
                              </span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Price Section */}
                      <div className="mt-2">
                        <div className="flex items-baseline gap-1 whitespace-nowrap">
                          {discountPercent(product) !== null && (
                            <span className="text-[#0052FF] font-black text-lg sm:text-xl">
                              {discountPercent(product)}%
                            </span>
                          )}
                          <div className="text-xl sm:text-2xl font-black text-[#0F172A] tracking-tight">
                            {product.price.toLocaleString()}
                            <span className="text-base font-bold text-[#0F172A] ml-0.5">원</span>
                          </div>
                        </div>
                        {discountPercent(product) !== null && (
                          <span className="block text-[11px] font-bold text-[#94A3B8] mt-0.5">
                            공공시세 대비 저렴
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
