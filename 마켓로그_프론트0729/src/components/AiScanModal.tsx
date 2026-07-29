import React, { useState, useRef } from "react";
import { ProductItem, InspectionResult } from "../types";
import { analyzeProduct } from "../lib/api";

interface AiScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveToSavedList: (product: ProductItem) => void;
  onNavigateToSavedTab: () => void;
}

export const AiScanModal: React.FC<AiScanModalProps> = ({
  isOpen,
  onClose,
  onSaveToSavedList,
  onNavigateToSavedTab,
}) => {
  const [selectedPreset, setSelectedPreset] = useState<"hairtail" | "strawberry" | "pork">("strawberry");
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [saveSuccessToast, setSaveSuccessToast] = useState(false);

  const [inspectionResult, setInspectionResult] = useState<InspectionResult | null>({
    productName: "논산 설향 딸기 (500g)",
    category: "과일/야채",
    grade: "A+",
    qualityScore: 96,
    sellingPrice: 12500,
    publicMarketPrice: 13500,
    priceDiffPercent: 8,
    priceTrafficLight: "SAFE",
    freshnessScore: 96,
    defectScore: 94,
    uniformityScore: 92,
    publicGuarantee: "농림축산식품부 공공데이터 연동 보증",
    aiAnalysisSummary: "당도와 색택이 우수하며 표면 무름이 없는 최상급 신선 딸기입니다.",
    crossSellRecommendation: {
      itemName: "싱싱청과 수제 생크림",
      shopName: "싱싱청과",
      distance: "30m",
      discountOffer: "10% OFF",
      recipeName: "딸기 파르페 패키지",
    },
  });

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const sampleImages = {
    strawberry:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuDPrTKft45sE79PKyzcNxkpR7jiC94SaLZBeIpOho8PS6MfxcM24FBq5mPUD-KQhGgWNaVSPodpYSrMEPgddi0FNoTIy5QByRJ1O29bN2GoPyZ_bHdyNd5oLvlWDvbU1IxCuntiDyiletIj2q2SHcDwhgzncBso0wtlMj6iVE_kmfeXMGwbx6c0QNetTRXhf0m91HziI7YK5e-OWXOgc84THY9rQc3IN9xQ2glKexbCJmw0SCF4BrhWOw",
    hairtail:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuBPBsS9pCM36y_2W6Vey0_5EC88SbxJT0t7GhjPXTqlYnaqTLo0NcPV6LFPJH4p8pI2sVispE0SOUUZyXGM7sHnAfTR02l7Ecz_PaENAV0UotAJL_GFQ2-MlPFcyoWoDVhUhvNa5dMeWWVko5qNl4VottlwisP_V2H8J6BvPu4fkLyQ-lAczaPkDamw8VL1R4HpBabcEkOJK7MtMocMNcOhlDpmlg45ZYg8F7B_zr9m5nvPktBbJxjvUA",
    pork:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuDfqKKJROFYLfdHz4E-dhGPYRcjGFgyiVvPNDRmUVShw2Z2MABEaTDMc3Yh-oO77txFIhM4Fko4dPgwWTc4rYljeZnxkIfQcnrLP9JEOVhqXwiVmd5UxKDOBLXFugDB2zSgwLp4FR-guYiZtxriswvRdiFTkbxW2WcC9swB-xuvAG4kr3R3OIomDMdUDdfW0t8d2__fEnZGUFSVN-2Y6i8MIpXxpixAPZcIYGT2pHfzOSqTFdiVjw5Bfg",
  };

  const currentViewImage = capturedImage || sampleImages[selectedPreset];

  // Camera Trigger/Snap Function
  const handleSnapCamera = async (presetKey?: "hairtail" | "strawberry" | "pork", customBase64?: string) => {
    const key = presetKey || selectedPreset;
    if (presetKey) setSelectedPreset(presetKey);

    setIsAnalyzing(true);
    setShowResult(false);

    try {
      const json = await analyzeProduct({
        sampleId: key,
        imageBase64: customBase64,
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
  };

  const handleSaveResult = () => {
    if (inspectionResult) {
      const newSavedItem: ProductItem = {
        id: `scan-${Date.now()}`,
        title: inspectionResult.productName,
        shopName: inspectionResult.category === "수산물" ? "양동수산" : inspectionResult.category === "정육" ? "양동정육" : "싱싱청과",
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
      {/* Background Camera Viewport */}
      <div
        className="absolute inset-0 z-0 bg-cover bg-center transition-all duration-300"
        style={{ backgroundImage: `url('${currentViewImage}')` }}
      >
        {isFlashOn && <div className="absolute inset-0 bg-white/30 pointer-events-none"></div>}
      </div>

      {/* Top & Bottom Vignette Gradients */}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/90 via-black/40 to-transparent z-10 pointer-events-none"></div>
      <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/90 via-black/50 to-transparent z-10 pointer-events-none"></div>

      {/* Top Header */}
      <header className="relative z-20 pt-3 px-4 flex justify-between items-center w-full">
        {/* Top Left: Flash Toggle */}
        <button
          onClick={() => setIsFlashOn(!isFlashOn)}
          className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white active:scale-90 transition-transform border border-white/20 hover:bg-black/60"
          title="플래시"
        >
          <span className="material-symbols-outlined text-xl">
            {isFlashOn ? "flash_on" : "flash_off"}
          </span>
        </button>

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
            <span className="material-symbols-outlined text-xl">more_vert</span>
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
              농수산물을 화면 가운데에 위치시키세요
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

      {/* Hidden Native File Inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCameraFileChange}
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
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
              onClick={() => galleryInputRef.current?.click()}
              className="w-12 h-12 rounded-full border-2 border-white/90 overflow-hidden bg-black/60 flex items-center justify-center p-0.5 shadow-lg active:scale-90 transition-transform group"
              title="갤러리 사진 선택"
            >
              <img
                src={currentViewImage}
                alt="Gallery preview"
                className="w-full h-full object-cover rounded-full group-hover:scale-110 transition-transform"
              />
            </button>

            {/* Main Center Camera Shutter Button (Opens Camera, Then Triggers AI Analysis) */}
            <button
              onClick={() => cameraInputRef.current?.click()}
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

            {/* Action Buttons */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleRetake}
                className="flex-1 py-3 bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0] text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1"
              >
                <span className="material-symbols-outlined text-base">refresh</span>
                다시 촬영
              </button>
              <button
                onClick={handleSaveResult}
                className="flex-2 py-3 bg-[#0052FF] hover:bg-[#0043D6] text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>
                  bookmark
                </span>
                저장목록에 저장
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

