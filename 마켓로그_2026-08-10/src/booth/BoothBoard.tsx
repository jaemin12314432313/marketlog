// CO-SHOW 부스 대형 모니터 화면 (/booth/board).
// 김대중컨벤션센터를 중심으로 한 가상 시장 지도 + 실시간 소비자 피드 + 누적 통계를 상시 송출한다.
// 몇 초마다 서버를 다시 읽어서, 태블릿에서 막 등록된 상품을 맨 위에 띄우고 지도에서 그 가게로 이동한다.
// 스태프용: 주소 뒤에 ?admin=관리키 를 붙이면 카드마다 "숨기기" 버튼이 생긴다.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { fetchMapConfig } from "../lib/api";
import { boothApi, type BoothFeed, type BoothPin, type BoothProduct } from "./boothApi";
import { BrandMark, GradeBadge, gradeText, priceDiffText, won } from "./boothUi";

const POLL_MS = 3000;
const SPOTLIGHT_MS = 8000;
const NAVER_SCRIPT_ID = "naver-map-sdk-booth";

declare global {
  interface Window {
    naver?: any;
    navermap_authFailure?: () => void;
  }
}

function timeAgo(iso?: string | null, now = Date.now()): string {
  if (!iso) return "";
  const sec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (sec < 60) return "방금 전";
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  return `${Math.floor(sec / 86400)}일 전`;
}

export default function BoothBoard() {
  const adminKey = new URLSearchParams(window.location.search).get("admin") || "";
  const [feed, setFeed] = useState<BoothFeed | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [spotlight, setSpotlight] = useState<BoothProduct | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const knownIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      try {
        const data = await boothApi.feed(20);
        if (cancelled) return;
        setIsOffline(false);
        // 처음 불러올 때는 기존 상품을 "새 상품"으로 취급하지 않는다.
        if (knownIdsRef.current) {
          const fresh = data.products.filter((p) => !knownIdsRef.current!.has(p.id));
          if (fresh.length > 0) {
            setSpotlight(fresh[0]);
            setFreshIds(new Set(fresh.map((p) => p.id)));
          }
        }
        knownIdsRef.current = new Set(data.products.map((p) => p.id));
        setFeed(data);
      } catch {
        if (!cancelled) setIsOffline(true);
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!spotlight) return;
    const timer = window.setTimeout(() => setSpotlight(null), SPOTLIGHT_MS);
    return () => clearTimeout(timer);
  }, [spotlight]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hide = async (p: BoothProduct) => {
    if (!window.confirm(`"${p.shopName}" 가게를 화면에서 숨길까요?`)) return;
    try {
      await boothApi.hide(p.id, adminKey);
      setFeed((prev) => prev && { ...prev, products: prev.products.filter((x) => x.id !== p.id) });
    } catch (err: any) {
      alert(err?.message || "숨기기에 실패했습니다.");
    }
  };

  // 새로 들어온 상품 표시(NEW, 지도 핀 강조)는 30초 뒤 자연스럽게 사라진다.
  useEffect(() => {
    if (freshIds.size === 0) return;
    const timer = window.setTimeout(() => setFreshIds(new Set()), 30_000);
    return () => clearTimeout(timer);
  }, [freshIds]);

  const freshStoreIds = useMemo(
    () => new Set((feed?.products || []).filter((p) => freshIds.has(p.id)).map((p) => p.storeId || "")),
    [feed, freshIds]
  );

  const stats = feed?.stats;
  const clock = new Date(now).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="h-[100dvh] w-full bg-[#0B1220] text-white flex flex-col overflow-hidden">
      <header className="flex items-center gap-6 px-8 py-4 border-b border-white/10">
        <BrandMark dark />
        <div className="flex-1">
          <p className="text-sm font-bold text-sky-300 flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${isOffline ? "bg-amber-400" : "bg-rose-500 animate-pulse"}`} />
            {isOffline ? "재연결 중..." : "LIVE"}
          </p>
          <h1 className="text-3xl font-black tracking-tight">CO-SHOW 가상 시장 실시간 전광판</h1>
        </div>
        <div className="flex gap-3">
          <StatTile label="문을 연 가게" value={stats?.totalShops} unit="곳" />
          <StatTile label="진열된 상품" value={stats?.totalProducts} unit="개" />
          <StatTile label="오늘 등록" value={stats?.todayProducts} unit="개" />
          <StatTile label="AI 특상 판정" value={stats?.premiumPercent} unit="%" />
        </div>
        <p className="text-3xl font-black tabular-nums text-white/80 whitespace-nowrap text-right">{clock}</p>
      </header>

      <div className="flex-1 flex min-h-0">
        <section className="relative flex-[3] min-w-0">
          <MarketMap
            center={feed?.center}
            pins={feed?.pins || []}
            focusStoreId={spotlight?.storeId || null}
            freshStoreIds={freshStoreIds}
          />
          <div className="absolute top-4 left-4 rounded-2xl bg-black/60 backdrop-blur px-4 py-3">
            <p className="text-xs font-bold text-white/60">지도 중심</p>
            <p className="font-extrabold">김대중컨벤션센터</p>
          </div>
          {stats && Object.keys(stats.itemCounts).length > 0 && (
            <div className="absolute top-4 right-4 rounded-2xl bg-black/60 backdrop-blur px-4 py-3 min-w-44">
              <p className="text-xs font-bold text-white/60 mb-1">많이 진열된 과일</p>
              {Object.entries(stats.itemCounts).map(([item, count]) => (
                <p key={item} className="flex justify-between font-bold gap-6">
                  <span>{item}</span>
                  <span className="tabular-nums text-sky-300">{count}</span>
                </p>
              ))}
            </div>
          )}
          {spotlight && <SpotlightCard product={spotlight} />}
        </section>

        <aside className="flex-[2] min-w-0 flex flex-col border-l border-white/10 bg-[#0F172A]">
          <div className="px-6 pt-5 pb-3 flex items-end justify-between">
            <div>
              <p className="text-sm font-bold text-white/50">소비자 피드</p>
              <p className="text-2xl font-black">방금 진열된 상품</p>
            </div>
            <p className="text-sm text-white/50 font-semibold">AI 검증 등급 · 공공 시세 비교</p>
          </div>
          <div className="flex-1 overflow-hidden px-4 pb-4 space-y-3">
            {feed && feed.products.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-white/50 gap-3">
                <span className="material-symbols-outlined text-6xl">storefront</span>
                <p className="text-xl font-bold">첫 번째 가게의 주인공이 되어보세요!</p>
              </div>
            )}
            {feed?.products.map((p) => (
              <FeedCard
                key={p.id}
                product={p}
                isFresh={freshIds.has(p.id)}
                now={now}
                onHide={adminKey ? () => hide(p) : undefined}
              />
            ))}
          </div>
        </aside>
      </div>

      <footer className="bg-[#0052FF] px-8 py-3 flex items-center gap-4 overflow-hidden">
        <span className="material-symbols-outlined text-3xl">campaign</span>
        <p className="text-xl font-bold whitespace-nowrap">
          사장님이 사진 한 장만 찍어 올리면, 소비자는 AI가 검증한 등급과 실시간 공공 시세를 비교하며 믿고 구매할 수
          있습니다.
        </p>
        <p className="ml-auto text-lg font-extrabold whitespace-nowrap bg-white/15 rounded-full px-4 py-1">
          👉 옆 태블릿에서 나만의 과일가게를 만들어보세요
        </p>
      </footer>
    </div>
  );
}

