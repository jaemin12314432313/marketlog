import React, { useState } from "react";
import { Browser } from "@capacitor/browser";
import { ProductItem, MarketInfo, AttributeGradeLabel } from "../types";
import { fetchStoreByName, StoreInfo } from "../lib/api";
import { MARKETS_DATA } from "../data/initialData";
import { UserRole } from "./LoginModal";

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

// 원산지/단위를 따로따로 뱃지로 흩어놓는 대신, "[국내산] 해남 알배기 배추 1포기"처럼
// 하나의 자연스러운 문장으로 합쳐서 보여준다 (HomeFeed와 동일 규칙) — 대분류(국내산/
// 수입산)만 대괄호 태그로 남기고 상세 산지는 상품명 앞에 자연스럽게 붙인다.
function formatProductDisplayTitle(product: ProductItem): React.ReactNode {
  const [originType, originDetail] = (product.origin || "").split(" · ").map((s) => s.trim());
  const typePart = originType ? `[${originType}] ` : "";
  const detailPart = originDetail ? `${originDetail} ` : "";
  const unitPart = product.unit ? ` ${product.unit}` : "";
  return <>{typePart}{detailPart}{product.title}{unitPart}</>;
}

interface ProductDetailModalProps {
  product: ProductItem | null;
  marketInfo: MarketInfo;
  onClose: () => void;
  isBookmarked: boolean;
  onToggleBookmark: (product: ProductItem) => void;
  onNavigateToMap: () => void;
  // 레시피 탭에서 "지도에서 재료 위치 확인"을 누르면, 그 레시피 재료 목록을 들고 지도
  // 탭으로 넘어간다 — 없으면(아직 부모가 안 만들었으면) 버튼 자체를 숨긴다.
  onNavigateToRecipeMap?: (ingredients: string[]) => void;
  // "AI 스캔 종합 의견" 아래 "찍은 위치로 이동하기" — 특정 점포가 아니라 좌표 하나로
  // 지도를 이동시키는 것이라 onNavigateToMap(점포 기준)과는 별도 경로다. product.scanLat/
  // scanLng가 있을 때만(위치 권한 허용하고 스캔한 기록만) 버튼이 뜬다.
  onNavigateToScanLocation?: (lat: number, lng: number) => void;
  // 해시태그를 누르면 홈 피드로 돌아가서 그 태그로 검색된 상태를 보여준다 — 없으면
  // (아직 부모가 안 만들었으면) 태그가 클릭 불가능한 일반 텍스트로만 보인다.
  onSearchTag?: (tag: string) => void;
  // 소비자가 스캔 저장 상품에 개인 메모를 남기고 저장할 때 호출된다 — isSavedScanRecord
  // 항목에서만 쓰이고, 없으면(피드 상품/미리보기 등) 메모 섹션 자체를 숨긴다.
  onUpdateMemo?: (productId: string, memo: string) => Promise<void>;
  // 상인이 "미리보기"로 자기 상품을 열었을 때는 저장(찜) 버튼이 의미가 없다 — 자기
  // 상품을 자기가 찜할 일이 없으므로. 소비자가 피드에서 여는 경우엔 그대로 보여준다.
  userRole?: UserRole;
  initialTab?: "description" | "shop" | "recipe";
}

