import React, { useState, useRef, useEffect } from "react";
import { ProductItem, InspectionResult } from "../types";
import { analyzeProduct } from "../lib/api";

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
  const [selectedPreset, setSelectedPreset] = useState<"radish" | "apple" | "potato">("apple");
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [saveSuccessToast, setSaveSuccessToast] = useState(false);
  const [hasCameraStream, setHasCameraStream] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [inspectionResult, setInspectionResult] = useState<InspectionResult | null>({
    productName: "청송 부사 사과 (5개입)",
    category: "과일",
    grade: "A",
    qualityScore: 93,
    sellingPrice: 13500,
    publicMarketPrice: 15000,
    priceDiffPercent: 10,
    priceTrafficLight: "SAFE",
    freshnessScore: 94,
    defectScore: 92,
    uniformityScore: 91,
    publicGuarantee: "농산물유통정보(KAMIS) 소매가격 실시간 연동",
    aiAnalysisSummary: "당도가 높고 표면 흠집이 거의 없는 우수한 사과입니다.",
    crossSellRecommendation: {
      itemName: "수제 그래놀라",
      shopName: "싱싱청과",
      distance: "30m",
      discountOffer: "10% OFF",
      recipeName: "사과 샐러드 패키지",
    },
  });

  const sampleImages = {
    apple:
      "https://plus.unsplash.com/premium_photo-1724249990837-f6dfcb7f3eaa?auto=format&fit=crop&w=800&q=80",
    radish:
      "https://plus.unsplash.com/premium_photo-1726736510146-4703a18e3c6e?auto=format&fit=crop&w=800&q=80",
    potato:
      "https://plus.unsplash.com/premium_photo-1724256031338-b5bfba816cfd?auto=format&fit=crop&w=800&q=80",
  };

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
              setCameraError("실제 카메라를 불러올 수 없어 샘플 비디오 화면으로 대체합니다.");
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

  const currentViewImage = capturedImage || sampleImages[selectedPreset];

  // Camera Trigger/Snap Function
  const handleSnapCamera = async (presetKey?: "radish" | "apple" | "potato", customBase64?: string) => {
    const key = presetKey || selectedPreset;
    if (presetKey) setSelectedPreset(presetKey);

    let activeBase64 = customBase64;
    if (!activeBase64) {
      const liveFrame = captureFrameFromVideo();
      if (liveFrame) {
        activeBase64 = liveFrame;
        setCapturedImage(liveFrame);
      }
    }

    setIsAnalyzing(true);
    setShowResult(false);

    try {
      const json = await analyzeProduct({
        sampleId: key,
        imageBase64: activeBase64,
      });
      if (json.success && json.data) {
        setInspectionResult(json.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsAnalyzing(false);
      setShowResult(true);
    }
  };

  const handleCameraFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setCapturedImage(base64);
        handleSnapCamera(selectedPreset, base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRetake = () => {
    setShowResult(false);
    setCapturedImage(null);
    if (videoRef.current && streamRef.current) {
      videoRef.current.play().catch(() => {});
    }
  };

  const handleMerchantRegister = () => {
    if (inspectionResult) {
      const merchantShop = userDisplayName || "양동수산";
      const newProductItem: ProductItem = {
        id: `merchant-scan-${Date.now()}`,
        title: inspectionResult.productName,
        shopName: merchantShop,
        distance: "양동전통시장 내 점포",
        timeAgo: "AI 스캔 즉시 등록",
        price: inspectionResult.sellingPrice,
        publicPrice: inspectionResult.publicMarketPrice,
        priceTag: `공공 시세 대비 ${inspectionResult.priceDiffPercent}% 저렴`,
        grade: inspectionResult.grade,
        category: inspectionResult.category as any,
        imageUrl: currentViewImage,
        freshnessScore: inspectionResult.freshnessScore,
        defectScore: inspectionResult.defectScore,
        uniformityScore: inspectionResult.uniformityScore,
        description: inspectionResult.aiAnalysisSummary,
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

  const handleSaveResult = () => {
    if (inspectionResult) {
      const newSavedItem: ProductItem = {
        id: `scan-${Date.now()}`,
        title: inspectionResult.productName,
        shopName: inspectionResult.category === "신선야채" ? "호남상회" : inspectionResult.category === "과일" ? "싱싱청과" : inspectionResult.category === "수산물" ? "양동수산" : inspectionResult.category === "정육" ? "양동정육" : "싱싱청과",
        distance: "촬영 장소",
        timeAgo: "방금 스캔",
        price: inspectionResult.sellingPrice,
        publicPrice: inspectionResult.publicMarketPrice,
        priceTag: `공공 시세 대비 ${inspectionResult.priceDiffPercent}% 저렴`,
        grade: inspectionResult.grade,
        category: inspectionResult.category as any,
        imageUrl: currentViewImage,
        freshnessScore: inspectionResult.freshnessScore,
        defectScore: inspectionResult.defectScore,
        uniformityScore: inspectionResult.uniformityScore,
        description: inspectionResult.aiAnalysisSummary,
      };

      onSaveToSavedList(newSavedItem);
      setSaveSuccessToast(true);

      setTimeout(() => {
        setSaveSuccessToast(false);
        onClose();
        onNavigateToSavedTab();
      }, 900);
    }
  };

  return (
    <div className="fixed inset-x-0 top-0 bottom-[72px] md:bottom-0 z-40 bg-black text-white flex flex-col justify-between overflow-hidden select-none">
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

        {/* Fallback Image or Captured Snapshot */}
        {(!hasCameraStream || capturedImage) && (
          <div
            className="absolute inset-0 bg-cover bg-center transition-all duration-300"
            style={{ backgroundImage: `url('${currentViewImage}')` }}
          />
        )}

        {/* Flash Screen Overlay */}
        {isFlashOn && <div className="absolute inset-0 bg-white/30 pointer-events-none z-10"></div>}
      </div>

      {/* Top & Bottom Vignette Gradients */}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/90 via-black/40 to-transparent z-10 pointer-events-none"></div>
      <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/90 via-black/50 to-transparent z-10 pointer-events-none"></div>

      {/* Top Header */}
      <header className="relative z-20 pt-3 px-4 flex justify-between items-center w-full">
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

        {/* Top Right: History & Menu */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigateToSavedTab()}
            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white active:scale-90 transition-transform border border-white/20 hover:bg-black/60"
            title="스캔 이력"
          >
            <span className="material-symbols-outlined text-xl">history</span>
          </button>
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
        {!showResult && !isAnalyzing && (
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

      {/* Hidden Native File Input */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCameraFileChange}
        className="hidden"
      />

      {/* Toast Notification when saved */}
      {saveSuccessToast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-[#00C875] text-white px-5 py-2.5 rounded-full shadow-2xl font-bold text-xs flex items-center gap-2 border border-white/20 animate-bounce">
          <span className="material-symbols-outlined text-base">bookmark_check</span>
          <span>스캔 결과가 저장목록에 저장되었습니다!</span>
        </div>
      )}

      {/* Bottom Shutter & Controls Container */}
      <div className="relative z-30 w-full px-4 pb-3 max-w-md mx-auto space-y-3">
        {!showResult ? (
          /* Shutter Row */
          <div className="flex items-center justify-center gap-8 px-6 pt-2">
            {/* Left Gallery Thumbnail Button */}
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="w-12 h-12 rounded-full border-2 border-white/90 overflow-hidden bg-black/60 flex items-center justify-center p-0.5 shadow-lg active:scale-90 transition-transform group"
              title="갤러리 사진 선택"
            >
              <img
                src={currentViewImage}
                alt="Gallery preview"
                className="w-full h-full object-cover rounded-full group-hover:scale-110 transition-transform"
              />
            </button>

            {/* Main Center Camera Shutter Button (Triggers AI Analysis) */}
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
          <div className="bg-white text-black rounded-2xl shadow-2xl border border-[#E2E8F0] p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-4 duration-300">
            {/* Title & Grade Header */}
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[11px] font-bold text-[#0052FF] bg-[#DBEAFE] px-2 py-0.5 rounded">
                  {inspectionResult?.category || "농수산물"}
                </span>
                <h2 className="text-lg font-bold text-[#0F172A] mt-1">
                  {inspectionResult?.productName}
                </h2>
              </div>
              <div className="bg-[#DCFCE7] text-[#166534] px-2.5 py-1 rounded-full font-extrabold text-xs flex items-center gap-1 border border-[#10B981]/20">
                <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                  check_circle
                </span>
                <span>AI {inspectionResult?.grade}</span>
              </div>
            </div>

            {/* Price & Analysis Details */}
            <div className="bg-[#F8FAFC] rounded-xl p-3 border border-[#E2E8F0] flex justify-between items-center">
              <div>
                <span className="text-xs font-semibold text-[#64748B]">추천 판매가</span>
                <div className="text-lg font-black text-[#0F172A]">
                  {inspectionResult?.sellingPrice.toLocaleString()}원
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs font-semibold text-[#64748B]">공공 시세 대비</span>
                <div className="text-xs font-bold text-[#0052FF] bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 rounded mt-0.5 inline-block">
                  {inspectionResult?.priceDiffPercent}% 저렴
                </div>
              </div>
            </div>

            <p className="text-xs text-[#475569] font-medium leading-relaxed">
              {inspectionResult?.aiAnalysisSummary}
            </p>

            {/* AI Score Breakdown (freshness / defect / uniformity) */}
            {inspectionResult && (
              <div className="bg-[#F8FAFC] rounded-xl p-3 border border-[#E2E8F0] grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[10px] font-bold text-[#64748B]">신선도</div>
                  <div className="text-sm font-extrabold text-[#10B981]">{inspectionResult.freshnessScore}%</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-[#64748B]">표면 결함</div>
                  <div className="text-sm font-extrabold text-[#10B981]">{inspectionResult.defectScore}%</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-[#64748B]">균일도</div>
                  <div className="text-sm font-extrabold text-[#0052FF]">{inspectionResult.uniformityScore}%</div>
                </div>
              </div>
            )}

            {/* Cross-sell Recommendation */}
            {inspectionResult?.crossSellRecommendation && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold text-amber-700 flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">add_shopping_cart</span>
                    함께 사면 좋은 상품
                  </div>
                  <div className="text-xs font-bold text-[#0F172A] truncate mt-0.5">
                    {inspectionResult.crossSellRecommendation.shopName} · {inspectionResult.crossSellRecommendation.itemName}
                    <span className="text-[#64748B] font-medium"> ({inspectionResult.crossSellRecommendation.distance})</span>
                  </div>
                </div>
                <span className="text-[10px] font-extrabold text-white bg-amber-600 px-2 py-1 rounded-full flex-shrink-0">
                  {inspectionResult.crossSellRecommendation.discountOffer}
                </span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleRetake}
                className="py-3 px-3 bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0] text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1"
              >
                <span className="material-symbols-outlined text-base">refresh</span>
                다시 촬영
              </button>

              {userRole === "merchant" ? (
                <button
                  onClick={handleMerchantRegister}
                  className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white text-xs font-extrabold rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-base">storefront</span>
                  내 점포 물건으로 즉시 등록
                </button>
              ) : (
                <button
                  onClick={handleSaveResult}
                  className="flex-1 py-3 bg-[#0052FF] hover:bg-[#0043D6] text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>
                    bookmark
                  </span>
                  저장목록에 저장
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


