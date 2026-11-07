// QR로 여는 "내 가게 페이지" (/s/{가게 id}).
// 관람객이 부스에서 연 가게와 진열한 상품 전체를 앱 설치 없이 보고, 요약본 이미지로 저장할 수 있다.
// 화면 모양은 마켓로그 앱과 같게(appUi.tsx) 맞춘다.
import React, { useEffect, useState } from "react";
import { boothApi, type BoothProduct, type BoothShopInfo } from "./boothApi";
import { copyText, downloadBlob, makeShopSummaryCard, shareCardFile, shopOneLiner } from "./shopCard";
import {
  APP_BG,
  APP_CARD,
  AppHeader,
  BTN_DARK,
  BTN_PRIMARY,
  CardTitle,
  GradePill,
  HeaderIconButton,
} from "./appUi";

// 앱의 "등록 상품" 목록과 같은 가로형 상품 카드 — 누르면 상품 페이지(/r/{id})
function ProductRow({ p }: { p: BoothProduct; key?: React.Key }) {
  const pct = p.publicPrice > 0 ? Math.round(((p.publicPrice - p.price) / p.publicPrice) * 100) : null;
  const meta = [p.origin, p.unit].filter(Boolean).join(" · ");
  return (
    <a href={`/r/${p.id}`} className={`${APP_CARD} flex items-center gap-4 p-3.5 active:scale-[0.99] transition`}>
      <div className="relative w-[84px] h-[84px] shrink-0 rounded-xl overflow-hidden border border-[#E2E8F0] bg-slate-100">
        <img src={p.imageUrl} alt={p.title} className="w-full h-full object-cover" />
        <span className="absolute top-1.5 left-1.5 scale-90 origin-top-left">
          <GradePill grade={p.grade} solid />
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
          {pct != null && pct > 0 && (
            <span className="text-[11px] font-semibold text-[#0052FF] bg-blue-50 px-1.5 py-0.5 rounded-full">{pct}% 저렴</span>
          )}
        </div>
      </div>
      <span className="material-symbols-outlined text-slate-300">chevron_right</span>
    </a>
  );
}

export default function BoothShopPage({ storeId }: { storeId: string }) {
  const [data, setData] = useState<{ store: BoothShopInfo; products: BoothProduct[] } | null>(null);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [cardPreview, setCardPreview] = useState<{ url: string; blob: Blob; name: string } | null>(null);

  useEffect(() => {
    boothApi
      .shop(storeId)
      .then((res) => {
        setData(res);
        document.title = `${res.store.name} · CO-SHOW 가상 시장 | 마켓로그`;
      })
      .catch((err) => setError(err?.status === 404 ? "가게를 찾을 수 없어요." : "잠시 후 다시 열어주세요."));
  }, [storeId]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const closePreview = () => {
    if (cardPreview) URL.revokeObjectURL(cardPreview.url);
    setCardPreview(null);
  };

  const saveCard = async () => {
    if (!data || isSaving) return;
    setIsSaving(true);
    try {
      const blob = await makeShopSummaryCard(
        data.store.name,
        data.store.number,
        data.products,
        data.store.openedAt,
        `${window.location.origin}/s/${storeId}`,
        data.store.tagline
      );
      const name = `마켓로그_${data.store.number}번_${data.store.name}.png`;
      const shared = await shareCardFile(blob, name, `${data.store.name} · CO-SHOW 가상 시장`);
      if (!shared) setCardPreview({ url: URL.createObjectURL(blob), blob, name });
    } catch {
      setToast("저장하지 못했어요. 화면을 캡처해주세요");
    } finally {
      setIsSaving(false);
    }
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
  const diffs = products.filter((p) => p.publicPrice > 0).map((p) => Math.round(((p.publicPrice - p.price) / p.publicPrice) * 100));
  const avgDiff = diffs.length ? Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length) : null;
  const stats = [
    { label: "진열 상품", value: `${products.length}개`, color: "text-[#0F172A]" },
    { label: "AI 특상", value: `${premiumCount}개`, color: "text-[#10B981]" },
    {
      label: "시세 대비",
      value: avgDiff == null ? "-" : avgDiff > 0 ? `${avgDiff}% 저렴` : avgDiff < 0 ? `${-avgDiff}% 높음` : "시세 수준",
      color: avgDiff != null && avgDiff > 0 ? "text-[#0052FF]" : "text-[#0F172A]",
    },
  ];
  const line = store.tagline?.trim() || shopOneLiner(products);

  return (
    <div className={`min-h-[100dvh] ${APP_BG} text-[#0F172A] pb-10`}>
      <AppHeader right={<HeaderIconButton icon="ios_share" label="공유" onClick={share} />} />

      <main className="max-w-md mx-auto px-4 pt-5 space-y-5">
        {/* 가게 정보 */}
        <section className={`${APP_CARD} p-5`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#0052FF]">CO-SHOW 가상 시장</span>
            <span className="text-[11px] font-extrabold text-[#0052FF] bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1">
              No.{store.number}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight break-keep">{store.name}</h1>
          <p className="mt-1 text-xs font-medium text-slate-400">
            {openedAt ? `${openedAt} 개점 · ` : ""}김대중컨벤션센터
          </p>
          <div className="mt-4 grid grid-cols-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] divide-x divide-[#E2E8F0]">
            {stats.map((s) => (
              <div key={s.label} className="px-3 py-2.5">
                <p className="text-[10px] font-bold text-slate-500">{s.label}</p>
                <p className={`text-sm font-extrabold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 버튼 */}
        <div className="space-y-2.5">
          <button onClick={saveCard} disabled={isSaving} className={BTN_PRIMARY}>
            <span className="material-symbols-outlined text-lg">download</span>
            {isSaving ? "요약본 만드는 중..." : "내 가게 요약본 저장하기"}
          </button>
          <a href={`/market3d.html?shop=${encodeURIComponent(storeId)}`} className={BTN_DARK}>
            <span className="material-symbols-outlined text-lg">view_in_ar</span>
            3D 시장에서 다른 가게 구경하기
          </a>
        </div>

        {/* 진열 상품 */}
        <section>
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-sm font-extrabold text-[#0F172A]">진열 상품 ({products.length})</h2>
            <span className="text-xs font-semibold text-slate-400">누르면 자세히 보기</span>
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

        {/* 우리 가게 한마디 — 앱의 "사장님 한마디"와 같은 모양 */}
        <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
          <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-700 mb-1.5">
            <span className="material-symbols-outlined text-base">chat_bubble</span>
            우리 가게 한마디
          </div>
          <p className="text-sm text-slate-700 leading-relaxed font-semibold break-keep">&ldquo;{line}&rdquo;</p>
        </section>

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

      {cardPreview && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-5 gap-4" onClick={closePreview}>
          <p className="text-white font-extrabold text-center">
            이미지를 <span className="text-[#FDE68A]">길게 눌러</span> &lsquo;이미지 저장&rsquo;을 선택하세요
          </p>
          <img src={cardPreview.url} alt="내 가게 카드" className="max-h-[68vh] w-auto rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
          <div className="flex gap-2 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => downloadBlob(cardPreview.blob, cardPreview.name)} className={BTN_PRIMARY}>
              <span className="material-symbols-outlined">download</span>파일로 받기
            </button>
            <button onClick={closePreview} className="px-6 py-3 rounded-xl bg-white/15 text-white font-extrabold">
              닫기
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 max-w-[90vw] break-all bg-[#0F172A] text-white text-sm font-bold rounded-full px-4 py-2 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
