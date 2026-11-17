// 공공시세(KAMIS) 비교 기준 단위 맞추기.
// 대부분의 품목은 판매 단위와 상관없이 가격을 그대로 시세와 비교하지만, 감귤처럼 시세가 "10개" 기준인
// 품목을 "20개 8,000원"처럼 올리면 10개 가격(4,000원)으로 환산해서 비교해야 한다.
// 단위가 "N개"가 아니면 환산하지 않는다(기존 동작 그대로).

/** 단위 문자열이 "N개"면 N/10, 아니면 1 (시세 기준은 10개). */
export function unitFactor(unit?: string | null): number {
  const m = (unit || "").trim().match(/^(\d+(?:\.\d+)?)\s*개$/);
  const n = m ? Number(m[1]) : 0;
  return n > 0 ? n / 10 : 1;
}

/** 시세와 비교할 수 있도록 10개 기준(해당할 때만)으로 환산한 가격. */
export function priceForCompare(price: number, unit?: string | null): number {
  return price / unitFactor(unit);
}
