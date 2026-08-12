import React, { useState } from "react";
import { ProductItem, MarketInfo } from "../types";

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
  youtubeChannel: string;
  youtubeViews: string;
  youtubeThumbnailUrl?: string;
  ingredientsList: {
    name: string;
    amount: string;
    isMain?: boolean;
  }[];
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
      dishTitle: "칼칼한 제주 은갈치조림 백종원 황금레시피",
      cookingTime: "25분",
      difficulty: "보통",
      description: "통통한 은갈치에 달큰한 가을 무와 칼칼한 특제 양념장을 넣어 자작하게 조려내는 전통시장 대표 별미 요리입니다.",
      youtubeUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent("갈치조림 백종원 레시피")}`,
      youtubeChannel: "백종원 PAIK JONG WON",
      youtubeViews: "조회수 182만회",
      youtubeThumbnailUrl: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&w=600&q=80",
      ingredientsList: [
        { name: `${product.title} (본 상품)`, amount: "1마리", isMain: true },
        { name: "달큰한 가을 무", amount: "1/3개 (200g)", isMain: true },
        { name: "대파 & 청양고추", amount: "각 1개", isMain: false },
        { name: "특제 갈치조림 양념장", amount: "3큰술 (고춧가루, 간장, 마늘)", isMain: false },
      ],
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
      difficulty: "쉬움",
      description: "당도 높은 생과일을 슬라이스하여 고소한 견과류와 천연 꿀을 곁들인 상큼 건강 디저트입니다.",
      youtubeUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent("사과 샐러드 레시피")}`,
      youtubeChannel: "1분요리 뚝딱이형",
      youtubeViews: "조회수 94만회",
      youtubeThumbnailUrl: "https://images.unsplash.com/photo-1568569350060-e8563f522810?auto=format&fit=crop&w=600&q=80",
      ingredientsList: [
        { name: `${product.title} (본 상품)`, amount: "2개", isMain: true },
        { name: "고소한 모둠 견과류", amount: "1주먹 (50g)", isMain: false },
        { name: "지리산 천연 아카시아 꿀", amount: "2큰술", isMain: false },
        { name: "플레인 요거트 / 드레싱", amount: "3큰술", isMain: false },
      ],
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
      dishTitle: "달콤 바삭 겉바속촉 꿀고구마 맛탕 & 라떼",
      cookingTime: "15분",
      difficulty: "쉬움",
      description: "신선한 꿀고구마를 바삭하게 튀겨 쌀조청으로 코팅한 최고 인기 간식 레시피입니다.",
      youtubeUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent("고구마맛탕 만들기 레시피")}`,
      youtubeChannel: "하루한끼 DayOneMeal",
      youtubeViews: "조회수 230만회",
      youtubeThumbnailUrl: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=600&q=80",
      ingredientsList: [
        { name: `${product.title} (본 상품)`, amount: "3개", isMain: true },
        { name: "전통 수제 쌀조청", amount: "4큰술", isMain: true },
        { name: "식용유 & 검은깨", amount: "적당량", isMain: false },
        { name: "신선한 목장 우유", amount: "200ml", isMain: false },
      ],
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
      dishTitle: "구수한 향이 가득한 모둠 표고버섯 솥밥",
      cookingTime: "30분",
      difficulty: "보통",
      description: "윤기 나는 햅쌀에 향긋한 표고버섯과 수제 양념간장을 비벼 먹는 영양 만점 솥밥입니다.",
      youtubeUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent("표고버섯 솥밥 레시피")}`,
      youtubeChannel: "이연복의 복주머니",
      youtubeViews: "조회수 115만회",
      youtubeThumbnailUrl: "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=600&q=80",
      ingredientsList: [
        { name: `${product.title} (본 상품)`, amount: "2컵", isMain: true },
        { name: "산지직송 생 표고버섯", amount: "4개", isMain: true },
        { name: "전통 수제 비빔양념장", amount: "2큰술", isMain: false },
        { name: "다시마 육수", amount: "2컵", isMain: false },
      ],
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
      dishTitle: "육즙 가득 단짠 소불고기 황금 양념 공식",
      cookingTime: "20분",
      difficulty: "쉬움",
      description: "고소하고 질 좋은 정육에 달콤 짭조름한 양념을 재워 싱싱한 쌈채소와 함께 즐기는 대표 요리입니다.",
      youtubeUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent("소불고기 양념 백종원 레시피")}`,
      youtubeChannel: "백종원 PAIK JONG WON",
      youtubeViews: "조회수 310만회",
      youtubeThumbnailUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=600&q=80",
      ingredientsList: [
        { name: `${product.title} (본 상품)`, amount: "600g", isMain: true },
        { name: "갓 따온 싱싱 쌈채소 모둠", amount: "1팩", isMain: true },
        { name: "국산 마늘 & 양파", amount: "각 1개", isMain: false },
        { name: "특제 소불고기 양념장", amount: "5큰술", isMain: false },
      ],
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
    dishTitle: `${product.title} 활용 백종원 별미 레시피`,
    cookingTime: "15분",
    difficulty: "쉬움",
    description: `AI가 추천하는 ${product.title}와 전통시장 신선 식재료를 결합한 최고의 홈메이드 레시피입니다.`,
    youtubeUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(product.title + " 레시피")}`,
    youtubeChannel: "백종원의 요리비책",
    youtubeViews: "조회수 150만회",
    youtubeThumbnailUrl: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=600&q=80",
    ingredientsList: [
      { name: `${product.title} (본 상품)`, amount: "1팩", isMain: true },
      { name: "산지직송 신선 야채 모둠", amount: "1팩", isMain: false },
      { name: "전통방앗간 특제 만능양념", amount: "2큰술", isMain: false },
    ],
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
  initialTab = "description",
}) => {
  if (!product) return null;

  const [viewMode, setViewMode] = useState<"scan" | "full">(
    product?.isScannedProduct ? "scan" : "full"
  );
  const [activeTab, setActiveTab] = useState<"description" | "shop" | "recipe">(initialTab);

  React.useEffect(() => {
    if (product?.isScannedProduct) {
      setViewMode("scan");
    } else {
      setViewMode("full");
    }
    setActiveTab(initialTab);
  }, [product, initialTab]);

  const handleToggle = () => {
    onToggleBookmark(product);
  };

  const recipe = getRecipeRecommendation(product);

  if (viewMode === "scan") {
    const formattedGrade = product.grade
      ? product.grade.replace(/Trafficlight|SAFE|CAUTION|ALERT/gi, "").trim() || "A+"
      : "A+";

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
                  <span>가게 번호: <strong className="text-[#334155]">{product.phone || "062-360-7000"}</strong></span>
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
                    품질 등급 {product.grade.replace(/Trafficlight|SAFE|CAUTION|ALERT/gi, "").trim() || "A+"}
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
                  <span className="text-xs font-extrabold text-[#10B981] bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                    인증 상점
                  </span>
                </div>

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
                    <span className="font-extrabold text-[#0F172A]">{product.category}</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-[#64748B] font-medium">점포 위치 / 호수</span>
                    <span className="font-bold text-[#334155] text-right max-w-[240px]">
                      {marketInfo.name} A동 수산/식자재 라인
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-[#64748B] font-medium">전화번호</span>
                    <a href={`tel:${product.phone || "062-360-7000"}`} className="font-bold text-[#0052FF] hover:underline flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">call</span>
                      {product.phone || "062-360-7000"}
                    </a>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-[#64748B] font-medium">영업시간</span>
                    <span className="font-bold text-[#334155]">08:00 - 20:00 (연중무휴)</span>
                  </div>
                </div>

                {/* Shop Description Box */}
                <div className="bg-[#F8FAFC] rounded-xl p-3 border border-[#E2E8F0] space-y-1">
                  <span className="text-[11px] font-bold text-[#64748B] block">점포 한줄 안내 / 소개</span>
                  <p className="text-xs text-[#334155] leading-relaxed font-medium">
                    매일 아침 산지에서 신선한 식자재를 직접 엄선해 정직한 가격으로 판매합니다.
                  </p>
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
            <div className="bg-white rounded-2xl p-5 border border-[#E2E8F0] shadow-[0_2px_8px_rgba(0,0,0,0.03)] space-y-5 animate-in fade-in duration-200">
              {/* 1. TOP: Recipe Video Section */}
              <div className="space-y-3.5">
                <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
                      <span className="material-symbols-outlined text-xl">play_circle</span>
                    </div>
                    <div>
                      <h3 className="text-sm font-extrabold text-[#0F172A]">추천 레시피 영상</h3>
                      <p className="text-[11px] text-[#64748B]">영상을 통해 레시피 조리법을 쉽게 확인하세요</p>
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
                        <span className="material-symbols-outlined text-xs">play_arrow</span>
                        영상 레시피
                      </span>
                    </div>

                    <div className="space-y-1">
                      <h4 className="text-sm sm:text-base font-black text-white leading-tight drop-shadow-md">
                        {recipe.dishTitle}
                      </h4>
                      <p className="text-[11px] text-slate-200 font-medium flex items-center gap-2">
                        <span className="text-red-400 font-bold">{recipe.youtubeChannel}</span>
                        <span>•</span>
                        <span>{recipe.youtubeViews}</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Direct Link Button to YouTube */}
                <a
                  href={recipe.youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-red-600 hover:bg-red-700 text-white py-3 px-4 rounded-xl font-extrabold text-xs shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">play_circle</span>
                  <span>유튜브에서 영상 보며 요리하기</span>
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                </a>
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