interface RecipeRecommendation {
  dishTitle: string;
  cookingTime: string;
  difficulty: string;
  description: string;
  youtubeUrl: string;
  youtubeThumbnailUrl?: string;
  youtubeVideoId?: string;
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
// 품목마다 요리를 2가지씩 준비해서, "이거 말고 다른 요리는?" 하고 골라볼 수 있게 한다.
//
// youtubeVideoId를 직접 확인해서 넣어둔 항목은 그 영상의 실제 썸네일(img.youtube.com,
// API 키 불필요)을 보여주고 클릭하면 그 영상으로 바로 연결된다 — API 없이 "진짜 영상"을
// 보여주기로 한 절충안. 아직 확인 못 한 항목은 여전히 상품 사진 + 유튜브 검색 결과로
// 폴백한다(검증 안 된 영상을 특정 영상인 척 보여주지 않기 위함). 링크가 삭제/비공개로
// 바뀌면 썸네일이 깨지므로, 주기적으로 살아있는지 확인이 필요하다.
function getRecipeRecommendations(product: ProductItem): RecipeRecommendation[] {
  const title = product.title;
  const category = product.category;

  const base = (
    dishTitle: string,
    cookingTime: string,
    difficulty: string,
    description: string,
    searchQuery: string,
    ingredientsList: { name: string; amount: string; isMain?: boolean }[],
    youtubeVideoId?: string
  ): RecipeRecommendation => ({
    dishTitle,
    cookingTime,
    difficulty,
    description,
    youtubeUrl: youtubeVideoId
      ? `https://www.youtube.com/watch?v=${youtubeVideoId}`
      : `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`,
    // maxresdefault(1280x720)는 화질은 더 좋지만 업로더가 그 해상도로 안 올린 영상은
    // 아예 없어서 404가 난다(실제로 여러 개 걸림) — onError 폴백에 기대는 대신, 모든
    // 유튜브 영상이 항상 갖고 있는 hqdefault(480x360)를 기본으로 써서 깨지는 일 자체를
    // 없앤다. 그래도 영상이 삭제/비공개되면 hqdefault도 깨지므로 onError는 그대로 둔다.
    youtubeThumbnailUrl: youtubeVideoId
      ? `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`
      : product.imageUrl,
    youtubeVideoId,
    ingredientsList,
  });

  if (title.includes("갈치") || title.includes("생선") || title.includes("조기") || category === "수산물") {
    return [
      base(
        "칼칼한 갈치조림",
        "25분",
        "보통",
        "통통한 갈치에 무와 칼칼한 양념장을 넣어 자작하게 조려내는 전통시장 대표 별미 요리입니다.",
        "갈치조림 레시피",
        [
          { name: `${title} (본 상품)`, amount: "1마리", isMain: true },
          { name: "무", amount: "1/3개 (200g)", isMain: true },
          { name: "대파", amount: "1개", isMain: false },
          { name: "청양고추", amount: "1개", isMain: false },
          { name: "고춧가루", amount: "양념장 재료", isMain: false },
          { name: "마늘", amount: "양념장 재료", isMain: false },
        ],
        "fJdZpi5lXb0"
      ),
      base(
        "든든한 갈치 매운탕",
        "30분",
        "보통",
        "갈치와 채소를 큼직하게 썰어 얼큰하게 끓여내는 국물 요리로, 밥 한 공기와 잘 어울립니다.",
        "생선 매운탕 레시피",
        [
          { name: `${title} (본 상품)`, amount: "1마리", isMain: true },
          { name: "무", amount: "1/4개", isMain: true },
          { name: "쑥갓", amount: "1줌", isMain: false },
          { name: "고추장", amount: "2큰술", isMain: false },
          { name: "청양고추", amount: "2개", isMain: false },
        ],
        "hyTvVxTGObM"
      ),
    ];
  }

  if (title.includes("무")) {
    return [
      base(
        "홍어무침",
        "20분",
        "보통",
        "새콤달콤 무친 무에 홍어를 더해 알싸하고 시원하게 즐기는 전통시장 대표 별미입니다.",
        "홍어무침 레시피",
        [
          { name: "홍어", amount: "적당량", isMain: true },
          { name: `${title} (본 상품)`, amount: "적당량", isMain: true },
          { name: "미나리", amount: "적당량", isMain: false },
          { name: "고춧가루", amount: "적당량", isMain: false },
          { name: "식초", amount: "적당량", isMain: false },
          { name: "다진마늘", amount: "적당량", isMain: false },
          { name: "깨소금", amount: "적당량", isMain: false },
        ]
      ),
      base(
        "새콤달콤 무생채",
        "10분",
        "쉬움",
        "채썬 무를 고춧가루와 식초로 무쳐내는 밑반찬으로, 다른 요리에 곁들이기 좋습니다.",
        "무생채 레시피",
        [
          { name: `${title} (본 상품)`, amount: "1.4kg", isMain: true },
          { name: "고춧가루", amount: "3큰술", isMain: true },
          { name: "쪽파", amount: "약간", isMain: false },
          { name: "식초", amount: "2큰술", isMain: false },
          { name: "설탕 (또는 매실청)", amount: "2큰술", isMain: false },
          { name: "다진마늘", amount: "1큰술", isMain: false },
          { name: "참깨", amount: "1큰술", isMain: false },
        ],
        "dXxhCmHP-l0"
      ),
    ];
  }

  // "양배추"는 "배추"를 부분 문자열로 포함하므로, 더 구체적인 양배추 분기를 먼저 검사한다.
  if (title.includes("양배추")) {
    return [
      base(
        "아삭한 양배추 쌈밥",
        "15분",
        "쉬움",
        "부드럽게 찐 양배추 잎에 매콤한 쌈장 비빔밥을 올려 싸먹는 담백하고 건강한 한끼 요리입니다.",
        "양배추 쌈밥 레시피",
        [
          { name: `${title} (본 상품)`, amount: "1/4통", isMain: true },
          { name: "밥", amount: "1공기", isMain: true },
          { name: "고추장", amount: "2큰술", isMain: false },
          { name: "마늘", amount: "3알", isMain: false },
          { name: "식초", amount: "1/2큰술", isMain: false },
          { name: "참기름", amount: "1큰술", isMain: false },
          { name: "깨소금", amount: "1큰술", isMain: false },
          { name: "매실청", amount: "2큰술", isMain: false },
          { name: "대파", amount: "1/3대", isMain: false },
        ],
        "uYN6jX2nU3w"
      ),
      base(
        "떡갈비 양배추쌈",
        "25분",
        "보통",
        "떡갈비를 부드럽게 구워, 아삭한 양배추에 쌈으로 곁들여 먹는 든든한 한 상입니다.",
        "떡갈비 양배추쌈 레시피",
        [
          { name: "떡갈비", amount: "적당량", isMain: true },
          { name: `${title} (본 상품)`, amount: "적당량", isMain: true },
          { name: "쌈장", amount: "적당량", isMain: false },
          { name: "마늘", amount: "적당량", isMain: false },
        ]
      ),
    ];
  }

  if (title.includes("배추")) {
    return [
      base(
        "홍어삼합",
        "20분",
        "보통",
        "잘 익은 배추 묵은지·삶은 돼지고기·삭힌 홍어를 한 점씩 겹쳐 싸 먹는 잔치상 대표 별미입니다.",
        "홍어삼합 레시피",
        [
          { name: `${title} (묵은지, 본 상품)`, amount: "적당량", isMain: true },
          { name: "홍어", amount: "적당량", isMain: true },
          { name: "삶은 돼지고기 (수육)", amount: "적당량", isMain: true },
          { name: "새우젓", amount: "적당량", isMain: false },
        ]
      ),
      base(
        "시원한 배추물김치",
        "40분",
        "보통",
        "얇게 절인 배추를 배·양파로 우려낸 시원한 국물에 담가 익혀 먹는 물김치입니다.",
        "배추물김치 레시피",
        [
          { name: `${title} (본 상품)`, amount: "3통 (2.3kg)", isMain: true },
          { name: "천일염 (절임용)", amount: "1컵", isMain: false },
          { name: "대파", amount: "5대", isMain: false },
          { name: "배", amount: "1개", isMain: false },
          { name: "양파", amount: "1개", isMain: false },
          { name: "마늘", amount: "10개", isMain: false },
          { name: "생강", amount: "1톨", isMain: false },
          { name: "고춧가루", amount: "1/2컵", isMain: false },
          { name: "찹쌀풀", amount: "1/2컵", isMain: false },
          { name: "천일염 (국물용)", amount: "3.5큰술", isMain: false },
        ],
        "7SofAEBSPAw"
      ),
    ];
  }

  if (title.includes("양파")) {
    return [
      base(
        "아삭한 양파김치",
        "20분 (숙성 1일)",
        "쉬움",
        "단맛이 강한 양파를 부추와 함께 양념에 버무려 담그는 아삭한 별미 김치로, 숙성될수록 새콤한 맛이 깊어집니다.",
        "양파김치 레시피",
        [
          { name: `${title} (본 상품)`, amount: "7개 (720g)", isMain: true },
          { name: "부추", amount: "한줌", isMain: true },
          // 시장에 "멸치액젓"/"통깨"라는 정확한 품목명은 없지만 젓갈가게(젓갈)·참기름집
          // (참깨)에서 사실상 같은 걸 판다 — "A & B"로 적어두면 지도 매칭이 A를 먼저
          // 찾아보고 없으면 B로도 시도한다(대체 가능한 실제 취급 품목).
          { name: "멸치액젓 & 젓갈", amount: "2스푼", isMain: true },
          { name: "새우젓 & 젓갈", amount: "2스푼", isMain: true },
          { name: "고춧가루", amount: "5스푼", isMain: true },
          { name: "마늘", amount: "1스푼 (다진 것)", isMain: true },
          { name: "생강(청) & 생강", amount: "0.5스푼", isMain: true },
          { name: "통깨 & 참깨", amount: "2스푼 (넉넉하게)", isMain: true },
        ],
        "VYkiNq4saAo"
      ),
      base(
        "돼지고기 양파볶음",
        "20분",
        "쉬움",
        "단맛이 강한 양파를, 고추장 양념 돼지고기·마늘·대파와 함께 볶아내는 든든한 한 끼 요리입니다.",
        "돼지고기 양파볶음 레시피",
        [
          { name: "돼지고기", amount: "적당량", isMain: true },
          { name: "고추장", amount: "적당량", isMain: true },
          { name: "설탕", amount: "적당량", isMain: true },
          { name: `${title} (본 상품)`, amount: "적당량", isMain: true },
          { name: "마늘", amount: "적당량", isMain: true },
          { name: "대파", amount: "적당량", isMain: true },
        ],
        "96vbMdcPiX4"
      ),
    ];
  }

  if (title.includes("마늘")) {
    return [
      base(
        "알싸한 통마늘 장아찌",
        "15분 (숙성 2주)",
        "보통",
        "알이 굵은 통마늘을 식초 설탕물에 절여 알싸한 맛을 오래 즐길 수 있는 대표 밑반찬입니다.",
        "마늘장아찌 레시피",
        [
          { name: `${title} (본 상품)`, amount: "20알", isMain: true },
          { name: "설탕", amount: "1컵", isMain: false },
          { name: "굵은소금", amount: "적당량", isMain: false },
          { name: "생수", amount: "적당량", isMain: false },
        ],
        "Y3F7QalV3qc"
      ),
      base(
        "매콤 짭짤한 마늘볶음",
        "15분",
        "쉬움",
        "햇마늘을 고추장 양념에 매콤 짭짤하게 볶아내는 밥도둑 밑반찬입니다.",
        "마늘볶음 레시피",
        [
          { name: `${title} (본 상품)`, amount: "300g (햇마늘)", isMain: true },
          { name: "청양고추", amount: "2개", isMain: false },
          { name: "고추장", amount: "1큰술", isMain: false },
          { name: "매실원액", amount: "2큰술", isMain: false },
          { name: "진간장", amount: "1큰술", isMain: false },
          { name: "까나리액젓", amount: "1/2큰술", isMain: false },
          { name: "식용유 · 참기름", amount: "각 1큰술", isMain: false },
          { name: "통깨", amount: "약간", isMain: false },
        ],
        "ATwc62fKd3s"
      ),
    ];
  }

  if (title.includes("감귤") || title.includes("귤")) {
    return [
      base(
        "상큼한 귤청",
        "20분",
        "쉬움",
        "제철 감귤을 얇게 썰어 설탕에 재워두면 차로도, 탄산수에 타서도 즐길 수 있는 상큼한 청이 됩니다.",
        "유자청 만들기 레시피",
        [
          { name: `${title} (본 상품)`, amount: "적당량", isMain: true },
          { name: "설탕", amount: "동량", isMain: true },
          { name: "꿀", amount: "적당량", isMain: false },
        ],
        "TFB9wk30SlA"
      ),
      base(
        "상큼한 귤 드레싱 샐러드",
        "10분",
        "쉬움",
        "새콤달콤한 귤 드레싱을 곁들인 양상추 샐러드로, 가볍게 즐기기 좋은 곁들임 요리입니다.",
        "귤 드레싱 샐러드 레시피",
        [
          { name: `${title} (본 상품)`, amount: "적당량", isMain: true },
          { name: "양상추", amount: "적당량", isMain: false },
          { name: "견과류", amount: "약간", isMain: false },
          { name: "올리브오일", amount: "적당량", isMain: false },
          { name: "레몬즙", amount: "약간", isMain: false },
          { name: "꿀 (또는 올리고당)", amount: "약간", isMain: false },
          { name: "소금", amount: "약간", isMain: false },
        ],
        "MooNKruuI9U"
      ),
    ];
  }

  if (title.includes("감") && !title.includes("감자") && !title.includes("감귤")) {
    return [
      base(
        "대봉감말랭이",
        "30분 (건조 1주)",
        "보통",
        "잘 익은 대봉감을 얇게 썰어 말리면 쫀득하고 달콤한 국민 간식 감말랭이가 됩니다.",
        "감말랭이 만들기 레시피",
        [{ name: `${title} (본 상품)`, amount: "5개", isMain: true }],
        "FCJe-0OqyBE"
      ),
      base(
        "든든한 감말랭이 약밥",
        "1시간",
        "보통",
        "쫀득한 감말랭이를 섞어 찐 찹쌀 약밥으로, 명절 별미 겸 든든한 간식입니다.",
        "감말랭이 약밥 레시피",
        [
          { name: `${title} (본 상품, 감말랭이)`, amount: "적당량", isMain: true },
          { name: "찹쌀", amount: "500g", isMain: true },
          { name: "생수", amount: "450ml", isMain: false },
          { name: "흑설탕", amount: "80g", isMain: false },
          { name: "밤", amount: "200g", isMain: false },
          { name: "대추 (씨포함)", amount: "120g", isMain: false },
          { name: "잣", amount: "20g", isMain: false },
          { name: "호박씨", amount: "약간", isMain: false },
          { name: "진간장", amount: "60g", isMain: false },
          { name: "참기름", amount: "2큰술", isMain: false },
        ],
        "Rcwu72Usaxs"
      ),
    ];
  }

  if (title.includes("사과")) {
    return [
      base(
        "사과잼",
        "40분",
        "쉬움",
        "새콤달콤한 맛이 진한 사과를 푹 끓여, 빵에 발라 먹기 좋은 사과잼으로 만듭니다.",
        "사과잼 레시피",
        [
          { name: `${title} (본 상품)`, amount: "5개", isMain: true },
          { name: "설탕", amount: "적당량", isMain: true },
          { name: "레몬즙", amount: "약간", isMain: false },
        ],
        "RXmVL7_f6Y0"
      ),
      base(
        "새콤달콤 사과정과",
        "30분 (건조 반나절)",
        "쉬움",
        "얇게 썬 사과를 설탕물에 졸여 말리는 전통 저장 간식 정과로, 새콤달콤하고 쫀득한 맛을 오래 즐길 수 있습니다.",
        "사과정과 레시피",
        [
          { name: `${title} (본 상품)`, amount: "2개", isMain: true },
          { name: "설탕", amount: "6큰술", isMain: true },
          { name: "소금", amount: "약간", isMain: false },
        ],
        "y0wx1gU7Apc"
      ),
    ];
  }

  if (title.includes("배") && !title.includes("배추")) {
    return [
      base(
        "새콤달콤 배무침",
        "10분",
        "쉬움",
        "즙 많은 배를 채썰어 양파와 새콤달콤하게 무쳐내는 상큼한 곁들임 반찬입니다.",
        "배무침 레시피",
        [
          { name: `${title} (본 상품)`, amount: "1개", isMain: true },
          { name: "양파", amount: "1개", isMain: false },
          { name: "통깨", amount: "1큰술", isMain: false },
          { name: "올리고당", amount: "1큰술", isMain: false },
          { name: "식초", amount: "1큰술", isMain: false },
        ],
        "Ar4OENmmsvo"
      ),
      base(
        "달콤한 배숙",
        "40분",
        "쉬움",
        "배를 생강·대추와 함께 달콤하게 끓여내는 전통 화채 겸 디저트입니다.",
        "배숙 레시피",
        [
          { name: `${title} (본 상품, 중간 크기)`, amount: "3개", isMain: true },
          { name: "대추", amount: "2개", isMain: false },
          { name: "생강", amount: "45g", isMain: false },
          { name: "정수물", amount: "1.3L", isMain: false },
          { name: "꿀", amount: "8큰술", isMain: false },
        ],
        "iFgOmAfQ6bU"
      ),
    ];
  }

  if (title.includes("샤인") || category === "과일") {
    return [
      base(
        "아삭한 생과일 샐러드",
        "10분",
        "쉬움",
        "당도 높은 생과일을 슬라이스하여 견과류와 요거트를 곁들인 상큼 건강 디저트입니다.",
        `${title} 샐러드 레시피`,
        [
          { name: `${title} (본 상품)`, amount: "2개", isMain: true },
          { name: "견과류", amount: "1주먹 (50g)", isMain: false },
          { name: "플레인 요거트", amount: "3큰술", isMain: false },
        ]
      ),
      base(
        "향긋한 과일청",
        "20분 (숙성 1주)",
        "쉬움",
        "제철 과일을 설탕에 재워두면 차로도, 탄산수에 타서도 즐길 수 있는 향긋한 청이 됩니다.",
        `${title}청 만들기 레시피`,
        [
          { name: `${title} (본 상품)`, amount: "1kg", isMain: true },
          { name: "설탕", amount: "동량(1kg)", isMain: true },
        ]
      ),
    ];
  }

  if (title.includes("감자")) {
    return [
      base(
        "감자갈치조림",
        "30분",
        "보통",
        "감자를 듬뿍 넣어 칼칼한 양념에 자작하게 조려내는 밥도둑 요리입니다.",
        "감자갈치조림 레시피",
        [
          { name: `${title} (본 상품)`, amount: "2개", isMain: true },
          { name: "갈치", amount: "2마리", isMain: true },
          { name: "무", amount: "1/4개", isMain: false },
          { name: "고춧가루", amount: "양념장 재료", isMain: false },
          { name: "마늘", amount: "양념장 재료", isMain: false },
        ],
        "Q2RBuy1gnzE"
      ),
      base(
        "담백한 감자샐러드",
        "20분",
        "쉬움",
        "삶아 으깬 감자에 채소와 마요네즈를 버무려내는 담백한 밑반찬 겸 샐러드입니다.",
        "감자샐러드 레시피",
        [
          { name: `${title} (본 상품)`, amount: "3개", isMain: true },
          { name: "마요네즈", amount: "3큰술", isMain: true },
          { name: "오이", amount: "1/2개", isMain: false },
          { name: "당근", amount: "약간", isMain: false },
        ],
        "sljZmiEHlAU"
      ),
    ];
  }

  if (title.includes("고구마")) {
    return [
      base(
        "달콤 바삭 꿀고구마 맛탕",
        "15분",
        "쉬움",
        "신선한 고구마를 바삭하게 튀겨 조청으로 코팅한 인기 간식 레시피입니다.",
        "고구마맛탕 만들기 레시피",
        [
          { name: `${title} (본 상품)`, amount: "3개", isMain: true },
          { name: "조청", amount: "4큰술", isMain: true },
          { name: "식용유", amount: "적당량", isMain: false },
          { name: "검은깨", amount: "약간", isMain: false },
        ],
        "O1lZIe84bOo"
      ),
      base(
        "포근한 고구마 맛탕조림",
        "25분",
        "쉬움",
        "큼직하게 썬 고구마를 간장 양념에 조려내는 포근한 밑반찬입니다.",
        "고구마조림 레시피",
        [
          { name: `${title} (본 상품)`, amount: "3개", isMain: true },
          { name: "간장", amount: "3큰술", isMain: true },
          { name: "물엿", amount: "2큰술", isMain: false },
        ],
        "wyzYIHpfBGY"
      ),
    ];
  }

  if (category === "정육" || title.includes("한우") || title.includes("돼지") || title.includes("삼겹살")) {
    return [
      base(
        "육즙 가득 단짠 소불고기",
        "20분",
        "쉬움",
        "고소하고 질 좋은 정육에 달콤 짭조름한 양념을 재워 쌈채소와 함께 즐기는 대표 요리입니다.",
        "소불고기 양념 레시피",
        [
          { name: `${title} (본 상품)`, amount: "600g", isMain: true },
          { name: "쌈채소 모둠", amount: "1팩", isMain: true },
          { name: "마늘", amount: "1개", isMain: false },
          { name: "양파", amount: "1개", isMain: false },
        ],
        "q85dpwLkDgQ"
      ),
      base(
        "매콤한 제육볶음",
        "20분",
        "쉬움",
        "고추장 양념에 재운 고기를 채소와 함께 볶아내는 든든한 한 끼 요리입니다.",
        "제육볶음 레시피",
        [
          { name: `${title} (본 상품)`, amount: "600g", isMain: true },
          { name: "고추장", amount: "3큰술", isMain: true },
          { name: "양파", amount: "1개", isMain: false },
          { name: "대파", amount: "1개", isMain: false },
        ]
      ),
    ];
  }

  return [
    base(
      `${title} 활용 레시피`,
      "15분",
      "쉬움",
      `${title}를 활용한 전통시장 신선 식재료 홈메이드 레시피입니다.`,
      `${title} 레시피`,
      [{ name: `${title} (본 상품)`, amount: "1팩", isMain: true }]
    ),
  ];
}

interface QualityMetric {
  label: string;
  grade: AttributeGradeLabel;
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
  // attribute_quality_v3가 실제로 측정한 진짜 속성명(착색도/신선도/손상 등)+등급이
  // 있으면 그걸 그대로 쓴다 — 아래 품목별 하드코딩 라벨은 이 값이 없을 때(감자 등 미지원
  // 품목, 모델 도입 전 저장된 상품, 수동 등록 상품)만 쓰는 근사치 폴백이다.
  if (product.attributeLabels) {
    return Object.entries(product.attributeLabels).map(([label, info]) => ({ label, grade: info.grade }));
  }

