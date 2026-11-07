// CO-SHOW 부스 전용 API 클라이언트. 로그인 없이 쓰므로 인증 토큰을 붙이지 않는다.
import type { AttributeGradeLabel, InspectionResult, ProductItem } from "../types";
import { Capacitor } from "@capacitor/core";
import { API_BASE_URL, analyzeProduct } from "../lib/api";

// 입장 화면의 관람객 유형 칩 — 백엔드 VISITOR_TYPES와 같은 값이어야 한다.
export const VISITOR_TYPES = ["초등학생", "중고등학생", "대학생", "일반", "교사·기관", "기업"] as const;

export class BoothApiError extends Error {
  status?: number;
  isNetwork: boolean;
  constructor(message: string, status?: number, isNetwork = false) {
    super(message);
    this.status = status;
    this.isNetwork = isNetwork;
  }
}

async function boothFetch<T>(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      signal: controller.signal,
    });
  } catch {
    throw new BoothApiError("인터넷 연결이 불안정해요. 잠시 후 다시 시도해주세요.", undefined, true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = "잠시 후 다시 시도해주세요.";
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* 본문이 JSON이 아니면 기본 문구를 쓴다 */
    }
    throw new BoothApiError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

export type AttributeLabels = Record<string, { grade: AttributeGradeLabel; confidence: number }>;

export interface BoothProduct extends ProductItem {
  shopNumber: number | null;
  gradeConfidencePercent: number | null;
}

export interface BoothPin {
  storeId: string;
  name: string;
  lat: number;
  lng: number;
  grade: string;
  number: number;
}

export interface BoothStats {
  totalShops: number;
  totalProducts: number;
  todayProducts: number;
  premiumPercent: number;
  itemCounts: Record<string, number>;
  qrViews: number;
}

export interface BoothFeed {
  center: { lat: number; lng: number };
  products: BoothProduct[];
  pins: BoothPin[];
  stats: BoothStats;
}

export interface BoothShopInfo {
  id: string;
  name: string;
  number: number;
  openedAt: string | null;
  tagline?: string | null; // 우리 가게 한마디(없으면 자동 한줄평)
}

export const boothApi = {
  warmup: () => boothFetch<{ modelsLoaded: boolean; loading: boolean }>("/api/v1/booth/warmup", undefined, 10_000),

  // 앱 부스 모드: 가게 + 임시 상인 계정을 만들고 로그인 토큰을 받는다.
  openShop: (shopName: string, visitorType: string, affiliation = "", tagline = "") =>
    boothFetch<{
      token: string;
      user: {
        role: "customer" | "merchant";
        displayName: string;
        shopName: string | null;
        username: string;
        phone: string | null;
        profileImage: string | null;
        marketId: string | null;
      };
      shopNumber: number;
      storeId: string;
    }>("/api/v1/booth/open-shop", { method: "POST", body: JSON.stringify({ shopName, visitorType, affiliation, tagline }) }),

  // 이미 있는 부스 가게로 다시 들어가기
  enterShop: (shopName: string, tagline = "") =>
    boothFetch<Awaited<ReturnType<typeof boothApi.openShop>>>("/api/v1/booth/enter-shop", {
      method: "POST",
      body: JSON.stringify({ shopName, tagline }),
    }),

  checkName: (shopName: string) =>
    boothFetch<{ shopName: string }>("/api/v1/booth/check-name", {
      method: "POST",
      body: JSON.stringify({ shopName }),
    }),

  // 기존 AI 스캔 API를 그대로 쓴다(로그인 불필요). 실패 사유(reason/hint)를 그대로 돌려준다.
  analyze: async (imageBase64: string): Promise<
    { ok: true; data: InspectionResult } | { ok: false; reason: string; hint: string }
  > => {
    try {
      const res = await analyzeProduct({ imageBase64 });
      if (res.success && res.data) return { ok: true, data: res.data };
      return {
        ok: false,
        reason: res.reason || "과일을 찾지 못했어요.",
        hint: res.hint || "과일이 화면 가운데에 크게 나오도록 다시 찍어주세요.",
      };
    } catch (err: any) {
      return {
        ok: false,
        reason: err?.isTimeout ? "AI 분석 시간이 너무 오래 걸렸어요." : "인터넷 연결이 불안정해요.",
        hint: "잠시 후 다시 촬영해주세요.",
      };
    }
  },

  productCopy: (title: string, shopName: string) =>
    boothFetch<{ descriptions: string[]; hashtags: string[]; isFallback: boolean }>(
      "/api/v1/booth/product-copy",
      { method: "POST", body: JSON.stringify({ title, category: "과일", shopName }) },
      25_000
    ),

  register: (payload: Record<string, unknown>) =>
    boothFetch<{ product: BoothProduct; shopNumber: number }>(
      "/api/v1/booth/register",
      { method: "POST", body: JSON.stringify(payload) },
      40_000
    ),

  feed: (limit = 20) => boothFetch<BoothFeed>(`/api/v1/booth/feed?limit=${limit}`, undefined, 15_000),

  // preview=true: 태블릿에서 미리 보는 경우라 QR 조회 수에 넣지 않는다.
  result: (productId: string, preview = false) =>
    boothFetch<{ product: BoothProduct; store: { name: string; number: number; openedAt: string | null } }>(
      `/api/v1/booth/result/${encodeURIComponent(productId)}${preview ? "?preview=1" : ""}`
    ),

  // 내 가게 페이지(QR): 가게 정보 + 진열 상품 전체. preview=true면 방문 수에 넣지 않는다.
  shop: (storeId: string, preview = false) =>
    boothFetch<{ store: BoothShopInfo; products: BoothProduct[] }>(
      `/api/v1/booth/shop/${encodeURIComponent(storeId)}${preview ? "?preview=1" : ""}`
    ),

  docent: (productId: string) =>
    boothFetch<{ script: string }>(`/api/v1/booth/result/${encodeURIComponent(productId)}/docent`, undefined, 30_000),

  // 성과 집계용 기록 — 실패해도 체험 흐름에는 영향을 주지 않는다.
  event: (type: "session_start" | "scan_success" | "scan_fail" | "register_fail", detail?: string) => {
    boothFetch("/api/v1/booth/events", { method: "POST", body: JSON.stringify({ type, detail }) }).catch(() => {});
  },

  hide: (productId: string, adminKey: string) =>
    boothFetch(`/api/v1/booth/products/${encodeURIComponent(productId)}`, {
      method: "DELETE",
      headers: { "X-Booth-Key": adminKey },
    }),
};

// "내 가게 카드 저장"에 쓰는 가게 사진 주소(같은 서버를 거쳐서 받아야 이미지로 합칠 수 있다).
export function boothResultImageUrl(productId: string): string {
  return `${API_BASE_URL}/api/v1/booth/result/${encodeURIComponent(productId)}/image`;
}

// QR 결과 페이지 주소. 부스 화면이 열린 주소(배포 서버)를 기준으로 만든다.
// 로컬 테스트용: 태블릿 화면을 localhost로 열었을 때 폰이 접속할 수 있는 주소를
// ?qrBase=http://PC내부IP:3000 으로 넘기면 QR이 그 주소를 가리킨다.
export function resultPageUrl(productId: string): string {
  const override = new URLSearchParams(window.location.search).get("qrBase");
  const base = (override || window.location.origin).replace(/\/$/, "");
  return `${base}/r/${productId}`;
}

// QR에 넣을 공개 주소의 앞부분(https://도메인). 설치형 앱(안드로이드) 안에서는 화면 주소가 폰 밖에서
// 열 수 없는 앱 내부 주소라서 서버 주소를 쓰고, 로컬 테스트면 PC의 내부 IP로 바꾼다.
async function publicBase(): Promise<string> {
  const override = new URLSearchParams(window.location.search).get("qrBase");
  let base = override || (Capacitor.isNativePlatform() ? API_BASE_URL : window.location.origin);
  // 로컬 테스트: 화면을 localhost로 열면 QR에도 localhost가 들어가 폰에서 안 열린다 →
  // 서버 PC의 내부 네트워크 IP로 바꿔 넣는다.
  if (!override && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
    try {
      const { ip } = await boothFetch<{ ip: string | null }>("/api/v1/booth/lan-ip", undefined, 3000);
      if (ip) base = `${window.location.protocol}//${ip}${window.location.port ? `:${window.location.port}` : ""}`;
    } catch {
      /* 못 얻으면 그대로 */
    }
  }
  return base.replace(/\/$/, "");
}

// 내 가게 페이지(/s/{가게 id})
export async function shopPageUrl(storeId: string): Promise<string> {
  return `${await publicBase()}/s/${storeId}`;
}

// 3D 가상 시장 — storeId가 있으면 그 가게 앞에서 시작한다.
export async function market3dUrl(storeId?: string): Promise<string> {
  return `${await publicBase()}/market3d.html${storeId ? `?shop=${encodeURIComponent(storeId)}` : ""}`;
}
