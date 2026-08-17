import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchMapConfig, fetchMapStores, geocodeAddress, getStoreLocation, reverseGeocode, searchPlace, setStoreLocation } from "../lib/api";

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
  // 지도를 눌러서만 위치를 찾기엔 정확한 자리를 짚기 어렵다는 피드백 — 주소를 입력해
  // 지오코딩(naver.maps.Service.geocode)으로 좌표를 찾은 뒤 그 자리로 지도/핀을 옮긴다.
  const [addressQuery, setAddressQuery] = useState("");
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  // 주소 지오코딩 결과와 상호명 검색(네이버 검색 API) 결과를 한 목록에 같이 보여준다 —
  // "양동시장"처럼 정확한 주소를 모르는 장소명으로도 찾을 수 있게. 상호명 검색 API 키가
  // 아직 없으면 그쪽만 조용히 빈 배열로 실패하고 주소 검색 결과는 그대로 나온다.
  const [addressResults, setAddressResults] = useState<
    { label: string; sublabel: string; lat: number; lng: number }[]
  >([]);
  // 지도를 클릭하거나 검색 결과를 골라 핀이 찍히면, 그 좌표의 도로명 주소를 자동으로
  // 역지오코딩해서 보여준다 — 위도/경도 숫자만 봐서는 어디인지 알기 어려우니까.
  const [resolvedAddress, setResolvedAddress] = useState("");
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);

  useEffect(() => {
    if (!pin) {
      setResolvedAddress("");
      return;
    }
    let cancelled = false;
    setIsResolvingAddress(true);
    reverseGeocode(pin.lat, pin.lng)
      .then((res) => {
        if (!cancelled) setResolvedAddress(res.roadAddress || res.label || "");
      })
      .catch((err) => {
        console.error("주소 역지오코딩 실패", err);
        if (!cancelled) setResolvedAddress("");
      })
      .finally(() => {
        if (!cancelled) setIsResolvingAddress(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pin]);

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

      // 모달이 화면에 완전히 자리잡기 전에 지도 컨테이너 크기를 재버리면 지도가 실제
      // 칸보다 넓게(또는 좁게) 그려진 채로 굳어버릴 수 있다 — 한 프레임 뒤에 강제로
      // 다시 계산시켜서 실제 컨테이너 크기에 맞춘다.
      requestAnimationFrame(() => {
        if (mapRef.current) naver.maps.Event.trigger(mapRef.current, "resize");
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

  // naver.maps.Service.geocode()를 브라우저에서 직접 부르면 이 계정에서는
  // naver.maps.Service 자체가 끝내 안 붙는 걸 확인했다(콘솔에 Geocoding API가 등록돼
  // 있어도 발생 — 비밀키 없는 클라이언트 인증으로는 막히는 것으로 보임). 비밀키가 있어야
  // 하는 서버사이드 REST 지오코딩을 백엔드가 대신 호출해주는 방식으로 바꿨다.
  const handleAddressSearch = async () => {
    const query = addressQuery.trim();
    if (!query) return;
    setIsSearchingAddress(true);
    setAddressResults([]);
    try {
      const [placeRes, addrRes] = await Promise.allSettled([searchPlace(query), geocodeAddress(query)]);

      const placeResults =
        placeRes.status === "fulfilled"
          ? placeRes.value.places.map((p) => ({
              label: p.name,
              sublabel: [p.category, p.roadAddress || p.jibunAddress].filter(Boolean).join(" · "),
              lat: p.lat,
              lng: p.lng,
            }))
          : [];
      const addressResultsList =
        addrRes.status === "fulfilled"
          ? addrRes.value.addresses.map((a) => ({
              label: a.roadAddress || a.jibunAddress,
              sublabel: a.roadAddress && a.jibunAddress ? a.jibunAddress : "",
              lat: a.lat,
              lng: a.lng,
            }))
          : [];

      const merged = [...placeResults, ...addressResultsList].slice(0, 6);
      if (merged.length === 0) {
        alert("검색 결과가 없어요. 장소명이나 도로명/지번 주소로 다시 시도해보세요.");
        return;
      }
      setAddressResults(merged);
    } catch (err) {
      console.error("주소 검색 실패", err);
      alert("주소 검색에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsSearchingAddress(false);
    }
  };

  const handleSelectAddressResult = (result: { lat: number; lng: number }) => {
    setPin({ lat: result.lat, lng: result.lng });
    setAddressResults([]);
    setAddressQuery("");

    const naver = (window as any).naver;
    if (mapRef.current && naver) {
      const point = new naver.maps.LatLng(result.lat, result.lng);
      mapRef.current.setCenter(point);
      mapRef.current.setZoom(19);
      if (markerRef.current) {
        markerRef.current.setPosition(point);
      } else {
        markerRef.current = new naver.maps.Marker({ position: point, map: mapRef.current });
      }
    }
  };

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
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" style={{ maxWidth: "min(28rem, calc(100vw - 2rem))" }}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-extrabold text-slate-900 text-base">점포 위치 등록</h3>
            <p className="text-xs text-slate-500 mt-0.5">주소로 검색하거나, 지도를 눌러 내 점포 위치에 핀을 찍어주세요</p>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <div className="px-4 pt-4 shrink-0 relative">
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 bg-slate-100 rounded-xl px-3 h-11">
              <span className="material-symbols-outlined text-slate-400 text-lg">search</span>
              <input
                type="text"
                value={addressQuery}
                onChange={(e) => setAddressQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddressSearch();
                  }
                }}
                placeholder="장소명 또는 주소로 검색"
                className="flex-1 bg-transparent border-none focus:outline-none text-sm text-slate-800 placeholder-slate-400"
              />
            </div>
            <button
              type="button"
              onClick={handleAddressSearch}
              disabled={isSearchingAddress || !addressQuery.trim()}
              className="h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold shrink-0 transition-colors"
            >
              {isSearchingAddress ? "검색 중..." : "검색"}
            </button>
          </div>

          {addressResults.length > 0 && (
            <div className="absolute left-4 right-4 top-[calc(100%-4px)] z-10 bg-white rounded-xl shadow-xl border border-slate-200 max-h-56 overflow-y-auto">
              {addressResults.map((result, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectAddressResult(result)}
                  className="w-full text-left px-3.5 py-2.5 text-xs hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-b-0"
                >
                  <p className="font-bold text-slate-800">{result.label}</p>
                  {result.sublabel && <p className="text-slate-400 mt-0.5">{result.sublabel}</p>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative w-full h-80 bg-slate-100 shrink-0 mt-3">
          {(!naverLoaded || isLoadingInitial) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}
          <div ref={mapElement} className="absolute inset-0 w-full h-full" />
        </div>

        <div className="p-4 space-y-2.5 shrink-0">
          {pin ? (
            <div className="text-[11px] text-slate-500 leading-relaxed space-y-0.5">
              <p className="font-bold text-slate-700 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm shrink-0">location_on</span>
                {isResolvingAddress ? "주소 확인 중..." : resolvedAddress || "이 위치의 도로명 주소를 찾지 못했어요."}
              </p>
              <p>위도 {pin.lat.toFixed(6)}, 경도 {pin.lng.toFixed(6)}</p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 leading-relaxed">아직 위치를 선택하지 않았어요.</p>
          )}
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
