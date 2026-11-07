// CO-SHOW 부스 공용 태블릿 화면 (/booth/kiosk).
// 흐름: 시작 → 가게 이름 → 과일 촬영(AI 판정) → 가격·홍보문구 고르고 등록 → QR로 결과 가져가기.
// 공용 기기라 로그인이 없고, 일정 시간 손대지 않으면 처음 화면으로 자동으로 돌아간다.
import React, { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { InspectionResult } from "../types";
import type { MarketInfo } from "../types";
import { HomeFeed } from "../components/HomeFeed";
import { boothApi, BoothApiError, resultPageUrl, type BoothFeed, type BoothProduct } from "./boothApi";
import BoothResult from "./BoothResult";
import { AttributeBars, BrandMark, GradeBadge, PriceCompare, captureVideoFrame, gradeText, won } from "./boothUi";

type Step = "intro" | "name" | "camera" | "result" | "shop" | "done";

const IDLE_LIMIT_MS: Record<Step, number> = {
  intro: Infinity,
  name: 90_000,
  camera: 120_000,
  result: 150_000,
  shop: 120_000,
  done: 60_000,
};
// 자리 비움 경고는 마지막 30초 동안 카운트다운으로 보여준다.
const IDLE_WARNING_MS = 30_000;

// 손님 화면에서 기존 소비자 피드(HomeFeed)에 넘기는 시장 정보.
const BOOTH_MARKET_INFO: MarketInfo = {
  id: "coshow",
  name: "CO-SHOW 가상 시장",
  city: "광주광역시 서구",
  region: "전남광주통합특별시",
  congestion: "보통",
  parkingCapacity: "",
  toiletLocation: "",
};

const NAME_IDEAS = [
  "꿀사과네", "아삭청과", "달콤과일상회", "새콤달콤가게", "햇살과일", "코쇼청과",
  "반짝과일", "싱싱팜", "주렁주렁", "과일천국", "빛고을청과", "상무과일",
];

const ANALYZE_STEPS = [
  "과일을 찾고 있어요",
  "착색도 · 신선도 · 흠집을 살펴보는 중",
  "품질 등급을 판정하는 중",
  "공공 시세(KAMIS)를 확인하는 중",
];

function pickNames(n: number): string[] {
  return [...NAME_IDEAS].sort(() => Math.random() - 0.5).slice(0, n);
}

function suggestedPrice(publicPrice: number): number {
  if (!publicPrice) return 10000;
  return Math.max(500, Math.round((publicPrice * 0.9) / 100) * 100);
}

// 테스트 모드용 샘플 사진 — 캔버스에 사과 그림을 그려서 실제 촬영 사진처럼 넘긴다.
function makeSampleFruitImage(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#EFE8DC";
  ctx.fillRect(0, 0, 960, 720);
  const body = ctx.createRadialGradient(420, 300, 40, 480, 380, 230);
  body.addColorStop(0, "#FF6B6B");
  body.addColorStop(0.6, "#D7263D");
  body.addColorStop(1, "#8E1B2A");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(480, 390, 220, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6B4423";
  ctx.fillRect(470, 130, 20, 70);
  ctx.fillStyle = "#4CAF50";
  ctx.beginPath();
  ctx.ellipse(540, 160, 60, 26, -0.4, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL("image/jpeg", 0.85);
}

export default function BoothKiosk() {
  const tabletId = new URLSearchParams(window.location.search).get("t") || "";
  // 테스트용: 주소에 ?demo=1 을 붙이면 촬영 화면에 "촬영 건너뛰기" 버튼이 생긴다(과일·카메라 없이 흐름 확인).
  const isDemo = new URLSearchParams(window.location.search).get("demo") === "1";

  const [step, setStep] = useState<Step>("intro");
  const [shopName, setShopName] = useState("");
  const [nameError, setNameError] = useState("");
  const [isCheckingName, setIsCheckingName] = useState(false);
  const [nameIdeas, setNameIdeas] = useState(() => pickNames(4));

  const [photo, setPhoto] = useState("");
  const [scan, setScan] = useState<InspectionResult | null>(null);
  const [scanError, setScanError] = useState<{ reason: string; hint: string } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeStep, setAnalyzeStep] = useState(0);

  const [price, setPrice] = useState(10000);
  const [copy, setCopy] = useState<{ descriptions: string[]; hashtags: string[] } | null>(null);
  const [descIndex, setDescIndex] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerError, setRegisterError] = useState("");

  const [registered, setRegistered] = useState<BoothProduct | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");

  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [idleLeft, setIdleLeft] = useState<number | null>(null);
  const lastActivityRef = useRef(Date.now());

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<"off" | "starting" | "on" | "error">("off");

  const resetAll = useCallback(() => {
    setStep("intro");
    setShopName("");
    setNameError("");
    setNameIdeas(pickNames(4));
    setPhoto("");
    setScan(null);
    setScanError(null);
    setIsAnalyzing(false);
    setCopy(null);
    setDescIndex(0);
    setSelectedTags([]);
    setIsRegistering(false);
    setRegisterError("");
    setRegistered(null);
    setQrDataUrl("");
    setIdleLeft(null);
  }, []);

  // ---------- 서버/AI 모델 예열 ----------
  // 첫 관람객이 모델 로딩(수십 초)을 기다리지 않도록 화면이 켜지면 바로 예열하고,
  // 준비된 뒤에도 몇 분마다 다시 호출해서 서버가 잠들지 않게 한다.
  useEffect(() => {
    let cancelled = false;
    let timer: number;
    const ping = async () => {
      try {
        const res = await boothApi.warmup();
        if (cancelled) return;
        setAiReady(res.modelsLoaded);
        timer = window.setTimeout(ping, res.modelsLoaded ? 240_000 : 8_000);
      } catch {
        if (cancelled) return;
        setAiReady(false);
        timer = window.setTimeout(ping, 10_000);
      }
    };
    ping();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // ---------- 자리 비움 감지 → 자동 초기화 ----------
  useEffect(() => {
    const touch = () => {
      lastActivityRef.current = Date.now();
      setIdleLeft(null);
    };
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, []);

  useEffect(() => {
    lastActivityRef.current = Date.now();
    setIdleLeft(null);
    const limit = IDLE_LIMIT_MS[step];
    if (!isFinite(limit)) return;
    const timer = window.setInterval(() => {
      // AI 분석/등록 중에는 관람객이 기다리는 중이니 초기화하지 않는다.
      if (isAnalyzing || isRegistering) {
        lastActivityRef.current = Date.now();
        return;
      }
      const left = limit - (Date.now() - lastActivityRef.current);
      if (left <= 0) resetAll();
      else setIdleLeft(left <= IDLE_WARNING_MS ? Math.ceil(left / 1000) : null);
    }, 500);
    return () => clearInterval(timer);
  }, [step, isAnalyzing, isRegistering, resetAll]);

  // ---------- 카메라 ----------
  useEffect(() => {
    if (step !== "camera") {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraState("off");
      return;
    }
    let cancelled = false;
    setCameraState("starting");
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setCameraState("on");
      })
      .catch((err) => {
        console.warn("카메라를 켤 수 없습니다", err);
        if (!cancelled) setCameraState("error");
      });
    if (!navigator.mediaDevices) setCameraState("error");
    return () => {
      cancelled = true;
    };
  }, [step]);

  useEffect(() => {
    if (!isAnalyzing) return;
    setAnalyzeStep(0);
    const timer = window.setInterval(() => setAnalyzeStep((s) => Math.min(s + 1, ANALYZE_STEPS.length - 1)), 1800);
    return () => clearInterval(timer);
  }, [isAnalyzing]);

  // ---------- 단계별 동작 ----------
  const startSession = () => {
    boothApi.event("session_start", tabletId);
    setStep("name");
  };

  const submitName = async (name = shopName) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("가게 이름을 입력해주세요.");
      return;
    }
    setIsCheckingName(true);
    setNameError("");
    try {
      const res = await boothApi.checkName(trimmed);
      setShopName(res.shopName);
      setStep("camera");
    } catch (err) {
      const e = err as BoothApiError;
      if (e.isNetwork) {
        // 이름 검사만 네트워크 때문에 실패했다면 체험은 계속 진행한다(등록 때 서버가 다시 검사함).
        setShopName(trimmed);
        setStep("camera");
      } else {
        setNameError(e.message);
      }
    } finally {
      setIsCheckingName(false);
    }
  };

  const loadCopy = async (title: string) => {
    setCopy(null);
    try {
      const res = await boothApi.productCopy(title, shopName);
      setCopy({ descriptions: res.descriptions, hashtags: res.hashtags });
      setSelectedTags(res.hashtags.slice(0, 3));
    } catch {
      const fallback = {
        descriptions: [
          `AI가 직접 확인한 오늘의 신선한 ${title}`,
          `한 입 베어 물면 느껴지는 제철 ${title}의 맛`,
          `사진 한 장으로 품질을 증명한 정직한 ${title}`,
        ],
        hashtags: ["#마켓로그", "#AI품질인증", "#제철과일", "#CO_SHOW", "#전통시장"],
      };
      setCopy(fallback);
      setSelectedTags(fallback.hashtags.slice(0, 3));
    }
  };

  const captureAndAnalyze = async (sampleImage?: string) => {
    if (isAnalyzing) return;
    if (!sampleImage && !videoRef.current) return;
    const image = sampleImage || captureVideoFrame(videoRef.current!);
    if (!image) {
      setScanError({ reason: "카메라 화면을 가져오지 못했어요.", hint: "잠시 후 다시 눌러주세요." });
      return;
    }
    setPhoto(image);
    setScanError(null);
    setIsAnalyzing(true);
    const res = await boothApi.analyze(image);
    setIsAnalyzing(false);
    if ("reason" in res) {
      boothApi.event("scan_fail", res.reason);
      setScanError({ reason: res.reason, hint: res.hint });
      setPhoto("");
      return;
    }
    boothApi.event("scan_success", res.data.productName);
    setScan(res.data);
    setPrice(suggestedPrice(res.data.publicMarketPrice));
    setDescIndex(0);
    setStep("result");
    loadCopy(res.data.productName);
  };

  const register = async () => {
    if (!scan || isRegistering) return;
    setIsRegistering(true);
    setRegisterError("");
    try {
      const res = await boothApi.register({
        shopName,
        title: scan.productName,
        category: scan.category,
        unit: "1kg",
        price,
        publicPrice: scan.publicMarketPrice,
        grade: scan.grade,
        imageBase64: photo,
        freshnessScore: scan.freshnessScore,
        defectScore: scan.defectScore,
        uniformityScore: scan.uniformityScore,
        attributeLabels: scan.attributeLabels ?? null,
        aiSummary: scan.aiAnalysisSummary,
        gradeConfidencePercent: scan.gradeConfidencePercent ?? null,
        description: copy?.descriptions[descIndex] ?? "",
        tags: selectedTags,
      });
      setRegistered(res.product);
      setQrDataUrl(
        await QRCode.toDataURL(resultPageUrl(res.product.id), { width: 520, margin: 1, errorCorrectionLevel: "M" })
      );
      // 등록 직후엔 태블릿에서 "내 가게 페이지"를 먼저 보여주고, QR은 그다음 단계에서 보여준다.
      setStep("shop");
    } catch (err) {
      const e = err as BoothApiError;
      boothApi.event("register_fail", e.message);
      setRegisterError(e.message);
      // 가게 이름이 문제면 이름 단계로 돌려보낸다(촬영 결과는 그대로 유지).
      if (e.status === 400 && e.message.includes("이름")) {
        setNameError(e.message);
      }
    } finally {
      setIsRegistering(false);
    }
  };

  // ---------- 화면 ----------
  return (
    <div className="min-h-[100dvh] w-full bg-slate-100 text-slate-900 select-none overflow-hidden">
      {step === "intro" && <IntroScreen aiReady={aiReady} onStart={startSession} />}

      {step === "name" && (
        <StepShell step={1} title="나만의 과일가게 이름을 지어주세요" onBack={resetAll}>
          <div className="w-full max-w-xl mx-auto space-y-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitName();
              }}
            >
              <input
                autoFocus
                value={shopName}
                maxLength={12}
                onChange={(e) => {
                  setShopName(e.target.value);
                  setNameError("");
                }}
                placeholder="예) 꿀사과네"
                className="w-full text-center text-4xl font-extrabold rounded-3xl border-4 border-slate-200 focus:border-[#0052FF] focus:ring-0 py-6 px-4 bg-white"
              />
            </form>
            <div className="flex justify-between text-sm font-semibold">
              <span className="text-rose-500">{nameError}</span>
              <span className="text-slate-400">{shopName.trim().length}/12</span>
            </div>
            <div>
              <p className="text-center text-slate-500 font-semibold mb-3">이름이 고민되면 골라보세요</p>
              <div className="flex flex-wrap justify-center gap-3">
                {nameIdeas.map((idea) => (
                  <button
                    key={idea}
                    onClick={() => {
                      setShopName(idea);
                      setNameError("");
                    }}
                    className="px-5 py-3 rounded-full bg-white border-2 border-slate-200 text-lg font-bold active:scale-95 transition"
                  >
                    {idea}
                  </button>
                ))}
                <button
                  onClick={() => setNameIdeas(pickNames(4))}
                  className="px-4 py-3 rounded-full text-slate-500 font-bold flex items-center gap-1"
                >
                  <span className="material-symbols-outlined">refresh</span>다른 이름
                </button>
              </div>
            </div>
            <BigButton onClick={() => submitName()} disabled={!shopName.trim() || isCheckingName}>
              {isCheckingName ? "확인 중..." : "가게 문 열기"}
            </BigButton>
          </div>
        </StepShell>
      )}

      {step === "camera" && (
        <div className="relative h-[100dvh] w-full bg-black text-white">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`absolute inset-0 w-full h-full object-cover ${cameraState === "on" ? "" : "opacity-0"}`}
          />
          {photo && isAnalyzing && <img src={photo} alt="" className="absolute inset-0 w-full h-full object-cover" />}

          <div className="absolute inset-x-0 top-0 p-5 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
            <button onClick={() => setStep("name")} className="flex items-center gap-1 font-bold text-white/90 text-lg">
              <span className="material-symbols-outlined">arrow_back</span>이름 바꾸기
            </button>
            <div className="text-center">
              <p className="text-sm text-white/70 font-semibold">STEP 2 · {shopName}</p>
              <p className="text-2xl font-extrabold">진열할 과일을 하나 골라 찍어주세요</p>
            </div>
            <div className="w-32" />
          </div>

          {cameraState === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
              <span className="material-symbols-outlined text-6xl">videocam_off</span>
              <p className="text-xl font-bold">카메라를 켤 수 없어요</p>
              <p className="text-white/60">브라우저 카메라 권한을 확인한 뒤 스태프에게 알려주세요.</p>
            </div>
          )}

          {!isAnalyzing && cameraState === "on" && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[min(60vw,60vh)] aspect-square rounded-[2.5rem] border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          )}

          {isAnalyzing && (
            <div className="absolute inset-0 bg-black/55 backdrop-blur-sm flex flex-col items-center justify-center gap-6">
              <div className="w-20 h-20 border-[6px] border-white border-t-transparent rounded-full animate-spin" />
              <div className="space-y-2 text-center">
                {ANALYZE_STEPS.map((label, i) => (
                  <p
                    key={label}
                    className={`text-xl font-bold transition-opacity ${
                      i < analyzeStep ? "text-emerald-300 opacity-90" : i === analyzeStep ? "opacity-100" : "opacity-30"
                    }`}
                  >
                    {i < analyzeStep ? "✓ " : ""}
                    {label}
                  </p>
                ))}
              </div>
            </div>
          )}

          {scanError && !isAnalyzing && (
            <div className="absolute left-1/2 -translate-x-1/2 bottom-40 w-[min(90vw,560px)] rounded-3xl bg-white text-slate-900 p-5 shadow-2xl text-center">
              <p className="text-xl font-extrabold text-rose-500">{scanError.reason}</p>
              <p className="mt-1 text-slate-600 font-semibold">{scanError.hint}</p>
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 pb-10 pt-16 flex flex-col items-center gap-3 bg-gradient-to-t from-black/85 to-transparent">
            <button
              onClick={() => captureAndAnalyze()}
              disabled={isAnalyzing || cameraState !== "on"}
              className="w-24 h-24 rounded-full bg-white/25 border-4 border-white flex items-center justify-center active:scale-95 transition disabled:opacity-40"
              aria-label="촬영"
            >
              <span className="w-[4.5rem] h-[4.5rem] rounded-full bg-white flex items-center justify-center">
                <span className="material-symbols-outlined text-4xl text-slate-900">photo_camera</span>
              </span>
            </button>
            <p className="text-white/80 font-semibold">과일이 네모 안에 크게 보이게 찍어주세요</p>
            {isDemo && (
              <button
                onClick={() => captureAndAnalyze(makeSampleFruitImage())}
                disabled={isAnalyzing}
                className="mt-1 px-5 py-2 rounded-full bg-amber-400 text-amber-950 font-extrabold text-sm active:scale-95 transition disabled:opacity-40"
              >
                촬영 건너뛰기 (테스트용 샘플 사진)
              </button>
            )}
          </div>
        </div>
      )}

      {step === "result" && scan && (
        <StepShell step={3} title={`${shopName}에 진열할 준비가 됐어요`} onBack={() => setStep("camera")} backLabel="다시 찍기">
          <div className="w-full max-w-6xl mx-auto grid md:grid-cols-2 gap-6 items-start">
            <section className="bg-white rounded-3xl p-5 shadow-sm space-y-4">
              <div className="relative rounded-2xl overflow-hidden aspect-video bg-slate-200">
                <img src={photo} alt="" className="w-full h-full object-cover" />
                <span className="absolute top-3 left-3 bg-black/60 text-white text-sm font-bold px-3 py-1 rounded-full">
                  AI 품질 판정 결과
                </span>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-3xl font-extrabold">{scan.productName}</p>
                <GradeBadge grade={scan.grade} confidence={scan.gradeConfidencePercent} size="lg" />
              </div>
              <AttributeBars labels={scan.attributeLabels} />
              {scan.aiAnalysisSummary && (
                <p className="text-slate-600 leading-relaxed bg-slate-50 rounded-2xl p-4 text-[15px]">
                  <span className="font-bold text-[#0052FF]">AI 종합 의견 </span>
                  {scan.aiAnalysisSummary}
                </p>
              )}
            </section>

            <section className="bg-white rounded-3xl p-5 shadow-sm space-y-5">
              <div>
                <p className="font-extrabold text-lg mb-2">① 가격 정하기 (1kg)</p>
                <div className="flex items-center gap-3 mb-3">
                  <PriceStepButton onClick={() => setPrice((p) => Math.max(500, p - 500))}>−500</PriceStepButton>
                  <p className="flex-1 text-center text-4xl font-extrabold tabular-nums">{won(price)}</p>
                  <PriceStepButton onClick={() => setPrice((p) => Math.min(200000, p + 500))}>+500</PriceStepButton>
                </div>
                <PriceCompare price={price} publicPrice={scan.publicMarketPrice} />
                <p className="text-xs text-slate-400 mt-1">{scan.publicGuarantee}</p>
              </div>

              <div>
                <p className="font-extrabold text-lg mb-2 flex items-center gap-2">
                  ② AI가 만든 홍보 문구 고르기
                  {!copy && <span className="text-sm font-semibold text-slate-400">작성 중...</span>}
                </p>
                {copy ? (
                  <div className="space-y-2">
                    {copy.descriptions.map((d, i) => (
                      <button
                        key={d}
                        onClick={() => setDescIndex(i)}
                        className={`w-full text-left rounded-2xl px-4 py-3 border-2 font-semibold transition ${
                          descIndex === i ? "border-[#0052FF] bg-blue-50 text-[#0052FF]" : "border-slate-200"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {copy.hashtags.map((tag) => {
                        const on = selectedTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            onClick={() =>
                              setSelectedTags((prev) => (on ? prev.filter((t) => t !== tag) : [...prev, tag]))
                            }
                            className={`px-3 py-1.5 rounded-full text-sm font-bold border-2 ${
                              on ? "bg-[#0052FF] border-[#0052FF] text-white" : "border-slate-200 text-slate-500"
                            }`}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-12 rounded-2xl bg-slate-100 animate-pulse" />
                    ))}
                  </div>
                )}
              </div>

              {registerError && (
                <p className="text-rose-500 font-bold text-center">
                  {registerError}
                  {registerError.includes("이름") && (
                    <button className="underline ml-2" onClick={() => setStep("name")}>
                      이름 바꾸기
                    </button>
                  )}
                </p>
              )}
              <BigButton onClick={register} disabled={isRegistering || !copy}>
                {isRegistering ? "가게에 진열하는 중..." : registerError ? "다시 시도하기" : "우리 가게에 진열하기"}
              </BigButton>
            </section>
          </div>
        </StepShell>
      )}

      {step === "shop" && registered && (
        <ShopPageScreen product={registered} onShowQr={() => setStep("done")} onRestart={resetAll} />
      )}

      {step === "done" && registered && (
        <DoneScreen product={registered} qrDataUrl={qrDataUrl} onBack={() => setStep("shop")} onRestart={resetAll} />
      )}

      {idleLeft != null && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onPointerDown={() => setIdleLeft(null)}>
          <div className="bg-white rounded-3xl px-10 py-8 text-center shadow-2xl">
            <p className="text-2xl font-extrabold">아직 체험 중이신가요?</p>
            <p className="mt-2 text-slate-500 font-semibold">화면을 터치하면 계속할 수 있어요</p>
            <p className="mt-4 text-5xl font-extrabold text-[#0052FF] tabular-nums">{idleLeft}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// 첫 화면: 저장 카드와 같은 과일가게 테마를 얇은 차양 하나로만 살린 심플한 구성.
function IntroScreen({ aiReady, onStart }: { aiReady: boolean | null; onStart: () => void }) {
  return (
    <div className="min-h-[100dvh] flex flex-col text-slate-900" style={{ background: "#FFF8EC" }}>
      <div className="flex h-10 shrink-0" aria-hidden>
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="flex-1 h-full rounded-b-full" style={{ background: i % 2 === 0 ? "#0052FF" : "#DBEAFE" }} />
        ))}
      </div>

      <header className="flex items-center justify-between px-8 pt-6">
        <BrandMark />
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-400">
          <span
            className={`w-2 h-2 rounded-full ${
              aiReady ? "bg-emerald-500" : aiReady === false ? "bg-amber-400 animate-pulse" : "bg-slate-300"
            }`}
          />
          {aiReady ? "AI 준비 완료" : "AI 준비 중"}
        </span>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-12 pb-10">
        <div>
          <p className="text-lg font-bold text-slate-400">CO-SHOW 가상 시장</p>
          <h1 className="mt-3 text-6xl md:text-7xl font-black leading-[1.15] tracking-tight">
            나만의 <span className="text-[#0052FF]">과일가게</span>
            <br />
            만들기
          </h1>
          <p className="mt-5 text-xl font-semibold text-slate-500">사진 한 장으로 AI가 품질을 증명해주는 전통시장</p>
        </div>

        <ol className="flex items-center gap-4 text-lg font-bold text-slate-600">
          {["가게 이름 짓기", "과일 찍고 AI 판정", "내 가게를 폰으로"].map((label, i) => (
            <li key={label} className="flex items-center gap-4">
              {i > 0 && <span className="material-symbols-outlined text-slate-300">chevron_right</span>}
              <span className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-[#0052FF] text-white text-sm font-black flex items-center justify-center">
                  {i + 1}
                </span>
                {label}
              </span>
            </li>
          ))}
        </ol>

        <div className="flex flex-col items-center gap-3">
          <button
            onClick={onStart}
            className="px-16 py-6 rounded-full bg-[#0052FF] text-white text-3xl font-black shadow-lg active:scale-95 transition"
          >
            시작하기
          </button>
          <p className="text-slate-400 font-semibold">회원가입 · 앱 설치 없이 1분이면 끝나요</p>
        </div>
      </main>
    </div>
  );
}

// 등록 직후 "내 가게" 단계: 폰 화면 모양 안에서 사장님 화면(내 가게 관리)을 먼저 보여주고,
// 옆 버튼으로 손님 화면(기존 앱의 소비자 피드 — 다른 관람객들이 만든 가게까지)으로 바꿔 볼 수 있다.
type ShopViewMode = "owner" | "customer";

function ShopPageScreen({
  product,
  onShowQr,
  onRestart,
}: {
  product: BoothProduct;
  onShowQr: () => void;
  onRestart: () => void;
}) {
  const [mode, setMode] = useState<ShopViewMode>("owner");
  const [feed, setFeed] = useState<BoothFeed | null>(null);
  // 손님 화면에서 피드의 상품을 누르면 그 가게의 손님용 페이지를 연다.
  const [openedProductId, setOpenedProductId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      boothApi
        .feed(50)
        .then((res) => {
          if (!cancelled) setFeed(res);
        })
        .catch(() => {});
    load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const switchMode = (next: ShopViewMode) => {
    setMode(next);
    setOpenedProductId(null);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const openProduct = (id: string | null) => {
    setOpenedProductId(id);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-slate-100">
      <header className="flex items-center justify-between px-6 py-5 bg-white shadow-sm">
        <button onClick={onRestart} className="flex items-center gap-1 font-bold text-slate-500 text-lg w-56">
          <span className="material-symbols-outlined">home</span>
          처음으로
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-emerald-600">🎉 {product.shopNumber}번 가게 오픈!</p>
          <p className="text-2xl font-extrabold">{product.shopName} 문을 열었어요</p>
        </div>
        <div className="w-56 flex justify-end">
          <BrandMark />
        </div>
      </header>
      <main className="flex-1 min-h-0 grid md:grid-cols-[minmax(0,1fr)_280px] gap-6 items-center max-w-7xl mx-auto w-full px-6 py-6">
        <div className="h-full max-h-[calc(100dvh-9rem)] w-full max-w-[760px] justify-self-center rounded-[2.5rem] border-[10px] border-slate-900 bg-slate-900 shadow-2xl overflow-hidden">
          <div ref={scrollRef} className="h-full overflow-y-auto rounded-[1.8rem] bg-slate-100 relative">
            {mode === "owner" && !openedProductId && (
              <OwnerView product={product} feed={feed} onPreviewCustomerPage={() => openProduct(product.id)} />
            )}
            {mode === "customer" && !openedProductId && (
              <CustomerFeedView products={feed ? feed.products : null} onSelect={(p) => openProduct(p.id)} />
            )}
            {openedProductId && (
              <>
                <button
                  onClick={() => openProduct(null)}
                  className="sticky top-0 z-10 w-full bg-white/95 backdrop-blur px-4 py-3 flex items-center gap-1 font-bold text-slate-600 border-b border-slate-200"
                >
                  <span className="material-symbols-outlined">arrow_back</span>
                  {mode === "owner" ? "상인 화면으로" : "피드로 돌아가기"}
                </button>
                <div key={openedProductId}>
                  <BoothResult productId={openedProductId} preview />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3">
            <ModeButton
              active={mode === "owner"}
              icon="storefront"
              title="상인 화면"
              desc="내 가게 관리"
              onClick={() => switchMode("owner")}
            />
            <ModeButton
              active={mode === "customer"}
              icon="groups"
              title="고객 화면"
              desc="CO-SHOW 시장 구경"
              onClick={() => switchMode("customer")}
            />
          </div>
          {mode === "owner" ? (
            <div>
              <p className="text-sm font-bold text-[#0052FF]">상인 화면</p>
              <h2 className="mt-1 text-2xl font-black leading-tight">
                사진 한 장으로
                <br />
                가게 등록이 끝났어요
              </h2>
              <p className="mt-3 text-[15px] font-semibold leading-relaxed text-slate-600">
                AI 판정 결과와 공공 시세 비교가 내 상품에 자동으로 붙었어요. 고객에게 어떻게 보이는지도 확인해보세요.
              </p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-bold text-[#0052FF]">고객 화면</p>
              <h2 className="mt-1 text-2xl font-black leading-tight">
                다른 관람객들이 만든
                <br />
                가게도 구경해보세요
              </h2>
              <p className="mt-3 text-[15px] font-semibold leading-relaxed text-slate-600">
                고객은 AI가 검증한 등급과 공공 시세를 비교하며 믿고 고를 수 있어요. 상품을 누르면 가게 페이지가 열려요.
              </p>
            </div>
          )}
          <BigButton onClick={onShowQr}>
            <span className="inline-flex items-center gap-2">
              <span className="material-symbols-outlined text-3xl">qr_code_2</span>내 폰으로 가져가기
            </span>
          </BigButton>
        </div>
      </main>
    </div>
  );
}

function ModeButton({
  active,
  icon,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  icon: string;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-3xl p-4 text-left border-2 transition active:scale-[0.98] ${
        active ? "bg-[#0052FF] border-[#0052FF] text-white shadow-lg" : "bg-white border-slate-200 text-slate-700"
      }`}
    >
      <span className="material-symbols-outlined text-3xl">{icon}</span>
      <p className="text-xl font-extrabold mt-1">{title}</p>
      <p className={`text-sm font-semibold ${active ? "text-white/80" : "text-slate-400"}`}>{desc}</p>
    </button>
  );
}

// 사장님 화면: 내 가게에 진열된 상품, AI 판정 리포트, CO-SHOW 시장 현황.
function OwnerView({
  product: p,
  feed,
  onPreviewCustomerPage,
}: {
  product: BoothProduct;
  feed: BoothFeed | null;
  onPreviewCustomerPage: () => void;
}) {
  const stats = feed ? feed.stats : null;
  return (
    <div className="pb-8">
      <div className="px-5 pt-5 pb-6 text-white" style={{ background: "linear-gradient(135deg,#0052FF,#0EA5E9)" }}>
        <span className="inline-flex items-center gap-1 text-xs font-extrabold bg-white/20 rounded-full px-2.5 py-1">
          <span className="material-symbols-outlined text-sm">storefront</span>상인 모드
        </span>
        <p className="mt-3 text-sm font-bold text-white/80">CO-SHOW 가상 시장 · {p.shopNumber}번 가게</p>
        <p className="text-3xl font-black">{p.shopName}</p>
        <p className="text-sm font-semibold text-white/80 mt-1">김대중컨벤션센터 · 영업 중</p>
      </div>

      <section className="mx-4 -mt-3 bg-white rounded-3xl shadow-sm p-4">
        <p className="text-sm font-extrabold text-slate-500 mb-3">진열 중인 상품 1개</p>
        <div className="flex gap-3">
          <img src={p.imageUrl} alt="" className="w-24 h-24 rounded-2xl object-cover bg-slate-200" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-xl font-black truncate">{p.title}</p>
              <GradeBadge grade={p.grade} confidence={p.gradeConfidencePercent} />
            </div>
            <p className="text-lg font-extrabold mt-1">
              {won(p.price)}
              <span className="text-sm font-semibold text-slate-400"> / 1kg</span>
            </p>
            {p.priceTag && <p className="text-sm font-bold text-emerald-600">{p.priceTag}</p>}
          </div>
        </div>
        {p.description && <p className="mt-3 text-[15px] font-semibold text-slate-700">“{p.description}”</p>}
        {p.tags && <p className="mt-1 text-sm font-semibold text-[#0052FF]">{p.tags.split(",").join(" ")}</p>}
      </section>

      <section className="mx-4 mt-4 bg-white rounded-3xl shadow-sm p-4">
        <p className="text-sm font-extrabold text-slate-500 mb-3">AI 품질 판정 리포트</p>
        <AttributeBars labels={p.attributeLabels} />
        {p.aiSummary && <p className="mt-3 text-sm leading-relaxed text-slate-600 bg-slate-50 rounded-2xl p-3">{p.aiSummary}</p>}
      </section>

      <section className="mx-4 mt-4 bg-white rounded-3xl shadow-sm p-4">
        <p className="text-sm font-extrabold text-slate-500 mb-3">CO-SHOW 시장 현황</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["문을 연 가게", stats ? `${stats.totalShops}곳` : "–"],
            ["오늘 등록", stats ? `${stats.todayProducts}개` : "–"],
            ["특상 비율", stats ? `${stats.premiumPercent}%` : "–"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-slate-50 py-3">
              <p className="text-xs font-bold text-slate-400">{label}</p>
              <p className="text-xl font-black">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mx-4 mt-4">
        <button
          onClick={onPreviewCustomerPage}
          className="w-full py-3.5 rounded-2xl bg-slate-900 text-white font-extrabold flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined">visibility</span>
          고객에게 보이는 내 가게 페이지
        </button>
      </div>
    </div>
  );
}

// 손님 화면: 기존 마켓로그 앱의 소비자 피드(HomeFeed)를 그대로 써서 CO-SHOW 시장 상품을 보여준다.
function CustomerFeedView({
  products,
  onSelect,
}: {
  products: BoothProduct[] | null;
  onSelect: (product: BoothProduct) => void;
}) {
  return (
    <div>
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-400">소비자 피드</p>
          <p className="text-lg font-black">CO-SHOW 가상 시장</p>
        </div>
        <span className="text-xs font-extrabold text-rose-500 flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
          LIVE
        </span>
      </div>
      {/* HomeFeed는 앱 상단 헤더 높이만큼 위 여백을 두고 그려져서, 그만큼 끌어올린다. */}
      <div style={{ marginTop: "calc(-5.5rem - env(safe-area-inset-top, 0px))" }}>
        <HomeFeed
          products={products || []}
          selectedMarket={BOOTH_MARKET_INFO}
          onSelectProduct={(p) => onSelect(p as BoothProduct)}
          onOpenAiScan={() => {}}
          isLoading={products === null}
        />
      </div>
    </div>
  );
}

function DoneScreen({
  product,
  qrDataUrl,
  onBack,
  onRestart,
}: {
  product: BoothProduct;
  qrDataUrl: string;
  onBack: () => void;
  onRestart: () => void;
}) {
  return (
    <div className="min-h-[100dvh] flex flex-col text-white" style={{ background: "linear-gradient(135deg,#10B981 0%,#0D9488 100%)" }}>
      <header className="p-6">
        <BrandMark dark />
      </header>
      <main className="flex-1 grid md:grid-cols-2 gap-8 items-center max-w-6xl mx-auto w-full px-6 pb-10">
        <div className="space-y-5 text-center md:text-left">
          <p className="text-xl font-bold text-white/85">🎉 가게 문을 열었어요!</p>
          <h1 className="text-5xl font-black leading-tight">
            CO-SHOW 가상 시장
            <br />
            <span className="text-yellow-200">{product.shopNumber}번</span> 가게
          </h1>
          <div className="inline-flex items-center gap-3 rounded-3xl bg-white/15 px-5 py-4">
            <img src={product.imageUrl} alt="" className="w-16 h-16 rounded-2xl object-cover" />
            <div className="text-left">
              <p className="font-extrabold text-xl">{product.shopName}</p>
              <p className="font-semibold text-white/85">
                {product.title} · {gradeText(product.grade)} · {won(product.price)}
              </p>
            </div>
          </div>
          <p className="text-2xl font-extrabold flex items-center gap-2 justify-center md:justify-start">
            <span className="material-symbols-outlined text-3xl">tv</span>
            지금 부스 앞 모니터를 확인해보세요!
          </p>
          <div className="flex gap-3 justify-center md:justify-start">
            <button
              onClick={onBack}
              className="px-6 py-4 rounded-full bg-white/20 border-2 border-white/60 text-xl font-extrabold active:scale-95 transition"
            >
              내 가게 페이지 다시 보기
            </button>
            <button
              onClick={onRestart}
              className="px-6 py-4 rounded-full bg-white text-emerald-700 text-xl font-extrabold active:scale-95 transition"
            >
              처음으로
            </button>
          </div>
        </div>
        <div className="bg-white rounded-[2rem] p-6 text-slate-900 text-center shadow-2xl">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="내 가게 QR 코드" className="w-full max-w-[340px] mx-auto aspect-square" />
          ) : (
            <div className="w-full max-w-[340px] mx-auto aspect-square bg-slate-100 animate-pulse rounded-2xl" />
          )}
          <p className="mt-4 text-2xl font-black">휴대폰 카메라로 찍어보세요</p>
          <p className="mt-1 text-slate-500 font-semibold">
            AI 판정 결과 · 공공 시세 · AI 도슨트를
            <br />
            앱 설치 없이 바로 볼 수 있어요
          </p>
        </div>
      </main>
    </div>
  );
}

function StepShell({
  step,
  title,
  children,
  onBack,
  backLabel = "처음으로",
}: {
  step: number;
  title: string;
  children: React.ReactNode;
  onBack: () => void;
  backLabel?: string;
}) {
  return (
    <div className="min-h-[100dvh] flex flex-col">
      <header className="flex items-center justify-between px-6 py-5 bg-white shadow-sm">
        <button onClick={onBack} className="flex items-center gap-1 font-bold text-slate-500 text-lg w-56">
          <span className="material-symbols-outlined">arrow_back</span>
          {backLabel}
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-[#0052FF]">STEP {step} / 3</p>
          <p className="text-2xl font-extrabold">{title}</p>
        </div>
        <div className="w-56 flex justify-end">
          <BrandMark />
        </div>
      </header>
      <main className="flex-1 flex flex-col justify-center p-6 overflow-y-auto">{children}</main>
    </div>
  );
}

function BigButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full py-5 rounded-3xl bg-[#0052FF] text-white text-2xl font-extrabold shadow-lg active:scale-[0.98] transition disabled:bg-slate-300 disabled:shadow-none"
    >
      {children}
    </button>
  );
}

function PriceStepButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-20 h-14 rounded-2xl bg-slate-100 border-2 border-slate-200 text-lg font-extrabold active:scale-95 transition"
    >
      {children}
    </button>
  );
}
