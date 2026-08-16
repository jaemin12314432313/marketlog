import type { InspectionResult, ProductItem } from "../types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

const AUTH_TOKEN_KEY = "marketlog_auth_token";

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

// 로그인 실패("아이디/비번 틀림")와 네트워크·서버 장애를 화면에서 구분해서 보여줄 수 있도록,
// 상태값을 담아 던진다. status가 없으면 fetch 자체가 실패한 것(네트워크 단절 등),
// isTimeout이면 아래 타임아웃에 걸린 것.
export class ApiError extends Error {
  status?: number;
  isTimeout: boolean;
  constructor(message: string, status?: number, isTimeout = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.isTimeout = isTimeout;
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const token = getAuthToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
      ...init,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new ApiError(`API ${path} timed out after ${timeoutMs}ms`, undefined, true);
    }
    throw new ApiError(`API ${path} network error: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new ApiError(`API ${path} failed: ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

export function fetchFeed(): Promise<ProductItem[]> {
  return apiFetch<ProductItem[]>("/api/v1/consumer/feed");
}

export interface MapStorePin {
  id: string;
  name: string;
  subtitle: string;
  lat: number;
  lng: number;
  category: string;
  icon: string;
  badge_color: string;
  grade: string;
  notice: string;
  notice_time: string;
  alley: string;
  products: { id: string; title: string; price: number; image_url: string }[];
}

export interface MapStoresResponse {
  status: string;
  market_name: string;
  center: { lat: number; lng: number };
  stores: MapStorePin[];
}

export function fetchMapStores(marketName?: string): Promise<MapStoresResponse> {
  const query = marketName ? `?market_name=${encodeURIComponent(marketName)}` : "";
  return apiFetch<MapStoresResponse>(`/api/v1/map/stores${query}`);
}

export interface MapConfig {
  status: string;
  naver_client_id: string;
}

export function fetchMapConfig(): Promise<MapConfig> {
  return apiFetch<MapConfig>("/api/v1/map/config");
}

export interface StoreInfo {
  name: string;
  subtitle: string;
  category: string;
  alley: string;
  phone: string;
  hours: string;
  storyText: string;
}

export function fetchStoreByName(name: string): Promise<{ status: string; store: StoreInfo | null }> {
  return apiFetch(`/api/v1/map/store?name=${encodeURIComponent(name)}`);
}

export interface AnalyzeProductResponse {
  success: boolean;
  data?: InspectionResult;
  isFallback?: boolean;
  // success:false일 때만 내려옴 — 사진에서 농산물을 못 찾은 정상적인 실패 케이스.
  reason?: string;
  hint?: string;
}

export function analyzeProduct(payload: {
  sampleId?: string;
  imageBase64?: string;
}): Promise<AnalyzeProductResponse> {
  // 실제 사진 분석은 모델 최초 로딩(콜드스타트) + CPU 추론 + Gemini 호출이 겹치면
  // 20초 안팎까지 정상적으로 걸릴 수 있어(직접 측정함), 기본 타임아웃보다 넉넉히 잡는다.
  return apiFetch<AnalyzeProductResponse>(
    "/api/analyze-product",
    { method: "POST", body: JSON.stringify(payload) },
    45_000
  );
}

export interface DocentStoryResponse {
  success: boolean;
  script: string;
}

export function fetchDocentStory(payload: {
  marketName: string;
  alleyName?: string;
  storeId?: string;
}): Promise<DocentStoryResponse> {
  return apiFetch<DocentStoryResponse>("/api/docent-story", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---------- 인증 ----------

export interface AuthUser {
  id: string;
  username: string;
  role: "customer" | "merchant";
  displayName: string;
  shopName?: string | null;
  marketId?: string | null;
  phone?: string | null;
  avatarIcon?: string | null;
  avatarColor?: string | null;
  profileImage?: string | null;
}

export interface AuthResponse {
  success: boolean;
  token: string;
  user: AuthUser;
}

export function register(payload: {
  username: string;
  password: string;
  role: "customer" | "merchant";
  displayName: string;
  phone: string;
  shopName?: string;
  marketId?: string;
}): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload: { username: string; password: string }): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchMe(): Promise<{ success: boolean; user: AuthUser }> {
  return apiFetch("/api/v1/auth/me");
}

export function findUsername(payload: { displayName: string; phone: string }): Promise<{ success: boolean; username: string }> {
  return apiFetch("/api/v1/auth/find-username", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resetPassword(payload: {
  username: string;
  displayName: string;
  phone: string;
}): Promise<{ success: boolean; tempPassword: string }> {
  return apiFetch("/api/v1/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateProfile(payload: {
  displayName?: string;
  phone?: string;
  currentPassword?: string;
  newPassword?: string;
  avatarIcon?: string;
  avatarColor?: string;
  profileImage?: string;
}): Promise<{ success: boolean; user: AuthUser }> {
  return apiFetch("/api/v1/auth/me", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// ---------- 저장/찜 ----------

export function fetchBookmarks(): Promise<ProductItem[]> {
  return apiFetch<ProductItem[]>("/api/v1/saved/bookmarks");
}

export function addBookmark(productId: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/saved/bookmarks/${encodeURIComponent(productId)}`, { method: "POST" });
}

export function removeBookmark(productId: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/saved/bookmarks/${encodeURIComponent(productId)}`, { method: "DELETE" });
}

export function fetchScannedProducts(): Promise<ProductItem[]> {
  return apiFetch<ProductItem[]>("/api/v1/saved/scanned");
}

export function addScannedProduct(
  product: Omit<ProductItem, "id">
): Promise<{ success: boolean; product: ProductItem }> {
  return apiFetch("/api/v1/saved/scanned", {
    method: "POST",
    body: JSON.stringify(product),
  });
}

export function removeScannedProduct(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/saved/scanned/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---------- 상인 상품 등록/수정/삭제 ----------

export type MerchantProductInput = Omit<
  ProductItem,
  "id" | "shopName" | "isMerchantUploaded" | "region" | "marketId"
>;

export function createMerchantProduct(
  payload: MerchantProductInput
): Promise<{ success: boolean; product: ProductItem }> {
  return apiFetch("/api/v1/merchant/products", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMerchantProduct(
  id: string,
  payload: MerchantProductInput
): Promise<{ success: boolean; product: ProductItem }> {
  return apiFetch(`/api/v1/merchant/products/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteMerchantProduct(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/merchant/products/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---------- 상인 점포 위치(지도 핀) ----------

export interface StoreLocation {
  id: string;
  lat: number;
  lng: number;
}

export function getStoreLocation(): Promise<{ success: boolean; store: StoreLocation | null }> {
  return apiFetch("/api/v1/merchant/store-location");
}

export function setStoreLocation(payload: { lat: number; lng: number }): Promise<{ success: boolean; store: StoreLocation }> {
  return apiFetch("/api/v1/merchant/store-location", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export interface StoreProfile {
  name: string;
  subtitle: string;
  phone: string;
  hours: string;
  storyText: string;
}

export function getStoreProfile(): Promise<{ success: boolean; profile: StoreProfile | null }> {
  return apiFetch("/api/v1/merchant/store-profile");
}

export function updateStoreProfile(payload: {
  name?: string;
  subtitle?: string;
  phone?: string;
  hours?: string;
  storyText?: string;
}): Promise<{ success: boolean; profile: StoreProfile }> {
  return apiFetch("/api/v1/merchant/store-profile", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export const API_BASE_URL = API_BASE;
