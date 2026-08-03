import React, { useState, useEffect, useRef } from "react";
import { MarketInfo } from "../types";
import { fetchMapConfig, fetchMapStores, fetchDocentStory, MapStorePin } from "../lib/api";

interface MapViewProps {
  selectedMarket: MarketInfo;
  onOpenAiScan: () => void;
  onSelectShop: (shopName: string) => void;
}

const NAVER_SCRIPT_ID = "naver-maps-sdk";
// Stores sit only meters apart inside the same market building, so pins overlap
// badly when zoomed out. Only show them once the user has zoomed in close enough
// to tell them apart.
const MIN_ZOOM_FOR_MARKERS = 19;

function buildMarkerContent(store: MapStorePin): string {
  return `
    <div class="flex flex-col items-center cursor-pointer group">
      <div class="w-9 h-9 text-white rounded-full flex items-center justify-center shadow-md border-2 border-white group-hover:scale-110 transition-transform" style="background:${store.badge_color}">
        <span class="material-symbols-outlined text-lg">${store.icon}</span>
      </div>
      <span class="text-xs font-bold bg-white px-2 py-0.5 rounded-md mt-0.5 shadow-sm border border-[#E2E8F0]" style="color:${store.badge_color}">
        ${store.name}
      </span>
    </div>
  `;
}

