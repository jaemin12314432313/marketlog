export type TabType = "home" | "map" | "aiscan" | "saved" | "my";

export type QualityGrade = "A+" | "A" | "B+" | "B" | "C";

export type TrafficLight = "SAFE" | "CAUTION" | "ALERT";

export interface ProductItem {
  id: string;
  title: string;
  unit: string; // 예: "1kg", "3개" — 상품명과 분리해서 저장
  origin: string; // 예: "국내산 · 완도" — "완도산 전복"처럼 상품명에 섞어 쓰지 않는다
  tags: string; // 쉼표로 이어붙인 해시태그, 예: "#달콤한,#산지직송"
  shopName: string;
  distance: string;
  timeAgo: string;
  price: number;
  publicPrice: number;
  priceTag: string; // e.g. "공공 시세 대비 10% 저렴"
  grade: QualityGrade;
  category: "야채" | "수산물" | "정육" | "과일" | "건어물";
  imageUrl: string;
  freshnessScore: number;
  defectScore: number;
  uniformityScore: number;
  description: string;
  // 카메라 AI 스캔이 실제로 생성한 종합의견 (Gemini). 상인이 직접 입력했거나 "AI 추천
  // 설명" 3개 중 고른 홍보문구인 description과는 별개 — 스캔을 거치지 않은 상품은 없다.
  aiSummary?: string;
  isMerchantUploaded?: boolean;
  isScannedProduct?: boolean;
  region?: string;
  marketId?: string;
  createdAt?: string;
}

export interface MarketInfo {
  id: string;
  name: string;
  city: string;
  congestion: "원활" | "보통" | "혼잡";
  parkingCapacity: string; // e.g. "24/80면 여유"
  toiletLocation: string; // e.g. "수산동 2층, 중앙광장"
}

export interface InspectionResult {
  productName: string;
  category: string;
  grade: QualityGrade;
  qualityScore: number;
  sellingPrice: number;
  publicMarketPrice: number;
  publicPriceUnit?: string; // "kg"면 publicMarketPrice가 실제 판매 단위가 아닌 1kg 환산가라는 뜻
  gradeConfidencePercent?: number; // 등급 판정 확률(%) — 라벨만 보여주면 안 되고 이 값을 같이 표시할 것(비전팀 권고)
  priceDiffPercent: number;
  priceTrafficLight: TrafficLight;
  freshnessScore: number;
  defectScore: number;
  uniformityScore: number;
  publicGuarantee: string;
  aiAnalysisSummary: string;
  crossSellRecommendation: {
    itemName: string;
    shopName: string;
    distance: string;
    discountOffer: string;
    recipeName: string;
  };
}

export interface KakaoChatMessage {
  id: string;
  sender: "merchant" | "ai";
  text?: string;
  imageUrl?: string;
  timestamp: string;
  publishedProduct?: ProductItem;
  isProcessing?: boolean;
}
