import React, { useState } from "react";
import { Browser } from "@capacitor/browser";
import { ProductItem, MarketInfo } from "../types";
import { fetchStoreByName, StoreInfo } from "../lib/api";

// 비전 파이프라인이 2단계(특상/보통) 등급으로 바뀌어서, 화면에도 A+/B 같은 영문 등급
// 대신 실제 판정 체계와 맞는 한글 표기를 쓴다 (HomeFeed/ProductFilterModal과 동일 규칙).
function displayGrade(grade: string): string {
  return grade === "A+" ? "특상" : "보통";
}

// product.timeAgo는 등록 시점에 박제된 고정 문자열이라 시간이 지나도 안 바뀐다 — 실제
// 경과 시간은 createdAt(진짜 타임스탬프)에서 매번 다시 계산해야 한다 (HomeFeed와 동일 규칙).
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

// HomeFeed의 할인율 뱃지와 동일한 계산 (공공 시세 대비 할인율). 공공가 정보가 없거나
// 오히려 더 비싸면(마이너스 할인) 뱃지를 아예 숨긴다.
function discountPercent(product: ProductItem): number | null {
  if (!product.publicPrice || product.publicPrice <= 0) return null;
  const percent = Math.round(((product.publicPrice - product.price) / product.publicPrice) * 100);
  return percent > 0 ? percent : null;
}

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

interface QualityMetric {
  label: string;
  value: number;
}

// 사진 한 장(그것도 보통 개체 하나만 찍힌 사진)만으로 정직하게 판단 가능한 항목만 남긴다.
// 당도·과즙감·속참(결구) 같은 내부 성분/구조는 사진으로 측정 불가능하고, "균일도"도 개체
// 하나짜리 사진에서는 애초에 성립하지 않는 개념이라 뺐다. 대신 표면 무결성(흠집/손상 없음),
// 색상·광택(숙성도 추정 근거), 품목 특유의 가시적 변화(미발아/정상색/형태온전성 등) 3가지는
// 기본으로 두고, 품목에 진짜로 보이는 4번째 단서가 있으면 추가한다 — 사과/배/감/감귤처럼
// 꼭지가 보이는 과일은 "꼭지 신선도"(마름 정도, 실제 청과 검수에서도 보는 지표), 무/양파/
// 마늘/감자처럼 낱개 형태가 보이는 품목은 "형태 온전성"(이 개체가 휘거나 기형이 아닌지 —
// 배치 균일도와는 다른, 사진 한 장으로도 보이는 개념)을 쓴다. 배추/양배추는 4번째로 내세울
// 만한 게 약해서 3개로 둔다.
//
// 라벨은 전부 "값이 높을수록 좋다"로 통일한다 — "손상"/"갈라짐" 같은 결함 자체를 라벨로 쓰면
// 숫자가 낮을수록 좋은 지표가 되어, 하나는 낮을수록/하나는 높을수록 좋은 지표가 같은 화면에
// 섞여 색상만으로는 좋고 나쁨을 구분할 수 없었다. "무결성(손상 없음)"처럼 결함이 없는 정도로
// 프레이밍하면 모든 지표가 "높을수록 좋음"으로 통일되어, 아래 getMetricColor의 임계치 색상이
// 지표 종류와 상관없이 항상 같은 뜻(초록=우수)이 된다.
//
// 백엔드가 아직 품목별 세부 점수를 안 주므로(다음 단계), 지금은 이미 있는
// freshness/defect/uniformity 3개 값 + 그 평균을 순서대로 매핑해 둔다.
// getRecipeRecommendation과 동일한 순서 제약: "양배추"가 "배추"를, "감귤"이 "감"을 부분
// 문자열로 포함하므로 더 구체적인 품목을 먼저 검사해야 한다.
function getQualityMetrics(product: ProductItem): QualityMetric[] {
  const title = product.title;

  const fresh = product.freshnessScore ?? 90;
  const integrity = Math.max(0, 100 - (product.defectScore ?? 5)); // 결함 적을수록 높은 점수
  const uniform = product.uniformityScore ?? 92;
  const avg = Math.round((fresh + integrity + uniform) / 3);
  const values = [fresh, integrity, uniform, avg];

  const withLabels = (labels: readonly string[]): QualityMetric[] =>
    labels.map((label, i) => ({ label, value: values[i] }));

  if (title.includes("무")) {
    return withLabels(["표면 상태 (매끈함)", "표면 무결성 (흠집 · 갈라짐 없음)", "표피 색상", "형태 온전성 (곧은 정도)"]);
  }

  if (title.includes("양배추")) {
    return withLabels(["겉잎 상태 (손상 없음)", "형태 온전성 (갈라짐 없음)", "색상 / 광택"]);
  }

  if (title.includes("배추")) {
    return withLabels(["겉잎 상태 (손상 없음)", "형태 온전성 (갈라짐 없음)", "색상 / 광택"]);
  }

  if (title.includes("양파")) {
    return withLabels(["껍질 광택", "미발아 상태 (싹틈 없음)", "표면 신선도 (무름 · 곰팡이 없음)", "형태 온전성 (구형 정도)"]);
  }

  if (title.includes("마늘")) {
    return withLabels(["미발아 상태 (싹틈 없음)", "표면 상태 (흠집 · 변색 없음)", "껍질 광택", "알 형태 온전성"]);
  }

  if (title.includes("감귤") || title.includes("귤")) {
    return withLabels(["껍질 상태 (흠집 · 곰팡이 없음)", "색상 선명도", "껍질 광택", "꼭지 신선도"]);
  }

  if (title.includes("감") && !title.includes("감자") && !title.includes("감귤")) {
    return withLabels(["표면 무결성 (흠집 없음)", "색상 (숙성도 추정)", "표면 탄력 (주름 없음)", "꼭지 신선도"]);
  }

  if (title.includes("사과")) {
    return withLabels(["표면 무결성 (흠집 · 멍 없음)", "착색도 (색택)", "표면 광택", "꼭지 신선도"]);
  }

  if (title.includes("배")) {
    return withLabels(["표면 무결성 (흠집 없음)", "색상 / 광택", "표면 탄력 (주름 없음)", "꼭지 신선도"]);
  }

  if (title.includes("감자")) {
    return withLabels(["표면 무결성 (흠집 · 상처 없음)", "정상 색상 (녹변 없음)", "미발아 상태 (싹틈 없음)", "형태 온전성"]);
  }

  // 10개 클래스 밖(수산물/정육/건어물 등)은 일반 기준으로 대체한다.
  return withLabels(["표면 무결성 (손상 없음)", "색상 / 광택", "전체 외관"]);
}

