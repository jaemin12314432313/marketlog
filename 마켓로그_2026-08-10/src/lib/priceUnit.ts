// 공공시세(KAMIS) 비교 기준 단위 맞추기.
// 공공시세는 kg 품목은 "1kg", 감귤은 "10개" 기준이다. 판매가는 올린 단위(예: 3kg 12,000원, 20개 8,000원)의
// 가격이므로, 시세와 비교할 때는 같은 기준(1kg 또는 10개) 가격으로 환산해야 한다.
// 단위가 "N kg"나 "N개"가 아니면(비어 있거나 다른 단위) 환산하지 않고 가격 그대로 비교한다.
// 직접 입력한 소수(예: 1.5kg, 0.5kg)도 그대로 환산된다.

/** 시세 기준 단위 몇 개 분량인지: "N개" → N/10, "N kg" → N, 그 외 1. */
export function unitFactor(unit?: string | null): number {
  const t = (unit || "").trim();
  let m = t.match(/^(\d+(?:\.\d+)?)\s*개$/);
  if (m && Number(m[1]) > 0) return Number(m[1]) / 10;
  m = t.match(/^(\d+(?:\.\d+)?)\s*kg$/i);
  if (m && Number(m[1]) > 0) return Number(m[1]);
  return 1;
}

/** 시세와 비교할 수 있도록 기준 단위(1kg 또는 10개) 가격으로 환산한 가격. */
export function priceForCompare(price: number, unit?: string | null): number {
  return price / unitFactor(unit);
}

/** 화면에 붙일 시세 기준 라벨: "10개" / "1kg" / 환산 단위가 아니면 null. */
export function unitBasisLabel(unit?: string | null): string | null {
  const t = (unit || "").trim();
  if (/^\d+(?:\.\d+)?\s*개$/.test(t)) return "10개";
  if (/^\d+(?:\.\d+)?\s*kg$/i.test(t)) return "1kg";
  return null;
}
