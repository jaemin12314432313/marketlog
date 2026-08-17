import React, { useState } from "react";
import { ProductItem, MarketInfo } from "../types";
import { UserRole } from "./LoginModal";
import { ProductFilterModal } from "./ProductFilterModal";

// 비전 파이프라인이 2단계(특상/보통) 등급으로 바뀌어서, 화면에도 A+/B 같은 영문 등급
// 대신 실제 판정 체계와 맞는 한글 표기를 쓴다 (데이터 자체는 여전히 A+/B 등 문자로 저장됨).
function displayGrade(grade: string): string {
  return grade === "A+" ? "특상" : "보통";
}

// product.timeAgo는 등록 시점에 박제된 고정 문자열("방금 전 등록" 등)이라 시간이 지나도
// 안 바뀐다 — 실제 경과 시간은 createdAt(진짜 타임스탬프)에서 매번 다시 계산해야 한다.
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

// 할인율순 정렬 기준(공공 시세 대비 할인율)과 동일한 계산인데, 정작 카드에는 안 보여서
// 정렬을 해야만 알 수 있었다 — 가격 옆에 직접 표시한다. 공공가 정보가 없거나(publicPrice
// 0 이하) 오히려 더 비싸면(마이너스 할인) 뱃지를 아예 숨긴다.
function discountPercent(product: ProductItem): number | null {
  if (!product.publicPrice || product.publicPrice <= 0) return null;
  const percent = Math.round(((product.publicPrice - product.price) / product.publicPrice) * 100);
  return percent > 0 ? percent : null;
}

// 원산지/단위를 따로따로 뱃지로 흩어놓는 대신, "[국내산 해남] 알배기 배추 1포기"처럼
// 하나의 자연스러운 문장으로 합쳐서 보여준다 — 저장은 "국내산 · 완도"처럼 가운뎃점으로
// 하지만 화면엔 공백으로 이어붙인다.
function formatProductDisplayTitle(product: ProductItem): string {
  const originLabel = product.origin ? product.origin.replace(" · ", " ") : "";
  const originPart = originLabel ? `[${originLabel}] ` : "";
  const unitPart = product.unit ? ` ${product.unit}` : "";
  return `${originPart}${product.title}${unitPart}`;
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

  const categories = ["야채", "과일", "정육", "수산물", "건어물"];
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
      const regionShort = selectedRegion
        .replace("특별자치시", "")
        .replace("특별자치도", "")
        .replace("통합특별시", "")
        .replace("광역시", "")
        .replace("특별시", "")
        .replace("도", "");
      matchesRegion = Boolean(
        p.region === selectedRegion ||
        (p.region && p.region.includes(regionShort)) ||
        // 양동시장 데이터는 region이 옛 행정구역명("광주광역시")으로 저장돼 있어서, 통합
        // 이후 명칭("전남광주통합특별시")을 골라도 그대로 매칭되게 해준다.
        (selectedRegion === "전남광주통합특별시" &&
          (p.marketId === "yangdong" || p.region === "광주광역시" || p.region === "전라남도")) ||
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
      style={{ paddingTop: "calc(5.5rem + env(safe-area-inset-top, 0px))" }}
    >
      {/* Search Input Bar */}
      <div className="relative w-full">
        <div className="bg-surface-white rounded-xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(0,0,0,0.05)] flex items-center px-4 h-12 transition-all focus-within:border-trust-blue focus-within:ring-1 focus-within:ring-trust-blue">
          <span className="material-symbols-outlined text-outline mr-2">search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="상품명/점포명 검색"
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
                ? "할인율순"
                : sortBy === "priceLow"
                ? "낮은가격순"
                : "높은가격순"}
            </span>
          </button>

          {isSortDropdownOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setIsSortDropdownOpen(false)} />
              <div className="absolute left-0 top-full mt-1.5 w-52 bg-white rounded-xl shadow-xl border border-[#E2E8F0] py-1.5 z-50 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-150">
                {[
                  { key: "latest", label: "최신순" },
                  { key: "discount", label: "공공시세 대비 할인율순" },
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
            <span>AI 스캔 인증 상품</span>
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
            <span>AI 스캔 인증 상품을 불러오는 중입니다...</span>
          </div>
        ) : sortedProducts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 text-center text-xs text-outline font-medium flex flex-col items-center gap-2">
            <span>
              {selectedRegion === "전체"
                ? "검색 결과와 일치하는 전통시장 인증 상품이 없습니다."
                : `[${selectedRegion}] 지역에 해당 조건의 AI 스캔 인증 상품이 아직 없습니다.`}
            </span>
          </div>
        ) : viewMode === "grid" ? (
          /* 2-Column Grid Layout (matching reference market mall style) */
          <div className="grid grid-cols-2 gap-3 sm:gap-4 items-start">
            {sortedProducts.map((product) => {
              const isBookmarked = bookmarkedProductIds.includes(product.id);
              const relativeTime = formatRelativeTime(product.createdAt);

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
                    <div
                      className={`absolute top-2 right-2 text-white px-2 py-0.5 rounded-full text-[10px] font-extrabold flex items-center gap-1 shadow-md z-10 border border-white/20 ${
                        product.grade.startsWith("A") ? "bg-[#00C875]" : "bg-[#0052FF]"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        verified
                      </span>
                      <span>{displayGrade(product.grade)}</span>
                    </div>
                  </div>

                  {/* Card Content Below Image */}
                  <div className="pt-2.5 pb-1 px-0.5 flex flex-col space-y-0.5">
                    {/* Shop Name (top line) + Title (below) */}
                    <div>
                      <p className="text-[11px] font-black text-[#0052FF] truncate leading-tight">{product.shopName}</p>
                      <h3 className="text-xs sm:text-sm font-extrabold text-[#0F172A] leading-snug line-clamp-2 group-hover:text-[#0052FF] transition-colors mt-0.5">
                        {formatProductDisplayTitle(product)}
                      </h3>
                      {relativeTime && (
                        <p className="text-[11px] text-[#94A3B8] font-medium leading-tight mt-0.5">{relativeTime}</p>
                      )}
                    </div>

                    {/* Price Section - Only Seller Price */}
                    <div className="flex items-center justify-between gap-1">
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-1 whitespace-nowrap leading-none">
                          {discountPercent(product) !== null && (
                            <span className="text-[#0052FF] font-black text-sm sm:text-base">
                              {discountPercent(product)}%
                            </span>
                          )}
                          <span className="text-base sm:text-lg font-black text-[#0F172A] tracking-tight">
                            {product.price.toLocaleString()}원
                          </span>
                        </div>
                        {discountPercent(product) !== null && (
                          <span className="block text-[10px] font-bold text-[#94A3B8] mt-0.5 leading-tight">
                            공공시세 대비 저렴
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
                </article>
              );
            })}
          </div>
        ) : (
          /* List View Mode */
          <div className="flex flex-col gap-3.5">
            {sortedProducts.map((product) => {
              const isBookmarked = bookmarkedProductIds.includes(product.id);
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
                        <div>
                          <p className="text-xs font-black text-[#0052FF] truncate">{product.shopName}</p>
                          <h3 className="text-sm sm:text-base font-extrabold text-[#0F172A] leading-snug line-clamp-2 group-hover:text-[#0052FF] transition-colors mt-0.5">
                            {formatProductDisplayTitle(product)}
                          </h3>
                          {relativeTime && (
                            <p className="text-[11px] text-[#94A3B8] font-medium mt-0.5">{relativeTime}</p>
                          )}
                        </div>
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
