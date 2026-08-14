import React, { useState } from "react";
import { ProductItem, MarketInfo } from "../types";
import { UserRole } from "./LoginModal";
import { ProductFilterModal } from "./ProductFilterModal";

// 비전 파이프라인이 2단계(특상/보통) 등급으로 바뀌어서, 화면에도 A+/B 같은 영문 등급
// 대신 실제 판정 체계와 맞는 한글 표기를 쓴다 (데이터 자체는 여전히 A+/B 등 문자로 저장됨).
function displayGrade(grade: string): string {
  return grade === "A+" ? "특상" : "보통";
}

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
  isLoading?: boolean;
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
  isLoading = false,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"latest" | "discount" | "priceLow" | "priceHigh">("latest");
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedItemTypes, setSelectedItemTypes] = useState<string[]>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  // [0, Infinity] = "가격 범위 미적용" — 필터 모달에서 실제 값으로 바뀌기 전까지는
  // 아무 상품도 걸러내지 않는다.
  const [priceRange, setPriceRange] = useState<[number, number]>([0, Infinity]);

  const categories = ["야채", "수산물", "정육", "과일", "건어물"];
  // AI 비전 모델이 실제로 인식하는 10개 품종을 카테고리별로 묶어둔다 — 필터에서
  // "야채" 선택하면 그 밑에 이 중 야채 것들만 펼쳐지는 식. 수산물/정육/건어물은
  // AI가 인식하는 품종이 없어서 서브 목록이 안 뜬다. 상품 제목에 이 단어가 포함돼
  // 있는지로 매칭한다(백엔드에 품종을 구조화해서 저장하는 필드가 아직 없어서 임시로 이렇게 함).
  const itemTypesByCategory: Record<string, string[]> = {
    야채: ["무", "배추", "마늘", "양파", "양배추", "감자"],
    과일: ["사과", "배", "감", "감귤"],
  };
  const activeFilterCount =
    selectedCategories.length +
    selectedItemTypes.length +
    selectedGrades.length +
    (priceRange[1] !== Infinity ? 1 : 0);

  // 지역/검색어까지만 반영한 목록 — 필터 모달이 여기 기준으로 실시간 개수와 가격
  // 범위를 계산한다(카테고리/등급/가격은 아직 안 걸렀으므로 전체 범위가 나온다).
  const regionAndSearchFiltered = products.filter((p) => {
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
    const matchesSearch =
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.shopName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesRegion && matchesSearch;
  });

  const filteredProducts = regionAndSearchFiltered.filter((p) => {
    const matchesCategory =
      selectedCategories.length === 0
        ? true
        : selectedCategories.includes(p.category) ||
          (selectedCategories.includes("야채") && (p.category as string) === "신선야채");

    const matchesItemType =
      selectedItemTypes.length === 0
        ? true
        : selectedItemTypes.some((item) => p.title.includes(item));

    const matchesGrade =
      selectedGrades.length === 0 ? true : selectedGrades.includes(displayGrade(p.grade));

    const matchesPrice = p.price >= priceRange[0] && p.price <= priceRange[1];

    return matchesCategory && matchesItemType && matchesGrade && matchesPrice;
  });

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Sort products — "가격순"/"정확도순"은 카테고리가 섞인 피드 전체에서는 비교 자체가
  // 무의미해서(사과랑 생선 가격을 비교하는 게 의미 없음), 항상 유의미한 기준(최신순)과
  // 카테고리 안 가려도 공정한 기준(공공시세 대비 할인율순)으로 교체했다.
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    if (sortBy === "priceLow") {
      return a.price - b.price;
    }
    if (sortBy === "priceHigh") {
      return b.price - a.price;
    }
    if (sortBy === "discount") {
      const discountOf = (p: ProductItem) =>
        p.publicPrice > 0 ? (p.publicPrice - p.price) / p.publicPrice : -Infinity;
      return discountOf(b) - discountOf(a);
    }
    // latest
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <div
      className="w-full max-w-[600px] mx-auto content-pb-safe px-4 flex flex-col gap-5"
      style={{ paddingTop: "calc(5.25rem + env(safe-area-inset-top, 0px))" }}
    >
      {/* Search Input Bar */}
      <div className="relative w-full">
        <div className="bg-surface-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(0,0,0,0.05)] flex items-center px-4 h-12 transition-all focus-within:border-trust-blue focus-within:ring-1 focus-within:ring-trust-blue">
          <span className="material-symbols-outlined text-outline mr-2">search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`${selectedRegion === "전체" ? "전국" : selectedRegion} 상품명/점포명 검색`}
            className="flex-1 min-w-0 bg-transparent border-none focus:outline-none text-sm text-on-surface placeholder-outline font-medium overflow-hidden text-ellipsis"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="text-outline hover:text-on-surface">
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter / Sort Pills */}
      <section className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsFilterModalOpen(true)}
          className={`px-4 py-2 rounded-full text-sm font-extrabold flex items-center gap-1.5 transition-all active:scale-95 border ${
            activeFilterCount > 0
              ? "bg-blue-50 border-[#0052FF] text-[#0052FF]"
              : "bg-white border-[#E2E8F0] text-[#334155] hover:border-[#CBD5E1]"
          }`}
        >
          <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
            tune
          </span>
          <span>필터</span>
          {activeFilterCount > 0 && (
            <span className="w-4.5 h-4.5 min-w-[18px] rounded-full bg-[#0052FF] text-white text-[10px] font-extrabold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
            className="px-4 py-2 rounded-full text-sm font-extrabold flex items-center gap-1.5 transition-all active:scale-95 border bg-white border-[#E2E8F0] text-[#334155] hover:border-[#CBD5E1]"
          >
            <span className="material-symbols-outlined text-lg">swap_vert</span>
            <span>
              {sortBy === "latest"
                ? "최신순"
                : sortBy === "discount"
                ? "혜택순"
                : sortBy === "priceLow"
                ? "낮은가격순"
                : "높은가격순"}
            </span>
          </button>

          {isSortDropdownOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIsSortDropdownOpen(false)} />
              <div className="absolute left-0 top-full mt-1.5 w-36 bg-white rounded-xl shadow-xl border border-[#E2E8F0] py-1.5 z-50 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-150">
                {[
                  { key: "latest", label: "최신순" },
                  { key: "discount", label: "혜택순 (할인율)" },
                  { key: "priceLow", label: "낮은가격순" },
                  { key: "priceHigh", label: "높은가격순" },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setSortBy(opt.key as typeof sortBy);
                      setIsSortDropdownOpen(false);
                    }}
                    className={`px-3 py-2 text-xs font-bold text-left flex items-center justify-between transition-colors ${
                      sortBy === opt.key ? "bg-blue-50 text-[#0052FF]" : "text-[#334155] hover:bg-slate-50"
                    }`}
                  >
                    <span>{opt.label}</span>
                    {sortBy === opt.key && (
                      <span className="material-symbols-outlined text-sm text-[#0052FF]">check</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
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
          </div>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center text-xs text-outline font-medium flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-trust-blue border-t-transparent rounded-full animate-spin"></div>
            <span>실시간 인증 상품을 불러오는 중입니다...</span>
          </div>
        ) : sortedProducts.length === 0 ? (
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

                    {/* Badge: Top Right - Grade */}
                    <div className="absolute top-2 right-2 bg-slate-900/80 backdrop-blur-md text-white px-2 py-0.5 rounded-full text-[10px] font-extrabold flex items-center gap-1 shadow-md z-10 border border-white/20">
                      <span className="material-symbols-outlined text-emerald-400 text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        verified
                      </span>
                      <span>{displayGrade(product.grade)}</span>
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

                    {/* Price Section - Only Seller Price */}
                    <div className="flex items-center justify-between gap-1 pt-0.5">
                      <span className="text-base sm:text-lg font-black text-[#0F172A] tracking-tight">
                        {product.price.toLocaleString()}원
                      </span>

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
                </article>
              );
            })}
          </div>
        ) : (
          /* List View Mode */
          <div className="flex flex-col gap-3.5">
            {sortedProducts.map((product) => {
              const isBookmarked = bookmarkedProductIds.includes(product.id);

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
                      <span>{displayGrade(product.grade)}</span>
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

                    {/* Price Section - Only Seller Price */}
                    <div className="mt-2">
                      <div className="text-xl sm:text-2xl font-black text-[#0F172A] tracking-tight">
                        {product.price.toLocaleString()}
                        <span className="text-base font-bold text-[#0F172A] ml-0.5">원</span>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <ProductFilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        products={regionAndSearchFiltered}
        categories={categories}
        itemTypesByCategory={itemTypesByCategory}
        selectedCategories={selectedCategories}
        selectedItemTypes={selectedItemTypes}
        selectedGrades={selectedGrades}
        priceRange={priceRange}
        onApply={({ categories: cats, itemTypes: items, grades, priceRange: range }) => {
          setSelectedCategories(cats);
          setSelectedItemTypes(items);
          setSelectedGrades(grades);
          setPriceRange(range);
        }}
      />
    </div>
  );
};