  const title = product.title;

  const fresh = product.freshnessScore ?? 90;
  const integrity = Math.max(0, 100 - (product.defectScore ?? 5)); // 결함 적을수록 높은 점수
  const uniform = product.uniformityScore ?? 92;
  const avg = Math.round((fresh + integrity + uniform) / 3);
  const values = [fresh, integrity, uniform, avg];

  const withLabels = (labels: readonly string[]): QualityMetric[] =>
    labels.map((label, i) => ({ label, grade: getMetricGrade(values[i]) }));

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

// attribute_quality_v3(2026-08-18 인계분)는 속성마다 어휘가 다르다 — 착색도/신선도 등
// "높을수록 좋은" 속성은 특상/상/중, 손상/흠집처럼 "적을수록 좋은" 속성은 많음/보통/적음.
// 색상/막대폭은 그 뜻(좋음/보통/나쁨)에만 의존해야 하므로, 문자열을 등급 순위(0=최상)로
// 먼저 접고 그 순위로 색/폭을 정한다 — 어떤 속성이든, 심지어 폴백 경로(getMetricGrade)의
// 특상/상/중까지 전부 이 한 표로 통일해서 처리한다.
const GRADE_RANK: Record<AttributeGradeLabel, 0 | 1 | 2> = {
  특상: 0, 적음: 0,
  상: 1, 보통: 1,
  중: 2, 많음: 2,
};
const RANK_COLOR = ["#10B981", "#F59E0B", "#F87171"]; // 우수 / 보통 / 주의
const RANK_BAR_WIDTH = [100, 60, 25];

function getMetricColor(grade: AttributeGradeLabel): string {
  return RANK_COLOR[GRADE_RANK[grade]];
}

function getMetricLabelColor(label: string): string {
  return /(모양|형태|손상|흠집)/.test(label) ? "#0F172A" : "#334155";
}

function getMetricBarWidth(grade: AttributeGradeLabel): number {
  return RANK_BAR_WIDTH[GRADE_RANK[grade]];
}

// attributeLabels가 없는 폴백 경로(감자 등 미지원 품목, 구형 저장 상품)에서 기존 점수
// 필드(0~100)를 등급으로 접어 보여준다 — 위 GRADE_RANK와 어휘를 통일해서 실측 라벨과
// 섞여도 색/막대 규칙이 항상 같은 뜻이 되게 한다.
function getMetricGrade(value: number): AttributeGradeLabel {
  if (value >= 80) return "특상";
  if (value >= 50) return "상";
  return "중";
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  marketInfo,
  onClose,
  isBookmarked,
  onToggleBookmark,
  onNavigateToMap,
  onNavigateToRecipeMap,
  onNavigateToScanLocation,
  onSearchTag,
  onUpdateMemo,
  userRole,
  initialTab = "description",
}) => {
  if (!product) return null;

  const [activeTab, setActiveTab] = useState<"description" | "shop" | "recipe">(initialTab);
  const [selectedRecipeIndex, setSelectedRecipeIndex] = useState(0);
  const [storeInfo, setStoreInfo] = useState<StoreInfo | null>(null);
  const [isStoreInfoLoaded, setIsStoreInfoLoaded] = useState(false);
  // 모바일에선 hover 툴팁이 안 먹히니, 탭으로 여닫는 방식으로 공공 시세 출처를 보여준다.
  const [showPublicPriceInfo, setShowPublicPriceInfo] = useState(false);
  // 소비자가 스캔 저장 상품에 남기는 개인 메모 — 저장 전까지는 로컬 입력값만 갖고
  // 있다가, 저장 버튼을 눌러야 서버에 반영된다(타이핑마다 API를 부르지 않기 위함).
  const [memoText, setMemoText] = useState(product.memo || "");
  const [isSavingMemo, setIsSavingMemo] = useState(false);

  React.useEffect(() => {
    setActiveTab(initialTab);
    setSelectedRecipeIndex(0);
    setMemoText(product.memo || "");
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
    fetchStoreByName(product.shopName, product.marketId)
      .then((res) => setStoreInfo(res.store))
      .catch((err) => console.error("점포 정보를 불러오지 못했습니다.", err))
      .finally(() => setIsStoreInfoLoaded(true));
  }, [product?.shopName, product?.marketId]);

  const handleToggle = () => {
    onToggleBookmark(product);
  };

  const handleSaveMemo = async () => {
    if (!onUpdateMemo) return;
    setIsSavingMemo(true);
    try {
      await onUpdateMemo(product.id, memoText);
    } catch (err) {
      console.error("메모 저장 실패", err);
      alert("메모 저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsSavingMemo(false);
    }
  };

  // marketInfo prop은 "소비자가 지금 지도에서 둘러보고 있는 시장"(App.tsx의 selectedMarket,
  // 기본값 양동시장)이라 이 상품이 실제 어느 시장 소속인지와 무관하다 — 그대로 쓰면 다른
  // 시장 상인의 상품인데도 매장 정보 탭에 "광주 양동시장"처럼 엉뚱한 시장이 뜬다.
  // product.marketId(상품 생성 시점 스냅샷)도 상인이 나중에 시장을 바꾸면 안 갱신되므로
  // 최종 표시는 storeInfo.marketName(Store.market_id 기준 실시간 값)을 최우선으로 쓰고,
  // 아직 로딩 전이거나 점포 자체가 없는 경우에만 product.marketId → marketInfo 순으로
  // 대체한다.
  const productMarket = MARKETS_DATA.find((m) => m.id === product.marketId) || marketInfo;
  const displayMarketName = storeInfo?.marketName || productMarket.name;

  const recipes = getRecipeRecommendations(product);
  const recipe = recipes[Math.min(selectedRecipeIndex, recipes.length - 1)];
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
          {/* 상인 점포에 딸린 상품일 때만 "찜하기"가 의미가 있다 — 스캔 상품 저장(개인이
              직접 찍어 분석만 해본 기록, shopName 없음)은 실제 판매 상품이 아니라서 찜
              대상이 아니다. 여기서 눌러도 뒷단은 정상 상품 id로 착각해 토글을 시도하게
              되므로, 아예 안 보여주고 닫기 버튼만 남긴다. 상인이 "미리보기"로 자기
              상품을 볼 때도 자기 상품을 자기가 찜할 일이 없으므로 숨긴다. */}
          {product.shopName && userRole !== "merchant" && (
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
          )}
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
              className={`flex-1 min-h-10 py-3 border-b-2 transition-all flex items-center justify-center gap-1 ${
                activeTab === "description"
                  ? "border-[#0052FF] text-[#0052FF] font-extrabold"
                  : "border-transparent text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              <span>상품설명</span>
            </button>

            {/* 특정 점포에 등록된 상품이 아니라 개인이 직접 스캔해서 저장한 기록(shopName
                없음)은 보여줄 가게정보 자체가 없으므로 탭을 아예 숨긴다. */}
            {product.shopName && (
              <button
                onClick={() => setActiveTab("shop")}
                className={`flex-1 min-h-10 py-3 border-b-2 transition-all flex items-center justify-center gap-1 ${
                  activeTab === "shop"
                    ? "border-[#0052FF] text-[#0052FF] font-extrabold"
                    : "border-transparent text-[#64748B] hover:text-[#0F172A]"
                }`}
              >
                <span>가게정보</span>
              </button>
            )}

            <button
              onClick={() => setActiveTab("recipe")}
              className={`flex-1 min-h-10 py-3 border-b-2 transition-all flex items-center justify-center gap-1 ${
                activeTab === "recipe"
                  ? "border-[#0052FF] text-[#0052FF] font-extrabold"
                  : "border-transparent text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              <span>레시피 추천</span>
            </button>
          </div>
        </div>

        {/* Detail Sections Container — 위쪽 여백을 줄여서 탭 바로 밑에 제목/등록일이
            바짝 붙게 한다(스캔 상품 저장처럼 상호명이 없는 항목은 이 위 배지 줄
            왼쪽이 통째로 비어 보여서 더 휑해 보였다). */}
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-3 sm:pt-4 pb-4 sm:pb-6 space-y-5">
          {/* TAB 1: 상품설명 (Product Description) */}
          {activeTab === "description" && (
            <div className="space-y-5 animate-in fade-in duration-200">
              {/* Product Title & Basic Info Section */}
              <div className="space-y-1.5 px-1">
                <div className={`flex items-center text-xs font-bold text-[#64748B] ${product.shopName ? "justify-between" : "justify-end"}`}>
                  {product.shopName && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[#0052FF] font-bold text-sm">
                        {product.shopName}
                      </span>
                    </div>
                  )}
                  <span
                    className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border ${
                      product.grade?.startsWith("A")
                        ? "text-[#10B981] bg-emerald-50 border-emerald-100"
                        : "text-[#0052FF] bg-blue-50 border-blue-100"
                    }`}
                  >
                    {displayGrade(product.grade)} 
                  </span>
                </div>

                <h2 className="text-xl sm:text-2xl font-semibold text-[#0F172A] leading-snug">
                  {formatProductDisplayTitle(product)}
                </h2>

                {formatRelativeTime(product.createdAt) && (
                  <p className="text-[11px] text-[#94A3B8] font-medium">
                    {formatRelativeTime(product.createdAt)} 등록
                  </p>
                )}

                {product.tags && (
                  <div className="flex flex-wrap gap-1.5">
                    {product.tags.split(",").filter(Boolean).map((tag) =>
                      onSearchTag ? (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => onSearchTag(tag.trim())}
                          className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold hover:bg-emerald-100 active:scale-95 transition-all cursor-pointer"
                          title={`${tag.trim()} 검색`}
                        >
                          {tag}
                        </button>
                      ) : (
                        <span
                          key={tag}
                          className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold"
                        >
                          {tag}
                        </span>
                      )
                    )}
                  </div>
                )}

                {/* Price Display: 실제 판매가 & 공공 판매가 */}
                <div className="hidden bg-[#F8FAFC] rounded-2xl p-4 border border-[#E2E8F0] grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <span className="text-xs font-medium text-[#475569] flex items-center gap-1">
                      현장 판매가
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <div className="text-xl font-semibold text-[#0F172A] mt-0.5">
                        {product.price ? `${product.price.toLocaleString()}원` : "-"}
                      </div>
                      {discountPercent(product) !== null && (
                        <span className="inline-block translate-y-px text-[11px] font-black [-webkit-text-stroke:0.25px_currentColor] text-[#0052FF] bg-blue-50 px-1.5 py-0.5 rounded-full">
                          {discountPercent(product)}% 저렴
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className="text-xs font-medium text-[#475569] flex items-center gap-1 relative">
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
                    <div className="text-xl font-semibold text-[#0F172A] mt-0.5">
                      {product.publicPrice ? `${product.publicPrice.toLocaleString()}원` : "-"}
                    </div>
                  </div>
                </div>
              </div>

              {/* 상품 소개 — 사장님이 쓴 홍보문구. 상호명은 위에서 이미 나왔으니 반복하지
                  않고, 아래 AI 분석 카드들(파란/초록 톤)과 다르게 사장님이 직접 남긴 말이라는
                  느낌이 들도록 따뜻한 색+말풍선 아이콘의 "사장님 한마디"로 감싼다. */}
              {product.description && (
                <div className="hidden bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.9)]">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-700 mb-1.5">
                    <span className="material-symbols-outlined text-base">chat_bubble</span>
                    사장님 한마디
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed font-medium">{product.description}</p>
                </div>
              )}

              {/* AI Metrics Breakdown */}
              <div className="bg-white rounded-2xl p-4 pb-5 sm:p-5 sm:pb-6 border border-[#E2E8F0] shadow-[0_4px_12px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] space-y-3">
                <div className="grid grid-cols-2 gap-3 pb-3 border-b border-[#D1D1D1]">
                  <div>
                    <span className="text-xs font-bold text-[#0F172A] h-4 flex items-center">현장 판매가</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <div className="text-xl font-semibold text-[#0F172A] mt-0.5">
                        {product.price ? `${product.price.toLocaleString()}원` : "-"}
                      </div>
                      {discountPercent(product) !== null && (
                        <span className="inline-block translate-y-px text-[11px] font-semibold text-[#0052FF] bg-blue-50 px-1.5 py-0.5 rounded-full">
                          {discountPercent(product)}% 저렴
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className="text-xs font-bold text-[#0F172A] h-4 flex items-center gap-1 relative">
                      공공 시세
                      <button
                        type="button"
                        onClick={() => setShowPublicPriceInfo((v) => !v)}
                        className="material-symbols-outlined text-xs text-slate-400 hover:text-slate-600 cursor-pointer leading-none"
                        style={{ fontSize: "14px" }}
                        title="한국농수산식품유통공사(KAMIS)에서 제공하는 최신 소매 평균 시세입니다."
                      >
                        info
                      </button>
                      {showPublicPriceInfo && (
                        <div className="absolute left-0 top-full mt-1 z-20 w-56 bg-[#0F172A] text-white text-[11px] font-medium leading-relaxed rounded-lg p-2.5 shadow-xl">
                          한국농수산식품유통공사(KAMIS)에서 제공하는 해당 품목의 최신 소매 평균 시세입니다.
                        </div>
                      )}
                    </span>
                    <div className="text-xl font-semibold text-[#0F172A] mt-0.5">
                      {product.publicPrice ? `${product.publicPrice.toLocaleString()}원` : "-"}
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold text-[#0F172A] tracking-wider">
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
                  {qualityMetrics.map((metric, index) => {
                    const color = getMetricColor(metric.grade);
                    return (
                      <div key={metric.label} className={index > 0 ? "border-t border-[#D1D1D1] pt-3" : ""}>
                        <div className="flex justify-between items-center text-xs mb-1">
                          <span className="font-bold" style={{ color: getMetricLabelColor(metric.label) }}>{metric.label}</span>
                          <span className="text-sm font-black" style={{ color }}>{metric.grade}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {[0, 1, 2].map((rank) => {
                            const isActive = rank <= 2 - GRADE_RANK[metric.grade];
                            return (
                              <div
                                key={rank}
                                className="relative h-2.5 rounded-md overflow-hidden border border-slate-300 border-t-white/70 bg-slate-200 shadow-[inset_0_2px_4px_rgba(15,23,42,0.16),inset_0_-1px_1px_rgba(255,255,255,0.75)]"
                                style={isActive ? { backgroundColor: color } : undefined}
                              >
                                <div aria-hidden="true" className="pointer-events-none absolute inset-x-1 top-px h-px rounded-full bg-white/60" />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {product.aiSummary && (
                  <div className="border-t border-[#D1D1D1] pt-3 space-y-2">
                    <div className="font-extrabold text-[#0052FF] flex items-center gap-1.5 text-xs">
                      AI 스캔 종합 의견
                    </div>
                    <p className="text-slate-700 font-medium text-xs leading-relaxed">{product.aiSummary}</p>
                  </div>
                )}
              </div>

              {product.description && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.9)]">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-700 mb-1.5">
                    <span className="material-symbols-outlined text-base">chat_bubble</span>
                    사장님 한마디
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed font-medium">{product.description}</p>
                </div>
              )}

              {/* AI 스캔 종합 의견 — 실제 카메라 AI 스캔(제미나이)을 거친 상품에만 있는 값이라,
                  없으면(수동 등록 상품) 이 섹션 자체를 숨긴다. 상인이 직접 쓴 상품 소개는
                  위쪽에 별도로 보여준다. */}
              {product.aiSummary && (
                <div className="hidden text-xs text-[#475569] bg-white p-5 rounded-2xl border border-[#E2E8F0] shadow-[0_4px_12px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] leading-relaxed space-y-2">
                  <div className="font-extrabold text-[#0052FF] flex items-center gap-1.5 text-xs">
                    <span className="material-symbols-outlined text-base">psychology</span>
                    AI 스캔 종합 의견
                  </div>
                  <p className="text-slate-700 font-medium text-xs leading-relaxed">{product.aiSummary}</p>
                </div>
              )}

              {/* 내 메모 — 소비자가 스캔해서 저장해둔 상품에 직접 남기는 개인 메모.
                  isSavedScanRecord(저장 탭에서 연 내 스캔 기록)에서만 뜨고, 상인 미리보기나
                  일반 피드에서 보는 화면에는 안 보인다. isScannedProduct는 상인 상품에도
                  붙는 값이라(스캔이 등록 필수라서) 이 구분에 못 쓴다 — 실제로 그것 때문에
                  미리보기/피드에도 메모칸이 잘못 뜨던 버그가 있었다. */}
              {product.isSavedScanRecord && onUpdateMemo && (
                <div className="text-xs text-[#475569] bg-white p-5 rounded-2xl border border-[#E2E8F0] shadow-[0_2px_8px_rgba(0,0,0,0.03)] leading-relaxed space-y-2.5">
                  <div className="font-extrabold text-amber-600 flex items-center gap-1.5 text-xs">
                    <span className="material-symbols-outlined text-base">edit_note</span>
                    내 메모
                  </div>
                  <textarea
                    value={memoText}
                    onChange={(e) => setMemoText(e.target.value)}
                    placeholder="이 상품에 대해 나만 보는 메모를 남겨보세요 (예: 가격 괜찮았음, 다음엔 여기서 사기)"
                    rows={3}
                    className="w-full resize-none rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs font-medium text-[#334155] placeholder-[#94A3B8] focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleSaveMemo}
                      disabled={isSavingMemo || memoText === (product.memo || "")}
                      className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[11px] font-extrabold transition-colors flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <span className="material-symbols-outlined text-sm">
                        {isSavingMemo ? "sync" : "save"}
                      </span>
                      <span>{isSavingMemo ? "저장 중..." : "메모 저장"}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* 찍은 위치로 이동하기 — 위치 권한을 허용하고 스캔한 개인 기록만 좌표가
                  있어서 버튼이 뜬다. 특정 점포가 아니라 좌표 하나라 지도에서 그 지점으로
                  이동만 시키고(핀/도슨트 없음), 시장 경계·점포 목록은 건드리지 않는다. */}
              {onNavigateToScanLocation &&
                typeof product.scanLat === "number" &&
                typeof product.scanLng === "number" && (
                  <button
                    type="button"
                    onClick={() => onNavigateToScanLocation(product.scanLat!, product.scanLng!)}
                    className="w-full bg-white hover:bg-slate-50 text-[#0052FF] py-3 px-4 rounded-2xl font-extrabold text-xs shadow-[0_2px_8px_rgba(0,0,0,0.03)] border border-[#E2E8F0] transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-base">location_on</span>
                    <span>사진 찍은 위치로 이동하기</span>
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </button>
                )}
            </div>
          )}

          {/* TAB 2: 가게정보 (Shop Information) */}
          {activeTab === "shop" && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl p-5 border border-[#E2E8F0] shadow-[0_2px_8px_rgba(0,0,0,0.03)] space-y-4">
                <div className="space-y-2 pb-2">
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-xl font-bold text-[#0F172A] leading-none">{product.shopName}</h3>
                    {storeInfo && (
                      <span className="text-xs font-extrabold text-white bg-[#00C875]/90 px-2 py-0.5 rounded-full border border-[#00A864]/80">
                        인증 상점
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[#475569] flex items-center gap-1.5 font-medium">
                    <span className="material-symbols-outlined text-base text-[#475569]">location_on</span>
                    {displayMarketName} 내 위치
                  </p>
                </div>

                {!isStoreInfoLoaded ? (
                  <div className="py-6 flex justify-center">
                    <div className="w-6 h-6 border-4 border-[#0052FF] border-t-transparent rounded-full animate-spin"></div>
                  </div>
                ) : (
                  <>
                    {/* 필드 순서/이름을 마이 탭의 "점포 상세 정보"(MyWallet.tsx)와 맞춘다 —
                        상호명→위치→전화번호→영업시간→주요 품목. 소속 전통시장은 바로 위
                        "OO시장 내 위치" 캡션에 이미 나오므로 여기서 또 보여주면 중복이라
                        뺐다. 골목(alley)은 지도 CSV로 들어온 옛 데이터에만 남아있는 필드라
                        사장님이 직접 관리하는 값이 아니다 — 실제 주소가 비어있는 옛 점포에서
                        골목만 대신 보여주면 오히려 헷갈리므로 빼고, 다른 필드들처럼 없으면
                        "정보 없음"으로 정직하게 보여준다. */}
                    <div className="bg-[#F8FAFC] rounded-xl p-3.5 border border-[#E2E8F0] space-y-1.5 shadow-[inset_0_2px_4px_rgba(15,23,42,0.12),inset_0_-1px_1px_rgba(255,255,255,0.8)]">
                      <span className="text-[11px] font-bold text-[#0F172A] block">점포 한줄 안내 / 소개</span>
                      <p className="text-sm text-[#0F172A] leading-relaxed font-medium">
                        {storeInfo?.storyText || "아직 등록된 점포 소개글이 없습니다."}
                      </p>
                    </div>

                    <div className="border-t border-[#E2E8F0] pt-3 space-y-2 text-xs divide-y divide-[#F1F5F9]">
                      <div className="flex justify-between py-1.5">
                        <span className="text-sm text-[#0F172A] font-medium">상호명</span>
                        <span className="font-semibold text-[#0F172A]">{product.shopName}</span>
                      </div>
                      <div className="flex justify-between py-1.5 gap-3">
                        <span className="text-sm text-[#0F172A] font-medium shrink-0">위치</span>
                        <span className="font-semibold text-[#0F172A] text-right max-w-[240px]">
                          {storeInfo?.address || "정보 없음"}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5">
                        <span className="text-sm text-[#0F172A] font-medium">전화번호</span>
                        {storeInfo?.phone ? (
                          <a
                            href={`tel:${storeInfo.phone}`}
                            className="font-semibold text-[#0F172A] hover:underline flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-xs">call</span>
                            {storeInfo.phone}
                          </a>
                        ) : (
                          <span className="font-semibold text-[#0F172A]">정보 없음</span>
                        )}
                      </div>
                      <div className="flex justify-between py-1.5">
                        <span className="text-sm text-[#0F172A] font-medium">영업시간</span>
                        <span className="font-semibold text-[#0F172A]">{storeInfo?.hours || "정보 없음"}</span>
                      </div>
                      <div className="flex justify-between py-1.5">
                        <span className="text-sm text-[#0F172A] font-medium">주요 품목</span>
                        {/* 점포에 등록된 주요 품목이 없을 때 지금 보고 있는 상품의 카테고리로
                            대신 채우면, 그 점포가 실제로는 다른 걸 팔면서도 마치 이 상품
                            카테고리가 주력인 것처럼 보여서 오해를 준다 — 정직하게 미등록 표시. */}
                        <span className="font-semibold text-[#0F172A]">{storeInfo?.subtitle || "미등록"}</span>
                      </div>
                    </div>

                    {/* Shop Description Box */}
                    <div className="hidden bg-[#F8FAFC] rounded-xl p-3 border border-[#E2E8F0] space-y-1">
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
              <div className="space-y-2.5">
                <div className="flex items-center justify-between pb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-blue-50 text-[#0052FF] flex items-center justify-center">
                      <span className="material-symbols-outlined text-xl">play_circle</span>
                    </div>
                    <h3 className="text-base font-bold text-[#0F172A]">추천 레시피</h3>
                  </div>
                </div>

                {/* 요리를 2가지씩 준비해뒀으니, 마음에 드는 쪽으로 골라볼 수 있게 한다. */}
                {recipes.length > 1 && (
                  <div className="flex gap-1.5">
                    {recipes.map((r, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedRecipeIndex(idx)}
                        className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors cursor-pointer ${
                          idx === selectedRecipeIndex
                            ? "bg-[#e8ecfc] border-[#e8ecfc] text-[#0F172A]"
                            : "bg-white border-[#E2E8F0] text-[#64748B] hover:bg-slate-50"
                        }`}
                      >
                        {r.dishTitle}
                      </button>
                    ))}
                  </div>
                )}

