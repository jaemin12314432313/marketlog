import React, { useState } from "react";
import { Browser } from "@capacitor/browser";
import { ProductItem, MarketInfo } from "../types";
import { fetchStoreByName, StoreInfo } from "../lib/api";

interface ProductDetailModalProps {
  product: ProductItem | null;
  marketInfo: MarketInfo;
  onClose: () => void;
  isBookmarked: boolean;
  onToggleBookmark: (product: ProductItem) => void;
  onNavigateToMap: () => void;
  initialTab?: "description" | "shop" | "recipe";
}

interface RecipeRecommendation {
  dishTitle: string;
  cookingTime: string;
  difficulty: string;
  description: string;
  youtubeUrl: string;
  youtubeThumbnailUrl?: string;
  ingredientsList: {
    name: string;
    amount: string;
    isMain?: boolean;
  }[];
}

// 실제 품목 인식 모델이 학습한 10개 클래스(무·배추·양파·마늘·양배추·감·사과·배·감귤·감자) +
// 수산물/정육 카테고리를 전부 다루도록 구성 — 예전엔 이 중 절반 이상이 매칭되는 분기가 없어서
// "AI가 추천하는 OOO 활용 백종원 별미 레시피" 같은 어색한 범용 문구로만 빠졌었다(감자가
// 고구마 분기에 같이 묶여 "감자맛탕"으로 추천되는 것도 부자연스러운 매칭이었음).
// 영상 썸네일은 검증되지 않은 스톡사진 대신 상품 자체 사진을 그대로 써서 이미지 불일치
// 위험이 없게 했고, 유튜브는 실제로 그 영상으로 가는 게 아니라 검색 결과로 연결되므로
// "조회수/채널명"처럼 특정 영상인 척하는 정보는 보여주지 않는다.
function getRecipeRecommendation(product: ProductItem): RecipeRecommendation {
  const title = product.title;
  const category = product.category;

  const base = (
    dishTitle: string,
    cookingTime: string,
    difficulty: string,
    description: string,
    searchQuery: string,
    ingredientsList: { name: string; amount: string; isMain?: boolean }[]
  ): RecipeRecommendation => ({
    dishTitle,
    cookingTime,
    difficulty,
    description,
    youtubeUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`,
    youtubeThumbnailUrl: product.imageUrl,
    ingredientsList,
  });

  if (title.includes("갈치") || title.includes("생선") || title.includes("조기") || category === "수산물") {
    return base(
      "칼칼한 갈치조림",
      "25분",
      "보통",
      "통통한 갈치에 무와 칼칼한 양념장을 넣어 자작하게 조려내는 전통시장 대표 별미 요리입니다.",
      "갈치조림 레시피",
      [
        { name: `${title} (본 상품)`, amount: "1마리", isMain: true },
        { name: "무", amount: "1/3개 (200g)", isMain: true },
        { name: "대파 & 청양고추", amount: "각 1개", isMain: false },
        { name: "고춧가루, 간장, 마늘", amount: "양념장 재료", isMain: false },
      ]
    );
  }

  if (title.includes("무")) {
    return base(
      "시원한 소고기 뭇국",
      "20분",
      "쉬움",
      "단단하고 매끈한 무를 나박하게 썰어 소고기와 함께 맑게 끓여내는 자극없이 시원한 국물 요리입니다.",
      "소고기 뭇국 레시피",
      [
        { name: `${title} (본 상품)`, amount: "1/4개", isMain: true },
        { name: "국거리 소고기", amount: "150g", isMain: true },
        { name: "대파 & 다진마늘", amount: "약간", isMain: false },
        { name: "국간장 & 참기름", amount: "2큰술", isMain: false },
      ]
    );
  }

  // "양배추"는 "배추"를 부분 문자열로 포함하므로, 더 구체적인 양배추 분기를 먼저 검사한다.
  if (title.includes("양배추")) {
    return base(
      "아삭한 양배추 쌈밥",
      "15분",
      "쉬움",
      "부드럽게 찐 양배추 잎에 밥과 쌈장을 올려 싸먹는 담백하고 건강한 한끼 요리입니다.",
      "양배추 쌈밥 레시피",
      [
        { name: `${title} (본 상품)`, amount: "1/4통", isMain: true },
        { name: "쌈장", amount: "2큰술", isMain: true },
        { name: "밥", amount: "2공기", isMain: false },
      ]
    );
  }

  if (title.includes("배추")) {
    return base(
      "아삭한 배추 겉절이",
      "15분",
      "쉬움",
      "속이 꽉 찬 배추를 한입 크기로 썰어 매콤달콤한 양념에 바로 무쳐 먹는 자리에서 만드는 겉절이입니다.",
      "배추 겉절이 레시피",
      [
        { name: `${title} (본 상품)`, amount: "1/2포기", isMain: true },
        { name: "고춧가루", amount: "3큰술", isMain: true },
        { name: "액젓 & 다진마늘", amount: "각 1큰술", isMain: false },
        { name: "쪽파 & 통깨", amount: "약간", isMain: false },
      ]
    );
  }

  if (title.includes("양파")) {
    return base(
      "새콤달콤 양파장아찌",
      "10분 (숙성 1일)",
      "쉬움",
      "아삭한 양파를 간장물에 절여 만드는 밑반찬으로, 고기 요리와 특히 잘 어울립니다.",
      "양파장아찌 레시피",
      [
        { name: `${title} (본 상품)`, amount: "3개", isMain: true },
        { name: "간장 & 식초 & 설탕", amount: "1:1:1 비율", isMain: false },
      ]
    );
  }

  if (title.includes("마늘")) {
    return base(
      "알싸한 통마늘 장아찌",
      "15분 (숙성 2주)",
      "보통",
      "알이 굵은 통마늘을 식초 간장물에 절여 알싸한 맛을 오래 즐길 수 있는 대표 밑반찬입니다.",
      "마늘장아찌 레시피",
      [
        { name: `${title} (본 상품)`, amount: "20알", isMain: true },
        { name: "식초 & 간장 & 설탕", amount: "1:1:1 비율", isMain: false },
      ]
    );
  }

  if (title.includes("감귤") || title.includes("귤")) {
    return base(
      "상큼한 감귤청",
      "20분",
      "쉬움",
      "제철 감귤을 얇게 썰어 설탕에 재워두면 차로도, 탄산수에 타서도 즐길 수 있는 상큼한 청이 됩니다.",
      "감귤청 만들기 레시피",
      [
        { name: `${title} (본 상품)`, amount: "1kg", isMain: true },
        { name: "설탕", amount: "동량(1kg)", isMain: true },
      ]
    );
  }

  if (title.includes("감") && !title.includes("감자") && !title.includes("감귤")) {
    return base(
      "쫀득한 감말랭이",
      "30분 (건조 1주)",
      "보통",
      "단단한 감을 얇게 썰어 말리면 쫀득하고 달콤한 국민 간식 감말랭이가 됩니다.",
      "감말랭이 만들기 레시피",
      [{ name: `${title} (본 상품)`, amount: "5개", isMain: true }]
    );
  }

  if (title.includes("사과") || title.includes("배") || title.includes("샤인") || category === "과일") {
    return base(
      "아삭한 생과일 샐러드",
      "10분",
      "쉬움",
      "당도 높은 생과일을 슬라이스하여 견과류와 요거트를 곁들인 상큼 건강 디저트입니다.",
      `${title} 샐러드 레시피`,
      [
        { name: `${title} (본 상품)`, amount: "2개", isMain: true },
        { name: "견과류", amount: "1주먹 (50g)", isMain: false },
        { name: "플레인 요거트 / 꿀", amount: "3큰술", isMain: false },
      ]
    );
  }

  if (title.includes("감자")) {
    return base(
      "고소한 감자채전",
      "20분",
      "쉬움",
      "감자를 채썰어 부쳐내는 고소하고 바삭한 전으로, 간단한 간식이나 반찬으로 좋습니다.",
      "감자채전 레시피",
      [
        { name: `${title} (본 상품)`, amount: "3개", isMain: true },
        { name: "부침가루", amount: "2큰술", isMain: false },
        { name: "식용유", amount: "적당량", isMain: false },
      ]
    );
  }

  if (title.includes("고구마")) {
    return base(
      "달콤 바삭 꿀고구마 맛탕",
      "15분",
      "쉬움",
      "신선한 고구마를 바삭하게 튀겨 조청으로 코팅한 인기 간식 레시피입니다.",
      "고구마맛탕 만들기 레시피",
      [
        { name: `${title} (본 상품)`, amount: "3개", isMain: true },
        { name: "조청 or 물엿", amount: "4큰술", isMain: true },
        { name: "식용유 & 검은깨", amount: "적당량", isMain: false },
      ]
    );
  }

  if (category === "정육" || title.includes("한우") || title.includes("돼지") || title.includes("삼겹살")) {
    return base(
      "육즙 가득 단짠 소불고기",
      "20분",
      "쉬움",
      "고소하고 질 좋은 정육에 달콤 짭조름한 양념을 재워 쌈채소와 함께 즐기는 대표 요리입니다.",
      "소불고기 양념 레시피",
      [
        { name: `${title} (본 상품)`, amount: "600g", isMain: true },
        { name: "쌈채소 모둠", amount: "1팩", isMain: true },
        { name: "마늘 & 양파", amount: "각 1개", isMain: false },
      ]
    );
  }

  return base(
    `${title} 활용 레시피`,
    "15분",
    "쉬움",
    `${title}를 활용한 전통시장 신선 식재료 홈메이드 레시피입니다.`,
    `${title} 레시피`,
    [{ name: `${title} (본 상품)`, amount: "1팩", isMain: true }]
  );
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  marketInfo,
  onClose,
  isBookmarked,
  onToggleBookmark,
  onNavigateToMap,
  initialTab = "description",
}) => {
  if (!product) return null;

  const [viewMode, setViewMode] = useState<"scan" | "full">(
    product?.isScannedProduct ? "scan" : "full"
  );
  const [activeTab, setActiveTab] = useState<"description" | "shop" | "recipe">(initialTab);
  const [storeInfo, setStoreInfo] = useState<StoreInfo | null>(null);
  const [isStoreInfoLoaded, setIsStoreInfoLoaded] = useState(false);

  React.useEffect(() => {
    if (product?.isScannedProduct) {
      setViewMode("scan");
    } else {
      setViewMode("full");
    }
    setActiveTab(initialTab);
  }, [product, initialTab]);

  // 매장 정보 탭에 실제 점포 데이터(주요품목/전화/영업시간/소개)를 채운다. 아직 지도에
  // 위치를 등록하지 않은 상인의 상품이면 store가 null로 오고, 그 경우 "정보 없음"으로
  // 정직하게 보여준다 — 예전처럼 모든 점포에 똑같은 가짜 정보를 보여주지 않는다.
  React.useEffect(() => {
    setIsStoreInfoLoaded(false);
    setStoreInfo(null);
    if (!product?.shopName) {
      setIsStoreInfoLoaded(true);
      return;
    }
    fetchStoreByName(product.shopName)
      .then((res) => setStoreInfo(res.store))
      .catch((err) => console.error("점포 정보를 불러오지 못했습니다.", err))
      .finally(() => setIsStoreInfoLoaded(true));
  }, [product?.shopName]);

  const handleToggle = () => {
    onToggleBookmark(product);
  };

  const recipe = getRecipeRecommendation(product);

  if (viewMode === "scan") {
    const formattedGrade = product.grade || "A+";

    return (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
        {/* Blurred Background Image Effect */}
        <div className="absolute inset-0 z-0 overflow-hidden opacity-30 pointer-events-none">
          <img
            src={product.imageUrl}
            alt={product.title}
            className="w-full h-full object-cover blur-xl scale-110"
          />
        </div>

        {/* AI Scan Result Sheet Card */}
        <div className="bg-white w-full max-w-sm sm:max-w-md rounded-3xl p-5 sm:p-6 shadow-2xl border border-white/40 space-y-4 my-auto relative z-10 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
          
          {/* Top Badges */}
          <div className="flex items-center justify-between gap-2">
            <span className="bg-[#DBEAFE] text-[#1D4ED8] text-xs font-bold px-3 py-1 rounded-full">
              {product.category || "농산물/과일류"}
            </span>
            <span className="bg-[#DCFCE7] text-[#166534] text-xs font-extrabold px-3 py-1 rounded-full flex items-center gap-1 border border-[#10B981]/20">
              <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                verified
              </span>
              품질 등급 {formattedGrade}
            </span>
          </div>

          {/* Product Scanned Photo */}
          {product.imageUrl && (
            <div className="relative w-full h-44 sm:h-52 rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
              <img
                src={product.imageUrl}
                alt={product.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-2.5 left-2.5 bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 border border-white/20">
                <span className="material-symbols-outlined text-xs">center_focus_weak</span>
                AI 스캔 원본 이미지
              </div>
            </div>
          )}

          {/* Product Title */}
          <h2 className="text-xl sm:text-2xl font-black text-[#0F172A] leading-snug tracking-tight">
            {product.title}
          </h2>

          {/* Price Box: 공공 판매가 */}
          <div className="bg-[#F8FAFC] rounded-2xl p-4 border border-[#E2E8F0] flex items-center justify-between">
            <span className="text-xs font-bold text-[#64748B] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm text-[#0052FF]">account_balance</span>
              공공 판매가
            </span>
            <div className="text-xl font-black text-[#0F172A]">
              {product.publicPrice ? `${product.publicPrice.toLocaleString()}원` : "-"}
            </div>
          </div>

          {/* AI 정밀 분석 지표 */}
          <div className="space-y-2.5">
            <div className="text-xs font-extrabold text-[#0F172A] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base text-[#0052FF]">analytics</span>
              AI 정밀 분석 지표
            </div>
            <div className="grid grid-cols-3 gap-2 bg-[#F8FAFC] p-3 rounded-2xl border border-[#E2E8F0] text-center">
              <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
                <div className="text-[11px] font-bold text-slate-500">신선도</div>
                <div className="text-base font-black text-emerald-600 mt-0.5">
                  {product.freshnessScore ?? 98}점
                </div>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
                <div className="text-[11px] font-bold text-slate-500">결함도</div>
                <div className="text-base font-black text-blue-600 mt-0.5">
                  {product.defectScore ?? 5}점
                </div>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
                <div className="text-[11px] font-bold text-slate-500">균일도</div>
                <div className="text-base font-black text-indigo-600 mt-0.5">
                  {product.uniformityScore ?? 92}점
                </div>
              </div>
            </div>

            {/* 세부 항목별 백분율 및 프로그래스 바 */}
            <div className="space-y-2 bg-[#F8FAFC] p-3.5 rounded-2xl border border-[#E2E8F0] text-xs">
              <div>
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="font-bold text-[#334155]">신선도 (광택 / 수분도 / 신선도)</span>
                  <span className="font-black text-[#10B981]">{product.freshnessScore ?? 98}%</span>
                </div>
                <div className="w-full h-2 bg-slate-200/80 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#10B981] rounded-full transition-all duration-500"
                    style={{ width: `${product.freshnessScore ?? 98}%` }}
                  ></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="font-bold text-[#334155]">표면 무결성 (상처 / 무름 없음)</span>
                  <span className="font-black text-[#0052FF]">
                    {product.defectScore !== undefined ? Math.max(0, 100 - product.defectScore) : 95}%
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-200/80 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#0052FF] rounded-full transition-all duration-500"
                    style={{ width: `${product.defectScore !== undefined ? Math.max(0, 100 - product.defectScore) : 95}%` }}
                  ></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="font-bold text-[#334155]">크기 / 중량 균일도</span>
                  <span className="font-black text-indigo-600">{product.uniformityScore ?? 92}%</span>
                </div>
                <div className="w-full h-2 bg-slate-200/80 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                    style={{ width: `${product.uniformityScore ?? 92}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>

          {/* AI 스캔 종합 의견 */}
          <div className="space-y-1.5">
            <div className="text-xs font-extrabold text-[#0052FF] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">psychology</span>
              AI 스캔 종합 의견
            </div>
            <div className="bg-[#EFF6FF] rounded-2xl p-3.5 border border-[#BFDBFE] text-xs text-[#334155] font-medium leading-relaxed">
              {product.description || "표면 광택이 우수하고 과육 손상이 거의 없으며 공공 시세 대비 가격 및 품질 신뢰도가 매우 높습니다."}
            </div>
          </div>

          {/* Bottom Buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-[#334155] text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-base">close</span>
              닫기
            </button>

            <button
              onClick={() => {
                setActiveTab("description");
                setViewMode("full");
              }}
              className="flex-1 py-3 bg-[#0052FF] hover:bg-[#0043D6] text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">storefront</span>
              가게 정보 보기
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#F8FAFC] flex flex-col w-full h-full overflow-y-auto animate-in fade-in duration-200">
      {/* Sticky Full-Screen Top Header */}
      <header
        className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#E2E8F0] px-4 pb-3 flex items-center justify-between"
        style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-[#0F172A] flex items-center justify-center transition-colors"
            title="뒤로 가기"
          >
            <span className="material-symbols-outlined text-xl">arrow_back</span>
          </button>
          <div>
            <h1 className="text-sm sm:text-base font-extrabold text-[#0F172A] line-clamp-1">
              [{product.shopName}] {product.title}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {product.isScannedProduct && (
            <button
              onClick={() => setViewMode("scan")}
              className="px-2.5 py-1 text-xs font-extrabold text-[#0052FF] bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 flex items-center gap-1 transition-colors mr-1"
            >
              <span className="material-symbols-outlined text-sm">auto_awesome</span>
              <span className="hidden sm:inline">스캔 결과 카드</span>
              <span className="sm:hidden">스캔 카드</span>
            </button>
          )}

          <button
            onClick={handleToggle}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors border ${
              isBookmarked
                ? "bg-blue-50 border-[#BFDBFE] text-[#0052FF]"
                : "bg-white border-[#E2E8F0] text-[#64748B] hover:bg-slate-50"
            }`}
            title={isBookmarked ? "저장 취소" : "관심 상품 저장"}
          >
            <span
              className="material-symbols-outlined text-lg"
              style={{ fontVariationSettings: isBookmarked ? "'FILL' 1" : "'FILL' 0" }}
            >
              bookmark
            </span>
          </button>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-[#64748B] flex items-center justify-center transition-colors"
            title="닫기"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>
      </header>

      {/* Main Full-Screen Body */}
      <div className="flex-1 pb-10">
        {/* Full-width Hero Banner Image */}
        <div className="relative w-full h-72 sm:h-80 bg-slate-900 overflow-hidden">
          <img
            src={product.imageUrl}
            alt={product.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0F172A] via-black/20 to-transparent"></div>

          {/* AI Grade & Freshness Badges */}
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <div className="bg-[#10B981] text-white px-3 py-1 rounded-full flex items-center gap-1 shadow-md border border-white/20 text-xs font-extrabold">
              <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                verified
              </span>
              <span>최상등급 ({product.grade})</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation Bar */}
        <div className="sticky top-[53px] z-20 bg-white border-b border-[#E2E8F0] shadow-2xs">
          <div className="max-w-2xl mx-auto flex text-center font-bold text-xs sm:text-sm">
            <button
              onClick={() => setActiveTab("description")}
              className={`flex-1 py-3 border-b-2 transition-all flex items-center justify-center gap-1 ${
                activeTab === "description"
                  ? "border-[#0052FF] text-[#0052FF] font-extrabold"
                  : "border-transparent text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              <span className="material-symbols-outlined text-base">description</span>
              <span>상품설명</span>
            </button>

            <button
              onClick={() => setActiveTab("shop")}
              className={`flex-1 py-3 border-b-2 transition-all flex items-center justify-center gap-1 ${
                activeTab === "shop"
                  ? "border-[#0052FF] text-[#0052FF] font-extrabold"
                  : "border-transparent text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              <span className="material-symbols-outlined text-base">storefront</span>
              <span>가게정보</span>
            </button>

            <button
              onClick={() => setActiveTab("recipe")}
              className={`flex-1 py-3 border-b-2 transition-all flex items-center justify-center gap-1 ${
                activeTab === "recipe"
                  ? "border-[#0052FF] text-[#0052FF] font-extrabold"
                  : "border-transparent text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              <span className="material-symbols-outlined text-base">soup_kitchen</span>
              <span>레시피 추천</span>
            </button>
          </div>
        </div>

        {/* Detail Sections Container */}
        <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
          {/* TAB 1: 상품설명 (Product Description) */}
          {activeTab === "description" && (
            <div className="space-y-5 animate-in fade-in duration-200">
              {/* Product Title & Basic Info Section */}
              <div className="space-y-2 px-1 pt-1 pb-1">
                <div className="flex items-center justify-between text-xs font-bold text-[#64748B]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#0052FF] font-black text-sm">
                      {product.shopName}
                    </span>
                  </div>
                  <span className="text-[11px] font-extrabold text-[#10B981] bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-100">
                    {product.grade} 등급
                  </span>
                </div>

                <h2 className="text-xl sm:text-2xl font-black text-[#0F172A] leading-snug">
                  {product.title}
                </h2>

                <div className="text-xs text-[#64748B] font-medium flex items-center justify-between pt-0.5 pb-1">
                  <span>가게 번호: <strong className="text-[#334155]">{storeInfo?.phone || "정보 없음"}</strong></span>
                  <span className="text-[#0052FF] font-bold">{product.category}</span>
                </div>

                {/* Price Display: 실제 판매가 & 공공 판매가 */}
                <div className="bg-[#F8FAFC] rounded-2xl p-4 border border-[#E2E8F0] grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <span className="text-xs font-bold text-[#64748B] flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs text-[#0052FF]">sell</span>
                      현장가
                    </span>
                    <div className="text-xl font-black text-[#0F172A] mt-0.5">
                      {product.price ? `${product.price.toLocaleString()}원` : "-"}
                    </div>
                  </div>

                  <div>
                    <span className="text-xs font-bold text-[#64748B] flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs text-slate-500">account_balance</span>
                      공공 시장가
                    </span>
                    <div className="text-xl font-bold text-[#475569] mt-0.5">
                      {product.publicPrice ? `${product.publicPrice.toLocaleString()}원` : "-"}
                    </div>
                  </div>
                </div>
              </div>

              {/* AI Metrics Breakdown */}
              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E2E8F0] shadow-[0_2px_8px_rgba(0,0,0,0.03)] space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-extrabold text-[#0F172A] tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[#0052FF] text-base">analytics</span>
                    AI 정밀 분석 지표
                  </h3>
                  <span className="text-xs font-extrabold text-[#10B981] bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                    품질 등급 {product.grade || "A+"}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-[#F8FAFC] p-3 rounded-xl border border-[#E2E8F0] text-center">
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200/60 shadow-2xs">
                    <div className="text-[11px] font-bold text-slate-500">신선도</div>
                    <div className="text-base font-black text-emerald-600 mt-0.5">
                      {product.freshnessScore ?? 96}점
                    </div>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200/60 shadow-2xs">
                    <div className="text-[11px] font-bold text-slate-500">결함도</div>
                    <div className="text-base font-black text-blue-600 mt-0.5">
                      {product.defectScore ?? 94}점
                    </div>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200/60 shadow-2xs">
                    <div className="text-[11px] font-bold text-slate-500">균일도</div>
                    <div className="text-base font-black text-indigo-600 mt-0.5">
                      {product.uniformityScore ?? 92}점
                    </div>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <div>
                    <div className="flex justify-between items-center text-xs mb-1">
                      <span className="font-bold text-[#334155]">신선도 (광택 / 수분도 / 신선도)</span>
                      <span className="font-black text-[#10B981]">{product.freshnessScore}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#10B981] rounded-full transition-all duration-500" style={{ width: `${product.freshnessScore}%` }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center text-xs mb-1">
                      <span className="font-bold text-[#334155]">표면 결함 (상처 / 무름 무결성)</span>
                      <span className="font-black text-[#10B981]">{product.defectScore}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#10B981] rounded-full transition-all duration-500" style={{ width: `${product.defectScore}%` }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center text-xs mb-1">
                      <span className="font-bold text-[#334155]">크기 / 중량 균일도</span>
                      <span className="font-black text-[#0052FF]">{product.uniformityScore}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#0052FF] rounded-full transition-all duration-500" style={{ width: `${product.uniformityScore}%` }}></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Product AI Description & Opinion */}
              <div className="text-xs text-[#475569] bg-white p-5 rounded-2xl border border-[#E2E8F0] shadow-[0_2px_8px_rgba(0,0,0,0.03)] leading-relaxed space-y-2">
                <div className="font-extrabold text-[#0052FF] flex items-center gap-1.5 text-xs">
                  <span className="material-symbols-outlined text-base">psychology</span>
                  AI 스캔 종합 의견
                </div>
                <p className="text-slate-700 font-medium text-xs leading-relaxed">{product.description}</p>

              </div>


            </div>
          )}

          {/* TAB 2: 가게정보 (Shop Information) */}
          {activeTab === "shop" && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl p-5 border border-[#E2E8F0] shadow-[0_2px_8px_rgba(0,0,0,0.03)] space-y-4">
                <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-50 text-[#0052FF] flex items-center justify-center font-extrabold">
                      <span className="material-symbols-outlined text-xl">storefront</span>
                    </div>
                    <div>
                      <h3 className="text-base font-extrabold text-[#0F172A]">{product.shopName}</h3>
                      <p className="text-xs text-[#64748B] flex items-center gap-1 font-medium">
                        <span className="material-symbols-outlined text-xs text-[#0052FF]">location_on</span>
                        {marketInfo.name} 내 위치
                      </p>
                    </div>
                  </div>
                  {storeInfo && (
                    <span className="text-xs font-extrabold text-[#10B981] bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                      인증 상점
                    </span>
                  )}
                </div>

                {!isStoreInfoLoaded ? (
                  <div className="py-6 flex justify-center">
                    <div className="w-6 h-6 border-4 border-[#0052FF] border-t-transparent rounded-full animate-spin"></div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2 text-xs divide-y divide-[#F1F5F9]">
                      <div className="flex justify-between py-1.5">
                        <span className="text-[#64748B] font-medium">상호명</span>
                        <span className="font-extrabold text-[#0F172A]">{product.shopName}</span>
                      </div>
                      <div className="flex justify-between py-1.5">
                        <span className="text-[#64748B] font-medium">소속 전통시장</span>
                        <span className="font-extrabold text-emerald-600">{marketInfo.name}</span>
                      </div>
                      <div className="flex justify-between py-1.5">
                        <span className="text-[#64748B] font-medium">주요 품목</span>
                        <span className="font-extrabold text-[#0F172A]">{storeInfo?.subtitle || product.category}</span>
                      </div>
                      {storeInfo?.alley && (
                        <div className="flex justify-between py-1.5">
                          <span className="text-[#64748B] font-medium">골목</span>
                          <span className="font-bold text-[#334155] text-right max-w-[240px]">{storeInfo.alley}</span>
                        </div>
                      )}
                      <div className="flex justify-between py-1.5">
                        <span className="text-[#64748B] font-medium">전화번호</span>
                        {storeInfo?.phone ? (
                          <a
                            href={`tel:${storeInfo.phone}`}
                            className="font-bold text-[#0052FF] hover:underline flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-xs">call</span>
                            {storeInfo.phone}
                          </a>
                        ) : (
                          <span className="font-bold text-[#94A3B8]">정보 없음</span>
                        )}
                      </div>
                      <div className="flex justify-between py-1.5">
                        <span className="text-[#64748B] font-medium">영업시간</span>
                        <span className="font-bold text-[#334155]">{storeInfo?.hours || "정보 없음"}</span>
                      </div>
                    </div>

                    {/* Shop Description Box */}
                    <div className="bg-[#F8FAFC] rounded-xl p-3 border border-[#E2E8F0] space-y-1">
                      <span className="text-[11px] font-bold text-[#64748B] block">점포 한줄 안내 / 소개</span>
                      <p className="text-xs text-[#334155] leading-relaxed font-medium">
                        {storeInfo?.storyText || "아직 등록된 점포 소개가 없습니다."}
                      </p>
                    </div>
                  </>
                )}

                <button
                  onClick={() => {
                    onClose();
                    onNavigateToMap();
                  }}
                  className="w-full bg-[#0052FF] hover:bg-[#0043D6] text-white py-3.5 px-4 rounded-xl font-extrabold text-xs shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-lg">map</span>
                  <span>상점 위치 지도에서 확인하기</span>
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: 레시피 추천 (Recipe Recommendations) */}
          {activeTab === "recipe" && (
            <div className="bg-white rounded-2xl p-5 border border-[#E2E8F0] shadow-[0_2px_8px_rgba(0,0,0,0.03)] space-y-5 animate-in fade-in duration-200">
              {/* 1. TOP: Recipe Video Section */}
              <div className="space-y-3.5">
                <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
                      <span className="material-symbols-outlined text-xl">play_circle</span>
                    </div>
                    <div>
                      <h3 className="text-sm font-extrabold text-[#0F172A]">추천 레시피</h3>
                      <p className="text-[11px] text-[#64748B]">유튜브 검색으로 조리법을 쉽게 찾아보세요</p>
                    </div>
                  </div>
                </div>

                {/* Video Banner Card */}
                <div className="relative w-full rounded-2xl overflow-hidden border border-slate-200 bg-slate-900 group shadow-sm">
                  {recipe.youtubeThumbnailUrl ? (
                    <img
                      src={recipe.youtubeThumbnailUrl}
                      alt={recipe.dishTitle}
                      className="w-full h-44 sm:h-52 object-cover opacity-85 group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-44 sm:h-52 bg-gradient-to-tr from-slate-900 via-slate-800 to-red-950 flex items-center justify-center" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent flex flex-col justify-between p-4">
                    <div className="flex justify-end">
                      <span className="bg-red-600 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-md shadow-sm flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs">restaurant_menu</span>
                        레시피 아이디어
                      </span>
                    </div>

                    <div className="space-y-1">
                      <h4 className="text-sm sm:text-base font-black text-white leading-tight drop-shadow-md">
                        {recipe.dishTitle}
                      </h4>
                      <p className="text-[11px] text-slate-200 font-medium flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-xs">search</span>
                        <span>유튜브에서 이 레시피 검색해보기</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Direct Link Button to YouTube — 안드로이드 WebView는 target="_blank"
                    링크를 열어줄 새 탭이 없어서 그냥 아무 반응이 없다. Capacitor Browser
                    플러그인으로 외부 브라우저(커스텀 탭)를 직접 띄운다. */}
                <button
                  type="button"
                  onClick={() => Browser.open({ url: recipe.youtubeUrl })}
                  className="w-full bg-red-600 hover:bg-red-700 text-white py-3 px-4 rounded-xl font-extrabold text-xs shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">search</span>
                  <span>유튜브에서 레시피 검색하기</span>
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                </button>
              </div>

              {/* Divider */}
              <div className="border-t border-[#F1F5F9]" />

              {/* 2. Recipe Required Ingredients & Market Recommendations */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
                      <span className="material-symbols-outlined text-lg">soup_kitchen</span>
                    </div>
                    <div>
                      <h3 className="text-sm font-extrabold text-[#0F172A]">이 요리의 추천 재료</h3>
                    </div>
                  </div>
                </div>

                {/* Required Ingredients Checklist */}
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {recipe.ingredientsList.map((ing, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-1.5 font-bold text-[#0F172A]">
                          <span className={`w-2 h-2 rounded-full ${ing.isMain ? "bg-amber-500" : "bg-slate-400"}`} />
                          <span>{ing.name}</span>
                        </div>
                        <span className="text-[11px] font-extrabold text-[#64748B] bg-white px-2 py-0.5 rounded-md border border-[#E2E8F0]">
                          {ing.amount}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

