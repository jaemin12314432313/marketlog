import React, { useState, useEffect, useMemo, useRef } from "react";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { MarketInfo } from "../types";
import { MARKETS_DATA } from "../data/initialData";
import { fetchMapConfig, fetchMapStores, fetchDocentStory, MapStorePin } from "../lib/api";

interface MapViewProps {
  selectedMarket: MarketInfo;
  // 검색으로 다른 전통시장(양동/망원/자갈치)을 고르면 지도가 그 시장으로 전환된다.
  onSelectMarket?: (market: MarketInfo) => void;
  onOpenAiScan: () => void;
  // 상품 상세 등 다른 화면에서 "이 상점 지도에서 확인하기"로 넘어왔을 때, 그 상점으로
  // 바로 이동/포커스하기 위한 이름. 처리 후 onFocusHandled로 부모 쪽 상태를 비운다.
  focusShopName?: string | null;
  onFocusHandled?: () => void;
  // 상품 상세에서 넘어온 경우에만 채워진다 — 있을 때만 뒤로가기 버튼을 보여주고,
  // 누르면 원래 보던 상품 상세로 돌아간다. 하단 탭에서 지도 탭을 직접 눌러 들어온
  // 경우엔 없으므로 버튼도 안 뜬다.
  onBack?: () => void;
  // 상품 상세의 레시피 탭 "지도에서 재료 위치 확인"에서 넘어온 재료 이름 목록.
  // 있으면 이 시장의 실제 점포/등록 상품과 매칭해서 체크리스트 + 마커 강조 +
  // 내 위치에서 출발하는 최단 동선(직선거리 기준)을 보여준다.
  recipeIngredients?: string[] | null;
}

const NAVER_SCRIPT_ID = "naver-maps-sdk";
// Stores sit only meters apart inside the same market building, so pins overlap
// badly when zoomed out. Only show them once the user has zoomed in close enough
// to tell them apart.
const MIN_ZOOM_FOR_MARKERS = 19;
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
function buildMarkerContent(store: MapStorePin, isFocused: boolean, routeOrder?: number): string {
  const productBadge = store.products.length
    ? `<span class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-bold flex items-center justify-center border border-white">${store.products.length}</span>`
    : "";
  const routeBadge = routeOrder
    ? `<span class="absolute -bottom-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#10B981] text-white text-[10px] font-extrabold flex items-center justify-center border-2 border-white shadow-sm">${routeOrder}</span>`
    : "";
  const pinColor = isFocused ? "#EF4444" : store.badge_color;
  const pinSizeClass = isFocused ? "w-12 h-12" : "w-9 h-9";
  const iconSizeClass = isFocused ? "text-2xl" : "text-lg";
  const bounceClass = isFocused ? "animate-bounce" : "";
  const ringStyle = routeOrder ? "box-shadow:0 0 0 4px rgba(16,185,129,0.5);" : "";
  return `
    <div class="flex flex-col items-center cursor-pointer group ${bounceClass}">
      <div class="relative ${pinSizeClass} text-white rounded-full flex items-center justify-center shadow-lg border-2 border-white group-hover:scale-110 transition-transform" style="background:${pinColor};${ringStyle}">
        <span class="material-symbols-outlined ${iconSizeClass}">${store.icon}</span>
        ${productBadge}
        ${routeBadge}
      </div>
      <span class="text-xs font-bold bg-white px-2 py-0.5 rounded-md mt-0.5 shadow-sm border ${isFocused ? "border-[#EF4444]" : routeOrder ? "border-[#10B981]" : "border-[#E2E8F0]"}" style="color:${pinColor}">
        ${store.name}
      </span>
    </div>
  `;
}

