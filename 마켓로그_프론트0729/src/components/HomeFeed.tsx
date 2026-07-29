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
            className="flex-1 bg-transparent border-none focus:outline-none text-sm text-on-surface placeholder-outline"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="text-outline hover:text-on-surface">
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          )}
        </div>
      </div>

      {/* Merchant Mode Special Banner */}
      {userRole === "merchant" && (
        <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 rounded-2xl p-4 text-white shadow-lg space-y-3 relative overflow-hidden border border-amber-400/30 animate-in fade-in duration-300">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-2">
              <span className="bg-white/20 backdrop-blur-md px-2.5 py-0.5 rounded-full text-[11px] font-extrabold text-white flex items-center gap-1 border border-white/20">
                <span className="material-symbols-outlined text-xs">storefront</span>
                상인 전용 모드
              </span>
              <span className="text-xs font-bold text-amber-100">{userDisplayName || "사장님"}</span>
            </div>
            {onOpenLogin && (
              <button
                onClick={onOpenLogin}
                className="text-[11px] font-bold bg-black/20 hover:bg-black/30 px-2.5 py-1 rounded-lg text-white transition-colors"
              >
                유형 변경
              </button>
            )}
          </div>

          <div>
            <h3 className="text-lg font-black tracking-tight leading-snug">
              톡 메시지 한 줄로 AI 상품 등록 & 등급 발급!
            </h3>
            <p className="text-xs text-amber-100 mt-1">
              매대 농수산물을 촬영하거나 카카오톡 메시지를 보내시면 AI가 즉시 시세와 등급을 산정해 드립니다.
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onOpenAiScan}
              className="flex-1 bg-white text-amber-900 py-2.5 px-3 rounded-xl font-extrabold text-xs shadow-md hover:bg-amber-50 active:scale-95 transition-all flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-base text-amber-600">photo_camera</span>
              <span>AI 현장 스캔 등록</span>
            </button>
            <button
              onClick={() => alert("카카오톡 [MarketLog 상인채널]로 이동합니다. 사진과 가격을 전송해주세요!")}
              className="flex-1 bg-[#FEE500] text-[#191919] py-2.5 px-3 rounded-xl font-extrabold text-xs shadow-md hover:bg-[#FDD800] active:scale-95 transition-all flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-base">chat_bubble</span>
              <span>카카오톡 톡등록</span>
            </button>
          </div>
        </div>
      )}

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
          <h2 className="text-xl sm:text-2xl font-extrabold text-[#0F172A] tracking-tight">
            실시간 인증 상품
          </h2>

          <div className="relative">
            <button
              onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
              className="text-xs font-semibold text-[#64748B] hover:text-[#0F172A] flex items-center gap-1 transition-colors whitespace-nowrap py-1 px-1"
            >
              <span>{sortBy === "accuracy" ? "정확도순" : sortBy === "price" ? "최저가순" : "최상품질순"}</span>
              <span className="material-symbols-outlined text-sm text-[#0052FF]">tune</span>
            </button>

            {/* Sort Selection Dropdown */}
            {isSortDropdownOpen && (
              <>
                {/* Backdrop to close on outside click */}
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
        ) : (
          <div className="flex flex-col gap-3.5">
            {sortedProducts.map((product) => {
              const isBookmarked = bookmarkedProductIds.includes(product.id);
              return (
                <article
                  key={product.id}
                  onClick={() => onSelectProduct(product)}
                  className="bg-white rounded-2xl border border-[#E2E8F0] p-3.5 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-md transition-all flex gap-3.5 items-center cursor-pointer group"
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
                        <h3 className="text-base sm:text-lg font-bold text-[#0F172A] leading-snug line-clamp-1 group-hover:text-[#0052FF] transition-colors">
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

                      {/* Sub Info Row: shopName · distance · timeAgo */}
                      <p className="text-xs text-[#64748B] font-medium mt-0.5">
                        {product.shopName} · {product.distance} · {product.timeAgo}
                      </p>
                    </div>

                    {/* Price & PriceTag Badge */}
                    <div className="mt-2">
                      <div className="text-xl sm:text-2xl font-black text-[#0F172A] tracking-tight">
                        {product.price.toLocaleString()}
                        <span className="text-base font-bold text-[#0F172A] ml-0.5">원</span>
                      </div>

                      <div className="mt-1">
                        {product.priceTag.includes("저렴") || product.priceTag.includes("할인") ? (
                          <div className="inline-flex items-center gap-0.5 text-[#0052FF] text-xs font-bold bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 rounded-md">
                            <span className="material-symbols-outlined text-xs font-bold">south_west</span>
                            <span>{product.priceTag}</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-0.5 text-[#475569] text-xs font-bold bg-[#F8FAFC] border border-[#E2E8F0] px-2 py-0.5 rounded-md">
                            <span className="material-symbols-outlined text-xs font-bold">drag_handle</span>
                            <span>{product.priceTag}</span>
                          </div>
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