export const MapView: React.FC<MapViewProps> = ({
  selectedMarket,
  onOpenAiScan,
  onSelectShop,
}) => {
  const [isPlayingDocent, setIsPlayingDocent] = useState(false);
  const [docentProgress, setDocentProgress] = useState(38); // percent
  const [currentScript, setCurrentScript] = useState(selectedMarket.docentScript);
  const [isDocentExpanded, setIsDocentExpanded] = useState(false); // 기본적으로 하단 배너 위에 살짝 나와있게 시작
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [activePin, setActivePin] = useState<string | null>(null);
  const [naverLoaded, setNaverLoaded] = useState(false);
  const [stores, setStores] = useState<MapStorePin[]>([]);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [currentZoom, setCurrentZoom] = useState(17);

  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const dragOffsetYRef = useRef<number>(0);
  const touchStartYRef = useRef<number | null>(null);
  const isDocentExpandedRef = useRef<boolean>(isDocentExpanded);
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const myLocationMarkerRef = useRef<any>(null);

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

  useEffect(() => {
    setCurrentScript(selectedMarket.docentScript);
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
    fetchMapStores(selectedMarket.name)
      .then((res) => {
        if (cancelled) return;
        setStores(res.stores);
        setMapCenter(res.center);
      })
      .catch((err) => console.error("점포 지도 정보를 불러오지 못했습니다.", err));
    return () => {
      cancelled = true;
    };
  }, [selectedMarket.name]);

  // Create the map once the SDK is loaded and we know where to center it.
  useEffect(() => {
    if (!naverLoaded || !mapElement.current || mapRef.current || !mapCenter) return;

    const naver = (window as any).naver;
    const center = new naver.maps.LatLng(mapCenter.lat, mapCenter.lng);
    mapRef.current = new naver.maps.Map(mapElement.current, {
      center,
      zoom: 17,
      zoomControl: false,
      scaleControl: false,
      logoControl: false,
      mapDataControl: false,
    });
    naver.maps.Event.addListener(mapRef.current, "zoom_changed", (zoom: number) => {
      setCurrentZoom(zoom);
    });
  }, [naverLoaded, mapCenter]);

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
          content: buildMarkerContent(store),
          anchor: new naver.maps.Point(40, 18),
        },
      });

      naver.maps.Event.addListener(marker, "click", () => {
        setActivePin(store.name);
        onSelectShop(store.name);
        handleFetchAiDocent(store.alley);
      });

      return marker;
    });

    return () => {
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naverLoaded, stores, currentZoom]);

  // Audio Progress Bar Simulation
  useEffect(() => {
    let interval: any;
    if (isPlayingDocent) {
      interval = setInterval(() => {
        setDocentProgress((prev) => (prev >= 100 ? 0 : prev + 1));
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isPlayingDocent]);

  const toggleDocentPlay = () => {
    if ("speechSynthesis" in window) {
      if (isPlayingDocent) {
        window.speechSynthesis.cancel();
        setIsPlayingDocent(false);
      } else {
        window.speechSynthesis.cancel();
        const textToSpeak = currentScript.replace(/"/g, "");
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.lang = "ko-KR";
        utterance.rate = 0.95;
        utterance.onend = () => setIsPlayingDocent(false);
        synthRef.current = utterance;
        window.speechSynthesis.speak(utterance);
        setIsPlayingDocent(true);
      }
    } else {
      setIsPlayingDocent(!isPlayingDocent);
    }
  };

  const handleGoToCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert("이 브라우저에서는 위치 확인을 지원하지 않습니다.");
      return;
    }
    if (!mapRef.current) {
      alert("지도를 아직 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
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
        const reason =
          error.code === error.PERMISSION_DENIED
            ? "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해 주세요."
            : "현재 위치를 가져오지 못했습니다.";
        alert(reason);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleZoom = (delta: number) => {
    if (!mapRef.current) return;
    mapRef.current.setZoom(mapRef.current.getZoom() + delta);
  };

  const handleFetchAiDocent = async (alley: string) => {
    try {
      const data = await fetchDocentStory({
        marketName: selectedMarket.name,
        alleyName: alley,
      });
      if (data.success && data.script) {
        setCurrentScript(`"${data.script}"`);
        setDocentProgress(0);
        setIsPlayingDocent(true);
        if ("speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(data.script);
          utterance.lang = "ko-KR";
          window.speechSynthesis.speak(utterance);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#F0F3F4] text-on-surface">
      <div ref={mapElement} className="absolute inset-0 w-full h-full z-0" />

      {currentZoom < MIN_ZOOM_FOR_MARKERS && stores.length > 0 && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 bg-white/95 text-[#334155] text-xs font-semibold px-3 py-1.5 rounded-full shadow-md border border-[#E2E8F0] pointer-events-none">
          더 확대하면 점포가 표시됩니다
        </div>
      )}

      {/* Top Floating Search Bar */}
      <div className="absolute top-4 left-4 right-4 z-30 max-w-lg mx-auto flex items-center gap-2">
        <div className="flex-1 bg-white rounded-full shadow-lg flex items-center px-4 h-12 border border-outline-variant/30">
          <span className="material-symbols-outlined text-outline mr-2">search</span>
          <input
            type="text"
            placeholder={`점포, 편의시설, 주차장 검색`}
            className="flex-1 bg-transparent border-none focus:outline-none text-sm text-on-surface placeholder-outline"
          />
        </div>
        <button
          className="w-11 h-11 bg-white rounded-full shadow-md flex items-center justify-center text-[#2563EB] border border-[#E2E8F0]"
          title="현재 위치"
          onClick={handleGoToCurrentLocation}
        >
          <span className="material-symbols-outlined">my_location</span>
        </button>
      </div>

      {/* Floating Action Map Controls (Left Middle) */}
      <div className="absolute left-3 top-1/3 transform -translate-y-1/2 flex flex-col gap-2 z-30">
        <button
          className="w-10 h-10 bg-white rounded-full shadow-md flex items-center justify-center text-[#2563EB] hover:bg-slate-50 transition-colors border border-[#E2E8F0]"
          title="단골 점포"
        >
          <span className="material-symbols-outlined text-xl">favorite</span>
        </button>
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
          isDocentExpanded ? "bottom-[330px]" : "bottom-[155px]"
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

      {/* AI Docent Audio Player Bottom Sheet */}
      {(() => {
        // 닫혀있을 때는 상단 미니 바 (높이 약 64px)만 남기고 아래로 숨김
        // translateY: 닫힌 상태 -> calc(100% - 64px), 펼친 상태 -> 0px
        const baseTranslate = isDocentExpanded ? "0px" : "calc(100% - 64px)";
        const currentTransform = isDragging
          ? `calc(${baseTranslate} + ${dragOffsetY}px)`
          : baseTranslate;

        return (
          <div
            className={`absolute bottom-[76px] left-0 right-0 z-30 px-3 max-w-md mx-auto ${
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
                        {selectedMarket.docentStoryTitle || "양동시장 수산길 이야기"}
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
                  {currentScript || `"오른쪽에 보이는 양동수산은 매일 새벽 산지에서 직송된 신선한 활어를 취급합니다. 오늘 A급..."`}
                </p>

                {/* Progress Bar Row */}
                <div className="flex items-center gap-2.5 mt-1">
                  <span className="text-xs font-semibold text-[#64748B] min-w-[36px]">01:24</span>
                  <div
                    className="flex-1 h-1.5 bg-[#DBEAFE] rounded-full overflow-hidden cursor-pointer"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const clickX = e.clientX - rect.left;
                      setDocentProgress(Math.max(0, Math.min(100, (clickX / rect.width) * 100)));
                    }}
                  >
                    <div
                      className="h-full bg-[#0052FF] rounded-full transition-all duration-300"
                      style={{ width: `${docentProgress}%` }}
                    ></div>
                  </div>
                  <span className="text-xs font-semibold text-[#64748B] min-w-[36px] text-right">03:45</span>
                </div>

                {/* Controls Row */}
                <div className="flex items-center justify-center gap-8 mt-1 pt-0.5">
                  <button
                    onClick={() => setDocentProgress(Math.max(0, docentProgress - 10))}
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
                    onClick={() => setDocentProgress(Math.min(100, docentProgress + 10))}
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
