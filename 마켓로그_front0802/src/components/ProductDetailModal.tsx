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

interface RecipeRecommendation {
  dishTitle: string;
  cookingTime: string;
  difficulty: string;
  description: string;
  linkedIngredients: {
    icon: string;
    title: string;
    shopName: string;
    distance: string;
    discountTag?: string;
  }[];
  routeSummary: string;
  totalDistanceTime: string;
}

function getRecipeRecommendation(product: ProductItem): RecipeRecommendation {
  const title = product.title;
  const category = product.category;
  const shopName = product.shopName;

  if (title.includes("갈치") || title.includes("생선") || title.includes("조기") || category === "수산물") {
    return {
      dishTitle: "칼칼한 제주 은갈치조림",
      cookingTime: "25분",
      difficulty: "쉬움",
      description: "통통한 은갈치에 달큰한 가을 무와 칼칼한 특제 양념장을 넣어 조려내는 전통시장 대표 별미 요리입니다.",
      linkedIngredients: [
        {
          icon: "skillet",
          title: "달큰한 가을 무",
          shopName: "호남야채",
          distance: "40m",
          discountTag: "15% 할인쿠폰",
        },
        {
          icon: "soup_kitchen",
          title: "특제 갈치조림 양념장",
          shopName: "남도방앗간",
          distance: "20m",
          discountTag: "1,000원 할인",
        },
      ],
      routeSummary: `${shopName}(갈치) ➔ 호남야채(가을무) ➔ 남도방앗간(조림양념)`,
      totalDistanceTime: "총 도보 2분 코스",
    };
  }

  if (title.includes("사과") || title.includes("배") || title.includes("샤인") || category === "과일") {
    return {
      dishTitle: "아삭한 부사 사과 샐러드 & 수제 에이드",
      cookingTime: "10분",
      difficulty: "매우 쉬움",
      description: "당도 높은 생과일을 슬라이스하여 고소한 견과류와 천연 꿀을 곁들인 상큼 건강 디저트입니다.",
      linkedIngredients: [
        {
          icon: "nutrition",
          title: "고소한 모둠 견과류",
          shopName: "중앙건어물",
          distance: "",
          discountTag: "10% 할인",
        },
        {
          icon: "local_cafe",
          title: "지리산 천연 아카시아 꿀",
          shopName: "남도벌꿀",
          distance: "",
          discountTag: "2,000원 할인",
        },
      ],
      routeSummary: `${shopName}(과일) ➔ 중앙건어물(견과류) ➔ 남도벌꿀(천연꿀)`,
      totalDistanceTime: "총 도보 2분 코스",
    };
  }

  if (title.includes("고구마") || title.includes("감자")) {
    return {
      dishTitle: "달콤 바삭 꿀고구마 맛탕 & 고구마 라떼",
      cookingTime: "15분",
      difficulty: "쉬움",
      description: "신선한 꿀고구마를 튀겨 쌀조청으로 코팅한 간식과 따뜻한 우유 라떼 레시피입니다.",
      linkedIngredients: [
        {
          icon: "liquor",
          title: "전통 수제 쌀조청",
          shopName: "떡골목방앗간",
          distance: "",
          discountTag: "500원 할인",
        },
        {
          icon: "water_drop",
          title: "신선한 목장 유기농 우유",
          shopName: "남도유업",
          distance: "",
          discountTag: "10% 할인",
        },
      ],
      routeSummary: `${shopName}(고구마) ➔ 떡골목방앗간(쌀조청) ➔ 남도유업(우유)`,
      totalDistanceTime: "총 도보 2분 코스",
    };
  }

  if (title.includes("쌀") || title.includes("잡곡") || title.includes("메뚜기")) {
    return {
      dishTitle: "갓 지은 모둠 표고버섯 솥밥",
      cookingTime: "30분",
      difficulty: "보통",
      description: "윤기 나는 햅쌀에 향긋한 표고버섯과 수제 양념간장을 비벼 먹는 영양 만점 솥밥입니다.",
      linkedIngredients: [
        {
          icon: "potted_plant",
          title: "산지직송 생 표고버섯",
          shopName: "산지야채",
          distance: "",
          discountTag: "20% 할인",
        },
        {
          icon: "cooking",
          title: "전통 수제 비빔양념장",
          shopName: "전통방앗간",
          distance: "",
          discountTag: "500원 할인",
        },
      ],
      routeSummary: `${shopName}(햅쌀) ➔ 산지야채(표고버섯) ➔ 전통방앗간(양념장)`,
      totalDistanceTime: "총 도보 1분 30초 코스",
    };
  }

  if (category === "정육" || title.includes("한우") || title.includes("돼지") || title.includes("삼겹살")) {
    return {
      dishTitle: "육즙 가득 소불고기 & 싱싱 쌈채소 모둠",
      cookingTime: "20분",
      difficulty: "쉬움",
      description: "고소하고 질 좋은 정육에 달콤 짭조름한 양념을 재워 싱싱한 쌈채소와 함께 즐기는 건강 밥상입니다.",
      linkedIngredients: [
        {
          icon: "eco",
          title: "갓 따온 싱싱 쌈채소 모둠",
          shopName: "자연야채",
          distance: "",
          discountTag: "10% 할인",
        },
        {
          icon: "soup_kitchen",
          title: "국산 마늘 & 다진 양념",
          shopName: "남도마늘상회",
          distance: "",
          discountTag: "500원 할인",
        },
      ],
      routeSummary: `${shopName}(정육) ➔ 자연야채(쌈채소) ➔ 남도마늘상회(양념)`,
      totalDistanceTime: "총 도보 1분 50초 코스",
    };
  }

  return {
    dishTitle: `${product.title} 연계 추천 요리`,
    cookingTime: "15분",
    difficulty: "쉬움",
    description: `AI가 추천하는 ${product.title}와 전통시장 신선 식재료를 결합한 별미 레시피입니다.`,
    linkedIngredients: [
      {
        icon: "eco",
        title: "산지직송 신선 야채 모둠",
        shopName: "호남야채",
        distance: "",
        discountTag: "10% 할인",
      },
      {
        icon: "restaurant",
        title: "전통방앗간 특제 양념",
        shopName: "남도양념",
        distance: "",
        discountTag: "500원 할인",
      },
    ],
    routeSummary: `${shopName} ➔ 호남야채 ➔ 남도양념`,
    totalDistanceTime: "총 도보 2분 코스",
  };
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

  const [activeTab, setActiveTab] = useState<"description" | "shop" | "recipe">("description");

  const handleToggle = () => {
    onToggleBookmark(product);
  };

  const recipe = getRecipeRecommendation(product);

  return (
    <div className="fixed inset-0 z-50 bg-[#F8FAFC] flex flex-col w-full h-full overflow-y-auto animate-in fade-in duration-200">
      {/* Sticky Full-Screen Top Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#E2E8F0] px-4 py-3 flex items-center justify-between">
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
            <p className="text-[11px] text-[#64748B] font-medium flex items-center gap-1">
              <span className="material-symbols-outlined text-xs text-[#0052FF]" style={{ fontVariationSettings: "'FILL' 1" }}>
                verified
              </span>
              AI 정밀 검증 상품 상세
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
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
              <span>최상등급 (AI {product.grade})</span>
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
                    AI {product.grade} 등급
                  </span>
                </div>

                <h2 className="text-xl sm:text-2xl font-black text-[#0F172A] leading-snug">
                  {product.title}
                </h2>

                <div className="text-xs text-[#64748B] font-medium flex items-center justify-between pt-0.5 pb-1">
                  <span>원산지: <strong className="text-[#334155]">국산 (전통시장 산지직송)</strong></span>
                  <span className="text-[#0052FF] font-bold">{product.category}</span>
                </div>

                {/* Price Display */}
                <div className="pt-2 space-y-1">
                  {/* Row 1: 전국 공공 시세 가격 */}
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold text-[#94A3B8]">
                      {product.publicPrice.toLocaleString()}원
                    </span>
                    <span className="text-xs font-bold text-[#64748B]">전국 공공 시세 가격</span>
                  </div>

                  {/* Row 2: 오늘의 판매가 */}
                  <div className="flex items-center justify-between pt-0.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl sm:text-3xl font-black text-[#0F172A]">
                        {product.price.toLocaleString()}원
                      </span>
                      <span className="text-sm font-extrabold text-[#0052FF]">오늘의 판매가</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* AI Metrics Breakdown */}
              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E2E8F0] shadow-[0_2px_8px_rgba(0,0,0,0.03)] space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-extrabold text-[#64748B] uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[#0052FF] text-base">analytics</span>
                    AI 정밀 분석 지표
                  </h3>
                  <span className="text-xs font-extrabold text-[#10B981] bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                    AI {product.grade} 등급
                  </span>
                </div>

                <div className="space-y-3.5 pt-1">
                  <div>
                    <div className="flex justify-between items-center text-xs mb-1.5">
                      <span className="font-bold text-[#334155]">신선도 (광택 / 수분도 / 신선도)</span>
                      <span className="font-black text-[#10B981]">{product.freshnessScore}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#10B981] rounded-full transition-all duration-500" style={{ width: `${product.freshnessScore}%` }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center text-xs mb-1.5">
                      <span className="font-bold text-[#334155]">표면 결함 (상처 / 무름 무결성)</span>
                      <span className="font-black text-[#10B981]">{product.defectScore}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#10B981] rounded-full transition-all duration-500" style={{ width: `${product.defectScore}%` }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center text-xs mb-1.5">
                      <span className="font-bold text-[#334155]">크기 / 중량 균일도</span>
                      <span className="font-black text-[#0052FF]">{product.uniformityScore}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#0052FF] rounded-full transition-all duration-500" style={{ width: `${product.uniformityScore}%` }}></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Product AI Description & Opinion */}
              <div className="text-xs text-[#475569] bg-white p-5 rounded-2xl border border-[#E2E8F0] shadow-[0_2px_8px_rgba(0,0,0,0.03)] leading-relaxed space-y-2">
                <div className="font-extrabold text-[#0052FF] flex items-center gap-1.5 text-xs">
                  <span className="material-symbols-outlined text-base">auto_awesome</span>
                  AI 카메라 스캔 검증 종합 의견
                </div>
                <p className="text-slate-700 font-medium text-xs leading-relaxed">{product.description}</p>
                <div className="pt-2 border-t border-[#F1F5F9] text-[11px] text-[#64748B] flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs text-[#0052FF]">check_circle</span>
                  <span>최종 스캔 일시: 오늘 {product.timeAgo} 검증 완료</span>
                </div>
              </div>

              {/* Warranty Stamp */}
              <div className="py-3 px-4 bg-white border border-[#E2E8F0] rounded-2xl flex items-center justify-center gap-2 text-xs font-bold text-[#64748B]">
                <span className="material-symbols-outlined text-[#0052FF] text-base" style={{ fontVariationSettings: "'FILL' 1" }}>
                  security
                </span>
                <span>농림축산식품부 공공데이터 연동 인증 상품</span>
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
                  <span className="text-xs font-extrabold text-[#10B981] bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                    인증 상점
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-[#64748B] font-bold">소재지</span>
                    <span className="text-[#0F172A] font-extrabold">{marketInfo.name} A동 수산/식자재 라인</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-[#64748B] font-bold">영업시간</span>
                    <span className="text-[#0F172A] font-extrabold">매일 07:00 ~ 20:00 (연중무휴)</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-[#64748B] font-bold">주요 취급품목</span>
                    <span className="text-[#0F172A] font-extrabold">{product.category} 및 제철 신선 식자재</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-[#64748B] font-bold">원산지 정보</span>
                    <span className="text-[#0052FF] font-extrabold">100% 국산 산지직송 / 자율 원산지 표기</span>
                  </div>
                </div>

                <div className="bg-[#F8FAFC] p-3.5 rounded-xl border border-[#E2E8F0] space-y-2">
                  <div className="text-xs font-extrabold text-[#0F172A] flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm text-[#0052FF]">credit_card</span>
                    결제 지원 및 혜택
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[11px] font-extrabold text-[#0052FF] bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-lg">
                      지류 온누리상품권
                    </span>
                    <span className="text-[11px] font-extrabold text-[#0052FF] bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-lg">
                      모바일 온누리 (10% 할인)
                    </span>
                    <span className="text-[11px] font-extrabold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
                      제로페이 / 카카오페이
                    </span>
                  </div>
                </div>

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
            <div className="space-y-5 animate-in fade-in duration-200">
              {/* Recipe Header Card */}
              <div className="bg-white rounded-2xl p-5 border border-[#E2E8F0] shadow-[0_2px_8px_rgba(0,0,0,0.03)] space-y-4">
                <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
                      <span className="material-symbols-outlined text-lg">soup_kitchen</span>
                    </div>
                    <div>
                      <h3 className="text-sm font-extrabold text-[#0F172A]">이 식재료 추천 요리 & 연계 구매</h3>
                      <p className="text-[11px] text-[#64748B]">함께 사면 더 맛있는 전통시장 조화 추천</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-extrabold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
                    AI 요리 연계
                  </span>
                </div>

                {/* Recipe Dish Header */}
                <div className="bg-[#F8FAFC] rounded-xl p-4 border border-[#E2E8F0] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-base font-black text-[#0F172A]">{recipe.dishTitle}</span>
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#64748B]">
                      <span className="bg-white border border-[#E2E8F0] px-2.5 py-1 rounded-md flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-xs">schedule</span> {recipe.cookingTime}
                      </span>
                      <span className="bg-white border border-[#E2E8F0] px-2.5 py-1 rounded-md">
                        난이도: {recipe.difficulty}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-[#475569] leading-relaxed font-medium">{recipe.description}</p>
                </div>

                {/* Linked Ingredients List */}
                <div className="space-y-2">
                  <div className="text-xs font-extrabold text-[#0F172A] flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm text-[#0052FF]">add_shopping_cart</span>
                    인근 상점 연계 재료 (함께 장보기)
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {recipe.linkedIngredients.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-white rounded-xl border border-[#E2E8F0] flex items-center justify-between gap-2 shadow-2xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#0052FF] flex items-center justify-center flex-shrink-0">
                            <span className="material-symbols-outlined text-base">{item.icon}</span>
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[#0F172A] truncate">{item.title}</div>
                            <div className="text-[11px] text-[#64748B]">
                              {item.shopName}
                            </div>
                          </div>
                        </div>
                        {item.discountTag && (
                          <span className="text-[10px] font-extrabold text-[#0052FF] bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full flex-shrink-0">
                            {item.discountTag}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Recommended Route & View Store */}
              <div className="bg-white rounded-2xl p-5 border-2 border-[#0052FF]/20 shadow-[0_2px_8px_rgba(0,82,255,0.06)] space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-blue-50 text-[#0052FF] flex items-center justify-center">
                      <span className="material-symbols-outlined text-lg">alt_route</span>
                    </div>
                    <div>
                      <h3 className="text-sm font-extrabold text-[#0F172A]">추천 장보기 이동 동선</h3>
                      <p className="text-[11px] text-[#64748B]">원스톱 통합 방문 코스 안내</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-extrabold text-[#0052FF] bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100">
                    최적 동선
                  </span>
                </div>

                {/* Route Flowchart Visualization */}
                <div className="bg-[#F8FAFC] rounded-xl p-3.5 border border-[#E2E8F0] space-y-2">
                  <div className="text-xs font-bold text-[#334155] flex items-center justify-between">
                    <span>동선 코스 요약</span>
                    <span className="text-[#0052FF] font-extrabold">{recipe.totalDistanceTime}</span>
                  </div>
                  <div className="text-xs font-semibold text-[#0F172A] bg-white p-2.5 rounded-lg border border-[#E2E8F0] leading-snug">
                    {recipe.routeSummary}
                  </div>
                </div>

                <button
                  onClick={() => {
                    onClose();
                    onNavigateToMap();
                  }}
                  className="w-full bg-[#0052FF] hover:bg-[#0043D6] text-white py-3.5 px-4 rounded-xl font-extrabold text-xs shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-lg">map</span>
                  <span>추천 이동 동선 및 상점 지도 보기</span>
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

