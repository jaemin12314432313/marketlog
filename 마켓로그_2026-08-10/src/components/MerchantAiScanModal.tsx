import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { ProductItem } from "../types";
import { analyzeProduct } from "../lib/api";

interface MerchantAiScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRegisterProduct: (product: ProductItem) => void;
  shopName?: string;
}

export const MerchantAiScanModal: React.FC<MerchantAiScanModalProps> = ({
  isOpen,
  onClose,
  onRegisterProduct,
  shopName = "양동수산",
}) => {
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasCameraStream, setHasCameraStream] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cameraRestartTick, setCameraRestartTick] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

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
      setIsAnalyzing(false);
      setCapturedImage(null);
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
            console.warn("Merchant camera access error:", err);
            if (isMounted) {
              setHasCameraStream(false);
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

  // 앱이 백그라운드로 가면 카메라 스트림을 끄고, 돌아오면 다시 켠다.
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

  if (!isOpen) return null;

  const currentViewImage = capturedImage || "";

  // Capture current camera video frame as base64 image
  const captureFrame = (): string => {
    if (videoRef.current && hasCameraStream && !capturedImage) {
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
    return currentViewImage;
  };

  // Handle Gallery file select
  const handleCameraFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setCapturedImage(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle Capture & AI Analysis (real backend vision inference, not a canned preset)
  const handleCaptureAndAnalyze = async () => {
    if (isAnalyzing) return;

    const capturedImg = captureFrame();
    if (!capturedImg) {
      alert("먼저 카메라로 촬영하거나 갤러리에서 사진을 선택해주세요.");
      return;
    }

    setIsAnalyzing(true);
    try {
      const result = await analyzeProduct({ imageBase64: capturedImg });
      if (!result.success) throw new Error("분석 실패");
      const data = result.data;

      const newProduct: ProductItem = {
        id: `merchant-ai-${Date.now()}`,
        title: data.productName,
        category: data.category as any,
        price: data.sellingPrice || 0,
        publicPrice: data.publicMarketPrice,
        priceTag: "",
        shopName: shopName,
        distance: "양동전통시장 내 점포",
        timeAgo: "방금 전 AI 스캔 등록",
        grade: (data.grade || "A+") as any,
        imageUrl: capturedImg,
        isScannedProduct: true,
        isMerchantUploaded: true,
        freshnessScore: data.freshnessScore,
        defectScore: data.defectScore,
        uniformityScore: data.uniformityScore,
        description: data.aiAnalysisSummary,
      };

      // 폼에 채워넣기만 함 (실제 등록은 MerchantView의 '상품 등록 완료' 클릭 시)
      onRegisterProduct(newProduct);
      onClose();
    } catch (err) {
      console.error(err);
      alert("AI 분석에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 w-screen h-screen h-[100dvh] z-[9999] bg-black text-white flex flex-col justify-between overflow-hidden select-none animate-in fade-in duration-200">
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
      <header
        className="relative z-20 px-4 flex justify-between items-center w-full"
        style={{ paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))" }}
      >
        {/* Flash Toggle Button */}
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

        {/* Close Button */}
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white active:scale-90 transition-transform border border-white/20 hover:bg-black/60"
          title="닫기"
        >
          <span className="material-symbols-outlined text-xl">close</span>
        </button>
      </header>

      {/* Center Camera Target Box with Rounded Curved Corners (Google Lens Style) */}
      <div className="relative z-20 flex-1 flex flex-col items-center justify-center px-6">
        {!isAnalyzing && (
          <div className="relative w-64 h-64 sm:w-72 sm:h-72 flex items-center justify-center pointer-events-none">
            {/* Curved Corner Bracket Frames */}
            <div className="absolute top-0 left-0 w-12 h-12 border-t-[3.5px] border-l-[3.5px] border-white/90 rounded-tl-3xl shadow-[0_0_8px_rgba(255,255,255,0.4)]"></div>
            <div className="absolute top-0 right-0 w-12 h-12 border-t-[3.5px] border-r-[3.5px] border-white/90 rounded-tr-3xl shadow-[0_0_8px_rgba(255,255,255,0.4)]"></div>
            <div className="absolute bottom-0 left-0 w-12 h-12 border-b-[3.5px] border-l-[3.5px] border-white/90 rounded-bl-3xl shadow-[0_0_8px_rgba(255,255,255,0.4)]"></div>
            <div className="absolute bottom-0 right-0 w-12 h-12 border-b-[3.5px] border-r-[3.5px] border-white/90 rounded-br-3xl shadow-[0_0_8px_rgba(255,255,255,0.4)]"></div>

            <p className="text-white/90 text-xs font-semibold bg-black/50 px-3.5 py-1.5 rounded-full backdrop-blur-md border border-white/10 shadow-md">
              농수산물을 화면 가운데에 위치시키세요
            </p>
          </div>
        )}

        {/* Analyzing Spinner Overlay State */}
        {isAnalyzing && (
          <div className="bg-black/80 backdrop-blur-md rounded-2xl p-6 text-center space-y-3 border border-white/20 shadow-2xl">
            <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs font-bold text-white">
              AI가 신선도, 표면 결함 및 시세를 분석하여 내 점포 DB로 등록 중입니다...
            </p>
          </div>
        )}
      </div>

      {/* Hidden Native File Input for Gallery Selection */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCameraFileChange}
        className="hidden"
      />

      {/* Bottom Shutter & Controls Container */}
      <div className="relative z-30 w-full px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] max-w-md mx-auto space-y-3">
        <div className="flex items-center justify-center gap-8 px-6 pt-2">
          {/* Left Gallery Thumbnail Button */}
          <button
            onClick={() => cameraInputRef.current?.click()}
            className="w-12 h-12 rounded-full border-2 border-white/90 overflow-hidden bg-black/60 flex items-center justify-center p-0.5 shadow-lg active:scale-90 transition-transform group"
            title="갤러리 사진 선택"
          >
            {currentViewImage ? (
              <img
                src={currentViewImage}
                alt="Gallery preview"
                className="w-full h-full object-cover rounded-full group-hover:scale-110 transition-transform"
              />
            ) : (
              <span className="material-symbols-outlined text-white/80 text-lg">photo_library</span>
            )}
          </button>

          {/* Main Center Camera Shutter Button */}
          <button
            onClick={handleCaptureAndAnalyze}
            disabled={isAnalyzing}
            className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center p-1.5 border border-white/40 cursor-pointer active:scale-95 transition-transform shadow-xl"
            title="카메라 AI 촬영 및 내 점포 자동 등록"
          >
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-black shadow-md">
              <span className="material-symbols-outlined text-2xl font-bold text-black">
                camera_alt
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
