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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
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

export interface AnalyzeProductResponse {
  success: boolean;
  data: InspectionResult;
  isFallback?: boolean;
}

export function analyzeProduct(payload: {
  sampleId?: string;
  imageBase64?: string;
}): Promise<AnalyzeProductResponse> {
  return apiFetch<AnalyzeProductResponse>("/api/analyze-product", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface DocentStoryResponse {
  success: boolean;
  script: string;
}

export function fetchDocentStory(payload: {
  marketName: string;
  alleyName?: string;
}): Promise<DocentStoryResponse> {
  return apiFetch<DocentStoryResponse>("/api/docent-story", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface KakaoRegisterResponse {
  success: boolean;
  product: ProductItem;
}

// 판매자(merchant) 계정으로 로그인한 상태여야 호출 가능 (Authorization 토큰 필요).
// 등록되는 상품의 shopName은 로그인 계정의 shop_name으로 서버에서 자동 지정됨.
export function kakaoRegister(payload: {
  chatText?: string;
  imageBase64?: string;
}): Promise<KakaoRegisterResponse> {
  return apiFetch<KakaoRegisterResponse>("/api/kakao-register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---------- 인증 ----------

export interface AuthUser {
  id: string;
  email: string;
  role: "customer" | "merchant";
  displayName: string;
  shopName?: string | null;
}

export interface AuthResponse {
  success: boolean;
  token: string;
  user: AuthUser;
}

export function register(payload: {
  email: string;
  password: string;
  role: "customer" | "merchant";
  displayName: string;
  shopName?: string;
}): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload: { email: string; password: string }): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchMe(): Promise<{ success: boolean; user: AuthUser }> {
  return apiFetch("/api/v1/auth/me");
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

export const API_BASE_URL = API_BASE;