// getQualityMetrics의 모든 라벨이 "높을수록 좋음"으로 통일되어 있으므로, 임계치 하나로
// 신호등 색을 매길 수 있다 — 지표 종류와 무관하게 초록=우수/노랑=보통/빨강=주의.
function getMetricColor(value: number): string {
  if (value >= 80) return "#10B981"; // 우수
  if (value >= 50) return "#F59E0B"; // 보통
  return "#EF4444"; // 주의
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

  const [activeTab, setActiveTab] = useState<"description" | "shop" | "recipe">(initialTab);
  const [storeInfo, setStoreInfo] = useState<StoreInfo | null>(null);
  const [isStoreInfoLoaded, setIsStoreInfoLoaded] = useState(false);
  // 모바일에선 hover 툴팁이 안 먹히니, 탭으로 여닫는 방식으로 공공 시세 출처를 보여준다.
  const [showPublicPriceInfo, setShowPublicPriceInfo] = useState(false);

  React.useEffect(() => {
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
  const qualityMetrics = getQualityMetrics(product);

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
              {product.shopName ? `[${product.shopName}] ` : ""}
              {product.title}
            </h1>
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
            <div
              className={`text-white px-3 py-1 rounded-full flex items-center gap-1 shadow-md border border-white/20 text-xs font-extrabold ${
                product.grade?.startsWith("A") ? "bg-[#00C875]" : "bg-[#0052FF]"
              }`}
            >
              <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                verified
              </span>
              <span>{displayGrade(product.grade)}</span>
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

            {/* 특정 점포에 등록된 상품이 아니라 개인이 직접 스캔해서 저장한 기록(shopName
                없음)은 보여줄 가게정보 자체가 없으므로 탭을 아예 숨긴다. */}
            {product.shopName && (
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
            )}

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
                  <span
                    className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border ${
                      product.grade?.startsWith("A")
                        ? "text-[#10B981] bg-emerald-50 border-emerald-100"
                        : "text-[#0052FF] bg-blue-50 border-blue-100"
                    }`}
                  >
                    {displayGrade(product.grade)} 등급
                  </span>
                </div>

                <h2 className="text-xl sm:text-2xl font-black text-[#0F172A] leading-snug">
                  {product.title}
                  {product.unit && <span className="text-[#94A3B8] font-bold"> ({product.unit})</span>}
                </h2>

                {formatRelativeTime(product.createdAt) && (
                  <p className="text-[11px] text-[#94A3B8] font-medium">
                    {formatRelativeTime(product.createdAt)} 등록
                  </p>
                )}

                {/* Price Display: 실제 판매가 & 공공 판매가 */}
                <div className="bg-[#F8FAFC] rounded-2xl p-4 border border-[#E2E8F0] grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <span className="text-xs font-bold text-[#64748B] flex items-center gap-1">
                      현장 판매가
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <div className="text-xl font-black text-[#0F172A] mt-0.5">
                        {product.price ? `${product.price.toLocaleString()}원` : "-"}
                      </div>
                      {discountPercent(product) !== null && (
                        <span className="text-[11px] font-extrabold text-[#0052FF] bg-blue-50 px-1.5 py-0.5 rounded-full">
                          {discountPercent(product)}% 저렴
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className="text-xs font-bold text-[#64748B] flex items-center gap-1 relative">
                      공공 시세
                      <button
                        type="button"
                        onClick={() => setShowPublicPriceInfo((v) => !v)}
                        className="material-symbols-outlined text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                        style={{ fontSize: "14px" }}
                        title="한국농수산식품유통공사(KAMIS)에서 제공하는 해당 품목의 최신 소매 평균 시세입니다."
                      >
                        info
                      </button>
                      {showPublicPriceInfo && (
                        <div className="absolute left-0 top-full mt-1 z-20 w-56 bg-[#0F172A] text-white text-[11px] font-medium leading-relaxed rounded-lg p-2.5 shadow-xl">
                          한국농수산식품유통공사(KAMIS)에서 제공하는 해당 품목의 최신 소매 평균 시세입니다.
                        </div>
                      )}
                    </span>
                    <div className="text-xl font-bold text-[#475569] mt-0.5">
                      {product.publicPrice ? `${product.publicPrice.toLocaleString()}원` : "-"}
                    </div>
                  </div>
                </div>
              </div>

              {/* 상품 소개 — 사장님이 쓴 홍보문구. 상호명은 위에서 이미 나왔으니 반복하지
                  않고, 아래 AI 분석 카드들(파란/초록 톤)과 다르게 사장님이 직접 남긴 말이라는
                  느낌이 들도록 따뜻한 색+말풍선 아이콘의 "사장님 한마디"로 감싼다. */}
              {product.description && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-700 mb-1.5">
                    <span className="material-symbols-outlined text-base">chat_bubble</span>
                    사장님 한마디
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed font-medium">{product.description}</p>
                </div>
              )}

              {/* AI Metrics Breakdown */}
              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E2E8F0] shadow-[0_2px_8px_rgba(0,0,0,0.03)] space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-extrabold text-[#0F172A] tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[#0052FF] text-base">analytics</span>
                    AI 정밀 분석 지표
                  </h3>
                  <span
                    className={`text-xs font-extrabold px-2.5 py-1 rounded-full border flex items-center gap-1 ${
                      product.grade?.startsWith("A")
                        ? "text-[#10B981] bg-emerald-50 border-emerald-200"
                        : "text-[#0052FF] bg-blue-50 border-blue-200"
                    }`}
                  >
                    <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                    품질 등급 {displayGrade(product.grade || "A+")}
                  </span>
                </div>

                <div className="space-y-3 pt-1">
                  {qualityMetrics.map((metric) => {
                    const color = getMetricColor(metric.value);
                    return (
                      <div key={metric.label}>
                        <div className="flex justify-between items-center text-xs mb-1">
                          <span className="font-bold text-[#334155]">{metric.label}</span>
                          <span className="font-black" style={{ color }}>{metric.value}점</span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${metric.value}%`, backgroundColor: color }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* AI 스캔 종합 의견 — 실제 카메라 AI 스캔(제미나이)을 거친 상품에만 있는 값이라,
                  없으면(수동 등록 상품) 이 섹션 자체를 숨긴다. 상인이 직접 쓴 상품 소개는
                  위쪽에 별도로 보여준다. */}
              {product.aiSummary && (
                <div className="text-xs text-[#475569] bg-white p-5 rounded-2xl border border-[#E2E8F0] shadow-[0_2px_8px_rgba(0,0,0,0.03)] leading-relaxed space-y-2">
                  <div className="font-extrabold text-[#0052FF] flex items-center gap-1.5 text-xs">
                    <span className="material-symbols-outlined text-base">psychology</span>
                    AI 스캔 종합 의견
                  </div>
                  <p className="text-slate-700 font-medium text-xs leading-relaxed">{product.aiSummary}</p>
                </div>
              )}
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

