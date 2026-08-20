import React, { useState, useEffect, useMemo, useRef } from "react";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { MarketInfo } from "../types";
import { MARKETS_DATA } from "../data/initialData";
import {
  fetchMapConfig,
  fetchMapStores,
  fetchDocentStory,
  fetchMarketBoundaries,
  geocodeAddress,
  searchPlace,
  MapStorePin,
  MarketBoundary,
} from "../lib/api";

interface MapViewProps {
  selectedMarket: MarketInfo;
  // 검색으로 다른 전통시장(양동/망원/자갈치)을 고르면 지도가 그 시장으로 전환된다.
  onSelectMarket?: (market: MarketInfo) => void;
  onOpenAiScan: () => void;
  // 상품 상세 등 다른 화면에서 "이 상점 지도에서 확인하기"로 넘어왔을 때, 그 상점으로
  // 바로 이동/포커스하기 위한 이름. 처리 후 onFocusHandled로 부모 쪽 상태를 비운다.
  focusShopName?: string | null;
  onFocusHandled?: () => void;
  // 상품 상세의 "찍은 위치로 이동하기"에서 넘어온 좌표 — 특정 점포가 아니라 GPS 좌표
  // 하나라 focusShopName(점포 목록에서 이름으로 찾기)과는 다른 경로다. 핀/도슨트 없이
  // 그 지점으로 지도만 이동시킨다.
  focusCoordinate?: { lat: number; lng: number } | null;
  onFocusCoordinateHandled?: () => void;
  // 상품 상세에서 넘어온 경우에만 채워진다 — 있을 때만 뒤로가기 버튼을 보여주고,
  // 누르면 원래 보던 상품 상세로 돌아간다. 하단 탭에서 지도 탭을 직접 눌러 들어온
  // 경우엔 없으므로 버튼도 안 뜬다.
  onBack?: () => void;
  // 상품 상세의 레시피 탭 "지도에서 재료 위치 확인"에서 넘어온 재료 이름 목록.
  // 있으면 이 시장의 실제 점포/등록 상품과 매칭해서 체크리스트 + 마커 강조 +
  // 아래 recipeStartShopName(있으면) 또는 내 위치에서 출발하는 최단 동선(직선거리 기준)을
  // 보여준다.
  recipeIngredients?: string[] | null;
  // 지금 보고 있던 상품(예: 양파)을 실제로 파는 점포 이름 — 있으면 장보기 동선을 "내
  // 위치"가 아니라 이 점포부터 출발하는 걸로 계산한다. 그 재료를 이미 여기서 사기로
  // 하고 온 거니, 동선도 여기서부터 나머지 재료를 도는 게 실제 장보기 흐름에 맞는다.
  recipeStartShopName?: string | null;
}

const NAVER_SCRIPT_ID = "naver-maps-sdk";
// Stores sit only meters apart inside the same market building, so pins overlap
// badly when zoomed out. Only show them once the user has zoomed in close enough
// to tell them apart.
const MIN_ZOOM_FOR_MARKERS = 19;

// "다른 시장들" 경계선을 전부 같은 회색으로 그리면 여러 시장이 한 화면에 같이 보일 때
// 서로 구분이 안 된다 — 시장마다 고정 팔레트에서 하나씩 골라 색을 다르게 준다. 강조 핀의
// 빨강, 선택된 시장의 브랜드 블루와는 겹치지 않는 색만 골랐다. market_id로 고정 인덱스를
// 뽑아서 같은 시장은 항상 같은 색이 나오게 한다(매번 랜덤이면 헷갈림).
const OTHER_MARKET_BOUNDARY_COLORS = ["#F59E0B", "#10B981", "#8B5CF6", "#06B6D4", "#84CC16", "#F97316"];
function getMarketBoundaryColor(marketId: string): string {
  // djb2 계열 해시 — 단순 곱셈 누적(hash*31+c)은 "yangdong"/"malbawi"처럼 실제 쓰는
  // market_id 몇 개가 같은 색으로 충돌해서(둘 다 초록) 정작 구분이 필요한 두 시장이
  // 똑같아 보이는 문제가 있었다. XOR를 섞으면 짧은 문자열에서도 충돌이 훨씬 줄어든다.
  let hash = 5381;
  for (let i = 0; i < marketId.length; i++) {
    hash = ((hash * 33) ^ marketId.charCodeAt(i)) >>> 0;
  }
  return OTHER_MARKET_BOUNDARY_COLORS[hash % OTHER_MARKET_BOUNDARY_COLORS.length];
}
// Web Speech API에는 재생 전 실제 길이를 알려주는 값이 없어서, 텍스트 길이로 추정한다.
// rate=0.95 기준 한국어 TTS 체감 속도로 보정한 값 — 브라우저/음성엔진마다 다를 수 있는 근사치.
const SPEECH_RATE = 0.95;
const KOREAN_CHARS_PER_SECOND = 6;

function estimateSpeechSeconds(text: string): number {
  return Math.max(1, Math.round(text.length / KOREAN_CHARS_PER_SECOND));
}

function formatSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// 네이버 Direction API는 자동차 경로만 지원해서(도보 경로 없음) 새 API 연동 없이,
// 직선거리(하버사인 공식) 기준 최근접 이웃으로 방문 순서를 정한다. 시장 안 점포들은
// 서로 몇십~몇백 미터 안에 다닥다닥 붙어있어서, 실제 골목길과 직선거리 차이가 크지
// 않다 — 정확한 턴바이턴 안내보다 "대충 이 순서로 돌면 된다" 정도로 충분하다.
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// 평균 도보 속도 약 4km/h(분당 67m) 기준 — 시장 안에서는 사람이 많아 이보다 느릴 수 있지만
// 대략적인 소요시간 감으로 충분하다.
const WALK_METERS_PER_MIN = 67;

function buildNearestNeighborRoute<T extends { lat: number; lng: number }>(
  start: { lat: number; lng: number },
  points: T[]
): { order: T[]; totalMeters: number } {
  const remaining = [...points];
  const order: T[] = [];
  let cursor = start;
  let totalMeters = 0;
  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    remaining.forEach((p, idx) => {
      const d = haversineMeters(cursor, p);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = idx;
      }
    });
    const [next] = remaining.splice(nearestIdx, 1);
    order.push(next);
    totalMeters += nearestDist;
    cursor = next;
  }
  return { order, totalMeters };
}

