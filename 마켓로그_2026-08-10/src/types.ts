export type TabType = "home" | "map" | "aiscan" | "saved" | "my";

export type QualityGrade = "A+" | "A" | "B+" | "B" | "C";

export type TrafficLight = "SAFE" | "CAUTION" | "ALERT";

// attribute_quality_v3(2026-08-18 비전팀 인계분)이 내려주는 속성 등급 어휘. 착색도·신선도
// 등 "높을수록 좋은" 속성은 특상/상/중, 손상·흠집처럼 "적을수록 좋은" 속성은 많음/보통/적음 —
// 하나의 속성명 안에서는 항상 같은 방향이라 프론트는 속성명이 무엇이든 이 6개 문자열만
// 알면 된다(ProductDetailModal/AiScanModal의 GRADE_RANK가 색상/막대 폭으로 변환).
export type AttributeGradeLabel = "특상" | "상" | "중" | "많음" | "보통" | "적음";

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
  // attribute_quality_v3 CV 모델이 실제로 측정한 품목별 속성(착색도/신선도/손상 등)의
  // 진짜 이름과 등급 — 있으면 상세페이지가 이 실측 라벨을 그대로 보여주고, 없으면
  // (구형 저장 상품, 감자 등 미지원 품목) freshness/defect/uniformity 3개 숫자로 근사한
  // 예전 방식 라벨로 대체한다.
  attributeLabels?: Record<string, { grade: AttributeGradeLabel; confidence: number }>;
  description: string;
  // 카메라 AI 스캔이 실제로 생성한 종합의견 (Gemini). 상인이 직접 입력했거나 "AI 추천
  // 설명" 3개 중 고른 홍보문구인 description과는 별개 — 스캔을 거치지 않은 상품은 없다.
  aiSummary?: string;
  // 스캔 촬영 당시 기기 GPS 좌표 — 소비자 개인 스캔 저장 기록에서 "찍은 위치로 이동하기"로
  // 지도에서 그 지점을 바로 확인할 때 쓴다. 위치 권한을 거부/실패한 스캔은 비어있다.
  scanLat?: number;
  scanLng?: number;
  isMerchantUploaded?: boolean;
  // "AI 스캔을 거쳐서 만들어진 기록인가"라는 뜻으로, 상인 상품(스캔 필수라 전부 true)에도
  // 붙어있는 값이라 "저장 탭에서 연 내 스캔 기록인가"의 신호로는 못 쓴다 — 그 구분은
  // 아래 isSavedScanRecord를 따로 쓴다.
  isScannedProduct?: boolean;
  // 소비자가 "저장 > 스캔 상품" 탭에서 자기 개인 스캔 기록을 열었을 때만 SavedView가
  // 채워준다 — 상품 상세 모달이 "내 메모" 섹션을 보여줄지 여기 하나로만 판단한다
  // (일반 피드/상인 미리보기에서 연 같은 상품에는 이 값이 없다).
  isSavedScanRecord?: boolean;
  region?: string;
  marketId?: string;
  createdAt?: string;
  // 소비자가 스캔해서 저장한 상품에 직접 남기는 개인 메모(예: "가격 괜찮았음"). 이
  // 스캔을 저장한 본인만 보고 쓴다 — isSavedScanRecord 항목에서만 의미가 있다.
  memo?: string;
}

export interface MarketInfo {
  id: string;
  name: string;
  city: string;
  // REGIONS_DATA의 값과 일치 — 상인 가입 후 마이 탭에서 "지역 선택 → 그 지역 시장 선택"
  // 2단계 필터에 쓴다.
  region: string;
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
  attributeLabels?: Record<string, { grade: AttributeGradeLabel; confidence: number }>;
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