export const MapView: React.FC<MapViewProps> = ({
  selectedMarket,
  onSelectMarket,
  onOpenAiScan,
  focusShopName,
  onFocusHandled,
  onBack,
  recipeIngredients,
}) => {
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
  const [stores, setStores] = useState<MapStorePin[]>([]);
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
  const searchResults = trimmedQuery
    ? stores
        .filter(
          (s) =>
            s.name.includes(trimmedQuery) ||
            s.subtitle.includes(trimmedQuery) ||
            s.notice.includes(trimmedQuery)
        )
        .slice(0, 8)
    : [];
  // 검색으로 다른 전통시장도 찾아서 바로 전환할 수 있게 한다 — 예전엔 지역 선택
  // 드롭다운에서 "서울특별시" 같은 걸 고르면 지도가 몰래 다른 시장으로 바뀌었는데,
  // 지역 필터와 지도 시장 전환은 서로 다른 기능이라 분리했다.
  const marketResults = trimmedQuery
    ? MARKETS_DATA.filter(
        (m) => m.id !== selectedMarket.id && (m.name.includes(trimmedQuery) || m.city.includes(trimmedQuery))
      )
    : [];

  // 레시피 재료 목록을, 이 시장에 실제로 등록된 점포/상품과 이름으로 매칭한다. "액젓 &
  // 다진마늘"처럼 묶여있는 재료는 "&"/","로 쪼개 각각 시도한다. 재료명이 짧은 일반명사가
  // 많아서(예: "무", "마늘") 정확도는 완벽하지 않지만, 이 시장에 없는 재료는 정직하게
  // "이 시장엔 없음"으로 보여준다 — 아무거나 억지로 매칭시키지 않는다.
  const recipeMatches = useMemo(() => {
    if (!recipeIngredients || recipeIngredients.length === 0) return [];
    return recipeIngredients.map((rawName) => {
      const cleaned = rawName.replace(/\s*\(본 상품\)\s*/g, "").trim();
      const parts = cleaned.split(/[&,]/).map((p) => p.trim()).filter(Boolean);
      let matchedStore: MapStorePin | null = null;
      for (const part of parts) {
        if (!part) continue;
        const found = stores.find(
          (s) =>
            s.products.some((p) => p.title.includes(part) || part.includes(p.title)) ||
            s.subtitle.includes(part) ||
            s.notice.includes(part)
        );
        if (found) {
          matchedStore = found;
          break;
        }
      }
      return { ingredient: cleaned, store: matchedStore };
    });
  }, [recipeIngredients, stores]);

  const matchedRecipeStores = useMemo(() => {
    const seen = new Set<string>();
    const list: MapStorePin[] = [];
    recipeMatches.forEach((m) => {
      if (m.store && !seen.has(m.store.id)) {
        seen.add(m.store.id);
        list.push(m.store);
      }
    });
    return list;
  }, [recipeMatches]);

  // 내 위치(없으면 시장 중심)에서 출발해 최근접 이웃 순으로 방문 순서를 정한다.
  // 내 위치가 이 시장에서 3km 넘게 떨어져 있으면(예: 집에서 그냥 레시피만 구경하는 중)
  // "내 위치에서 걸어서 장보기 동선"은 의미가 없다 — 지도가 내 위치와 시장을 억지로
  // 한 화면에 욱여넣으려다 잔뜩 축소돼서 아무것도 안 보이는 화면이 되던 원인이기도
  // 했다. 이럴 땐 내 위치 대신 시장 중심을 출발점으로 써서, 시장 안에서의 동선만 보여준다.
  const MAX_WALK_ROUTE_START_METERS = 3000;
  const recipeRouteStart = useMemo(() => {
    if (!mapCenter) return null;
    const useMyLocation = myLocation && haversineMeters(myLocation, mapCenter) <= MAX_WALK_ROUTE_START_METERS;
    return useMyLocation ? myLocation! : mapCenter;
  }, [myLocation, mapCenter]);

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
    if (!focusShopName && !geoAttempted) return;
    const initialCenter = !focusShopName && myLocation ? myLocation : mapCenter;
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
    naver.maps.Event.addListener(mapRef.current, "zoom_changed", (zoom: number) => {
      setCurrentZoom(zoom);
    });

    if (!focusShopName && myLocation) {
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
  }, [naverLoaded, mapCenter, geoAttempted, myLocation, focusShopName]);

  // 시장을 검색해서 실제로 다른 시장으로 바꾼 경우에만 이미 만들어진 지도 인스턴스를
  // 새 중심으로 옮긴다. appliedMarketIdRef가 null인 최초 1회(=지도 생성 시점)는 건드리지
  // 않는다 — 그렇지 않으면 내 위치로 막 띄운 지도를 시장 데이터가 도착하자마자 다시
  // 시장 중심으로 되돌려버리게 된다.
  const appliedMarketIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mapRef.current || !mapCenter) return;
    const isMarketSwitch = appliedMarketIdRef.current !== null && appliedMarketIdRef.current !== selectedMarket.id;
    appliedMarketIdRef.current = selectedMarket.id;
    if (!isMarketSwitch) return;
    const naver = (window as any).naver;
    mapRef.current.setCenter(new naver.maps.LatLng(mapCenter.lat, mapCenter.lng));
  }, [mapCenter, selectedMarket.id]);

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

  // Render store pins as real markers positioned by lat/lng, once zoomed in close
  // enough to tell neighboring stalls apart; replaced whenever the list or zoom changes.
  useEffect(() => {
    if (!naverLoaded || !mapRef.current) return;

    if (currentZoom < MIN_ZOOM_FOR_MARKERS || stores.length === 0) {
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      return;
    }

    const naver = (window as any).naver;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = stores.map((store) => {
      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(store.lat, store.lng),
        map: mapRef.current,
        icon: {
          content: buildMarkerContent(store, activePin === store.name, recipeRouteStoreOrder.get(store.id)),
          anchor: new naver.maps.Point(40, 18),
        },
      });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naverLoaded, stores, currentZoom, activePin, recipeRouteStoreOrder]);

  // 레시피 장보기 동선 — 내 위치(또는 시장 중심)에서 매칭된 점포들을 최근접 순으로 잇는
  // 점선을 그리고, 전부 한눈에 보이도록 지도 범위를 맞춘다.
  useEffect(() => {
    if (!naverLoaded || !mapRef.current) return;
    const naver = (window as any).naver;

    if (recipeRouteLineRef.current) {
      recipeRouteLineRef.current.setMap(null);
      recipeRouteLineRef.current = null;
    }

    if (!recipeRoute || recipeRoute.order.length === 0 || !recipeRouteStart) return;

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
    mapRef.current.fitBounds(bounds, { top: 160, right: 40, bottom: 200, left: 40 });
    // fitBounds가 고른 줌이 MIN_ZOOM_FOR_MARKERS보다 낮으면 점포 마커 자체가 안 보이는
    // 줌이라(위쪽 "더 확대하면 점포가 표시됩니다" 상태), 체크리스트를 보고 일부러 여기까지
    // 온 상황이니 최소한 마커가 보이는 줌까지는 강제로 올려준다.
    if (mapRef.current.getZoom() < MIN_ZOOM_FOR_MARKERS) {
      mapRef.current.setZoom(MIN_ZOOM_FOR_MARKERS);
    }

    return () => {
      if (recipeRouteLineRef.current) {
        recipeRouteLineRef.current.setMap(null);
        recipeRouteLineRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naverLoaded, recipeRoute, recipeRouteStart]);

  // Elapsed time is derived from a real wall-clock start time (speechStartRef), not a
  // fixed 1%/sec loop -- Web Speech API gives no true duration, so "seeking" below works
  // by shifting that start time rather than actually scrubbing the audio.
  useEffect(() => {
    if (!isPlayingDocent) return;
    const interval = setInterval(() => {
      if (speechStartRef.current === null) return;
      const elapsed = (Date.now() - speechStartRef.current) / 1000;
      setDocentElapsedSec(Math.min(docentTotalSec, elapsed));
    }, 250);
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

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#F0F3F4] text-on-surface" style={{ overscrollBehavior: "none" }}>
      <div ref={mapElement} className="absolute inset-0 w-full h-full z-0" style={{ overscrollBehavior: "contain" }} />

      {currentZoom < MIN_ZOOM_FOR_MARKERS && stores.length > 0 && (
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
              onBlur={() => setShowSearchResults(false)}
              placeholder="점포, 다른 전통시장 검색"
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
          <button
            className="w-11 h-11 bg-white rounded-full shadow-md flex items-center justify-center text-[#2563EB] border border-[#E2E8F0]"
            title="현재 위치"
            onClick={handleGoToCurrentLocation}
          >
            <span className="material-symbols-outlined">my_location</span>
          </button>
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
            {searchResults.length > 0 ? (
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
              ))
            ) : marketResults.length === 0 ? (
              <div className="px-4 py-3 text-sm text-outline text-center">검색 결과가 없습니다</div>
            ) : null}
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
        <div className="absolute top-[calc(6.5rem+env(safe-area-inset-top))] right-4 z-30 w-64 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-xl border border-[#E2E8F0] overflow-hidden">
          <div className="flex items-center justify-between px-3.5 py-2.5 bg-emerald-50 border-b border-emerald-100">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="material-symbols-outlined text-emerald-600 text-lg shrink-0">checklist</span>
              <span className="text-xs font-extrabold text-emerald-800 truncate">레시피 장보기 체크리스트</span>
            </div>
            <button
              onClick={() => setIsRecipeChecklistMinimized(true)}
              className="text-emerald-700 hover:text-emerald-900 shrink-0"
              title="체크리스트 접기"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-[#F1F5F9]">
            {!storesLoaded ? (
              <div className="flex items-center justify-center gap-2 px-3.5 py-4 text-xs text-slate-400">
                <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                이 시장 점포 정보를 확인하는 중...
              </div>
            ) : (
              recipeMatches.map((m, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 px-3.5 py-2 text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`material-symbols-outlined text-base shrink-0 ${
                        m.store ? "text-emerald-600" : "text-slate-300"
                      }`}
                    >
                      {m.store ? "check_circle" : "radio_button_unchecked"}
                    </span>
                    <span className={`truncate font-bold ${m.store ? "text-[#0F172A]" : "text-slate-400"}`}>
                      {m.ingredient}
                    </span>
                  </div>
                  {m.store ? (
                    <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md shrink-0">
                      {m.store.name}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 shrink-0">이 시장엔 없음</span>
                  )}
                </div>
              ))
            )}
          </div>
          {recipeRoute && (
            <div className="px-3.5 py-2.5 bg-slate-50 border-t border-[#E2E8F0] text-[11px] font-bold text-[#64748B] flex items-center justify-between">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-sm text-emerald-600">directions_walk</span>
                예상 도보 동선
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
