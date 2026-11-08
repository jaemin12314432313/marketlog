// QR로 들어오는 관람객 개인 폰 화면 (/r/{상품 id}).
// 앱 설치 없이 내가 만든 가게의 AI 품질 판정 결과, 공공 시세 비교, AI 도슨트를 보고 공유할 수 있는 읽기 전용 페이지.
import React, { useEffect, useState } from "react";
import { boothApi, type BoothProduct } from "./boothApi";
import { APP_BG, APP_CARD, AppHeader, BTN_DARK, BTN_OUTLINE, BTN_PRIMARY, GradePill, HeaderIconButton, MetricBars, PriceRow } from "./appUi";
import { copyText, downloadBlob, makeProductPageCard, shareCardFile, shopCardFileName } from "./shopCard";
import { getQualityMetrics } from "../components/ProductDetailModal";

// preview: 체험 태블릿 안에서 "내 가게 페이지"를 미리 보여줄 때 — 방문 수를 세지 않고, 공유 버튼은 숨긴다.
export default function BoothResult({ productId, preview = false }: { productId: string; preview?: boolean }) {
  const screenH = preview ? "min-h-full" : "min-h-[100dvh]";
  const [data, setData] = useState<{ product: BoothProduct; store: { name: string; number: number; openedAt: string | null } } | null>(null);
  const [error, setError] = useState("");
  const [docent, setDocent] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [toast, setToast] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  // 공유 창을 못 띄우는 환경(http 주소, PC 등)에서 보여주는 카드 미리보기 / 링크 창
  const [cardPreview, setCardPreview] = useState<{ url: string; blob: Blob; name: string } | null>(null);
  const [linkSheet, setLinkSheet] = useState(false);

  useEffect(() => {
    boothApi
      .result(productId, preview)
      .then((res) => {
        setData(res);
        if (!preview) document.title = `${res.store.name} · CO-SHOW 가상 시장 | 마켓로그`;
      })
      .catch((err) => setError(err?.status === 404 ? "가게를 찾을 수 없어요." : "잠시 후 다시 열어주세요."));
    boothApi
      .docent(productId)
      .then((res) => setDocent(res.script))
      .catch(() => setDocent(""));
  }, [productId, preview]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const toggleSpeak = () => {
    const synth = window.speechSynthesis;
    if (!synth || !docent) return;
    if (isSpeaking) {
      synth.cancel();
      setIsSpeaking(false);
      return;
    }
    const utter = new SpeechSynthesisUtterance(docent);
    utter.lang = "ko-KR";
    utter.rate = 1.0;
    utter.onend = () => setIsSpeaking(false);
    utter.onerror = () => setIsSpeaking(false);
    synth.speak(utter);
    setIsSpeaking(true);
  };

  const share = async () => {
    const url = window.location.href;
    const title = data ? `CO-SHOW 가상 시장 ${data.store.number}번 가게 '${data.store.name}'` : "마켓로그";
    try {
      if (navigator.share) {
        await navigator.share({ title, text: `${title}에 놀러오세요! AI가 품질을 판정한 과일가게예요.`, url });
        return;
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return; // 공유 창을 닫은 경우
    }
    if (await copyText(url)) setToast("링크를 복사했어요. 원하는 곳에 붙여넣어 주세요");
    else setLinkSheet(true);
  };

  // 이 페이지 내용 전체(가게·상품·AI 판정·시세·도슨트)를 한 장의 이미지로 만들어 폰에 저장/공유한다.
  const saveCard = async () => {
    if (!data || isSaving) return;
    setIsSaving(true);
    try {
      const blob = await makeProductPageCard(data.product, data.store, docent, window.location.href);
      const name = shopCardFileName(data.product, data.store.number);
      const shared = await shareCardFile(blob, name, `${data.store.name} · CO-SHOW 가상 시장`);
      if (!shared) setCardPreview({ url: URL.createObjectURL(blob), blob, name });
    } catch {
      setToast("저장하지 못했어요. 화면을 길게 눌러 캡처해주세요");
    } finally {
      setIsSaving(false);
    }
  };

  if (error) {
    return (
      <div className={`${screenH} ${APP_BG} flex flex-col items-center justify-center gap-3 p-6 text-center`}>
        <span className="material-symbols-outlined text-5xl text-slate-400">storefront</span>
        <p className="text-base font-bold text-slate-700">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={`${screenH} ${APP_BG} flex items-center justify-center`}>
        <div className="w-10 h-10 border-4 border-[#0052FF] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const { product: p, store } = data;
  const tags = (p.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  const openedAt = store.openedAt
    ? new Date(store.openedAt).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  const meta = [p.origin, p.unit].filter(Boolean).join(" · ");

  return (
    <div className={`${screenH} ${APP_BG} text-[#0F172A] pb-10`}>
      <AppHeader right={preview ? undefined : <HeaderIconButton icon="ios_share" label="공유" onClick={share} />} />

      <div className="max-w-md mx-auto">
        {/* 상품 사진 — 앱 상세 화면처럼 오른쪽 위에 등급 배지 */}
        <div className="relative bg-white">
          <img src={p.imageUrl} alt={p.title} className="w-full aspect-[4/3] object-cover bg-slate-200" />
          <span className="absolute top-3 right-3">
            <GradePill grade={p.grade} solid />
          </span>
        </div>

        <main className="px-4 pt-4 space-y-4">
          {/* 가게·상품 이름 */}
          <div className="px-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-[#0052FF]">
                {store.name}
              </span>
              <GradePill grade={p.grade} showIcon={false} />
            </div>
            <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight break-keep">{p.title}</h1>
            <p className="mt-1 text-xs font-medium text-slate-400">
              {[meta, openedAt ? `${openedAt} 개점` : "", "CO-SHOW 가상 시장"].filter(Boolean).join(" · ")}
            </p>
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span key={t} className="text-[11px] font-semibold text-[#0052FF] bg-blue-50 px-2 py-0.5 rounded-full">
                    {t.startsWith("#") ? t : `#${t}`}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 가격 + AI 정밀 분석 지표 (앱 상세와 같은 카드) */}
          <section className={`${APP_CARD} p-4 pb-5 space-y-3`}>
            <div className="pb-3 border-b border-[#E2E8F0]">
              <PriceRow price={p.price} publicPrice={p.publicPrice} />
            </div>
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-[#0F172A] tracking-wider">AI 정밀 분석 지표</h3>
              <span className={`text-xs font-extrabold px-2.5 py-1 rounded-full border flex items-center gap-1 ${p.grade?.startsWith("A") ? "text-[#10B981] bg-emerald-50 border-emerald-200" : "text-[#0052FF] bg-blue-50 border-blue-200"}`}>
                <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                품질 등급 {p.grade?.startsWith("A") ? "특상" : "보통"}
              </span>
            </div>
            <MetricBars labels={Object.fromEntries(getQualityMetrics(p).map(({ label, grade }) => [label, { grade }]))} />
            {p.aiSummary && (
              <div className="border-t border-[#D1D1D1] pt-3 space-y-2">
                <div className="font-extrabold text-[#0052FF] text-xs">AI 스캔 종합 의견</div>
                <p className="text-slate-700 font-medium text-xs leading-relaxed">{p.aiSummary}</p>
              </div>
            )}
          </section>

          {/* 사장님 한마디 */}
          {p.description && (
            <section className="rounded-2xl border border-amber-100 bg-[#FFFBF3] p-5">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-800">
                <span className="material-symbols-outlined text-lg">chat_bubble_outline</span>
                사장님 한마디
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-700 break-keep">{p.description}</p>
            </section>
          )}

          {/* AI 도슨트 */}
          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
            <div className="mb-4 flex items-center gap-3">
              <span className="material-symbols-outlined rounded-xl bg-blue-50 p-2 text-[#0052FF]">record_voice_over</span>
              <div><h2 className="text-sm font-bold">AI 도슨트</h2><p className="mt-0.5 text-xs text-slate-500">가게의 이야기를 들어보세요</p></div>
            </div>
            {docent === null ? (
              <div className="space-y-2">
                <div className="h-4 bg-slate-100 rounded animate-pulse" />
                <div className="h-4 bg-slate-100 rounded animate-pulse w-5/6" />
                <div className="h-4 bg-slate-100 rounded animate-pulse w-2/3" />
                <p className="text-xs text-slate-400 pt-1">AI가 가게 소개를 쓰는 중이에요...</p>
              </div>
            ) : docent ? (
              <>
                <p className="text-sm leading-7 text-slate-700 break-keep">{docent}</p>
                {"speechSynthesis" in window && (
                  <button onClick={toggleSpeak} aria-pressed={isSpeaking} className="mt-4 inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-blue-50 px-4 text-sm font-semibold text-[#0052FF] transition hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                    <span className="material-symbols-outlined text-lg text-[#0052FF]">{isSpeaking ? "stop_circle" : "play_circle"}</span>
                    {isSpeaking ? "멈추기" : "음성으로 듣기"}
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500">도슨트를 불러오지 못했어요. 잠시 후 새로고침해주세요.</p>
            )}
          </section>

          {!preview && (
            <section className="space-y-3 pt-1">
              <button onClick={saveCard} disabled={isSaving} className={BTN_PRIMARY}>
                <span className="material-symbols-outlined text-lg">download</span>
                {isSaving ? "이미지 만드는 중..." : "이 페이지 이미지로 저장하기"}
              </button>
              <p className="text-center text-xs text-slate-500">상품과 가게 이야기를 이미지로 간직해요</p>
              <div className="grid grid-cols-2 gap-2.5">
                {p.storeId && (
                  <a href={`/s/${p.storeId}`} className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-100/60 px-3 text-sm font-semibold text-blue-900 transition hover:bg-blue-100 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                    <span className="material-symbols-outlined text-lg">storefront</span>
                    가게 전체 보기
                  </a>
                )}
                <a href={`/market3d.html${p.storeId ? `?shop=${encodeURIComponent(p.storeId)}` : ""}`} className={`flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-100/60 px-3 text-sm font-semibold text-blue-900 transition hover:bg-blue-100 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${p.storeId ? "" : "col-span-2"}`}>
                  <span className="material-symbols-outlined text-lg">view_in_ar</span>
                  3D 시장
                </a>
              </div>
              <button onClick={share} className={BTN_OUTLINE}>
                <span className="material-symbols-outlined text-lg text-[#0052FF]">link</span>
                친구에게 내 가게 자랑하기
              </button>
            </section>
          )}

        </main>
      </div>

      {cardPreview && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-5 gap-4" onClick={() => { URL.revokeObjectURL(cardPreview.url); setCardPreview(null); }}>
          <p className="text-white font-extrabold text-center">
            이미지를 <span className="text-[#FDE68A]">길게 눌러</span> &lsquo;이미지 저장&rsquo;을 선택하세요
          </p>
          <img src={cardPreview.url} alt="내 가게 카드" className="max-h-[68vh] w-auto rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
          <div className="flex gap-2 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => downloadBlob(cardPreview.blob, cardPreview.name)} className={BTN_PRIMARY}>
              <span className="material-symbols-outlined">download</span>파일로 받기
            </button>
            <button onClick={() => { URL.revokeObjectURL(cardPreview.url); setCardPreview(null); }} className="px-6 py-3 rounded-xl bg-white/15 text-white font-extrabold">닫기</button>
          </div>
        </div>
      )}

      {linkSheet && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={() => setLinkSheet(false)}>
          <div className="w-full max-w-md bg-white rounded-t-3xl p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <p className="font-extrabold text-lg">내 가게 링크</p>
            <p className="text-sm text-slate-500 mt-1">아래 주소를 길게 눌러 복사하세요.</p>
            <p className="mt-3 p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-sm font-semibold break-all select-all">{window.location.href}</p>
            <button onClick={() => setLinkSheet(false)} className={`${BTN_DARK} mt-4`}>닫기</button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#0F172A] text-white text-sm font-bold rounded-full px-4 py-2 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