function StatTile({ label, value, unit }: { label: string; value?: number; unit: string }) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-2 min-w-32">
      <p className="text-xs font-bold text-white/55">{label}</p>
      <p className="text-3xl font-black tabular-nums">
        {value ?? "–"}
        <span className="text-base font-bold text-white/60 ml-0.5">{unit}</span>
      </p>
    </div>
  );
}

const FeedCard: React.FC<{
  product: BoothProduct;
  isFresh: boolean;
  now: number;
  onHide?: () => void;
}> = ({ product: p, isFresh, now, onHide }) => {
  const diff = priceDiffText(p.price, p.publicPrice);
  const tags = (p.tags || "").split(",").filter(Boolean).slice(0, 3);
  return (
    <article
      className={`flex gap-4 rounded-2xl p-3 transition-all duration-700 ${
        isFresh ? "bg-sky-500/20 ring-2 ring-sky-400" : "bg-white/[0.04]"
      }`}
    >
      <img src={p.imageUrl} alt="" className="w-28 h-28 rounded-xl object-cover bg-white/10 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {isFresh && <span className="text-xs font-black bg-rose-500 rounded px-1.5 py-0.5">NEW</span>}
          <p className="text-sm font-bold text-white/55 truncate">
            No.{p.shopNumber} · {p.shopName}
          </p>
          <p className="ml-auto text-xs text-white/40 shrink-0">{timeAgo(p.createdAt, now)}</p>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-2xl font-black truncate">{p.title}</p>
          <GradeBadge grade={p.grade} confidence={p.gradeConfidencePercent} />
        </div>
        <p className="mt-1 text-lg font-extrabold">
          {won(p.price)}
          <span className="text-sm font-semibold text-white/45"> / 1kg · 공공 시세 {won(p.publicPrice)}</span>
        </p>
        <div className="flex items-center gap-2 mt-1">
          {diff.text && (
            <span className={`text-sm font-bold ${diff.tone === "good" ? "text-emerald-300" : diff.tone === "high" ? "text-rose-300" : "text-white/60"}`}>
              {diff.text}
            </span>
          )}
          <span className="text-sm text-sky-300/80 truncate">{tags.join(" ")}</span>
          {onHide && (
            <button onClick={onHide} className="ml-auto text-xs font-bold text-rose-300 border border-rose-300/50 rounded px-2 py-0.5">
              숨기기
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

function SpotlightCard({ product: p }: { product: BoothProduct }) {
  return (
    <div className="absolute left-1/2 bottom-8 -translate-x-1/2 w-[min(92%,760px)] rounded-3xl bg-white text-slate-900 shadow-2xl p-5 flex gap-5 items-center animate-[booth-pop_0.5s_ease-out]">
      <style>{`@keyframes booth-pop{0%{transform:translate(-50%,40px) scale(.9);opacity:0}100%{transform:translate(-50%,0) scale(1);opacity:1}}`}</style>
      <img src={p.imageUrl} alt="" className="w-36 h-36 rounded-2xl object-cover shrink-0" />
      <div className="min-w-0">
        <p className="text-lg font-bold text-[#0052FF]">🎉 {p.shopNumber}번째 가게가 문을 열었어요!</p>
        <p className="text-4xl font-black truncate">{p.shopName}</p>
        <div className="flex items-center gap-3 mt-2">
          <p className="text-2xl font-extrabold">{p.title}</p>
          <GradeBadge grade={p.grade} confidence={p.gradeConfidencePercent} size="lg" />
        </div>
        <p className="mt-1 text-lg font-semibold text-slate-500">
          AI 판정 {gradeText(p.grade)} · {won(p.price)} / 1kg · {priceDiffText(p.price, p.publicPrice).text}
        </p>
      </div>
    </div>
  );
}

// ---------- 지도 ----------
// 네이버 지도를 우선 쓰고, SDK 로드/인증에 실패하면(전시장 도메인 미등록, 네트워크 문제)
// 같은 핀을 그린 간단한 그림 지도로 자동 전환해서 화면이 비지 않게 한다.
function MarketMap({
  center,
  pins,
  focusStoreId,
  freshStoreIds,
}: {
  center?: { lat: number; lng: number };
  pins: BoothPin[];
  focusStoreId: string | null;
  freshStoreIds: Set<string>;
}) {
  const [mode, setMode] = useState<"loading" | "naver" | "fallback">("loading");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const fail = () => !cancelled && setMode("fallback");
    window.navermap_authFailure = fail;
    const timeout = window.setTimeout(() => {
      if (!window.naver?.maps) fail();
    }, 12_000);
    if (window.naver?.maps) {
      setMode("naver");
    } else if (!document.getElementById(NAVER_SCRIPT_ID)) {
      fetchMapConfig()
        .then((config) => {
          const script = document.createElement("script");
          script.id = NAVER_SCRIPT_ID;
          script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${config.naver_client_id}`;
          script.onload = () => !cancelled && setMode("naver");
          script.onerror = fail;
          document.head.appendChild(script);
        })
        .catch(fail);
    }
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (mode !== "naver" || !center || !containerRef.current || mapRef.current) return;
    const { naver } = window;
    try {
      mapRef.current = new naver.maps.Map(containerRef.current, {
        center: new naver.maps.LatLng(center.lat, center.lng),
        zoom: 18,
        mapTypeId: naver.maps.MapTypeId.NORMAL,
        zoomControl: false,
        scaleControl: false,
        logoControlOptions: { position: naver.maps.Position.BOTTOM_LEFT },
      });
      new naver.maps.Marker({
        map: mapRef.current,
        position: new naver.maps.LatLng(center.lat, center.lng),
        icon: {
          content:
            '<div style="transform:translate(-50%,-50%);background:#0F172A;color:#fff;font-weight:800;padding:8px 14px;border-radius:999px;border:3px solid #38BDF8;white-space:nowrap;font-size:15px;box-shadow:0 6px 18px rgba(0,0,0,.35)">📍 김대중컨벤션센터 · 마켓로그 부스</div>',
        },
        zIndex: 1,
      });
    } catch {
      setMode("fallback");
    }
  }, [mode, center]);

  // 핀 갱신 — 새로 생긴 가게만 추가하고, 숨겨진 가게는 지운다.
  useEffect(() => {
    if (mode !== "naver" || !mapRef.current) return;
    const { naver } = window;
    const alive = new Set(pins.map((p) => p.storeId));
    markersRef.current.forEach((marker, id) => {
      if (!alive.has(id)) {
        marker.setMap(null);
        markersRef.current.delete(id);
      }
    });
    pins.forEach((pin) => {
      const fresh = freshStoreIds.has(pin.storeId);
      const content = pinHtml(pin, fresh);
      const existing = markersRef.current.get(pin.storeId);
      if (existing) {
        existing.setIcon({ content });
        existing.setZIndex(fresh ? 1000 : 10);
        return;
      }
      markersRef.current.set(
        pin.storeId,
        new naver.maps.Marker({
          map: mapRef.current,
          position: new naver.maps.LatLng(pin.lat, pin.lng),
          icon: { content },
          zIndex: fresh ? 1000 : 10,
        })
      );
    });
  }, [mode, pins, freshStoreIds]);

  useEffect(() => {
    if (mode !== "naver" || !mapRef.current || !focusStoreId) return;
    const pin = pins.find((p) => p.storeId === focusStoreId);
    if (pin) mapRef.current.panTo(new window.naver.maps.LatLng(pin.lat, pin.lng), { duration: 800 });
  }, [mode, focusStoreId, pins]);

  if (mode === "fallback") {
    return <FallbackMap center={center} pins={pins} freshStoreIds={freshStoreIds} />;
  }
  return (
    <div className="absolute inset-0 bg-slate-800">
      <div ref={containerRef} className="absolute inset-0" />
      {mode === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-white/50 font-bold">지도를 불러오는 중...</div>
      )}
    </div>
  );
}

function pinHtml(pin: BoothPin, fresh: boolean): string {
  const color = pin.grade === "A+" ? "#10B981" : "#F59E0B";
  const name = pin.name.replace(/[<>&"]/g, "");
  const scale = fresh ? 1.35 : 1;
  const ring = fresh ? "box-shadow:0 0 0 6px rgba(56,189,248,.55),0 6px 16px rgba(0,0,0,.35);" : "box-shadow:0 4px 10px rgba(0,0,0,.3);";
  return `<div style="transform:translate(-50%,-100%) scale(${scale});transform-origin:bottom center;display:flex;flex-direction:column;align-items:center;">
    <div style="background:#fff;color:#0F172A;border:3px solid ${color};border-radius:12px;padding:3px 8px;font-weight:800;font-size:13px;white-space:nowrap;${ring}">
      <span style="color:${color}">${pin.number}</span> ${name}
    </div>
    <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${color};"></div>
  </div>`;
}

function FallbackMap({
  center,
  pins,
  freshStoreIds,
}: {
  center?: { lat: number; lng: number };
  pins: BoothPin[];
  freshStoreIds: Set<string>;
}) {
  const span = useMemo(() => {
    if (!center) return 0.001;
    const max = pins.reduce((m, p) => Math.max(m, Math.abs(p.lat - center.lat), Math.abs(p.lng - center.lng)), 0);
    return Math.max(max * 1.15, 0.0004);
  }, [pins, center]);
  if (!center) return <div className="absolute inset-0 bg-slate-900" />;
  const toPos = (lat: number, lng: number) => ({
    left: `${50 + ((lng - center.lng) / span) * 45}%`,
    top: `${50 - ((lat - center.lat) / span) * 45}%`,
  });
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at 50% 50%, #1E3A5F 0%, #0B1220 70%), repeating-linear-gradient(0deg, transparent 0 39px, rgba(255,255,255,.04) 39px 40px)",
      }}
    >
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-24 rounded-3xl border-2 border-sky-400/60 bg-sky-400/10 flex items-center justify-center text-center">
        <p className="font-extrabold text-sky-200 text-sm">
          김대중컨벤션센터
          <br />
          마켓로그 부스
        </p>
      </div>
      {pins.map((pin) => {
        const fresh = freshStoreIds.has(pin.storeId);
        const color = pin.grade === "A+" ? "#10B981" : "#F59E0B";
        return (
          <div
            key={pin.storeId}
            className="absolute transition-transform"
            style={{ ...toPos(pin.lat, pin.lng), zIndex: fresh ? 10 : 1, transform: `translate(-50%,-100%) scale(${fresh ? 1.3 : 1})` }}
          >
            <div
              className={`rounded-xl bg-white text-slate-900 font-extrabold text-xs px-2 py-1 whitespace-nowrap border-[3px] ${fresh ? "animate-bounce" : ""}`}
              style={{ borderColor: color }}
            >
              <span style={{ color }}>{pin.number}</span> {pin.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
