export type TabType = "home" | "map" | "aiscan" | "saved" | "my";

export type QualityGrade = "A+" | "A" | "B+" | "B" | "C";

export type TrafficLight = "SAFE" | "CAUTION" | "ALERT";

export interface ProductItem {
  id: string;
  title: string;
  shopName: string;
  distance: string;
  timeAgo: string;
  price: number;
  publicPrice: number;
  priceTag: string; // e.g. "공공 시세 대비 10% 저렴"
  grade: QualityGrade;
  category: "AI 추천상품" | "야채" | "수산물" | "정육" | "과일" | "건어물";
  imageUrl: string;
  freshnessScore: number;
  defectScore: number;
  uniformityScore: number;
  description: string;
  isMerchantUploaded?: boolean;
  isScannedProduct?: boolean;
  phone?: string;
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
