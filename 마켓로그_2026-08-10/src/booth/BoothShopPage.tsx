// QR로 여는 "내 가게 페이지" (/s/{가게 id}).
// 관람객이 부스에서 연 가게와 진열한 상품 전체, 그리고 가게의 AI 도슨트를 앱 설치 없이 볼 수 있다.
// 화면 모양은 마켓로그 앱과 같게(appUi.tsx) 맞춘다.
import React, { useEffect, useState } from "react";
import { boothApi, type BoothProduct, type BoothShopInfo } from "./boothApi";
import { copyText, shopOneLiner } from "./shopCard";
import {
  APP_BG,
  APP_CARD,
  AppHeader,
  CardTitle,
  HeaderIconButton,
} from "./appUi";

// 앱의 "등록 상품" 목록과 같은 가로형 상품 카드 — 누르면 상품 페이지(/r/{id})
function ProductRow({ p }: { p: BoothProduct; key?: React.Key }) {
  const meta = [p.origin, p.unit].filter(Boolean).join(" · ");
  return (
    <a href={`/r/${p.id}`} className="group flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-3 shadow-[0_4px_18px_rgba(15,23,42,0.04)] transition hover:border-blue-200 hover:shadow-md active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
      <div className="relative w-[88px] h-[88px] shrink-0 rounded-xl overflow-hidden bg-slate-100">
        <img src={p.imageUrl} alt={p.title} className="w-full h-full object-cover" />
        <span className={`absolute top-1.5 left-1.5 inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[10px] font-bold leading-none text-white shadow-sm ${p.grade === "A+" ? "bg-emerald-500" : "bg-[#0052FF]"}`}>
          <span className="material-symbols-outlined text-[12px] leading-none" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          {p.grade === "A+" ? "특상" : "보통"}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold text-[#0F172A] truncate">{p.title}</p>
        {meta && <p className="text-xs font-medium text-slate-400 mt-0.5 truncate">{meta}</p>}
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <span className="text-lg font-bold text-[#0F172A]">
            {p.price.toLocaleString()}
            <span className="text-xs font-semibold ml-0.5">원</span>
          </span>
        </div>
      </div>
      <span className="material-symbols-outlined text-slate-300 transition group-hover:text-blue-600">chevron_right</span>
    </a>
  );
}

export default function BoothShopPage({ storeId }: { storeId: string }) {
  const [data, setData] = useState<{ store: BoothShopInfo; products: BoothProduct[] } | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  // AI 도슨트: null=불러오는 중, ""=불러오지 못함/상품 없음
  const [docent, setDocent] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    boothApi
      .shop(storeId)
      .then((res) => {
        setData(res);
        document.title = `${res.store.name} · CO-SHOW 가상 시장 | 마켓로그`;
        // 도슨트는 가게에서 가장 최근에 진열한 상품을 바탕으로 가게 이야기를 들려 준다.
        if (res.products.length > 0) {
          boothApi
            .docent(res.products[0].id)
            .then((d) => setDocent(d.script))
            .catch(() => setDocent(""));
        } else {
          setDocent("");
        }
      })
      .catch((err) => setError(err?.status === 404 ? "가게를 찾을 수 없어요." : "잠시 후 다시 열어주세요."));
  }, [storeId]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
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
    const title = data ? `CO-SHOW 가상 시장 '${data.store.name}'` : "마켓로그";
    try {
      if (navigator.share) {
        await navigator.share({ title, text: `${title}에 놀러오세요! AI가 품질을 판정한 과일가게예요.`, url });
        return;
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
    }
    setToast((await copyText(url)) ? "링크를 복사했어요" : url);
  };

  if (error) {
    return (
      <div className={`min-h-[100dvh] ${APP_BG} flex flex-col items-center justify-center gap-3 p-6 text-center`}>
        <span className="material-symbols-outlined text-5xl text-slate-400">storefront</span>
        <p className="text-base font-bold text-slate-700">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className={`min-h-[100dvh] ${APP_BG} flex items-center justify-center`}>
        <div className="w-10 h-10 border-4 border-[#0052FF] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const { store, products } = data;
  const openedAt = store.openedAt
    ? new Date(store.openedAt).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  const premiumCount = products.filter((p) => p.grade === "A+").length;
  const stats = [
    { label: "진열 상품", value: `${products.length}개`, color: "text-[#0F172A]" },
    { label: "AI 특상 상품", value: `${premiumCount}개`, color: "text-[#10B981]" },
  ];
  const line = store.tagline?.trim() || shopOneLiner(products);

  return (
    <div className="min-h-[100dvh] bg-[#F7F8FA] text-[#0F172A] pb-10">
      <AppHeader right={<HeaderIconButton icon="ios_share" label="공유" onClick={share} />} />

      <main className="max-w-md mx-auto px-4 pt-5 space-y-7">
        {/* 가게 정보 */}
        <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_8px_28px_rgba(15,23,42,0.06)]">
          <div className="h-1.5 bg-gradient-to-r from-[#0052FF] to-[#79A8FF]" />
          <div className="p-5 sm:p-6">
          <span className="text-[11px] font-bold tracking-wider text-[#0052FF]">CO-SHOW 가상 시장</span>
          <h1 className="mt-2 text-[26px] font-extrabold tracking-tight break-keep">{store.name}</h1>
          <p className="mt-1.5 text-xs font-medium text-slate-500">
            {openedAt ? `${openedAt} 개점 · ` : ""}김대중컨벤션센터
          </p>
          <p className="mt-4 text-sm leading-relaxed text-slate-600 break-keep">&ldquo;{line}&rdquo;</p>
          <div className="mt-5 grid grid-cols-2 border-t border-slate-300 divide-x divide-slate-300">
            {stats.map((s) => (
              <div key={s.label} className="px-3 pt-4 text-center">
                <p className="text-[11px] font-medium text-slate-500">{s.label}</p>
                <p className={`mt-1 text-sm font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
          </div>
        </section>

        {/* AI 도슨트 — 결과 페이지에서 가게 페이지로 옮겼다 */}
        {products.length > 0 && (
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
        )}

        {/* 진열 상품 */}
        <section>
          <div className="flex items-end justify-between mb-3 px-1">
            <div><h2 className="text-lg font-bold tracking-tight text-[#0F172A]">오늘의 진열대</h2><p className="mt-0.5 text-xs text-slate-500">상품을 눌러 자세히 살펴보세요</p></div>
            <span className="text-xs font-semibold text-slate-400">{products.length}개 상품</span>
          </div>
          {products.length === 0 ? (
            <div className={`${APP_CARD} p-8 text-center`}>
              <span className="material-symbols-outlined text-4xl text-slate-300">inventory_2</span>
              <p className="mt-2 text-sm font-semibold text-slate-500">아직 진열한 상품이 없어요.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {products.map((p) => (
                <ProductRow key={p.id} p={p} />
              ))}
            </div>
          )}
        </section>

        <a href={`/market3d.html?shop=${encodeURIComponent(storeId)}`} style={{ backgroundColor: "#0052FF", color: "#FFFFFF" }} className="market-3d-button flex items-center gap-3 rounded-2xl border border-[#0046D6] p-4 shadow-[0_5px_16px_rgba(0,82,255,0.3)] transition hover:-translate-y-0.5 active:scale-[0.98] motion-reduce:transition-none">
          <span className="market-3d-icon material-symbols-outlined rounded-xl bg-white p-2 text-[#0052FF]">view_in_ar</span>
          <span className="flex-1"><span className="block text-sm font-bold">3D 시장 둘러보기</span><span className="mt-0.5 block text-xs text-blue-100">다른 가게도 구경해 보세요</span></span>
          <span className="material-symbols-outlined text-white" aria-hidden="true">chevron_right</span>
        </a>

        {/* 서비스 소개 */}
        <section className={`${APP_CARD} p-5`}>
          <CardTitle icon="storefront">마켓로그는 이런 서비스예요</CardTitle>
          <p className="text-sm leading-relaxed text-slate-600 font-medium">
            사진 한 장으로 AI가 품질 등급을 판정하고 공공 시세와 비교해 보여줘요. 고객은 믿고 사고, 상인은 쉽게 알릴 수 있어요.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              ["photo_camera", "사진 찍기"],
              ["auto_awesome", "AI 등급 판정"],
              ["price_check", "공공 시세 비교"],
            ].map(([icon, label]) => (
              <div key={label} className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] py-3">
                <span className="material-symbols-outlined text-xl text-[#0052FF]">{icon}</span>
                <p className="mt-0.5 text-[11px] font-bold text-slate-600">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <p className="text-center text-xs font-medium text-slate-400 pb-2">
          이 페이지를 즐겨찾기하면 언제든 다시 볼 수 있어요
          <br />
          CO-SHOW 2026 · 팀 테라바이트
        </p>
      </main>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 max-w-[90vw] break-all bg-[#0F172A] text-white text-sm font-bold rounded-full px-4 py-2 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
