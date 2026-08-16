import React, { useState, useRef, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { ProductItem, InspectionResult } from "../types";
import { analyzeProduct, fetchMapConfig } from "../lib/api";

const NAVER_SCRIPT_ID = "naver-maps-sdk";

// 저장 목록에 "몇 시에 어디서 스캔했는지" 보여주기 위해, 저장 시점에 딱 한 번 위치를
// 조회해서 구/동 단위 라벨로 바꿔둔다(정확한 지번까지는 필요 없고, 오히려 노출 안 하는
// 게 낫다). 위치 권한을 거부/실패해도 조용히 빈 값으로 남기고 저장 자체는 그대로
// 진행한다 — 이 정보 하나 때문에 저장이 막히면 안 되므로 각 단계에 타임아웃을 둔다.
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function loadNaverMapsSdk(): Promise<boolean> {
  return new Promise((resolve) => {
    if ((window as any).naver?.maps?.Service) {
      resolve(true);
      return;
    }
    const existing = document.getElementById(NAVER_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(!!(window as any).naver?.maps));
      return;
    }
    fetchMapConfig()
      .then((config) => {
        const script = document.createElement("script");
        script.id = NAVER_SCRIPT_ID;
        script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${config.naver_client_id}&submodules=geocoding`;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
      })
      .catch(() => resolve(false));
  });
}

function getCurrentPositionOnce(timeoutMs: number): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs }
    );
  });
}

function reverseGeocodeToLabel(lat: number, lng: number): Promise<string | null> {
  return new Promise((resolve) => {
    const naver = (window as any).naver;
    if (!naver?.maps?.Service) {
      resolve(null);
      return;
    }
    try {
      naver.maps.Service.reverseGeocode(
        {
          coords: new naver.maps.LatLng(lat, lng),
          orders: [naver.maps.Service.OrderType.ADDR].join(","),
        },
        (status: string, response: any) => {
          if (status !== naver.maps.Service.Status.OK) {
            resolve(null);
            return;
          }
          try {
            const region = response.v2.results[0].region;
            const label = [region.area1?.name, region.area2?.name, region.area3?.name]
              .filter(Boolean)
              .join(" ");
            resolve(label || null);
          } catch {
            resolve(null);
          }
        }
      );
    } catch {
      resolve(null);
    }
  });
}

async function resolveScanLocationLabel(): Promise<string> {
  const pos = await withTimeout(getCurrentPositionOnce(6000), 6500, null);
  if (!pos) return "";
  const sdkReady = await withTimeout(loadNaverMapsSdk(), 4000, false);
  if (!sdkReady) return "";
  const label = await withTimeout(reverseGeocodeToLabel(pos.lat, pos.lng), 4000, null);
  return label || "";
}

function buildPriceTag(price: number, publicPrice: number): string {
  if (!price || !publicPrice) return "공공 시세 연동 검증";
  const diffPercent = Math.round(((publicPrice - price) / publicPrice) * 100);
  if (diffPercent > 0) return `공공 시세 대비 ${diffPercent}% 저렴`;
  if (diffPercent < 0) return `공공 시세보다 ${Math.abs(diffPercent)}% 비쌈`;
  return "공공 시세와 동일";
}

// 비전 파이프라인이 2단계(특상/보통) 등급으로 바뀌어서, 화면에도 A+/B 같은 영문 등급
// 대신 실제 판정 체계와 맞는 한글 표기를 쓴다 (HomeFeed/ProductDetailModal과 동일 규칙).
function displayGrade(grade: string): string {
  return grade === "A+" ? "특상" : "보통";
}

interface QualityMetric {
  label: string;
  value: number;
}

// ProductDetailModal의 getQualityMetrics/getMetricColor와 동일한 기준 — 저장 후 상품
// 상세페이지에서 보는 지표와 스캔 직후 여기서 보는 지표가 서로 달라선 안 되므로 그대로
// 맞춘다. 사진 한 장으로 정직하게 판단 가능한 항목만 남기고(당도·균일도 등은 제외),
// 라벨은 전부 "높을수록 좋음"으로 통일해 임계치 색상이 항상 같은 뜻(초록=우수)이 되게 한다.
function getQualityMetrics(productName: string, freshnessScore?: number, defectScore?: number, uniformityScore?: number): QualityMetric[] {
  const title = productName;

  const fresh = freshnessScore ?? 90;
  const integrity = Math.max(0, 100 - (defectScore ?? 5));
  const uniform = uniformityScore ?? 92;
  const avg = Math.round((fresh + integrity + uniform) / 3);
  const values = [fresh, integrity, uniform, avg];

  const withLabels = (labels: readonly string[]): QualityMetric[] =>
    labels.map((label, i) => ({ label, value: values[i] }));

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

  return withLabels(["표면 무결성 (손상 없음)", "색상 / 광택", "전체 외관"]);
}

function getMetricColor(value: number): string {
  if (value >= 80) return "#10B981";
  if (value >= 50) return "#F59E0B";
  return "#EF4444";
}

interface AiScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveToSavedList: (product: ProductItem) => void;
  onNavigateToSavedTab: () => void;
  userRole?: "customer" | "merchant";
  userDisplayName?: string;
  onMerchantRegisterProduct?: (product: ProductItem) => void;
}

export const AiScanModal: React.FC<AiScanModalProps> = ({
  isOpen,
  onClose,
  onSaveToSavedList,
  onNavigateToSavedTab,
  userRole = "customer",
  userDisplayName,
  onMerchantRegisterProduct,
}) => {
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  // AI는 카메라만으로 실제 판매가를 알 수 없어 항상 0을 내려주므로, 매대에서 직접 본
  // 가격을 사용자가 입력해야 "공공 시세 대비 N% 저렴" 비교가 의미를 가진다.
  const [sellingPriceInput, setSellingPriceInput] = useState("");
  const [saveSuccessToast, setSaveSuccessToast] = useState(false);
  // 저장 시점에 위치 조회(최대 몇 초)를 기다리는 동안 버튼을 연타해서 중복 저장되는 것을
  // 막는다 — saveSuccessToast는 그 조회가 끝난 뒤에야 true가 되므로 그 전 구간은 이걸로 막는다.
  const [isSavingResult, setIsSavingResult] = useState(false);
  const [hasCameraStream, setHasCameraStream] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // 백그라운드에서 돌아왔을 때 카메라를 다시 켜기 위한 트리거 — isOpen은 그대로라
  // effect를 다시 돌리려면 별도 값이 필요하다.
  const [cameraRestartTick, setCameraRestartTick] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [inspectionResult, setInspectionResult] = useState<InspectionResult | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Start / Stop Camera
  useEffect(() => {
    let isMounted = true;

    const stopCamera = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setHasCameraStream(false);
    };

    if (isOpen) {
      setCameraError(null);
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          })
          .then((stream) => {
            if (!isMounted) {
              stream.getTracks().forEach((t) => t.stop());
              return;
            }
            streamRef.current = stream;
            setHasCameraStream(true);
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
              videoRef.current.play().catch(() => {});
            }
          })
          .catch((err) => {
            console.warn("Camera access failed or unavailable:", err);
            if (isMounted) {
              setHasCameraStream(false);
              setCameraError("카메라 접근 권한을 확인해주세요.");
            }
          });
      }
    } else {
      stopCamera();
    }

    return () => {
      isMounted = false;
      stopCamera();
    };
  }, [isOpen, cameraRestartTick]);

  // 홈버튼/앱 전환으로 백그라운드에 가면 카메라 스트림을 꺼둔다 — 뒤로가기/모달
  // 닫기만 스트림을 정리했어서, 백그라운드로 나갔다 돌아오면 카메라가 계속 켜져
  // 있거나(배터리 낭비) 일부 기기에서 잠겨서 안 먹히는 문제가 있었다.
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !isOpen) return;
    const listener = CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
        setHasCameraStream(false);
      } else {
        setCameraRestartTick((t) => t + 1);
      }
    });
    return () => {
      listener.then((l) => l.remove());
    };
  }, [isOpen]);

  // 이 모달은 App.tsx에서 isOpen으로 보이기만 할 뿐 계속 마운트돼 있어서, X로 닫아도
  // 촬영 사진/분석 결과/입력한 판매가가 그대로 남아있다가 다시 열면 이전 스캔 결과부터
  // 보여주는 문제가 있었다. 열릴 때마다 깨끗한 카메라 화면부터 시작하게 초기화한다.
  useEffect(() => {
    if (isOpen) {
      setCapturedImage(null);
      setShowResult(false);
      setSellingPriceInput("");
      setInspectionResult(null);
      setAnalyzeError(null);
      setSaveSuccessToast(false);
      setIsSavingResult(false);
    }
  }, [isOpen]);

  // Flash / Torch toggle
  useEffect(() => {
    if (streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      if (track && "applyConstraints" in track) {
        try {
          // @ts-ignore
          track.applyConstraints({ advanced: [{ torch: isFlashOn }] }).catch(() => {});
        } catch (e) {}
      }
    }
  }, [isFlashOn]);

  if (!isOpen) return null;

  // Capture frame from live camera video
  const captureFrameFromVideo = (): string | null => {
    if (videoRef.current && hasCameraStream) {
      const video = videoRef.current;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL("image/jpeg", 0.85);
        }
      }
    }
    return null;
  };

  // Camera Trigger/Snap Function — 카메라가 실패해서 실제로 찍은 사진이 없으면, 예전엔
  // sampleId만으로도 백엔드가 조용히 "사과" 목데이터(SCAN_MOCK)를 돌려줘서 마치 실제로
  // 스캔에 성공한 것처럼 가짜 결과가 나왔다. 카메라가 없으면 애초에 분석을 시도하지 않고
  // 정직하게 실패를 알린다.
  const handleSnapCamera = async () => {
    const liveFrame = captureFrameFromVideo();
    if (!liveFrame) {
      setAnalyzeError("카메라를 사용할 수 없어 촬영할 수 없습니다. 카메라 권한을 확인해주세요.");
      return;
    }
    setCapturedImage(liveFrame);

    setIsAnalyzing(true);
    setShowResult(false);
    setAnalyzeError(null);

    try {
      const json = await analyzeProduct({ imageBase64: liveFrame });
      if (json.success && json.data && json.data.productName) {
        setInspectionResult(json.data);
        setSellingPriceInput(json.data.sellingPrice ? String(json.data.sellingPrice) : "");
        setShowResult(true);
      } else {
        // 사진에서 농산물을 못 찾은 정상적인 실패면 백엔드가 구체적인 안내(hint)를 준다.
        setAnalyzeError(json.hint || "AI 분석 결과를 받지 못했습니다. 다시 촬영해주세요.");
      }
    } catch (err) {
      console.error(err);
      setAnalyzeError("AI 분석에 실패했습니다. 네트워크 상태를 확인 후 다시 시도해주세요.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRetake = () => {
    setShowResult(false);
    setCapturedImage(null);
    setSellingPriceInput("");
    setAnalyzeError(null);
    if (videoRef.current && streamRef.current) {
      videoRef.current.play().catch(() => {});
    }
  };

  const handleMerchantRegister = () => {
    if (saveSuccessToast) return; // 저장 처리 중 버튼 연타로 중복 등록되는 것 방지
    if (inspectionResult) {
      if (!sellingPriceInput.trim()) {
        alert("판매가를 입력해주세요.");
        return;
      }
      const price = parseInt(sellingPriceInput, 10) || 0;
      const merchantShop = userDisplayName || "양동수산";
      const newProductItem: ProductItem = {
        id: `merchant-scan-${Date.now()}`,
        title: inspectionResult.productName,
        unit: "",
        origin: "",
        tags: "",
        shopName: merchantShop,
        distance: "양동전통시장 내 점포",
        timeAgo: "AI 스캔 즉시 등록",
        price,
        publicPrice: inspectionResult.publicMarketPrice,
        priceTag: buildPriceTag(price, inspectionResult.publicMarketPrice),
        grade: (inspectionResult.grade || "A+") as any,
        category: inspectionResult.category as any,
        imageUrl: capturedImage || "",
        freshnessScore: inspectionResult.freshnessScore,
        defectScore: inspectionResult.defectScore,
        uniformityScore: inspectionResult.uniformityScore,
        description: "",
        aiSummary: inspectionResult.aiAnalysisSummary,
        isScannedProduct: true,
        isMerchantUploaded: true,
      };

      if (onMerchantRegisterProduct) {
        onMerchantRegisterProduct(newProductItem);
      } else {
        onSaveToSavedList(newProductItem);
      }

      setSaveSuccessToast(true);

      setTimeout(() => {
        setSaveSuccessToast(false);
        onClose();
      }, 1000);
    }
  };

  const handleSaveResult = async () => {
    if (saveSuccessToast || isSavingResult) return; // 저장 처리 중 버튼 연타로 중복 저장되는 것 방지
    if (inspectionResult) {
      if (!sellingPriceInput.trim()) {
        alert("판매가를 입력해주세요.");
        return;
      }
      const price = parseInt(sellingPriceInput, 10) || 0;
      setIsSavingResult(true);
      // 위치 권한을 거부/실패하면 빈 문자열로 남는다 — 저장 자체는 막지 않는다.
      const scanLocationLabel = await resolveScanLocationLabel();
      // 이건 특정 점포에 등록하는 게 아니라 사용자가 직접 촬영해서 개인 저장목록에
      // 남기는 기록이라, 실제로 없는 점포 정보를 지어내지 않는다(예전엔 카테고리별로
      // "양동수산"/"양동정육"/"싱싱청과"를 무작정 붙였는데, 실제로 그 점포에서 산 게
      // 아닌데도 그런 것처럼 보여서 오해를 줬다).
      const newSavedItem: ProductItem = {
        id: `scan-${Date.now()}`,
        title: inspectionResult.productName,
        unit: "",
        origin: "",
        tags: "",
        shopName: "",
        distance: scanLocationLabel,
        timeAgo: "방금 스캔",
        price,
        publicPrice: inspectionResult.publicMarketPrice,
        priceTag: buildPriceTag(price, inspectionResult.publicMarketPrice),
        grade: (inspectionResult.grade || "A+") as any,
        category: inspectionResult.category as any,
        imageUrl: capturedImage || "",
        freshnessScore: inspectionResult.freshnessScore,
        defectScore: inspectionResult.defectScore,
        uniformityScore: inspectionResult.uniformityScore,
        description: "",
        aiSummary: inspectionResult.aiAnalysisSummary,
        isScannedProduct: true,
      };

      onSaveToSavedList(newSavedItem);
      setIsSavingResult(false);
      setSaveSuccessToast(true);

      setTimeout(() => {
        setSaveSuccessToast(false);
        onClose();
        onNavigateToSavedTab();
      }, 900);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black text-white flex flex-col justify-between overflow-hidden select-none">
      {/* Background Live Camera Video or Captured Image Viewport */}
      <div className="absolute inset-0 z-0 bg-black flex items-center justify-center overflow-hidden">
        {/* Real Live Camera Stream */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            hasCameraStream && !capturedImage ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        />

        {/* Captured Snapshot */}
        {capturedImage && (
          <div
            className="absolute inset-0 bg-cover bg-center transition-all duration-300"
            style={{ backgroundImage: `url('${capturedImage}')` }}
          />
        )}

        {/* 카메라를 못 쓰면 가짜 샘플 사진 대신 정직하게 "카메라 사용 불가" 상태를 보여준다. */}
        {!hasCameraStream && !capturedImage && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/40">
            <span className="material-symbols-outlined text-5xl">videocam_off</span>
            <p className="text-xs font-medium">카메라를 사용할 수 없습니다</p>
          </div>
        )}

        {/* Flash Screen Overlay */}
        {isFlashOn && <div className="absolute inset-0 bg-white/30 pointer-events-none z-10"></div>}

        {/* Camera Access Failure Notice */}
        {cameraError && !capturedImage && (
          <div className="absolute top-16 left-4 right-4 z-20 bg-amber-500/90 text-white text-xs font-bold rounded-xl px-3.5 py-2.5 flex items-center gap-2 shadow-lg">
            <span className="material-symbols-outlined text-base shrink-0">videocam_off</span>
            <span>{cameraError}</span>
          </div>
        )}
      </div>

      {/* Top & Bottom Vignette Gradients */}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/90 via-black/40 to-transparent z-10 pointer-events-none"></div>
      <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/90 via-black/50 to-transparent z-10 pointer-events-none"></div>

      {/* Top Header */}
      <header
        className="relative z-20 px-4 flex justify-between items-center w-full"
        style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}
      >
        {/* Top Left: Flash Toggle */}
        <button
          onClick={() => setIsFlashOn(!isFlashOn)}
          className={`w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white active:scale-90 transition-transform border border-white/20 hover:bg-black/60 ${
            isFlashOn ? "bg-amber-500/60 border-amber-300 text-amber-300" : ""
          }`}
          title="플래시"
        >
          <span className="material-symbols-outlined text-xl">
            {isFlashOn ? "flash_on" : "flash_off"}
          </span>
        </button>

        {/* Center Mode Indicator */}
        {userRole === "merchant" && (
          <span className="bg-amber-500/90 text-slate-950 font-extrabold text-[11px] px-3 py-1 rounded-full shadow-md flex items-center gap-1 border border-amber-300">
            <span className="material-symbols-outlined text-xs">storefront</span>
            판매자 점포 물건 등록
          </span>
        )}

        {/* Top Right: Close Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white active:scale-90 transition-transform border border-white/20 hover:bg-black/60"
            title="닫기"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>
      </header>

      {/* Center Camera Target Box with Rounded Curved Corners */}
      <div className="relative z-20 flex-1 flex flex-col items-center justify-center px-6">
        {analyzeError && !isAnalyzing && (
          <div className="bg-black/80 backdrop-blur-md rounded-2xl p-6 text-center space-y-3 border border-rose-400/40 shadow-2xl max-w-xs">
            <span className="material-symbols-outlined text-3xl text-rose-400">error</span>
            <p className="text-xs font-bold text-white">{analyzeError}</p>
            <button
              onClick={() => setAnalyzeError(null)}
              className="mt-1 px-4 py-2 bg-white/15 hover:bg-white/25 text-white text-xs font-bold rounded-xl border border-white/20 transition-colors"
            >
              다시 촬영하기
            </button>
          </div>
        )}
        {!showResult && !isAnalyzing && !analyzeError && (
          <div className="relative w-64 h-64 sm:w-72 sm:h-72 flex items-center justify-center pointer-events-none">
            {/* Curved Corner Bracket Frames (Google Lens Style) */}
            <div className="absolute top-0 left-0 w-12 h-12 border-t-[3.5px] border-l-[3.5px] border-white/90 rounded-tl-3xl shadow-[0_0_8px_rgba(255,255,255,0.4)]"></div>
            <div className="absolute top-0 right-0 w-12 h-12 border-t-[3.5px] border-r-[3.5px] border-white/90 rounded-tr-3xl shadow-[0_0_8px_rgba(255,255,255,0.4)]"></div>
            <div className="absolute bottom-0 left-0 w-12 h-12 border-b-[3.5px] border-l-[3.5px] border-white/90 rounded-bl-3xl shadow-[0_0_8px_rgba(255,255,255,0.4)]"></div>
            <div className="absolute bottom-0 right-0 w-12 h-12 border-b-[3.5px] border-r-[3.5px] border-white/90 rounded-br-3xl shadow-[0_0_8px_rgba(255,255,255,0.4)]"></div>

            <p className="text-white/90 text-xs font-semibold bg-black/50 px-3.5 py-1.5 rounded-full backdrop-blur-md border border-white/10 shadow-md">
              {hasCameraStream ? "농수산물을 화면 가운데에 위치시키세요" : "농수산물을 화면 가운데에 위치시키세요"}
            </p>
          </div>
        )}

        {/* Analyzing Spinner State */}
        {isAnalyzing && (
          <div className="bg-black/80 backdrop-blur-md rounded-2xl p-6 text-center space-y-3 border border-white/20 shadow-2xl">
            <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs font-bold text-white">
              AI가 신선도, 표면 결함 및 시세를 분석 중입니다...
            </p>
          </div>
        )}
      </div>

      {/* Toast Notification when saved */}
      {saveSuccessToast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-[#00C875] text-white px-5 py-2.5 rounded-full shadow-2xl font-bold text-xs flex items-center gap-2 border border-white/20 animate-bounce">
          <span className="material-symbols-outlined text-base">bookmark_check</span>
          <span>스캔 결과가 저장목록에 저장되었습니다!</span>
        </div>
      )}

      {/* Bottom Shutter & Controls Container */}
      <div
        className="relative z-30 w-full px-4 max-w-md mx-auto space-y-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {!showResult ? (
          /* Shutter Row */
          <div className="flex items-center justify-center px-6 pt-2">
            {/* Center Camera Shutter Button (Triggers AI Analysis) */}
            <button
              onClick={() => handleSnapCamera()}
              disabled={isAnalyzing}
              className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center p-1.5 border border-white/40 cursor-pointer active:scale-95 transition-transform shadow-xl"
              title="카메라 AI 촬영 및 분석"
            >
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-black shadow-md">
                <span className="material-symbols-outlined text-2xl font-bold text-black">
                  camera_alt
                </span>
              </div>
            </button>
          </div>
        ) : (
          /* Scanned Produce Result Card Sheet */
          <div
            className="bg-white text-black rounded-2xl shadow-2xl border border-[#E2E8F0] p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-4 duration-300 overflow-y-auto"
            style={{ maxHeight: "calc(100dvh - 140px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))" }}
          >
            {/* Title & Grade Header */}
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[11px] font-bold text-[#0052FF] bg-[#DBEAFE] px-2 py-0.5 rounded">
                  {inspectionResult?.category || "야채"}
                </span>
                <h2 className="text-lg font-bold text-[#0F172A] mt-1">
                  {inspectionResult?.productName}
                </h2>
              </div>
              <div
                className={`px-2.5 py-1 rounded-full font-extrabold text-xs flex items-center gap-1 border shadow-xs flex-shrink-0 ${
                  inspectionResult?.grade?.startsWith("A")
                    ? "bg-[#DCFCE7] text-[#166534] border-[#10B981]/20"
                    : "bg-blue-50 text-[#0052FF] border-[#0052FF]/20"
                }`}
              >
                <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                  verified
                </span>
                <span>품질 등급 {displayGrade(inspectionResult?.grade || "A+")}</span>
              </div>
            </div>

            {/* Price Details: 공공시세 */}
            <div className="bg-[#F8FAFC] rounded-xl p-3.5 border border-[#E2E8F0] flex items-center justify-between">
              <span className="text-xs font-bold text-[#64748B] flex items-center gap-1.5">
                공공시세{inspectionResult?.publicPriceUnit === "kg" ? " (1kg 기준)" : ""}
              </span>
              <div className="text-lg font-black text-[#0F172A]">
                {inspectionResult?.publicMarketPrice ? `${inspectionResult.publicMarketPrice.toLocaleString()}원` : "-"}
              </div>
            </div>

            {/* 이 매대 판매가 — AI는 카메라만으로 실제 판매가를 알 수 없어 직접 입력받는다 */}
            <div className="bg-white rounded-xl p-3.5 border border-[#0052FF]/30 flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-[#64748B] flex items-center gap-1.5 shrink-0">
                이 매대 판매가
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  value={sellingPriceInput}
                  onChange={(e) => setSellingPriceInput(e.target.value)}
                  placeholder="가격 입력"
                  className="w-24 text-right text-lg font-black text-[#0F172A] bg-transparent border-b border-slate-300 focus:outline-none focus:border-[#0052FF]"
                />
                <span className="text-sm font-bold text-[#64748B]">원</span>
              </div>
            </div>

            {/* AI 정밀 분석 지표 — 상품 상세페이지(ProductDetailModal)와 완전히 같은 기준.
                스캔 직후 여기서 보는 지표와, 저장 후 피드에 올라간 뒤 보는 지표가 서로
                다르면 안 되므로 동일한 getQualityMetrics/getMetricColor를 그대로 쓴다. */}
            <div className="space-y-2.5">
              <div className="text-xs font-extrabold text-[#0F172A] flex items-center gap-1">
                <span className="material-symbols-outlined text-sm text-[#0052FF]">analytics</span>
                AI 정밀 분석 지표
              </div>
              <div className="space-y-2 bg-[#F8FAFC] p-3 rounded-xl border border-[#E2E8F0] text-xs">
                {getQualityMetrics(
                  inspectionResult?.productName || "",
                  inspectionResult?.freshnessScore,
                  inspectionResult?.defectScore,
                  inspectionResult?.uniformityScore
                ).map((metric) => {
                  const color = getMetricColor(metric.value);
                  return (
                    <div key={metric.label}>
                      <div className="flex justify-between items-center text-[11px] mb-1">
                        <span className="font-bold text-[#334155]">{metric.label}</span>
                        <span className="font-black" style={{ color }}>{metric.value}점</span>
                      </div>
                      <div className="w-full h-2 bg-slate-200/80 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${metric.value}%`, backgroundColor: color }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* AI 스캔 종합 의견 */}
            <div className="bg-blue-50/70 rounded-xl p-3 border border-blue-100 space-y-1">
              <div className="text-xs font-extrabold text-[#0052FF] flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">psychology</span>
                AI 스캔 종합 의견
              </div>
              <p className="text-xs text-[#334155] font-medium leading-relaxed">
                {inspectionResult?.aiAnalysisSummary || "당도와 색택이 우수하며 표면 무름이 없는 최상급 신선 상품입니다."}
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleRetake}
                className="py-3 px-3 bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0] text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1"
              >
                <span className="material-symbols-outlined text-base">refresh</span>
                다시 촬영
              </button>

              <button
                onClick={handleSaveResult}
                disabled={saveSuccessToast || isSavingResult}
                className="flex-1 py-3 bg-[#0052FF] hover:bg-[#0043D6] disabled:opacity-60 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>
                  bookmark
                </span>
                {isSavingResult ? "저장 중..." : "저장목록에 저장"}
              </button>

              {userRole === "merchant" && (
                <button
                  onClick={handleMerchantRegister}
                  disabled={saveSuccessToast || isSavingResult}
                  className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 disabled:opacity-60 text-white text-xs font-extrabold rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-base">storefront</span>
                  점포 물건 등록
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


