import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchMapConfig, fetchMapStores, getStoreLocation, setStoreLocation } from "../lib/api";

const NAVER_SCRIPT_ID = "naver-maps-sdk";

interface StoreLocationPickerProps {
  isOpen: boolean;
  onClose: () => void;
  marketName: string;
  onSaved?: () => void;
  // "save"(기본) — 로그인된 상인이 자기 위치를 바로 서버에 저장한다 (MerchantView에서 사용).
  // "pick" — 아직 계정이 없는 회원가입 도중이라 서버에 저장할 인증 토큰이 없으므로, 좌표만
  // 골라서 onPinPicked로 부모에게 넘긴다. 실제 저장은 부모가 가입 완료 시점에 처리한다.
  mode?: "save" | "pick";
  initialPin?: { lat: number; lng: number } | null;
  onPinPicked?: (pin: { lat: number; lng: number }) => void;
}

// 상인이 자기 점포 위치에 직접 핀을 찍어 등록하는 모달. 지도의 실제 점포 데이터(공공데이터
// 463개)와 상인 shop_name이 정확히 일치할 때만 상품이 지도에 뜨던 문제를 해결하기 위해,
// 상인이 직접 자기 위치를 등록하면 그 이름으로 새 점포가 만들어지고 지도에 반영된다.
export const StoreLocationPicker: React.FC<StoreLocationPickerProps> = ({
  isOpen,
  onClose,
  marketName,
  onSaved,
  mode = "save",
  initialPin = null,
  onPinPicked,
}) => {
  const [naverLoaded, setNaverLoaded] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(initialPin);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingInitial, setIsLoadingInitial] = useState(mode === "save");

  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPin(initialPin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    if ((window as any).naver && (window as any).naver.maps) {
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
  }, [isOpen]);

  // "save" 모드에서만 — 이미 등록된 위치가 있으면 불러와서 그 자리에 핀을 미리 찍어둔다.
  // "pick" 모드는 아직 계정이 없으니 조회할 서버 데이터 자체가 없다.
  useEffect(() => {
    if (!isOpen || mode !== "save") return;
    setIsLoadingInitial(true);
    getStoreLocation()
      .then((res) => {
        if (res.store) {
          setPin({ lat: res.store.lat, lng: res.store.lng });
        }
      })
      .catch((err) => console.error("점포 위치를 불러오지 못했습니다.", err))
      .finally(() => setIsLoadingInitial(false));
  }, [isOpen, mode]);

  useEffect(() => {
    if (!isOpen || !naverLoaded || !mapElement.current || isLoadingInitial) return;

    const naver = (window as any).naver;

    const init = (center: { lat: number; lng: number }) => {
      if (mapRef.current) return;
      const startCenter = pin || center;
      mapRef.current = new naver.maps.Map(mapElement.current, {
        center: new naver.maps.LatLng(startCenter.lat, startCenter.lng),
        zoom: 19,
        zoomControl: false,
        scaleControl: false,
        logoControl: false,
        mapDataControl: false,
      });

      if (pin) {
        markerRef.current = new naver.maps.Marker({
          position: new naver.maps.LatLng(pin.lat, pin.lng),
          map: mapRef.current,
        });
      }

      naver.maps.Event.addListener(mapRef.current, "click", (e: any) => {
        const lat = e.coord.y;
        const lng = e.coord.x;
        setPin({ lat, lng });
        if (markerRef.current) {
          markerRef.current.setPosition(e.coord);
        } else {
          markerRef.current = new naver.maps.Marker({ position: e.coord, map: mapRef.current });
        }
      });
    };

    if (pin) {
      init(pin);
    } else {
      fetchMapStores(marketName)
        .then((res) => init(res.center))
        .catch(() => init({ lat: 35.1531, lng: 126.9028 }));
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.destroy?.();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, naverLoaded, isLoadingInitial]);

  const handleClose = () => {
    mapRef.current = null;
    markerRef.current = null;
    onClose();
  };

  const handleConfirm = async () => {
    if (!pin) {
      alert("지도를 눌러 점포 위치를 먼저 찍어주세요.");
      return;
    }
    if (mode === "pick") {
      onPinPicked?.(pin);
      handleClose();
      return;
    }
    setIsSaving(true);
    try {
      await setStoreLocation(pin);
      alert("점포 위치가 등록되었습니다. 이제 지도에서 내 점포와 상품을 볼 수 있어요.");
      onSaved?.();
      handleClose();
    } catch (err) {
      console.error(err);
      alert("점포 위치 등록에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-extrabold text-slate-900 text-base">점포 위치 등록</h3>
            <p className="text-xs text-slate-500 mt-0.5">지도를 눌러 내 점포 위치에 핀을 찍어주세요</p>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <div className="relative w-full h-80 bg-slate-100 shrink-0">
          {(!naverLoaded || isLoadingInitial) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}
          <div ref={mapElement} className="absolute inset-0 w-full h-full" />
        </div>

        <div className="p-4 space-y-2.5 shrink-0">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {pin
              ? `선택된 위치: 위도 ${pin.lat.toFixed(6)}, 경도 ${pin.lng.toFixed(6)}`
              : "아직 위치를 선택하지 않았어요."}
          </p>
          <button
            onClick={handleConfirm}
            disabled={isSaving || !pin}
            className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-extrabold text-sm shadow-md transition-all flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-base">check_circle</span>
            <span>{isSaving ? "저장 중..." : mode === "pick" ? "이 위치로 선택하기" : "이 위치로 등록하기"}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
