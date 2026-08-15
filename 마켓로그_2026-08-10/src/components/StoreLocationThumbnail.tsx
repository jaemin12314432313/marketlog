import React, { useEffect, useRef, useState } from "react";
import { fetchMapConfig, getStoreLocation } from "../lib/api";

const NAVER_SCRIPT_ID = "naver-maps-sdk";

interface StoreLocationThumbnailProps {
  onEdit: () => void;
  // StoreLocationPicker에서 위치를 새로 저장할 때마다 부모가 이 값을 바꿔주면
  // 썸네일이 최신 좌표로 다시 그려진다.
  refreshKey?: number;
}

// 점포 위치를 초록색 텍스트 박스 대신 실제 지도 썸네일로 보여준다 — 사장님이 글씨를
// 읽지 않아도 "내 가게가 저기 잘 찍혀 있다"를 한눈에 확인할 수 있게. StoreLocationPicker와
// 같은 네이버 지도 SDK를 재사용하되, 드래그/줌/클릭을 다 잠가서 스냅샷처럼 보이게 한다.
export const StoreLocationThumbnail: React.FC<StoreLocationThumbnailProps> = ({
  onEdit,
  refreshKey,
}) => {
  const [naverLoaded, setNaverLoaded] = useState(false);
  // undefined = 좌표 불러오는 중, null = 아직 미등록, 객체 = 등록된 좌표
  const [pin, setPin] = useState<{ lat: number; lng: number } | null | undefined>(undefined);
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    if ((window as any).naver?.maps) {
      setNaverLoaded(true);
    } else {
      const existingScript = document.getElementById(NAVER_SCRIPT_ID) as HTMLScriptElement | null;
      if (existingScript) {
        existingScript.addEventListener("load", () => {
          if (!cancelled) setNaverLoaded(true);
        });
      } else {
        fetchMapConfig()
          .then((config) => {
            if (cancelled) return;
            const script = document.createElement("script");
            script.id = NAVER_SCRIPT_ID;
            script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${config.naver_client_id}&submodules=geocoding`;
            script.onload = () => {
              if (!cancelled) setNaverLoaded(true);
            };
            document.head.appendChild(script);
          })
          .catch((err) => console.error("네이버 지도 설정을 불러오지 못했습니다.", err));
      }
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPin(undefined);
    getStoreLocation()
      .then((res) => setPin(res.store ? { lat: res.store.lat, lng: res.store.lng } : null))
      .catch((err) => {
        console.error("점포 위치를 불러오지 못했습니다.", err);
        setPin(null);
      });
  }, [refreshKey]);

  useEffect(() => {
    if (!naverLoaded || !pin || !mapElement.current) return;
    const naver = (window as any).naver;
    const center = new naver.maps.LatLng(pin.lat, pin.lng);

    if (!mapRef.current) {
      mapRef.current = new naver.maps.Map(mapElement.current, {
        center,
        zoom: 17,
        draggable: false,
        pinchZoom: false,
        scrollWheel: false,
        keyboardShortcuts: false,
        disableDoubleClickZoom: true,
        zoomControl: false,
        scaleControl: false,
        logoControl: false,
        mapDataControl: false,
      });
      markerRef.current = new naver.maps.Marker({ position: center, map: mapRef.current });
    } else {
      mapRef.current.setCenter(center);
      markerRef.current?.setPosition(center);
    }
  }, [naverLoaded, pin]);

  useEffect(() => {
    return () => {
      mapRef.current?.destroy?.();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  if (pin === null) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="w-full h-28 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/60 hover:bg-emerald-50 flex flex-col items-center justify-center gap-1.5 transition-colors"
      >
        <span className="material-symbols-outlined text-emerald-600 text-2xl">location_on</span>
        <span className="text-xs font-extrabold text-emerald-700">지도에서 점포 위치 등록하기</span>
      </button>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onEdit();
      }}
      className="relative w-full h-28 rounded-2xl overflow-hidden border border-[#E2E8F0] bg-slate-100 cursor-pointer group"
    >
      <div ref={mapElement} className="w-full h-full pointer-events-none" />
      {(pin === undefined || !naverLoaded) && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
          <span className="text-[11px] text-slate-400 font-bold">위치 불러오는 중...</span>
        </div>
      )}
      <span className="absolute bottom-2 right-2 px-2.5 py-1.5 rounded-full bg-white/95 shadow-md text-[11px] font-extrabold text-emerald-700 flex items-center gap-0.5 group-hover:bg-white transition-colors">
        지도 수정
        <span className="material-symbols-outlined text-sm">chevron_right</span>
      </span>
    </div>
  );
};