// 양동시장 전체 범위를 지도 위에 하나의 영역으로 보여주기 위해, 463개 실제 점포
// 좌표(위도/경도)의 컨벡스 헐(볼록 껍질)을 계산해 시장 외곽선으로 쓴다. 공식 행정
// 경계 데이터가 없어서 "실제 점포들이 위치한 범위"로 근사한 것 — 완벽한 시장 부지
// 경계는 아니지만, 점포 좌표 자체가 실측 공공데이터라 대략적인 범위는 정확하다.
function computeConvexHull(points: { lat: number; lng: number }[]): { lat: number; lng: number }[] {
  if (points.length < 3) return points;

  const sorted = [...points].sort((a, b) => (a.lng - b.lng) || (a.lat - b.lat));

  const cross = (
    o: { lat: number; lng: number },
    a: { lat: number; lng: number },
    b: { lat: number; lng: number }
  ) => (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);

  const lower: { lat: number; lng: number }[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: { lat: number; lng: number }[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

// isFocused: 다른 화면에서 "이 상점"으로 지목되어 넘어왔거나(포커스), 방금 클릭해서
// activePin이 된 마커. 주변 점포 핀과 색/모양이 거의 같아서 눈에 안 띈다는 피드백이 있어,
// 크기를 키우고 강렬한 빨간색으로 바꾸고 통통 튀는 애니메이션(animate-bounce)을 준다.
// 카테고리 기본색을 전부 브랜드 블루로 통일해서(gwangju_market_data.py), 빨강은 이제
// 강조 마커에만 쓰는 색이라 충돌이 없다.
// routeOrder: 레시피 재료 장보기 동선에 포함된 점포면 방문 순서(1, 2, 3...) 뱃지를 초록색
// 링과 함께 보여준다 — isFocused(빨강)와는 다른 강조라 서로 안 겹치게 색을 분리했다.
// 점포가 많은 시장(양동시장 400개+)에서는 핀마다 항상 떠 있는 이름표(흰 알약 라벨)가
// 서로 겹쳐서 지도가 "난잡하다"는 피드백이 있었다. 이름표는 정말 필요할 때(방금 탭한 핀,
// 레시피 장보기 동선에 포함된 핀)만 보여주고, 나머지는 아이콘만 남겨서 겹침을 줄인다 —
// 이름 자체는 핀을 탭하면 하단 AI 도슨트 패널에 바로 뜨므로 정보가 사라지는 게 아니다.
function buildMarkerContent(
  store: MapStorePin,
  isFocused: boolean,
  routeOrder?: number,
  isStart?: boolean
): string {
  const showLabel = isFocused || !!routeOrder || !!isStart;
  const productBadge = store.products.length
    ? `<span class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-bold flex items-center justify-center border border-white">${store.products.length}</span>`
    : "";
  // 출발점은 방문 순번(초록 원형 숫자)과는 다른 강조라 — "여기서부터 시작"이라는 뜻의
  // 파란 깃발 뱃지를 쓴다. 출발점 자체는 matchedRecipeStores에서 빠지므로 routeOrder와
  // 동시에 뜰 일은 없다.
  const routeBadge = isStart
    ? `<span class="absolute -bottom-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#0052FF] text-white text-[11px] font-extrabold flex items-center justify-center border-2 border-white shadow-sm">
        <span class="material-symbols-outlined" style="font-size:12px;">flag</span>
      </span>`
    : routeOrder
    ? `<span class="absolute -bottom-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#10B981] text-white text-[10px] font-extrabold flex items-center justify-center border-2 border-white shadow-sm">${routeOrder}</span>`
    : "";
  const pinColor = isFocused ? "#EF4444" : isStart ? "#0052FF" : store.badge_color;
  const pinSizeClass = isFocused ? "w-12 h-12" : "w-9 h-9";
  const iconSizeClass = isFocused ? "text-2xl" : "text-lg";
  const bounceClass = isFocused ? "animate-bounce" : "";
  const ringStyle = isStart
    ? "box-shadow:0 0 0 4px rgba(0,82,255,0.5);"
    : routeOrder
    ? "box-shadow:0 0 0 4px rgba(16,185,129,0.5);"
    : "";
  const labelBorderClass = isFocused ? "border-[#EF4444]" : isStart ? "border-[#0052FF]" : "border-[#10B981]";
  const label = showLabel
    ? `
      <span class="text-xs font-bold bg-white px-2 py-0.5 rounded-md mt-0.5 shadow-sm border ${labelBorderClass}" style="color:${pinColor}">
        ${isStart ? "출발점 · " : ""}${store.name}
      </span>`
    : "";
  return `
    <div class="flex flex-col items-center cursor-pointer group ${bounceClass}">
      <div class="relative ${pinSizeClass} text-white rounded-full flex items-center justify-center shadow-lg border-2 border-white group-hover:scale-110 transition-transform" style="background:${pinColor};${ringStyle}">
        <span class="material-symbols-outlined ${iconSizeClass}">${store.icon}</span>
        ${productBadge}
        ${routeBadge}
      </div>
      ${label}
    </div>
  `;
}

export const MapView: React.FC<MapViewProps> = ({
  selectedMarket,
  onSelectMarket,
  onOpenAiScan,
  focusShopName,
  onFocusHandled,
  focusCoordinate,
  onFocusCoordinateHandled,
  onBack,
  recipeIngredients,
  recipeStartShopName,
}) => {
  // 키보드가 올라오면 안드로이드 웹뷰가 실제 뷰포트 높이(window.innerHeight)를 줄여버려서,
  // h-screen(100vh) 기준으로 top-1/3, bottom-Npx로 배치해둔 줌 버튼/현재 위치 버튼이 화면
  // 안에서 위로 솟구쳐 올라오는 것처럼 보였다(검색창 탭할 때 특히 눈에 띔). 마운트 시점의
  // 높이를 한 번만 고정해서 화면 컨테이너에 적용하면, 키보드가 열려도 이 컨테이너의 크기가
  // 바뀌지 않으니 그 안의 상대 위치(top-1/3 등)도 그대로 유지된다.
  const [frozenViewportHeight] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  const [isPlayingDocent, setIsPlayingDocent] = useState(false);
  const [docentElapsedSec, setDocentElapsedSec] = useState(0);
  const [docentTotalSec, setDocentTotalSec] = useState(1);
  const docentProgress = docentTotalSec > 0 ? Math.min(100, (docentElapsedSec / docentTotalSec) * 100) : 0;
  const [currentScript, setCurrentScript] = useState("");
  const [isDocentLoading, setIsDocentLoading] = useState(false);
  const [isDocentExpanded, setIsDocentExpanded] = useState(false); // 기본적으로 하단 배너 위에 살짝 나와있게 시작
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [activePin, setActivePin] = useState<string | null>(null);
  const [naverLoaded, setNaverLoaded] = useState(false);
  // 체크리스트 X를 누르면 완전히 사라지는 대신 오른쪽에 작은 탭으로 접혀 있다가 다시
  // 눌러서 펼칠 수 있게 한다 — 새로 다른 레시피로 들어오면(재료 목록이 바뀌면) 이전에
  // 접어뒀던 상태가 남아있지 않게 펼친 상태로 초기화한다.
  const [isRecipeChecklistMinimized, setIsRecipeChecklistMinimized] = useState(false);
  useEffect(() => {
    setIsRecipeChecklistMinimized(false);
  }, [recipeIngredients]);
  // 재료 구성이 같은 레시피(정렬한 재료 이름 목록이 같음)는 같은 키를 갖는다 — 그
  // 레시피로 다시 들어오면 전에 빼뒀던 재료/골라둔 점포를 이 기기에서 그대로 복원한다.
  const recipeCartKey = useMemo(() => {
    if (!recipeIngredients || recipeIngredients.length === 0) return null;
    return `marketlog:recipeCart:${[...recipeIngredients].sort().join("|")}`;
  }, [recipeIngredients]);

  // 체크리스트에서 "이미 있어요"로 뺀 재료 — 동선/방문 순번 계산에서 제외된다.
  const [excludedIngredients, setExcludedIngredients] = useState<Set<string>>(new Set());
  // 후보가 여러 곳인 재료에서 사용자가 직접 고른 점포 — {재료명: storeId}.
  const [selectedStoreByIngredient, setSelectedStoreByIngredient] = useState<Record<string, string>>({});
  // 레시피가 바뀌면(recipeCartKey 변경) 이 기기에 저장해둔 이전 선택을 불러온다 — 없으면
  // 빈 상태로 시작한다.
  useEffect(() => {
    if (!recipeCartKey) {
      setExcludedIngredients(new Set());
      setSelectedStoreByIngredient({});
      return;
    }
    try {
      const raw = localStorage.getItem(recipeCartKey);
      const saved = raw ? JSON.parse(raw) : null;
      setExcludedIngredients(new Set(saved?.excluded || []));
      setSelectedStoreByIngredient(saved?.selected || {});
    } catch {
      setExcludedIngredients(new Set());
      setSelectedStoreByIngredient({});
    }
  }, [recipeCartKey]);
  // 선택이 바뀔 때마다 이 기기에 저장한다 — 다음에 같은 레시피로 들어오면 위 효과가
  // 다시 불러온다.
  useEffect(() => {
    if (!recipeCartKey) return;
    try {
      localStorage.setItem(
        recipeCartKey,
        JSON.stringify({ excluded: [...excludedIngredients], selected: selectedStoreByIngredient })
      );
    } catch {
      // localStorage 용량 초과 등 — 저장이 안 되더라도 체크리스트 자체는 계속 동작해야
      // 하니 조용히 무시한다(새로고침하면 이번 선택만 못 불러오는 정도).
    }
  }, [recipeCartKey, excludedIngredients, selectedStoreByIngredient]);
  const toggleIngredientExcluded = (ingredient: string) => {
    setExcludedIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(ingredient)) next.delete(ingredient);
      else next.add(ingredient);
      return next;
    });
  };
  const [stores, setStores] = useState<MapStorePin[]>([]);
  // 줌아웃했을 때 같이 보여줄 "다른 시장들" 경계선 원좌표 — 시장 하나 보는 동안 계속 바뀌는
  // 값이 아니라서 selectedMarket이 바뀌어도 다시 불러올 필요 없이 최초 1회만 가져온다.
  const [allMarketBoundaries, setAllMarketBoundaries] = useState<MarketBoundary[]>([]);
  useEffect(() => {
    fetchMarketBoundaries()
      .then((res) => setAllMarketBoundaries(res.boundaries))
      .catch((err) => console.error("시장 경계선 목록을 불러오지 못했습니다.", err));
  }, []);
  // 레시피 재료 매칭은 stores가 실제로 로드된 뒤에야 의미가 있다 — 로드되기 전에
  // "이 시장엔 없음"을 보여주면, 아직 확인도 안 했으면서 마치 없는 것처럼 단정하는
  // 꼴이라 오해를 준다.
  const [storesLoaded, setStoresLoaded] = useState(false);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [geoAttempted, setGeoAttempted] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(17);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const trimmedQuery = searchQuery.trim();
  // 도슨트 재생 중 250ms 타이머, 줌 변경 등으로 이 컴포넌트가 검색어와 무관하게 자주
  // 다시 렌더링되는데, useMemo 없이는 그때마다 stores(점포 많은 시장은 수백 개) 배열을
  // 매번 다시 필터링하고 있었다. trimmedQuery/stores/selectedMarket이 실제로 바뀔 때만
  // 다시 계산한다.
  const searchResults = useMemo(
    () =>
      trimmedQuery
        ? stores
            .filter(
              (s) =>
                s.name.includes(trimmedQuery) ||
                s.subtitle.includes(trimmedQuery) ||
                s.notice.includes(trimmedQuery)
            )
            .slice(0, 8)
        : [],
    [trimmedQuery, stores]
  );
  // 검색으로 다른 전통시장도 찾아서 바로 전환할 수 있게 한다 — 예전엔 지역 선택
  // 드롭다운에서 "서울특별시" 같은 걸 고르면 지도가 몰래 다른 시장으로 바뀌었는데,
  // 지역 필터와 지도 시장 전환은 서로 다른 기능이라 분리했다.
  const marketResults = useMemo(
    () =>
      trimmedQuery
        ? MARKETS_DATA.filter(
            (m) => m.id !== selectedMarket.id && (m.name.includes(trimmedQuery) || m.city.includes(trimmedQuery))
          )
        : [],
    [trimmedQuery, selectedMarket.id]
  );

  // 로컬 필터(searchResults/marketResults)는 이미 불러온 이 시장의 점포/고정 시장 목록
  // 안에서만 찾을 수 있다 — "강남역"처럼 등록 안 된 장소나 다른 시장 밖 주소는 걸리지
  // 않는다. StoreLocationPicker(상인용 위치 등록)와 같은 네이버 검색 API(장소명)+지오코딩
  // (주소)을 여기도 붙여서, 지도에 없는 장소로도 바로 이동할 수 있게 한다. 타이핑마다
  // 호출하면 API 낭비라 디바운스를 건다.
  const [placeResults, setPlaceResults] = useState<
    { label: string; sublabel: string; lat: number; lng: number }[]
  >([]);
  const [isSearchingPlace, setIsSearchingPlace] = useState(false);

  useEffect(() => {
    if (trimmedQuery.length < 2) {
      setPlaceResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsSearchingPlace(true);
      try {
        const [placeRes, addrRes] = await Promise.allSettled([
          searchPlace(trimmedQuery),
          geocodeAddress(trimmedQuery),
        ]);
        if (cancelled) return;
        const places =
          placeRes.status === "fulfilled"
            ? placeRes.value.places.map((p) => ({
                label: p.name,
                sublabel: [p.category, p.roadAddress || p.jibunAddress].filter(Boolean).join(" · "),
                lat: p.lat,
                lng: p.lng,
              }))
            : [];
        const addresses =
          addrRes.status === "fulfilled"
            ? addrRes.value.addresses.map((a) => ({
                label: a.roadAddress || a.jibunAddress,
                sublabel: a.roadAddress && a.jibunAddress ? a.jibunAddress : "",
                lat: a.lat,
                lng: a.lng,
              }))
            : [];
        setPlaceResults([...places, ...addresses].slice(0, 6));
      } catch (err) {
        console.error("장소 검색 실패", err);
        if (!cancelled) setPlaceResults([]);
      } finally {
        if (!cancelled) setIsSearchingPlace(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery]);

  // 레시피 재료 목록을, 이 시장에 실제로 등록된 점포/상품과 이름으로 매칭한다. "액젓 &
  // 다진마늘"처럼 묶여있는 재료는 "&"/","로 쪼개 각각 시도한다.
  //
  // 예전엔 subtitle/notice에 그 글자가 어디든 포함만 되면(부분 문자열) 배열에서 먼저
  // 나오는 아무 점포나 매칭시켜서, "무"가 실제로 무를 파는 "제1장성상회"(subtitle="무")
  // 대신 우연히 텍스트가 겹친 엉뚱한 가게(예: 수산물 가게)에 매칭되는 등 말이 안 되는
  // 결과가 나왔다. subtitle은 사실 "양파.무"/"배추.파"처럼 실제 주요 품목이 "."/","/"·"로
  // 깔끔하게 나열된 필드라서, 그걸 토큰으로 쪼개 정확히 일치하는지 보는 쪽이 데이터를
  // 제대로 활용하는 것이다. notice는 "채소"/"정육점"처럼 업종 설명일 뿐 품목이 아니라서
  // 매칭에서 아예 뺀다 — 우연한 글자 겹침의 주된 원인이었다.
  const recipeMatches = useMemo(() => {
    if (!recipeIngredients || recipeIngredients.length === 0) return [];
    return recipeIngredients.map((rawName) => {
      // "(본 상품)"이 붙은 재료는 지금 보고 있던 그 상품 자체다 — 예를 들어 양파 상세에서
      // 들어왔으면 이 항목은 "양파"고, 이미 그 점포(recipeStartStore)에서 사기로 하고 온
      // 것이니 다른 점포로 바꿀 수 있는 후보가 아니라 출발점으로 고정돼야 한다.
      const isAnchor = /\(본 상품/.test(rawName);
      const cleaned = rawName.replace(/\s*\(본 상품[^)]*\)\s*/g, "").trim();
      const parts = cleaned.split(/[&,]/).map((p) => p.trim()).filter(Boolean);
      // 예전엔 첫 매칭 하나만 골랐는데, 같은 재료를 파는 점포가 시장에 여러 곳이면
      // 사용자가 직접 고를 수 있어야 한다 — 매칭되는 점포를 전부 모은다(한 파트에서
      // 매칭이 나오면 그 파트로 확정하고 다음 파트는 시도하지 않는다. "젓갈" 같은
      // 대체 키워드까지 같이 후보로 섞이면 원래 재료와 무관한 게 섞여 보이므로).
      let candidates: MapStorePin[] = [];
      for (const part of parts) {
        if (!part) continue;
        // 1순위: 상인이 실제 등록한 상품명과 일치
        const productMatches = stores.filter((s) =>
          s.products.some((p) => p.title.includes(part) || part.includes(p.title))
        );
        if (productMatches.length > 0) {
          candidates = productMatches;
          break;
        }
        // 2순위: 점포 "주요 품목"(subtitle)을 토큰 단위로 쪼갰을 때 정확히 일치
        const tokenMatches = stores.filter((s) =>
          s.subtitle
            .split(/[.,·]/)
            .map((t) => t.trim())
            .some((token) => token === part)
        );
        if (tokenMatches.length > 0) {
          candidates = tokenMatches;
          break;
        }
      }
      // 가까운 점포부터 보여줘야 고르기 편하다 — 시장 중심 기준 거리순 정렬.
      if (mapCenter) {
        candidates = [...candidates].sort(
          (a, b) => haversineMeters(a, mapCenter) - haversineMeters(b, mapCenter)
        );
      }
      return { ingredient: cleaned, candidates, isAnchor };
    });
  }, [recipeIngredients, stores, mapCenter]);

  // 지금 후보를 펼쳐서 고르는 중인 재료 — 한 번에 하나만 펼친다.
  const [expandedIngredient, setExpandedIngredient] = useState<string | null>(null);
  useEffect(() => {
    setExpandedIngredient(null);
  }, [recipeIngredients]);

  const getChosenStore = (m: {
    ingredient: string;
    candidates: MapStorePin[];
    isAnchor: boolean;
  }): MapStorePin | null => {
    // 지금 보고 있던 상품 자체(예: 양파)는 이미 출발점 점포에서 사기로 정해진 것이니
    // 후보 중에서 고르게 하지 않고 항상 그 출발점 점포로 고정한다.
    if (m.isAnchor && recipeStartStore) return recipeStartStore;
    if (m.candidates.length === 0) return null;
    const chosenId = selectedStoreByIngredient[m.ingredient];
    return m.candidates.find((s) => s.id === chosenId) || m.candidates[0];
  };

  // 출발점으로 쓸 점포(예: 지금 보던 양파를 파는 점포) — 있으면 동선이 "내 위치"
  // 대신 여기서부터 시작한다. 상인이 "점포 위치 등록"에서 잘못된 곳을 찍어둔 경우(실제로
  // 시장에서 수km 떨어진 좌표로 등록된 사례가 있었음) 그 좌표를 그대로 출발점으로 쓰면
  // 동선이 시내를 가로지르는 말도 안 되는 길이로 계산되고, 지도도 그걸 다 담으려고
  // 확 축소돼서 정작 시장 안은 하나도 안 보이게 된다 — 시장 중심(mapCenter, 공공
  // 데이터 기준이라 신뢰 가능)에서 너무 멀면 이 점포는 출발점으로 못 믿고 무시한다.
  const MAX_START_STORE_FROM_MARKET_METERS = 1000;
  const recipeStartStore = useMemo(() => {
    if (!recipeStartShopName) return null;
    const found = stores.find((s) => s.name === recipeStartShopName);
    if (!found) return null;
    if (mapCenter && haversineMeters(found, mapCenter) > MAX_START_STORE_FROM_MARKET_METERS) return null;
    return found;
  }, [recipeStartShopName, stores, mapCenter]);

  const matchedRecipeStores = useMemo(() => {
    const seen = new Set<string>();
    const list: MapStorePin[] = [];
    recipeMatches.forEach((m) => {
      // "이미 있어요"로 뺀 재료는 동선에서도 뺀다. 출발점 그 자체인 점포는 이미 거기서
      // 사기로 하고 온 것이니 별도 방문지로 다시 들를 필요가 없다.
      if (excludedIngredients.has(m.ingredient)) return;
      const store = getChosenStore(m);
      if (store && store.id === recipeStartStore?.id) return;
      if (store && !seen.has(store.id)) {
        seen.add(store.id);
        list.push(store);
      }
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeMatches, excludedIngredients, recipeStartStore, selectedStoreByIngredient]);

  // 지정된 출발 점포가 있으면 그곳에서, 없으면 내 위치(없으면 시장 중심)에서 출발해
  // 최근접 이웃 순으로 방문 순서를 정한다. 내 위치가 이 시장에서 3km 넘게 떨어져
  // 있으면(예: 집에서 그냥 레시피만 구경하는 중) "내 위치에서 걸어서 장보기 동선"은
  // 의미가 없다 — 지도가 내 위치와 시장을 억지로 한 화면에 욱여넣으려다 잔뜩 축소돼서
  // 아무것도 안 보이는 화면이 되던 원인이기도 했다. 이럴 땐 내 위치 대신 시장 중심을
  // 출발점으로 써서, 시장 안에서의 동선만 보여준다.
  const MAX_WALK_ROUTE_START_METERS = 3000;
  const recipeRouteStart = useMemo(() => {
    if (recipeStartStore) return { lat: recipeStartStore.lat, lng: recipeStartStore.lng };
    if (!mapCenter) return null;
    const useMyLocation = myLocation && haversineMeters(myLocation, mapCenter) <= MAX_WALK_ROUTE_START_METERS;
    return useMyLocation ? myLocation! : mapCenter;
  }, [recipeStartStore, myLocation, mapCenter]);

  const recipeRoute = useMemo(() => {
    if (matchedRecipeStores.length === 0 || !recipeRouteStart) return null;
    return buildNearestNeighborRoute(recipeRouteStart, matchedRecipeStores);
  }, [matchedRecipeStores, recipeRouteStart]);

  const recipeRouteStoreOrder = useMemo(() => {
    const map = new Map<string, number>();
    recipeRoute?.order.forEach((s, idx) => map.set(s.id, idx + 1));
    return map;
  }, [recipeRoute]);

  const speechStartRef = useRef<number | null>(null);
  const speechTokenRef = useRef<number>(0);
  const dragOffsetYRef = useRef<number>(0);
  const touchStartYRef = useRef<number | null>(null);
  const isDocentExpandedRef = useRef<boolean>(isDocentExpanded);
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const myLocationMarkerRef = useRef<any>(null);
  const marketBoundaryRef = useRef<any>(null);
  const marketLabelRef = useRef<any>(null);
  // 줌아웃했을 때 같이 보여주는 "다른 시장들"의 경계선/라벨 — 지금 선택된 시장(위 두 ref,
  // 진한 파란색으로 강조)과는 별개로 옅은 회색으로 그린다. 시장마다 하나씩이라 배열로 관리.
  const otherBoundaryRefs = useRef<any[]>([]);
  const otherBoundaryLabelRefs = useRef<any[]>([]);
  const recipeRouteLineRef = useRef<any>(null);

  useEffect(() => {
    isDocentExpandedRef.current = isDocentExpanded;
  }, [isDocentExpanded]);

  const handleDragStart = (clientY: number) => {
    touchStartYRef.current = clientY;
    dragOffsetYRef.current = 0;
    setTouchStartY(clientY);
    setDragOffsetY(0);
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
      const clientY = "touches" in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
      if (touchStartYRef.current !== null) {
        const diff = clientY - touchStartYRef.current;
        if (isDocentExpandedRef.current) {
          // 펼쳐졌을 때는 아래로 드래그 (양수 offset)만 허용
          const clamped = Math.max(0, diff);
          dragOffsetYRef.current = clamped;
          setDragOffsetY(clamped);
        } else {
          // 접혔을 때는 위로 드래그 (음수 offset)만 허용
          const clamped = Math.min(0, diff);
          dragOffsetYRef.current = clamped;
          setDragOffsetY(clamped);
        }
      }
    };

    const handleGlobalEnd = () => {
      const finalOffset = dragOffsetYRef.current;
      if (touchStartYRef.current !== null) {
        if (isDocentExpandedRef.current) {
          if (finalOffset > 25) {
            setIsDocentExpanded(false);
          }
        } else {
          if (finalOffset < -20) {
            setIsDocentExpanded(true);
          }
        }
      }
      touchStartYRef.current = null;
      dragOffsetYRef.current = 0;
      setTouchStartY(null);
      setDragOffsetY(0);
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleGlobalMove);
    window.addEventListener("mouseup", handleGlobalEnd);
    window.addEventListener("touchmove", handleGlobalMove, { passive: true });
    window.addEventListener("touchend", handleGlobalEnd);

    return () => {
      window.removeEventListener("mousemove", handleGlobalMove);
      window.removeEventListener("mouseup", handleGlobalEnd);
      window.removeEventListener("touchmove", handleGlobalMove);
      window.removeEventListener("touchend", handleGlobalEnd);
    };
  }, [isDragging]);

  // 시장을 바꾸면 이전 시장의 점포에 대한 도슨트 패널은 더 이상 유효하지 않으므로 닫는다.
  useEffect(() => {
    TextToSpeech.stop().catch(() => {});
    setActivePin(null);
    setCurrentScript("");
    setIsPlayingDocent(false);
    setDocentElapsedSec(0);
  }, [selectedMarket]);

  // 네이티브 TTS는 React 컴포넌트 생명주기와 무관하게 계속 재생된다 — 지도 탭에서 다른
  // 탭으로 이동하면 이 컴포넌트는 언마운트되지만, 위 speak()는 그걸 모르고 계속 말한다.
  // 언마운트 시점에 반드시 멈춰야 "지도 나갔다 와도 도슨트가 계속 재생되는" 문제가 없다.
  useEffect(() => {
    return () => {
      TextToSpeech.stop().catch(() => {});
    };
  }, []);

  // Load the Naver Maps SDK dynamically using the client ID from the backend,
  // instead of a hardcoded script tag (avoids the SDK key drifting out of sync with the backend .env).
  useEffect(() => {
    let cancelled = false;

    if ((window as any).naver && (window as any).naver.maps) {
      setNaverLoaded(true);
      return;
    }

    const existingScript = document.getElementById(NAVER_SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("load", () => {
        if (!cancelled) setNaverLoaded(true);
      });
      return;
    }

    fetchMapConfig()
      .then((config) => {
        if (cancelled) return;
        const script = document.createElement("script");
        script.id = NAVER_SCRIPT_ID;
        script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${config.naver_client_id}&submodules=geocoding`;
        script.onload = () => {
          if (!cancelled) setNaverLoaded(true);
        };
        script.onerror = () => {
          console.error("네이버 지도 SDK 로드에 실패했습니다.");
        };
        document.head.appendChild(script);
      })
      .catch((err) => console.error("네이버 지도 설정을 불러오지 못했습니다.", err));

    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch store pins from the backend for the selected market.
  useEffect(() => {
    let cancelled = false;
    setStoresLoaded(false);
    fetchMapStores(selectedMarket.name)
      .then((res) => {
        if (cancelled) return;
        setStores(res.stores);
        setMapCenter(res.center);
      })
      .catch((err) => console.error("점포 지도 정보를 불러오지 못했습니다.", err))
      .finally(() => {
        if (!cancelled) setStoresLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMarket.name]);

  // 지도 탭에 처음 들어오면 시장 중심이 아니라 내 실제 위치부터 곧장 떠야 한다는 피드백 —
  // 지도를 만들기 전에 위치 조회부터 끝내서 "시장 중심으로 열렸다가 내 위치로 튀는" 게
  // 안 보이게 한다. 실패/거부해도 조용히 시장 중심으로 대체한다(alert 없음). "확인하기"로
  // 특정 점포를 보러 들어온 경우엔 점포 중심을 유지해야 하므로 시도하지 않는다.
  useEffect(() => {
    if (focusShopName || !navigator.geolocation) {
      setGeoAttempted(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setMyLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        setGeoAttempted(true);
      },
      () => setGeoAttempted(true),
      { enableHighAccuracy: true, timeout: 8000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create the map once the SDK is loaded and we know where to center it — either my
  // location (plain open, GPS resolved) or the market center (fallback / focusShopName).
  useEffect(() => {
    if (!naverLoaded || !mapElement.current || mapRef.current) return;
    // 레시피 장보기로 들어온 경우(recipeIngredients)도 focusShopName/focusCoordinate와
    // 같은 이유로 geoAttempted(GPS 권한 응답)를 기다릴 필요가 없다 — 어차피 출발점은
    // recipeStartStore/시장 중심으로 정해지지 내 위치를 안 쓴다. 이 예외가 빠져있으면
    // GPS 권한 팝업에 사용자가 응답하는 속도에 따라 지도(=마커) 생성 시점이 매번
    // 들쭉날쭉해져서 "마커가 뜰 때도 있고 안 뜰 때도 있는" 것처럼 보이는 원인이 된다.
    if (!focusShopName && !focusCoordinate && !recipeIngredients && !geoAttempted) return;
    // "찍은 위치로 이동하기"로 들어왔는데(focusCoordinate) 지도 인스턴스가 아직 없는
    // 상태면, 예전엔 일단 내 위치/시장 중심으로 지도를 만들고 나서 별도 효과가 뒤늦게
    // focusCoordinate로 옮기려 시도했다 — 근데 그 효과는 mapRef.current가 이 시점에
    // 아직 null이면(흔한 경우, ref라 반응형으로 재시도가 안 됨) 조용히 실패하고 다시는
    // 안 돌아서, 그냥 "현재 위치"에 그대로 머무는 버그가 있었다. 아예 처음 만들 때부터
    // focusCoordinate를 최우선으로 중심에 반영해서 이 경쟁 자체를 없앤다.
    const initialCenter = focusCoordinate || (!focusShopName && myLocation ? myLocation : mapCenter);
    if (!initialCenter) return;

    const naver = (window as any).naver;
    const center = new naver.maps.LatLng(initialCenter.lat, initialCenter.lng);
    mapRef.current = new naver.maps.Map(mapElement.current, {
      center,
      // 예전엔 17로 시작해서 점포 마커가 뜨는 최소 줌(MIN_ZOOM_FOR_MARKERS=19)보다
      // 낮아, 지도를 처음 열면 핀이 하나도 안 보이고 사용자가 직접 몇 번 확대해야
      // 했다. 처음부터 핀이 보이는 줌으로 시작한다.
      zoom: MIN_ZOOM_FOR_MARKERS,
      zoomControl: false,
      scaleControl: false,
      logoControl: false,
      mapDataControl: false,
    });
    setCurrentZoom(MIN_ZOOM_FOR_MARKERS);
    // 핀치 줌 제스처 중엔 zoom_changed가 짧은 시간에 연달아 여러 번 발생해서, 매번
    // setCurrentZoom을 부르면 그만큼 컴포넌트 전체가 반복 리렌더된다. 프레임당 최대
    // 한 번만 상태를 반영하도록 묶어서(coalesce) 제스처 중 리렌더 횟수를 줄인다 —
    // 값 자체는 항상 그 프레임 시점의 최신 줌을 쓰므로 중간 단계가 씹혀도 결과는 같다.
    const latestZoomRef = { current: MIN_ZOOM_FOR_MARKERS };
    let zoomRafId: number | null = null;
    naver.maps.Event.addListener(mapRef.current, "zoom_changed", (zoom: number) => {
      latestZoomRef.current = zoom;
      if (zoomRafId !== null) return;
      zoomRafId = requestAnimationFrame(() => {
        zoomRafId = null;
        setCurrentZoom(latestZoomRef.current);
      });
    });

    if (!focusShopName && !focusCoordinate && myLocation) {
      myLocationMarkerRef.current = new naver.maps.Marker({
        position: center,
        map: mapRef.current,
        icon: {
          content: `<div style="width:16px;height:16px;border-radius:50%;background:#2563EB;border:3px solid white;box-shadow:0 0 0 2px rgba(37,99,235,0.4);"></div>`,
          anchor: new naver.maps.Point(8, 8),
        },
        zIndex: 200,
      });
    }
  }, [naverLoaded, mapCenter, geoAttempted, myLocation, focusShopName, focusCoordinate, recipeIngredients]);

  // 시장을 검색해서 실제로 다른 시장으로 바꾼 경우에만 이미 만들어진 지도 인스턴스를
  // 새 중심으로 옮긴다. 예전엔 selectedMarket.id가 바뀐 그 순간 바로 "처리 완료"로
  // 표시해버렸는데, 점포 목록은 비동기로 따로 fetch되기 때문에 id가 바뀐 시점엔 아직
  // stores/mapCenter가 이전 시장 것 그대로였다 — 그래서 진짜 새 데이터(mapCenter)가
  // 도착해서 이 effect가 다시 돌 때는 "이미 처리함"으로 오판해 건너뛰어 버렸다. 그 결과
  // 검색해서 다른 시장으로 들어가도 지도가 실제로는 안 움직이고, 새 시장 핀은 화면
  // 밖에 있어 아무리 확대해도 안 보이는 버그가 있었다. mapCenter "값"이 실제로 바뀐
  // 시점(=새 시장 fetch가 진짜 끝난 시점)을 기준으로 삼아야 정확하다.
  const appliedMapCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!mapRef.current || !mapCenter) return;
    const prevCenter = appliedMapCenterRef.current;
    const isFirstApply = prevCenter === null;
    const isSameCenter = !!prevCenter && prevCenter.lat === mapCenter.lat && prevCenter.lng === mapCenter.lng;
    appliedMapCenterRef.current = mapCenter;
    if (isFirstApply || isSameCenter) return;
    const naver = (window as any).naver;

    // 검색으로 시장을 바꾸면 그 시장 경계가 화면에 딱 맞게 들어와야 한다 — 예전엔 중심점만
    // 옮기고 줌은 이전 시장 보던 그대로 둬서, 양동시장 보다가 말바우시장으로 넘어가면
    // 경계선이 화면 구석에 살짝만 걸리거나 아예 안 보이는 경우가 있었다. 공공데이터
    // 점포(비상인)가 3개 이상이라 경계선을 그릴 수 있는 시장은 그 경계 전체가 보이게
    // fitBounds로 맞추고, 아직 그런 데이터가 없는 시장은 중심점 + 기본 줌으로 대체한다.
    const boundaryStores = stores.filter((s) => s.category !== "merchant");
    if (boundaryStores.length >= 3) {
      const hull = computeConvexHull(boundaryStores.map((s) => ({ lat: s.lat, lng: s.lng })));
      const path = hull.map((p) => new naver.maps.LatLng(p.lat, p.lng));
      const bounds = new naver.maps.LatLngBounds(path[0], path[0]);
      path.forEach((p) => bounds.extend(p));
      mapRef.current.fitBounds(bounds, { top: 80, right: 40, bottom: 80, left: 40 });
    } else {
      mapRef.current.setCenter(new naver.maps.LatLng(mapCenter.lat, mapCenter.lng));
      mapRef.current.setZoom(MIN_ZOOM_FOR_MARKERS);
    }
  }, [mapCenter, stores]);

  // 양동시장 전체를 하나의 영역으로 보여주는 외곽선/음영 오버레이 — 실제 점포 좌표의
  // 컨벡스 헐을 계산해서 그린다. 줌 레벨과 무관하게 항상 표시(마커와 달리 시장
  // 전체 범위를 인지하는 용도라 확대해야만 보일 필요가 없다).
  useEffect(() => {
    // 상인이 "점포 위치 등록"으로 직접 찍은 핀(category === "merchant")은 실수로 시장과
    // 멀리 떨어진 곳에 찍힐 수 있는데, 컨벡스 헐은 이상치 하나에도 극도로 민감해서 그
    // 점 하나 때문에 경계선 전체가 그쪽으로 늘어나 버린다(실제로 겪은 문제 — 실기기
    // 테스트 계정 핀 하나가 시장에서 4.6km 떨어져 있어서 경계가 거기까지 뻗어나갔다).
    // 경계는 실측 공공데이터 점포로만 그려서 안정적인 시장 부지 모양을 유지한다.
    const boundaryStores = stores.filter((s) => s.category !== "merchant");
    if (!naverLoaded || !mapRef.current || boundaryStores.length < 3) return;

    const naver = (window as any).naver;
    const hull = computeConvexHull(boundaryStores.map((s) => ({ lat: s.lat, lng: s.lng })));
    const path = hull.map((p) => new naver.maps.LatLng(p.lat, p.lng));

    if (marketBoundaryRef.current) {
      marketBoundaryRef.current.setMap(null);
    }
    marketBoundaryRef.current = new naver.maps.Polygon({
      map: mapRef.current,
      paths: [path],
      fillColor: "#0052FF",
      fillOpacity: 0.08,
      strokeColor: "#0052FF",
      strokeOpacity: 0.5,
      strokeWeight: 2,
      strokeStyle: "shortdash",
    });

    const centroid = hull.reduce(
      (acc, p) => ({ lat: acc.lat + p.lat / hull.length, lng: acc.lng + p.lng / hull.length }),
      { lat: 0, lng: 0 }
    );
    if (marketLabelRef.current) {
      marketLabelRef.current.setMap(null);
    }
    marketLabelRef.current = new naver.maps.Marker({
      map: mapRef.current,
      position: new naver.maps.LatLng(centroid.lat, centroid.lng),
      icon: {
        content: `<div class="px-2.5 py-1 rounded-full bg-[#0052FF]/90 text-white text-[11px] font-extrabold shadow-md pointer-events-none whitespace-nowrap">${selectedMarket.name}</div>`,
        anchor: new naver.maps.Point(30, 12),
      },
      zIndex: 1,
    });

    return () => {
      if (marketBoundaryRef.current) {
        marketBoundaryRef.current.setMap(null);
        marketBoundaryRef.current = null;
      }
      if (marketLabelRef.current) {
        marketLabelRef.current.setMap(null);
        marketLabelRef.current = null;
      }
    };
  }, [naverLoaded, stores]);

  // 지금 선택 안 한 다른 시장들의 경계선 — 시장마다 고유 색으로 같이 보여줘서 검색 없이도
  // 지도를 둘러보다가 발견할 수 있게 한다. 줌을 아무리 확대해도(어떤 위치/배율에서 들어와도)
  // 계속 남아있어야 한다는 요구사항이라 줌 레벨에 따른 표시/숨김 로직 없이 항상 붙여둔다.
  // 도형 생성은 allMarketBoundaries/selectedMarket이 바뀔 때만 한다 — 이 effect가 currentZoom에
  // 의존하면 줌 제스처 중(줌 레벨이 빠르게 여러 번 바뀔 때)마다 도형을 통째로 지웠다 새로
  // 그리길 반복해서 "떴다 안 떴다" 깜빡이는 문제가 생긴다.
  useEffect(() => {
    const clear = () => {
      otherBoundaryRefs.current.forEach((p) => p.setMap(null));
      otherBoundaryRefs.current = [];
      otherBoundaryLabelRefs.current.forEach((l) => l.setMap(null));
      otherBoundaryLabelRefs.current = [];
    };

    if (!naverLoaded || !mapRef.current) {
      clear();
      return;
    }

    const naver = (window as any).naver;
    clear();
    allMarketBoundaries
      .filter((b) => b.marketId !== selectedMarket.id)
      .forEach((boundary) => {
        const color = getMarketBoundaryColor(boundary.marketId);
        const hull = computeConvexHull(boundary.points);
        const path = hull.map((p) => new naver.maps.LatLng(p.lat, p.lng));
        const polygon = new naver.maps.Polygon({
          map: mapRef.current,
          paths: [path],
          fillColor: color,
          fillOpacity: 0.1,
          strokeColor: color,
          strokeOpacity: 0.7,
          strokeWeight: 1.5,
          strokeStyle: "shortdash",
        });
        otherBoundaryRefs.current.push(polygon);

        const centroid = hull.reduce(
          (acc, p) => ({ lat: acc.lat + p.lat / hull.length, lng: acc.lng + p.lng / hull.length }),
          { lat: 0, lng: 0 }
        );
        const label = new naver.maps.Marker({
          map: mapRef.current,
          position: new naver.maps.LatLng(centroid.lat, centroid.lng),
          icon: {
            content: `<div class="px-2 py-0.5 rounded-full bg-white/95 text-[10px] font-bold shadow-sm pointer-events-none whitespace-nowrap" style="color:${color};border:1px solid ${color}">${boundary.marketName}</div>`,
            anchor: new naver.maps.Point(25, 10),
          },
          zIndex: 0,
        });
        otherBoundaryLabelRefs.current.push(label);
      });

    return clear;
  }, [naverLoaded, allMarketBoundaries, selectedMarket.id]);

  // Render store pins as real markers positioned by lat/lng. 예전엔 이 효과가 currentZoom/
  // activePin/recipeRouteStoreOrder에도 의존해서, 줌 제스처 중 프레임마다 그리고 핀 하나
  // 클릭할 때마다 화면의 마커 전부(점포 많은 시장은 수백 개)를 지우고 처음부터 다시 만들어
  // 버벅였다. 마커 생성은 store 목록이 바뀔 때만 하고, 줌에 따른 표시/숨김과 하이라이트는
  // 아래 두 개의 가벼운 효과가 기존 마커의 setMap()/setIcon()만으로 처리한다.
  useEffect(() => {
    if (!naverLoaded || !mapRef.current) return;

    const naver = (window as any).naver;

    markersRef.current.forEach((marker) => marker.setMap(null));
    // 마커 생성 시점에도 지금 알고 있는 줌/레시피 상태로 바로 보여줄지 정한다 — 아래
    // 별도 줌/레시피 효과가 나중에 다시 한번 맞춰주긴 하지만, 그 효과가 어떤 이유로든
    // 늦게 붙거나 놓치는 경우에도 최초 생성 시점부터 정확한 상태로 뜨게 하기 위한
    // 이중 안전장치다(레시피 모드에서 마커가 계속 안 뜨던 문제의 원인을 좁히기 위함).
    const initialShouldShowByZoom = recipeRelevantStoreIds ? true : currentZoom >= MIN_ZOOM_FOR_MARKERS;
    markersRef.current = stores.map((store) => {
      const isStart = store.id === recipeStartStore?.id;
      const passesRecipeFilter = !recipeRelevantStoreIds || recipeRelevantStoreIds.has(store.id);
      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(store.lat, store.lng),
        map: initialShouldShowByZoom && passesRecipeFilter ? mapRef.current : null,
        icon: {
          content: buildMarkerContent(store, false, undefined, isStart),
          anchor: new naver.maps.Point(40, 18),
        },
      });
      (marker as any).__store = store;

      naver.maps.Event.addListener(marker, "click", () => {
        setActivePin(store.name);
        setCurrentScript("");
        setIsDocentExpanded(true);
        handleFetchAiDocent(store);
      });

      return marker;
    });

    return () => {
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
  }, [naverLoaded, stores]);

  // 레시피 장보기 체크리스트가 떠 있는 동안은, 점포 수백 개짜리 시장에서도 이 동선과
  // 무관한 핀들까지 다 뜨면 정작 봐야 할 재료 점포가 묻힌다 — 출발점 + 실제로 들를
  // 점포만 남기고 나머지는 숨긴다. 레시피 모드가 아니면(null) 기존처럼 전부 보여준다.
  const recipeRelevantStoreIds = useMemo(() => {
    if (!recipeIngredients || recipeIngredients.length === 0) return null;
    const ids = new Set<string>();
    matchedRecipeStores.forEach((s) => ids.add(s.id));
    if (recipeStartStore) ids.add(recipeStartStore.id);
    return ids;
  }, [recipeIngredients, matchedRecipeStores, recipeStartStore]);

  // 줌/레시피 상태로 마커를 보일지 정하는 공통 판정 — 여러 효과(줌 변경, 활성 핀 변경,
  // 순번 배지 변경)가 각자 다른 시점에 setIcon()/setMap()을 부르는데, 그중 하나라도
  // setIcon() 이후에 setMap()을 다시 안 불러주면 바로 앞서 다른 효과가 setMap()으로
  // 맞춰둔 표시 상태가 덮어써질 수 있다(실제로 레시피 모드에서 마커가 하나도 안 뜨던
  // 원인 — setIcon()이 이 마커의 표시 상태를 건드리는지 아닌지 SDK 문서로 확실히
  // 보장할 수 없어서, 아이콘을 바꾸는 모든 효과가 그 직후 표시 여부도 같이 재확정한다).
  const shouldShowStoreMarker = (store: MapStorePin | undefined): boolean => {
    if (!store) return false;
    const shouldShowByZoom = recipeRelevantStoreIds ? true : currentZoom >= MIN_ZOOM_FOR_MARKERS;
    const passesRecipeFilter = !recipeRelevantStoreIds || recipeRelevantStoreIds.has(store.id);
    return shouldShowByZoom && passesRecipeFilter;
  };

  // 줌 레벨/레시피 상태에 따라 기존 마커를 붙였다 뗐다만 한다(재생성 없음). 레시피
  // 모드에서는 이미 출발점 + 실제로 들를 몇 곳으로 줄여놨으니(recipeRelevantStoreIds)
  // 수백 개가 겹칠 걱정이 없다 — 줌이 낮아도(동선이 넓어서 fitBounds가 멀리서 잡은
  // 경우 포함) 무조건 보여준다. 줌 게이트는 "전체 점포 다 보여주기" 모드(레시피 모드가
  // 아닐 때)에서만 켠다.
  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach((marker) => {
      const store = (marker as any).__store as MapStorePin | undefined;
      marker.setMap(shouldShowStoreMarker(store) ? mapRef.current : null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentZoom, stores, recipeRelevantStoreIds]);

  // 활성 핀 하이라이트 — 예전엔 activePin이 바뀔 때마다(=점포 아무거나 클릭/검색 결과 클릭할
  // 때마다) 마커 전부의 setIcon()을 호출해서, 점포가 많은 시장(말바우시장 400개+)에서는
  // 클릭할 때마다 아이콘 DOM을 수백 개씩 다시 그려 "클릭해도 한참 있다 반응하는" 것처럼
  // 느껴졌다. 실제로 하이라이트가 바뀌는 건 이전 활성 마커/새 활성 마커 딱 2개뿐이므로
  // 그 둘만 갱신한다.
  const prevActivePinRef = useRef<string | null>(null);
  useEffect(() => {
    const naver = (window as any).naver;
    const prevName = prevActivePinRef.current;
    prevActivePinRef.current = activePin;
    if (prevName === activePin) return;

    markersRef.current.forEach((marker) => {
      const store = (marker as any).__store as MapStorePin | undefined;
      if (!store || (store.name !== prevName && store.name !== activePin)) return;
      marker.setIcon({
        content: buildMarkerContent(
          store,
          activePin === store.name,
          recipeRouteStoreOrder.get(store.id),
          store.id === recipeStartStore?.id
        ),
        anchor: new naver.maps.Point(40, 18),
      });
      // setIcon() 직후 표시 여부를 다시 확정한다 — 이 효과가 줌/레시피 효과보다 나중에
      // 실행되는 경우에도 표시 상태가 덮어써지지 않게 하기 위함.
      if (mapRef.current) marker.setMap(shouldShowStoreMarker(store) ? mapRef.current : null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePin]);

  // 레시피 장보기 동선 순번 배지 — 동선 시작/변경은 드물게 일어나는 조작이라 전체 갱신해도
  // 괜찮다(활성 핀처럼 클릭마다 발생하지 않음).
  useEffect(() => {
    const naver = (window as any).naver;
    markersRef.current.forEach((marker) => {
      const store = (marker as any).__store as MapStorePin | undefined;
      if (!store) return;
      marker.setIcon({
        content: buildMarkerContent(
          store,
          activePin === store.name,
          recipeRouteStoreOrder.get(store.id),
          store.id === recipeStartStore?.id
        ),
        anchor: new naver.maps.Point(40, 18),
      });
      // setIcon() 직후 표시 여부를 다시 확정한다 — 줌/레시피 효과보다 이 효과가 먼저
      // 돌아서 그쪽이 정한 표시 상태를 덮어쓰는 순서가 되더라도 여기서 다시 맞춰준다.
      if (mapRef.current) marker.setMap(shouldShowStoreMarker(store) ? mapRef.current : null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeRouteStoreOrder, recipeStartStore]);

  // 레시피 장보기 동선 — 내 위치(또는 시장 중심)에서 매칭된 점포들을 최근접 순으로 잇는
  // 점선을 그리고, 전부 한눈에 보이도록 지도 범위를 맞춘다.
  useEffect(() => {
    if (!naverLoaded || !mapRef.current) return;
    const naver = (window as any).naver;

    if (recipeRouteLineRef.current) {
      recipeRouteLineRef.current.setMap(null);
      recipeRouteLineRef.current = null;
    }

    if (!recipeRoute || recipeRoute.order.length === 0 || !recipeRouteStart) {
      // 레시피 체크리스트를 보러 들어왔는데 이 시장엔 매칭된 재료가 하나도 없는 경우 —
      // 예전엔 지도 카메라를 아예 안 움직여서, 사용자가 어디를 보고 있었는지에 따라
      // 엉뚱한 곳(예: 내 위치, 다른 시장 보던 자리)을 계속 보여주는 채로 방치됐다.
      // 매칭이 하나도 없어도 최소한 지금 시장 중심으로는 옮겨줘야 "제대로" 이동한 것이다.
      if (recipeIngredients && recipeIngredients.length > 0 && mapCenter) {
        mapRef.current.setCenter(new naver.maps.LatLng(mapCenter.lat, mapCenter.lng));
        if (mapRef.current.getZoom() < MIN_ZOOM_FOR_MARKERS) {
          mapRef.current.setZoom(MIN_ZOOM_FOR_MARKERS);
        }
      }
      return;
    }

    const path = [recipeRouteStart, ...recipeRoute.order].map((p) => new naver.maps.LatLng(p.lat, p.lng));
    recipeRouteLineRef.current = new naver.maps.Polyline({
      map: mapRef.current,
      path,
      strokeColor: "#10B981",
      strokeWeight: 4,
      strokeOpacity: 0.8,
      strokeStyle: "shortdash",
    });

    const bounds = new naver.maps.LatLngBounds(path[0], path[0]);
    path.forEach((p) => bounds.extend(p));
    // 예전엔 fitBounds가 고른 줌이 낮으면 MIN_ZOOM_FOR_MARKERS로 강제로 올렸는데, 그러면
    // 동선이 넓을 때 일부 점포가 화면 밖으로 잘려나갔다 — 레시피 모드에서는 마커 표시
    // 자체가 줌과 무관해졌으니(위 recipeRelevantStoreIds 효과) 이제 강제로 올릴 필요가
    // 없다. fitBounds가 고른 줌 그대로 전체 동선이 한 화면에 다 들어오게 둔다.
    mapRef.current.fitBounds(bounds, { top: 160, right: 40, bottom: 200, left: 40 });

    return () => {
      if (recipeRouteLineRef.current) {
        recipeRouteLineRef.current.setMap(null);
        recipeRouteLineRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naverLoaded, recipeRoute, recipeRouteStart, recipeIngredients, mapCenter]);

  // Elapsed time is derived from a real wall-clock start time (speechStartRef), not a
  // fixed 1%/sec loop -- Web Speech API gives no true duration, so "seeking" below works
  // by shifting that start time rather than actually scrubbing the audio.
  useEffect(() => {
    if (!isPlayingDocent) return;
    // 화면엔 정수 초 단위로만 표시되므로(formatSeconds) 250ms 간격은 안 보이는 리렌더만
    // 4배로 늘릴 뿐이었다. 500ms로도 진행바는 충분히 매끄럽게 보인다.
    const interval = setInterval(() => {
      if (speechStartRef.current === null) return;
      const elapsed = (Date.now() - speechStartRef.current) / 1000;
      setDocentElapsedSec(Math.min(docentTotalSec, elapsed));
    }, 500);
    return () => clearInterval(interval);
  }, [isPlayingDocent, docentTotalSec]);

  const speakDocent = (text: string) => {
    const textToSpeak = text.replace(/"/g, "");
    const totalSec = estimateSpeechSeconds(textToSpeak);
    setDocentTotalSec(totalSec);
    setDocentElapsedSec(0);

    const token = ++speechTokenRef.current;
    speechStartRef.current = Date.now();
    setIsPlayingDocent(true);

    // 안드로이드 WebView에는 window.speechSynthesis가 객체는 있지만 실제로 음성이
    // 안 나온다(onstart조차 안 옴) — 네이티브 TTS로 브릿지하는 플러그인을 쓴다.
    // speak()는 재생이 끝나야 resolve되므로, 그 시점을 onend 대용으로 쓴다.
    TextToSpeech.speak({ text: textToSpeak, lang: "ko-KR", rate: SPEECH_RATE })
      .then(() => {
        if (speechTokenRef.current !== token) return; // 그 사이 새로 재생이 시작됐으면 무시
        speechStartRef.current = null;
        setDocentElapsedSec(totalSec);
        setIsPlayingDocent(false);
      })
      .catch((err) => {
        console.error("TTS 재생 실패", err);
        if (speechTokenRef.current !== token) return;
        speechStartRef.current = null;
        setIsPlayingDocent(false);
      });
  };

  const toggleDocentPlay = () => {
    if (isPlayingDocent) {
      speechTokenRef.current += 1; // 진행 중이던 재생의 완료 콜백을 무효화
      TextToSpeech.stop().catch(() => {});
      speechStartRef.current = null;
      setIsPlayingDocent(false);
    } else {
      speakDocent(currentScript);
    }
  };

  // Shifts the tracked start time so the displayed elapsed/total jumps by deltaSec --
  // there is no real seek API for in-flight speech synthesis, so this only moves the
  // on-screen clock, not the actual audio position.
  const seekDocentBy = (deltaSec: number) => {
    if (speechStartRef.current === null) {
      setDocentElapsedSec((prev) => Math.max(0, Math.min(docentTotalSec, prev + deltaSec)));
      return;
    }
    const nextElapsed = Math.max(0, Math.min(docentTotalSec, docentElapsedSec + deltaSec));
    speechStartRef.current = Date.now() - nextElapsed * 1000;
    setDocentElapsedSec(nextElapsed);
  };

  const goToCurrentLocation = (opts: { silent?: boolean } = {}) => {
    if (!navigator.geolocation) {
      if (!opts.silent) alert("이 브라우저에서는 위치 확인을 지원하지 않습니다.");
      return;
    }
    if (!mapRef.current) {
      if (!opts.silent) alert("지도를 아직 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const naver = (window as any).naver;
        const { latitude, longitude } = position.coords;
        const location = new naver.maps.LatLng(latitude, longitude);

        mapRef.current.setCenter(location);
        mapRef.current.setZoom(18);

        if (myLocationMarkerRef.current) {
          myLocationMarkerRef.current.setPosition(location);
        } else {
          myLocationMarkerRef.current = new naver.maps.Marker({
            position: location,
            map: mapRef.current,
            icon: {
              content: `<div style="width:16px;height:16px;border-radius:50%;background:#2563EB;border:3px solid white;box-shadow:0 0 0 2px rgba(37,99,235,0.4);"></div>`,
              anchor: new naver.maps.Point(8, 8),
            },
            zIndex: 200,
          });
        }
      },
      (error) => {
        if (opts.silent) return; // 자동 시도는 실패해도 조용히 시장 중심에 그대로 둔다
        const reason =
          error.code === error.PERMISSION_DENIED
            ? "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해 주세요."
            : "현재 위치를 가져오지 못했습니다.";
        alert(reason);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleGoToCurrentLocation = () => goToCurrentLocation();

  const handleZoom = (delta: number) => {
    if (!mapRef.current) return;
    mapRef.current.setZoom(mapRef.current.getZoom() + delta);
  };

  const handleFetchAiDocent = async (store: MapStorePin) => {
    setIsDocentLoading(true);
    try {
      const data = await fetchDocentStory({
        marketName: selectedMarket.name,
        alleyName: store.alley,
        storeId: store.id,
      });
      if (data.success && data.script) {
        setCurrentScript(data.script);
        speakDocent(data.script);
      } else {
        setCurrentScript(`"${store.name}의 AI 도슨트를 아직 준비하지 못했습니다."`);
      }
    } catch (err) {
      console.error(err);
      setCurrentScript(`"${store.name}의 AI 도슨트를 불러오지 못했습니다. 잠시 후 다시 시도해주세요."`);
    } finally {
      setIsDocentLoading(false);
    }
  };

  const handleSelectSearchResult = (store: MapStorePin) => {
    setSearchQuery("");
    setShowSearchResults(false);

    if (mapRef.current) {
      const naver = (window as any).naver;
      mapRef.current.setCenter(new naver.maps.LatLng(store.lat, store.lng));
      if (mapRef.current.getZoom() < MIN_ZOOM_FOR_MARKERS) {
        mapRef.current.setZoom(MIN_ZOOM_FOR_MARKERS);
      }
    }

    setActivePin(store.name);
    setCurrentScript("");
    setIsDocentExpanded(true);
    handleFetchAiDocent(store);
  };

  // 시장 자체를 검색해서 골랐을 때 — 실제 지도 전환(중심 이동/점포·바운더리 다시 그리기)은
  // selectedMarket이 바뀌면 아래 useEffect들이 알아서 처리하므로, 여기선 선택 상태만 정리한다.
  const handleSelectSearchResultMarket = (market: MarketInfo) => {
    setSearchQuery("");
    setShowSearchResults(false);
    setActivePin(null);
    onSelectMarket?.(market);
  };

  // 등록된 점포/시장이 아니라 검색 API로 찾은 일반 장소 — 특정 점포가 아니므로 activePin/
  // 도슨트는 건드리지 않고 그 위치로 지도만 이동시킨다.
  const handleSelectPlaceResult = (result: { lat: number; lng: number }) => {
    setSearchQuery("");
    setShowSearchResults(false);
    setPlaceResults([]);

    if (mapRef.current) {
      const naver = (window as any).naver;
      mapRef.current.setCenter(new naver.maps.LatLng(result.lat, result.lng));
      mapRef.current.setZoom(Math.max(mapRef.current.getZoom(), MIN_ZOOM_FOR_MARKERS));
    }
  };

  // 상품 상세 등 다른 화면의 "상점 위치 지도에서 확인하기"로 넘어왔을 때, 그 상점을
  // 찾아 자동으로 지도 중심을 옮기고 마커를 선택한 것처럼 만든다. stores가 로드되고
  // 지도 인스턴스가 만들어진 뒤에야 실행 가능하므로 둘 다 준비될 때까지 기다린다.
  useEffect(() => {
    if (!focusShopName || !mapRef.current || stores.length === 0) return;

    const store = stores.find((s) => s.name === focusShopName);
    if (store) {
      const naver = (window as any).naver;
      mapRef.current.setCenter(new naver.maps.LatLng(store.lat, store.lng));
      if (mapRef.current.getZoom() < MIN_ZOOM_FOR_MARKERS) {
        mapRef.current.setZoom(MIN_ZOOM_FOR_MARKERS);
      }
      setActivePin(store.name);
      setCurrentScript("");
      setIsDocentExpanded(true);
      handleFetchAiDocent(store);
    } else {
      alert("이 상점은 아직 지도에 위치가 등록되지 않았어요.");
    }
    onFocusHandled?.();
  }, [focusShopName, stores, naverLoaded]);

  // "찍은 위치로 이동하기" — 등록된 점포가 아니라 스캔 당시 GPS 좌표 하나라, 점포 목록을
  // 뒤질 필요 없이 지도 인스턴스만 준비되면 바로 그 지점으로 이동시킨다. 핀/도슨트는
  // 안 건드린다(특정 점포를 가리키는 게 아니므로).
  useEffect(() => {
    if (!focusCoordinate || !mapRef.current || !naverLoaded) return;

    const naver = (window as any).naver;
    mapRef.current.setCenter(new naver.maps.LatLng(focusCoordinate.lat, focusCoordinate.lng));
    mapRef.current.setZoom(Math.max(mapRef.current.getZoom(), MIN_ZOOM_FOR_MARKERS));
    onFocusCoordinateHandled?.();
  }, [focusCoordinate, naverLoaded]);

  return (
    <div
      className="relative w-full overflow-hidden bg-[#F0F3F4] text-on-surface"
      style={{ height: frozenViewportHeight, overscrollBehavior: "none" }}
    >
      <div ref={mapElement} className="absolute inset-0 w-full h-full z-0" style={{ overscrollBehavior: "contain" }} />

      {currentZoom < MIN_ZOOM_FOR_MARKERS && stores.length > 0 && !recipeRelevantStoreIds && (
        <div className="absolute top-[calc(5rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-20 bg-white/95 text-[#334155] text-xs font-semibold px-3 py-1.5 rounded-full shadow-md border border-[#E2E8F0] pointer-events-none">
          더 확대하면 점포가 표시됩니다
        </div>
      )}

      {/* Top Floating Search Bar */}
      <div className="absolute top-[calc(1rem+env(safe-area-inset-top))] left-4 right-4 z-30 max-w-lg mx-auto flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="w-11 h-11 bg-white rounded-full shadow-lg flex items-center justify-center text-[#0F172A] border border-outline-variant/30 shrink-0"
              title="이전 화면으로 돌아가기"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
          )}
          <div className="flex-1 bg-white rounded-full shadow-lg flex items-center px-4 h-12 border border-outline-variant/30">
            <span className="material-symbols-outlined text-outline mr-2">search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearchResults(true);
              }}
              onFocus={() => setShowSearchResults(true)}
              onBlur={() => {
                // 모바일 터치에서는 결과 버튼의 click 이벤트가 도착하기 전에
                // 이 blur가 먼저 발동해 목록이 사라져버려 탭이 씹히는 문제가
                // 있었다. click이 먼저 처리될 시간을 벌어주기 위해 지연시킨다.
                window.setTimeout(() => setShowSearchResults(false), 150);
              }}
              placeholder="점포, 전통시장 검색"
              className="flex-1 bg-transparent border-none focus:outline-none text-sm text-on-surface placeholder-outline"
            />
            {searchQuery && (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setSearchQuery("")}
                className="text-outline hover:text-on-surface"
                title="지우기"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            )}
          </div>
        </div>

        {showSearchResults && trimmedQuery && (
          <div className="bg-white rounded-2xl shadow-lg border border-[#E2E8F0] max-h-72 overflow-y-auto">
            {marketResults.length > 0 && (
              <div>
                <div className="px-4 pt-2.5 pb-1 text-[10px] font-extrabold text-outline uppercase tracking-wider">
                  다른 전통시장
                </div>
                {marketResults.map((market) => (
                  <button
                    key={market.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectSearchResultMarket(market)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left border-b border-[#F1F5F9]"
                  >
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 bg-[#2563EB]">
                      <span className="material-symbols-outlined text-base">storefront</span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-on-surface truncate">{market.name}</div>
                      <div className="text-xs text-outline truncate">{market.city}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {searchResults.length > 0 &&
              searchResults.map((store) => (
                <button
                  key={store.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectSearchResult(store)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left border-b border-[#F1F5F9] last:border-b-0"
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0"
                    style={{ background: store.badge_color }}
                  >
                    <span className="material-symbols-outlined text-base">{store.icon}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-on-surface truncate">{store.name}</div>
                    <div className="text-xs text-outline truncate">{store.subtitle}</div>
                  </div>
                </button>
              ))}
            {/* 등록된 점포/시장 밖의 일반 장소·주소 — 네이버 검색 API(장소명) + 지오코딩(주소)
                결과. 로컬 결과와 겹치지 않게 별도 섹션으로 아래에 둔다. */}
            {placeResults.length > 0 && (
              <div>
                <div className="px-4 pt-2.5 pb-1 text-[10px] font-extrabold text-outline uppercase tracking-wider">
                  장소 검색 결과
                </div>
                {placeResults.map((place, idx) => (
                  <button
                    key={`${place.label}-${idx}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectPlaceResult(place)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left border-b border-[#F1F5F9] last:border-b-0"
                  >
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 bg-[#64748B]">
                      <span className="material-symbols-outlined text-base">place</span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-on-surface truncate">{place.label}</div>
                      {place.sublabel && (
                        <div className="text-xs text-outline truncate">{place.sublabel}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {isSearchingPlace && (
              <div className="px-4 py-3 text-xs text-outline text-center">장소 검색 중...</div>
            )}
            {!isSearchingPlace &&
              marketResults.length === 0 &&
              searchResults.length === 0 &&
              placeResults.length === 0 && (
                <div className="px-4 py-3 text-sm text-outline text-center">검색 결과가 없습니다</div>
              )}
          </div>
        )}
      </div>

      {/* Recipe Shopping Checklist (Top Right) — 상품 상세의 레시피 탭에서 "지도에서 재료
          위치 확인"으로 넘어왔을 때만 뜬다. 재료마다 이 시장에 실제로 파는 점포를 찾아
          체크로 보여주고, 매칭된 점포들을 잇는 도보 동선(직선거리 최근접 이웃)을 안내한다. */}
      {recipeIngredients && recipeIngredients.length > 0 && (
        isRecipeChecklistMinimized ? (
          /* 접힌 상태 — 완전히 닫아버리면(재료 목록을 아예 지워버리면) 다시 보고 싶을 때
             레시피 상세로 되돌아가야만 해서, 오른쪽에 작은 탭으로만 접어두고 눌러서
             다시 펼칠 수 있게 한다. */
          <button
            onClick={() => setIsRecipeChecklistMinimized(false)}
            className="absolute top-[calc(6.5rem+env(safe-area-inset-top))] right-4 z-30 w-11 h-11 rounded-full bg-white shadow-xl border border-emerald-200 flex items-center justify-center text-emerald-600 active:scale-95 transition-transform"
            title="레시피 장보기 체크리스트 펼치기"
          >
            <span className="material-symbols-outlined text-xl">checklist</span>
          </button>
        ) : (
        <div className="absolute top-[calc(6.5rem+env(safe-area-inset-top))] right-4 z-30 w-56 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-xl border border-[#E2E8F0] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 bg-emerald-50 border-b border-emerald-100">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="material-symbols-outlined text-emerald-600 text-base shrink-0">checklist</span>
              <span className="text-[11px] font-extrabold text-emerald-800 truncate">장보기 체크리스트</span>
            </div>
            <button
              onClick={() => setIsRecipeChecklistMinimized(true)}
              className="text-emerald-700 hover:text-emerald-900 shrink-0"
              title="체크리스트 접기"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          </div>
          <div className="max-h-36 overflow-y-auto divide-y divide-[#F1F5F9]">
            {!storesLoaded ? (
              <div className="flex items-center justify-center gap-2 px-3 py-3 text-xs text-slate-400">
                <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                이 시장 점포 정보를 확인하는 중...
              </div>
            ) : (
              recipeMatches.map((m, idx) => {
                const isExcluded = excludedIngredients.has(m.ingredient);
                const chosen = getChosenStore(m);
                const isStart = !!chosen && chosen.id === recipeStartStore?.id;
                // 출발점으로 고정된 재료(지금 보던 상품 자체)는 다른 점포로 바꿀 수 없다.
                const hasChoices = !m.isAnchor && m.candidates.length > 1;
                const isExpanded = expandedIngredient === m.ingredient;
                return (
                  <div key={idx} className={isExcluded ? "opacity-50" : ""}>
                    <div className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs">
                      <button
                        type="button"
                        onClick={() => toggleIngredientExcluded(m.ingredient)}
                        className="shrink-0 cursor-pointer"
                        title={isExcluded ? "다시 장보기 목록에 넣기" : "이미 있으면 눌러서 빼기"}
                      >
                        <span
                          className={`material-symbols-outlined text-base ${
                            isExcluded ? "text-slate-300" : chosen ? "text-emerald-600" : "text-slate-300"
                          }`}
                        >
                          {isExcluded ? "check_box_outline_blank" : chosen ? "check_circle" : "radio_button_unchecked"}
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={!hasChoices || isExcluded}
                        onClick={() => setExpandedIngredient(isExpanded ? null : m.ingredient)}
                        className={`flex-1 min-w-0 flex items-center justify-between gap-1.5 text-left ${
                          hasChoices && !isExcluded ? "cursor-pointer" : "cursor-default"
                        }`}
                        title={hasChoices ? "여러 점포 중 고르기" : undefined}
                      >
                        <span
                          className={`truncate font-bold ${
                            isExcluded ? "text-slate-400 line-through" : chosen ? "text-[#0F172A]" : "text-slate-400"
                          }`}
                        >
                          {m.ingredient}
                        </span>
                        <span className="flex items-center gap-1 shrink-0">
                          {isStart ? (
                            <span className="text-[10px] font-extrabold text-white bg-emerald-600 px-1.5 py-0.5 rounded-md">
                              출발점
                            </span>
                          ) : chosen ? (
                            <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md">
                              {chosen.name}
                              {hasChoices ? ` 외 ${m.candidates.length - 1}곳` : ""}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">이 시장엔 없음</span>
                          )}
                          {hasChoices && !isExcluded && (
                            <span className="material-symbols-outlined text-sm text-slate-400">
                              {isExpanded ? "expand_less" : "expand_more"}
                            </span>
                          )}
                        </span>
                      </button>
                    </div>
                    {/* 후보 점포 목록 — 거리순으로 정렬돼 있고, 고르면 동선/거리가 바로
                        다시 계산된다(matchedRecipeStores가 selectedStoreByIngredient에
                        의존하는 useMemo라 자동으로 반영됨). */}
                    {isExpanded && hasChoices && (
                      <div className="px-3 pb-1.5 pl-8 space-y-1">
                        {m.candidates.map((c) => {
                          const dist = recipeRouteStart ? Math.round(haversineMeters(c, recipeRouteStart)) : null;
                          const isChosen = c.id === chosen?.id;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setSelectedStoreByIngredient((prev) => ({ ...prev, [m.ingredient]: c.id }));
                                setExpandedIngredient(null);
                              }}
                              className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                                isChosen
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-slate-50 text-[#334155] hover:bg-slate-100 border border-transparent"
                              }`}
                            >
                              <span className="flex items-center gap-1 min-w-0">
                                <span className="material-symbols-outlined text-sm shrink-0">
                                  {isChosen ? "radio_button_checked" : "radio_button_unchecked"}
                                </span>
                                <span className="truncate">{c.name}</span>
                              </span>
                              {dist !== null && <span className="text-[10px] text-slate-400 shrink-0">{dist}m</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {recipeRoute && (
            <div className="px-3 py-1.5 bg-slate-50 border-t border-[#E2E8F0] text-[10px] font-bold text-[#64748B] flex items-center justify-between">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-xs text-emerald-600">directions_walk</span>
                예상 동선
              </span>
              <span className="text-[#0F172A] font-extrabold">
                약 {Math.round(recipeRoute.totalMeters)}m · {Math.max(1, Math.round(recipeRoute.totalMeters / WALK_METERS_PER_MIN))}분
              </span>
            </div>
          )}
        </div>
        )
      )}

      {/* Floating Action Map Controls (Left Middle) */}
      <div className="absolute left-3 top-1/3 transform -translate-y-1/2 flex flex-col gap-2 z-30">
        <div className="bg-white rounded-2xl shadow-md flex flex-col overflow-hidden border border-[#E2E8F0]">
          <button
            onClick={() => handleZoom(1)}
            className="w-10 h-10 flex items-center justify-center text-[#334155] hover:bg-slate-50 border-b border-[#F1F5F9]"
            title="확대"
          >
            <span className="material-symbols-outlined text-xl">add</span>
          </button>
          <button
            onClick={() => handleZoom(-1)}
            className="w-10 h-10 flex items-center justify-center text-[#334155] hover:bg-slate-50"
            title="축소"
          >
            <span className="material-symbols-outlined text-xl">remove</span>
          </button>
        </div>
      </div>

      {/* Floating Current Location Button (Bottom Right) */}
      <div
        className={`absolute right-4 z-30 flex flex-col items-end gap-2 transition-all duration-300 ${
          isDocentExpanded ? "bottom-[calc(330px+env(safe-area-inset-bottom))]" : "bottom-[calc(155px+env(safe-area-inset-bottom))]"
        }`}
      >
        <button
          onClick={handleGoToCurrentLocation}
          className="w-11 h-11 bg-white hover:bg-slate-50 text-[#0052FF] active:scale-95 rounded-full shadow-lg border border-slate-200/90 flex items-center justify-center transition-all cursor-pointer group"
          title="내 현재 위치로 이동"
          id="current-location-btn"
        >
          <span className="material-symbols-outlined text-2xl group-hover:rotate-12 transition-transform">
            my_location
          </span>
        </button>
      </div>

      {/* AI Docent Audio Player Bottom Sheet — 점포를 하나도 클릭하지 않은 상태에서는
          정적 기본 스크립트를 마치 실제 도슨트처럼 보여주면 안 되므로, activePin(클릭한
          점포)이 있을 때만 렌더링한다. */}
      {activePin && (() => {
        // 닫혀있을 때는 상단 미니 바 (높이 약 64px)만 남기고 아래로 숨김
        // translateY: 닫힌 상태 -> calc(100% - 64px), 펼친 상태 -> 0px
        const baseTranslate = isDocentExpanded ? "0px" : "calc(100% - 64px)";
        const currentTransform = isDragging
          ? `calc(${baseTranslate} + ${dragOffsetY}px)`
          : baseTranslate;

        return (
          <div
            className={`absolute bottom-[calc(76px+env(safe-area-inset-bottom))] left-0 right-0 z-30 px-3 max-w-md mx-auto ${
              isDragging ? "" : "transition-transform duration-300 ease-out"
            }`}
            style={{
              transform: `translateY(${currentTransform})`,
            }}
          >
            <div className="bg-white rounded-2xl shadow-xl border border-[#E2E8F0] w-full flex flex-col overflow-hidden">
              {/* Draggable Top Handle & Mini Header */}
              <div
                onClick={() => {
                  if (Math.abs(dragOffsetY) < 5) {
                    setIsDocentExpanded(!isDocentExpanded);
                  }
                }}
                onTouchStart={(e) => handleDragStart(e.touches[0].clientY)}
                onMouseDown={(e) => handleDragStart(e.clientY)}
                className="w-full pt-2.5 pb-2.5 px-4 flex flex-col cursor-grab active:cursor-grabbing hover:bg-slate-50/80 transition-colors touch-none select-none group border-b border-transparent"
                title={isDocentExpanded ? "아래로 드래그하여 접기" : "위로 드래그하여 펼치기"}
              >
                {/* Drag Indicator Bar */}
                <div className="w-12 h-1.5 bg-[#CBD5E1] group-hover:bg-[#94A3B8] rounded-full transition-colors mx-auto mb-2 shrink-0"></div>

                {/* Mini Player Row (Always Visible as Handle Title) */}
                <div className="w-full flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#E0E7FF] flex items-center justify-center text-[#2563EB] shrink-0">
                      <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                        graphic_eq
                      </span>
                    </div>
                    <div className="flex flex-col min-w-0 text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-extrabold text-[#0052FF] uppercase tracking-wider">AI DOCENT</span>
                        <span className="text-[10px] font-medium text-slate-400">| 스와이프하여 {isDocentExpanded ? "접기" : "열기"}</span>
                      </div>
                      <span className="text-xs font-bold text-slate-800 truncate">
                        {activePin}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDocentPlay();
                      }}
                      className="w-8 h-8 bg-[#0052FF] text-white rounded-full flex items-center justify-center shadow-xs hover:scale-105 active:scale-95 transition-transform"
                      title={isPlayingDocent ? "일시정지" : "재생"}
                    >
                      <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                        {isPlayingDocent ? "pause" : "play_arrow"}
                      </span>
                    </button>
                    <span className="material-symbols-outlined text-slate-400 text-xl transition-transform duration-300">
                      {isDocentExpanded ? "expand_more" : "expand_less"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Expandable Body Content (Audio Details & Controls) */}
              <div className="px-4 pb-4 pt-1 flex flex-col gap-2 border-t border-slate-100">
                {/* Script Quote */}
                <p className="text-xs sm:text-sm text-[#475569] font-medium leading-relaxed mt-0.5">
                  {isDocentLoading ? "AI 도슨트를 준비하고 있어요..." : currentScript}
                </p>

                {/* Progress Bar Row */}
                <div className="flex items-center gap-2.5 mt-1">
                  <span className="text-xs font-semibold text-[#64748B] min-w-[36px]">{formatSeconds(docentElapsedSec)}</span>
                  <div
                    className="flex-1 h-1.5 bg-[#DBEAFE] rounded-full overflow-hidden cursor-pointer"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const clickX = e.clientX - rect.left;
                      const ratio = Math.max(0, Math.min(1, clickX / rect.width));
                      seekDocentBy(ratio * docentTotalSec - docentElapsedSec);
                    }}
                  >
                    <div
                      className="h-full bg-[#0052FF] rounded-full transition-all duration-300"
                      style={{ width: `${docentProgress}%` }}
                    ></div>
                  </div>
                  <span className="text-xs font-semibold text-[#64748B] min-w-[36px] text-right">{formatSeconds(docentTotalSec)}</span>
                </div>

                {/* Controls Row */}
                <div className="flex items-center justify-center gap-8 mt-1 pt-0.5">
                  <button
                    onClick={() => seekDocentBy(-10)}
                    className="p-1 text-[#334155] hover:text-[#0052FF] transition-colors"
                  >
                    <span className="material-symbols-outlined text-2xl">skip_previous</span>
                  </button>

                  <button
                    onClick={toggleDocentPlay}
                    className="w-11 h-11 bg-[#0052FF] text-white rounded-full flex items-center justify-center shadow-md hover:scale-105 active:scale-95 transition-all"
                  >
                    <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                      {isPlayingDocent ? "pause" : "play_arrow"}
                    </span>
                  </button>

                  <button
                    onClick={() => seekDocentBy(10)}
                    className="p-1 text-[#334155] hover:text-[#0052FF] transition-colors"
                  >
                    <span className="material-symbols-outlined text-2xl">skip_next</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