                {/* Video Banner Card — 안드로이드 WebView는 target="_blank" 링크를 열어줄 새
                    탭이 없어서 그냥 아무 반응이 없다. Capacitor Browser 플러그인으로 외부
                    브라우저(커스텀 탭)를 직접 띄운다. 썸네일 자체를 눌러도 바로 영상으로
                    이동하도록 카드 전체에 클릭 핸들러를 둔다. */}
                <div
                  role="button"
                  onClick={() => Browser.open({ url: recipe.youtubeUrl })}
                  className="relative w-full rounded-2xl overflow-hidden border border-slate-200 bg-slate-900 group shadow-sm cursor-pointer active:scale-[0.99] transition-transform"
                >
                  {recipe.youtubeThumbnailUrl ? (
                    <img
                      key={recipe.youtubeThumbnailUrl}
                      src={recipe.youtubeThumbnailUrl}
                      alt={recipe.dishTitle}
                      className="w-full h-56 sm:h-64 object-cover opacity-85 group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        // hqdefault는 모든 유튜브 영상에 항상 있어서 평소엔 여기로 올 일이
                        // 없다 — 영상이 삭제/비공개로 바뀐 경우에만 상품 사진으로 낮춘다.
                        const img = e.currentTarget;
                        if (img.dataset.fallback !== "product") {
                          img.dataset.fallback = "product";
                          img.src = product.imageUrl;
                        }
                      }}
                    />
                  ) : (
                    <div className="w-full h-56 sm:h-64 bg-gradient-to-tr from-slate-900 via-slate-800 to-blue-950 flex items-center justify-center" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent flex flex-col justify-end p-4">
                    <div className="hidden">
                      <span className="bg-[#0052FF] text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-md shadow-sm flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs">restaurant_menu</span>
                        레시피 아이디어
                      </span>
                    </div>

                    <div className="space-y-1">
                      <h4 className="text-xl font-semibold text-white leading-tight drop-shadow-md">
                        {recipe.dishTitle}
                      </h4>
                      <p className="text-sm text-slate-200 font-medium flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-xs">play_circle</span>
                        <span>눌러서 이 레시피 영상 보기</span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-[#D1D1D1]" />

              {/* 2. Recipe Required Ingredients & Market Recommendations */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-[#0F172A]">재료 목록</h3>
                </div>

                {/* Required Ingredients Checklist — 계량(스푼/g 등)은 빼고 재료 이름만
                    보여준다. 정확한 분량이 궁금하면 위 영상을 보면 되고, 여기서는 "이
                    시장에서 뭘 사야 하는지"만 한눈에 훑기 좋게 한다. */}
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    {recipe.ingredientsList.map((ing, idx) => (
                      <div
                        key={idx}
                        className="min-h-12 px-3 py-2 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] flex items-center gap-2 text-sm font-bold text-[#0F172A] shadow-[0_2px_6px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]"
                      >
                        <span className="w-2 h-2 rounded-full bg-[#0052FF]" />
                        <span>{ing.name.replace(/\s*\(\s*본\s*상품\s*\)\s*/g, "")}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 재료 목록이 그냥 정보용 텍스트로 끝나지 않게, 지금 이 시장에 실제로
                    등록된 상품/점포와 매칭해서 지도에서 바로 보여준다. */}
                {onNavigateToRecipeMap && (
                  <button
                    type="button"
                    onClick={() =>
                      // 소금 약간, 후추 약간처럼 굳이 사러 갈 필요 없는 조미료까지 지도
                      // 체크리스트/장보기 동선에 다 넣으면 부담스러우니, 실제로 사야 할
                      // 주재료(isMain)만 추려서 넘긴다.
                      onNavigateToRecipeMap(
                        recipe.ingredientsList.filter((ing) => ing.isMain).map((ing) => ing.name)
                      )
                    }
                    className="w-full bg-[#0052FF] hover:bg-[#0043D6] text-white py-3 px-4 rounded-xl font-extrabold text-xs shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-lg">map</span>
                    <span>지도에서 재료 위치 확인</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
