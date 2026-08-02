import React, { useState } from "react";
import { ProductItem, MarketInfo } from "../types";
import { UserRole } from "./LoginModal";

interface HomeFeedProps {
  products: ProductItem[];
  selectedRegion?: string;
  selectedMarket: MarketInfo;
  onSelectProduct: (product: ProductItem) => void;
  onOpenAiScan: () => void;
  userRole?: UserRole;
  userDisplayName?: string;
  onOpenLogin?: () => void;
  bookmarkedProductIds?: string[];
  onToggleBookmark?: (product: ProductItem) => void;
}

export const HomeFeed: React.FC<HomeFeedProps> = ({
  products,
  selectedRegion = "전체",
  selectedMarket,
  onSelectProduct,
  onOpenAiScan,
  userRole = "customer",
  userDisplayName,
  onOpenLogin,
  bookmarkedProductIds = [],
  onToggleBookmark,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>("AI 추천상품");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"accuracy" | "price" | "grade">("accuracy");
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);

  const categories = ["AI 추천상품", "신선야채", "수산물", "정육", "과일"];

  const filteredProducts = products.filter((p) => {
    // 1. Region Filter
    let matchesRegion = true;
    if (selectedRegion && selectedRegion !== "전체") {
      const regionShort = selectedRegion.replace("광역시", "").replace("특별시", "").replace("특별자치시", "");
      matchesRegion = Boolean(
        p.region === selectedRegion ||
        (p.region && p.region.includes(regionShort)) ||
        (selectedRegion === "광주광역시" && p.marketId === "yangdong") ||
        (selectedRegion === "서울특별시" && p.marketId === "mangwon") ||
        (selectedRegion === "부산광역시" && p.marketId === "jagalchi")
      );
    }

    // 2. Category Filter
    const matchesCategory =
      selectedCategory === "전체" || selectedCategory === "AI 추천상품"
        ? true
        : p.category === selectedCategory;

    // 3. Search Query Filter
    const matchesSearch =
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.shopName.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesRegion && matchesCategory && matchesSearch;
  });

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Sort products
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    if (sortBy === "price") {
      return a.price - b.price;
    }
    if (sortBy === "grade") {
      return b.freshnessScore - a.freshnessScore;
    }
    return 0; // default order
  });

  return (
    <div className="w-full max-w-[600px] mx-auto pt-20 pb-28 px-4 flex flex-col gap-5">
      {/* Search Input Bar */}
      <div className="relative w-full">
        <div className="bg-surface-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(0,0,0,0.05)] flex items-center px-4 h-12 transition-all focus-within:border-trust-blue focus-within:ring-1 focus-within:ring-trust-blue">
          <span className="material-symbols-outlined text-outline mr-2">search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`${selectedRegion === "전체" ? "전국" : selectedRegion} 상품명/점포명 검색 (예: 갈치, 양동수산)`}
            className="flex-1 bg-transparent border-none focus:outline-none text-sm text-on-surface placeholder-outline font-medium"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="text-outline hover:text-on-surface">
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          )}
        </div>
      </div>

      {/* Quick Category Chips */}
      <section className="flex overflow-x-auto no-scrollbar -mx-4 px-4 snap-x gap-2.5 py-1">
        {categories.map((cat) => {
          const isActive = selectedCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-full text-sm font-extrabold whitespace-nowrap active:scale-95 transition-all flex items-center gap-1.5 ${
                isActive
                  ? "bg-white border-2 border-[#0052FF] text-[#0052FF] shadow-sm"
                  : "bg-white border border-[#E2E8F0] text-[#334155] hover:border-[#CBD5E1]"
              }`}
            >
              {cat === "AI 추천상품" && (
                <span
                  className="material-symbols-outlined text-base text-[#0052FF]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  stars
                </span>
              )}
              <span>{cat}</span>
            </button>
          );
        })}
      </section>

      {/* Live Product Feed Container */}
      <section className="flex flex-col gap-3.5">
        <div className="flex justify-between items-center px-1 mb-0.5 relative">
          <h2 className="text-xl sm:text-2xl font-extrabold text-[#0F172A] tracking-tight flex items-center gap-2">
            <span>실시간 인증 상품</span>
            <span className="text-xs bg-[#0052FF] text-white px-2 py-0.5 rounded-full font-bold">
              {sortedProducts.length}
            </span>
          </h2>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle Button */}
            <div className="flex bg-[#F1F5F9] p-0.5 rounded-lg border border-[#E2E8F0]">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-md text-xs transition-colors flex items-center justify-center ${
                  viewMode === "grid" ? "bg-white text-[#0052FF] shadow-xs font-bold" : "text-[#64748B]"
                }`}
                title="2열 격자 보기"
              >
                <span className="material-symbols-outlined text-lg">grid_view</span>
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded-md text-xs transition-colors flex items-center justify-center ${
                  viewMode === "list" ? "bg-white text-[#0052FF] shadow-xs font-bold" : "text-[#64748B]"
                }`}
                title="목록형 보기"
              >
                <span className="material-symbols-outlined text-lg">view_list</span>
              </button>
            </div>

            {/* Sort Dropdown */}
            <div className="relative">
              <button
                onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
                className="text-xs font-semibold text-[#64748B] hover:text-[#0F172A] flex items-center gap-1 transition-colors whitespace-nowrap py-1.5 px-2 bg-white border border-[#E2E8F0] rounded-lg shadow-2xs"
              >
                <span>{sortBy === "accuracy" ? "정확도순" : sortBy === "price" ? "최저가순" : "최상품질순"}</span>
                <span className="material-symbols-outlined text-sm text-[#0052FF]">tune</span>
              </button>

              {/* Sort Selection Dropdown */}
              {isSortDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsSortDropdownOpen(false)}
                  />

                  <div className="absolute right-0 top-full mt-1.5 w-32 bg-white rounded-xl shadow-xl border border-[#E2E8F0] py-1.5 z-50 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-150">
                    <button
                      onClick={() => {
                        setSortBy("accuracy");
                        setIsSortDropdownOpen(false);
                      }}
                      className={`px-3 py-2 text-xs font-bold text-left flex items-center justify-between transition-colors ${
                        sortBy === "accuracy"
                          ? "bg-blue-50 text-[#0052FF]"
                          : "text-[#334155] hover:bg-slate-50"
                      }`}
                    >
                      <span>정확도순</span>
                      {sortBy === "accuracy" && (
                        <span className="material-symbols-outlined text-sm text-[#0052FF]">check</span>
                      )}
                    </button>

                    <button
                      onClick={() => {
                        setSortBy("price");
                        setIsSortDropdownOpen(false);
                      }}
                      className={`px-3 py-2 text-xs font-bold text-left flex items-center justify-between transition-colors ${
                        sortBy === "price"
                          ? "bg-blue-50 text-[#0052FF]"
                          : "text-[#334155] hover:bg-slate-50"
                      }`}
                    >
                      <span>최저가순</span>
                      {sortBy === "price" && (
                        <span className="material-symbols-outlined text-sm text-[#0052FF]">check</span>
                      )}
                    </button>

                    <button
                      onClick={() => {
                        setSortBy("grade");
                        setIsSortDropdownOpen(false);
                      }}
                      className={`px-3 py-2 text-xs font-bold text-left flex items-center justify-between transition-colors ${
                        sortBy === "grade"
                          ? "bg-blue-50 text-[#0052FF]"
                          : "text-[#334155] hover:bg-slate-50"
                      }`}
                    >
                      <span>최상품질순</span>
                      {sortBy === "grade" && (
                        <span className="material-symbols-outlined text-sm text-[#0052FF]">check</span>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {sortedProducts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 text-center text-xs text-outline font-medium flex flex-col items-center gap-2">
            <span className="material-symbols-outlined text-3xl text-slate-400">frown</span>
            <span>
              {selectedRegion === "전체"
                ? "검색 결과와 일치하는 전통시장 인증 상품이 없습니다."
                : `[${selectedRegion}] 지역에 해당 조건의 실시간 인증 상품이 아직 없습니다.`}
            </span>
            {selectedRegion !== "전체" && (
              <span className="text-[11px] text-trust-blue font-bold">
                상단 지역 선택에서 '전국 (전체)'로 변경해보세요!
              </span>
            )}
          </div>
        ) : viewMode === "grid" ? (
          /* 2-Column Grid Layout (matching reference market mall style) */
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {sortedProducts.map((product) => {
              const isBookmarked = bookmarkedProductIds.includes(product.id);
              const discountPercent =
                product.publicPrice && product.publicPrice > product.price
                  ? Math.round(((product.publicPrice - product.price) / product.publicPrice) * 100)
                  : null;

              return (
                <article
                  key={product.id}
                  onClick={() => onSelectProduct(product)}
                  className="flex flex-col cursor-pointer group relative transition-all"
                >
                  {/* Top Image Container with Badges */}
                  <div className="relative aspect-[4/3] sm:aspect-square w-full bg-slate-100 rounded-2xl overflow-hidden border border-[#E2E8F0]">
                    <img
                      src={product.imageUrl}
                      alt={product.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />

                    {/* Badge: Top Right - AI Grade */}
                    <div className="absolute top-2 right-2 bg-slate-900/80 backdrop-blur-md text-white px-2 py-0.5 rounded-full text-[10px] font-extrabold flex items-center gap-1 shadow-md z-10 border border-white/20">
                      <span className="material-symbols-outlined text-emerald-400 text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        verified
                      </span>
                      <span>{product.grade} 등급</span>
                    </div>

                    {/* Badge: Bottom Left Overlay - Freshness / Guarantee */}
                    <div className="absolute bottom-2 left-2 bg-[#0052FF] text-white px-2 py-0.5 rounded-md text-[9px] font-extrabold shadow-sm z-10 flex items-center gap-0.5">
                      <span className="material-symbols-outlined text-[10px]">auto_awesome</span>
                      <span>AI 검증 {product.freshnessScore}점</span>
                    </div>
                  </div>

                  {/* Card Content Below Image */}
                  <div className="pt-2.5 pb-1 px-0.5 flex-1 flex flex-col justify-between space-y-1.5">
                    {/* Title with Shop Name in Brackets */}
                    <div>
                      <h3 className="text-xs sm:text-sm font-extrabold text-[#0F172A] leading-snug line-clamp-2 group-hover:text-[#0052FF] transition-colors">
                        <span className="text-[#0052FF] font-black mr-1">[{product.shopName}]</span>
                        {product.title}
                      </h3>
                    </div>

                    {/* Price Section */}
                    <div>
                      {/* Strikethrough Public Market Price if Available */}
                      {product.publicPrice > product.price && (
                        <div className="text-[11px] text-[#94A3B8] line-through font-medium leading-none mb-0.5">
                          {product.publicPrice.toLocaleString()}원
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-baseline gap-1 flex-wrap">
                          <span className="text-base sm:text-lg font-black text-[#0F172A] tracking-tight">
                            {product.price.toLocaleString()}원
                          </span>
                          {discountPercent !== null && discountPercent > 0 && (
                            <span className="text-xs font-black text-[#0052FF] sm:text-sm">
                              {discountPercent}%
                            </span>
                          )}
                        </div>

                        {/* Bookmark Circle Button */}
                        {onToggleBookmark && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleBookmark(product);
                            }}
                            className={`w-7 h-7 rounded-full border border-[#E2E8F0] flex items-center justify-center transition-colors flex-shrink-0 ${
                              isBookmarked
                                ? "bg-blue-50 border-[#BFDBFE] text-[#0052FF]"
                                : "bg-white text-[#94A3B8] hover:bg-slate-100 hover:text-[#0052FF]"
                            }`}
                            title={isBookmarked ? "저장 취소" : "관심 상품 저장"}
                          >
                            <span
                              className="material-symbols-outlined text-sm"
                              style={{ fontVariationSettings: isBookmarked ? "'FILL' 1" : "'FILL' 0" }}
                            >
                              bookmark
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          /* List View Mode */
          <div className="flex flex-col gap-3.5">
            {sortedProducts.map((product) => {
              const isBookmarked = bookmarkedProductIds.includes(product.id);
              const discountPercent =
                product.publicPrice && product.publicPrice > product.price
                  ? Math.round(((product.publicPrice - product.price) / product.publicPrice) * 100)
                  : null;

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
                    {/* AI Grade Badge Overlay */}
                    <div
                      className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-extrabold text-white flex items-center gap-1 shadow-sm z-10 ${
                        product.grade.startsWith("A") ? "bg-[#00C875]" : "bg-[#0052FF]"
                      }`}
                    >
                      <span
                        className="material-symbols-outlined text-[13px] font-extrabold"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        check_circle
                      </span>
                      <span>AI {product.grade}</span>
                    </div>
                  </div>

                  {/* Right Details Container */}
                  <div className="flex-1 flex flex-col justify-between self-stretch py-0.5 min-w-0">
                    <div>
                      {/* Title and Bookmark options */}
                      <div className="flex justify-between items-start gap-1">
                        <h3 className="text-sm sm:text-base font-extrabold text-[#0F172A] leading-snug line-clamp-2 group-hover:text-[#0052FF] transition-colors">
                          <span className="text-[#0052FF] font-black mr-1">[{product.shopName}]</span>
                          {product.title}
                        </h3>
                        {onToggleBookmark && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleBookmark(product);
                            }}
                            className={`p-1 rounded-full transition-colors flex-shrink-0 ${
                              isBookmarked
                                ? "text-[#0052FF] bg-blue-50 hover:bg-blue-100"
                                : "text-[#94A3B8] hover:text-[#0052FF] hover:bg-slate-100"
                            }`}
                            title={isBookmarked ? "저장 취소" : "관심 상품 저장"}
                          >
                            <span
                              className="material-symbols-outlined text-xl"
                              style={{ fontVariationSettings: isBookmarked ? "'FILL' 1" : "'FILL' 0" }}
                            >
                              bookmark
                            </span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Price & PriceTag Badge */}
                    <div className="mt-2">
                      {product.publicPrice > product.price && (
                        <div className="text-xs text-[#94A3B8] line-through font-medium">
                          {product.publicPrice.toLocaleString()}원
                        </div>
                      )}
                      <div className="flex items-baseline gap-2">
                        <div className="text-xl sm:text-2xl font-black text-[#0F172A] tracking-tight">
                          {product.price.toLocaleString()}
                          <span className="text-base font-bold text-[#0F172A] ml-0.5">원</span>
                        </div>
                        {discountPercent !== null && discountPercent > 0 && (
                          <span className="text-sm font-black text-[#0052FF]">{discountPercent}%</span>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
