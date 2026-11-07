// 저장용 카드 이미지 2종 — QR "내 가게 페이지"와 같은 심플한 디자인(밝은 배경 + 흰 카드 + 파란 포인트).
//  - makeProductPageCard: 상품 결과 페이지(/r/{id})의 "내 가게 카드 저장" — 그 페이지 내용 전체
//  - makeShopSummaryCard: 내 가게 페이지(/s/{id})의 "요약본 저장" — 가게 전체
import QRCode from "qrcode";
import { boothResultImageUrl, type BoothProduct } from "./boothApi";

const W = 1080;
const H = 1350;
const FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const BLUE = "#0052FF";
const NAVY = "#0F172A";
const BG = "#F5F6F8";
const SLATE_500 = "#64748B";
const SLATE_400 = "#94A3B8";
const LINE = "#EEF0F3";
const PAD = 64; // 카드 바깥 여백
const CW = W - PAD * 2; // 카드 폭

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

// 글자가 maxW를 넘으면 글자 크기를 줄여서 한 줄에 맞춘다.
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxW: number) {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (s > 22 && ctx.measureText(text).width > maxW) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
}

function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  // 자간 지원 브라우저(크롬 등)에서만 적용된다.
  (ctx as any).letterSpacing = `${px}px`;
}

function dateText(value?: string | null) {
  const d = value ? new Date(value) : new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function diffPercent(p: BoothProduct) {
  return p.publicPrice ? Math.round(((p.publicPrice - p.price) / p.publicPrice) * 100) : null;
}

// 가게 한줄평 — 진열 상품 데이터(특상 수·시세 대비·품목)로 문장을 만든다. 페이지와 요약 이미지가 같이 쓴다.
export function shopOneLiner(products: BoothProduct[]): string {
  if (products.length === 0) return "곧 첫 상품을 진열할 새 가게";
  const premium = products.filter((p) => p.grade === "A+").length;
  const diffs = products.map(diffPercent).filter((d): d is number => d != null);
  const avg = diffs.length ? Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length) : null;
  const items = Array.from(new Set(products.map((p) => p.title.trim()).filter(Boolean))).slice(0, 2).join("·");
  const quality =
    premium === products.length ? "모든 상품이 AI 특상" : premium > 0 ? `AI 특상 ${premium}개를 갖춘` : "AI 품질 인증을 받은";
  const price = avg == null ? "" : avg > 0 ? `시세보다 평균 ${avg}% 저렴한` : avg < 0 ? "품질에 자신 있는" : "시세 그대로 정직한";
  const head = premium === products.length && price ? `${quality},` : quality;
  return [head, price, `${items || "과일"} 가게`].filter(Boolean).join(" ");
}

// 흰 카드(살짝 그림자)
function whiteCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 40) {
  ctx.save();
  ctx.shadowColor = "rgba(15,23,42,0.06)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#FFFFFF";
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

// 둥근 배지(글자 + 배경). 오른쪽 끝 x를 돌려준다.
function pill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { size?: number; color: string; bg: string; dot?: string; alignRight?: boolean }
) {
  const size = opts.size ?? 26;
  ctx.font = `800 ${size}px ${FONT}`;
  const dotW = opts.dot ? size * 0.5 + 10 : 0;
  const w = ctx.measureText(text).width + size * 1.2 + dotW;
  const h = size * 1.75;
  const left = opts.alignRight ? x - w : x;
  ctx.fillStyle = opts.bg;
  roundRect(ctx, left, y, w, h, h / 2);
  ctx.fill();
  if (opts.dot) {
    ctx.fillStyle = opts.dot;
    ctx.beginPath();
    ctx.arc(left + size * 0.6 + size * 0.25, y + h / 2, size * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = opts.color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + size * 0.6 + dotW, y + h / 2 + 1);
  ctx.textBaseline = "alphabetic";
  return left + w;
}

function gradePill(ctx: CanvasRenderingContext2D, grade: string, x: number, y: number, confidence?: number | null, size = 26) {
  const premium = grade === "A+";
  const text = `AI ${premium ? "특상" : "보통"}${confidence != null ? ` · ${confidence}%` : ""}`;
  return pill(ctx, text, x, y, {
    size,
    color: premium ? "#047857" : "#B45309",
    bg: premium ? "#ECFDF5" : "#FFFBEB",
    dot: premium ? "#10B981" : "#F59E0B",
  });
}

// 가게 머리 카드: 파란 띠 + 영문 머리말 + No. 배지 + 가게 이름 + 부제
// 카드 아래쪽(통계 등)을 이어 그릴 수 있게, 머리 부분이 끝나는 y를 돌려준다.
function drawShopHead(
  ctx: CanvasRenderingContext2D,
  y: number,
  cardH: number,
  shopName: string,
  shopNumber: number,
  sub: string,
  nameSize: number,
  qr?: HTMLImageElement | null
) {
  whiteCard(ctx, PAD, y, CW, cardH);
  // 위쪽 파란 띠(카드 모서리 안쪽으로 잘림)
  ctx.save();
  roundRect(ctx, PAD, y, CW, cardH, 40);
  ctx.clip();
  const grad = ctx.createLinearGradient(PAD, 0, PAD + CW, 0);
  grad.addColorStop(0, BLUE);
  grad.addColorStop(1, "#6EA8FF");
  ctx.fillStyle = grad;
  ctx.fillRect(PAD, y, CW, 12);
  ctx.restore();

  const x = PAD + 56;
  ctx.textAlign = "left";
  ctx.fillStyle = SLATE_400;
  ctx.font = `700 24px ${FONT}`;
  setSpacing(ctx, 5);
  ctx.fillText("CO-SHOW VIRTUAL MARKET", x, y + 82);
  setSpacing(ctx, 0);
  pill(ctx, `No.${shopNumber}`, PAD + CW - 56, y + 50, { size: 26, color: BLUE, bg: "#EEF4FF", alignRight: true });

  // No. 배지 아래 작은 QR(가게 페이지로 연결)
  const qrSize = 132;
  if (qr) {
    const qx = PAD + CW - 56 - qrSize;
    const qy = y + 112;
    ctx.drawImage(qr, qx, qy, qrSize, qrSize);
    ctx.textAlign = "center";
    ctx.fillStyle = SLATE_400;
    ctx.font = `600 18px ${FONT}`;
    ctx.fillText("가게 보러 가기", qx + qrSize / 2, qy + qrSize + 26);
    ctx.textAlign = "left";
  }

  ctx.fillStyle = NAVY;
  fitFont(ctx, shopName, 900, nameSize, CW - 112 - (qr ? qrSize + 32 : 0));
  ctx.fillText(shopName, x, y + 82 + 40 + nameSize);
  const nameBottom = y + 82 + 40 + nameSize;

  ctx.fillStyle = SLATE_500;
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText(sub, x, nameBottom + 52);
  return nameBottom + 52;
}

function drawFooter(ctx: CanvasRenderingContext2D, height: number) {
  const y = height - 56;
  ctx.textAlign = "left";
  ctx.fillStyle = BLUE;
  ctx.font = `900 34px ${FONT}`;
  ctx.fillText("MarketLog", PAD + 8, y);
  ctx.textAlign = "right";
  ctx.fillStyle = SLATE_400;
  ctx.font = `600 24px ${FONT}`;
  ctx.fillText("사진 한 장으로 AI가 품질을 증명하는 전통시장", W - PAD - 8, y - 2);
  ctx.textAlign = "left";
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("이미지 생성 실패"))), "image/png")
  );
}

async function drawProductImage(ctx: CanvasRenderingContext2D, productId: string, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  try {
    const img = await loadImage(boothResultImageUrl(productId));
    drawCover(ctx, img, x, y, w, h);
  } catch {
    ctx.fillStyle = "#E2E8F0";
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

export function shopCardFileName(product: BoothProduct, shopNumber: number) {
  return `마켓로그_${shopNumber}번_${product.shopName}.png`;
}

// 폰의 공유 창으로 이미지 파일을 넘긴다(https 주소에서만 됨). 공유 창을 못 띄우면 false.
export async function shareCardFile(blob: Blob, fileName: string, title: string): Promise<boolean> {
  const file = new File([blob], fileName, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (!nav.canShare?.({ files: [file] }) || !/Android|iPhone|iPad/i.test(navigator.userAgent)) return false;
  try {
    await nav.share({ files: [file], title });
    return true;
  } catch (err: any) {
    return err?.name === "AbortError";
  }
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// 링크 복사: http 주소에서는 navigator.clipboard가 막혀 있어서 예전 방식으로도 시도한다.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 아래 방식으로 다시 시도 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// ---------- 가게 요약본(가게 전체) ----------
// 가게 머리 카드(이름·번호·개점일 + 통계 3칸) + 진열 상품 목록(최대 4개).
export async function makeShopSummaryCard(
  shopName: string,
  shopNumber: number,
  products: BoothProduct[],
  openedAt?: string | null,
  shopUrl?: string,
  tagline?: string | null
): Promise<Blob> {
  await (document as any).fonts?.ready?.catch?.(() => {});

  let qr: HTMLImageElement | null = null;
  if (shopUrl) {
    try {
      qr = await loadImage(
        await QRCode.toDataURL(shopUrl, { width: 400, margin: 1, errorCorrectionLevel: "M", color: { dark: NAVY, light: "#FFFFFF" } })
      );
    } catch {
      qr = null;
    }
  }

  const shown = products.slice(0, 4);
  const rowH = 168;
  const rowGap = 20;
  const headH = 470;
  const listTop = PAD + headH + 96;
  const listH = shown.length ? shown.length * rowH + (shown.length - 1) * rowGap : 140;
  const lineBoxH = 96; // 진열대 아래 한줄평 박스
  const lineTop = listTop + listH + 32;
  const CH = Math.max(1080, lineTop + lineBoxH + 150);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = CH;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, CH);

  // 머리 카드 + 통계
  const subBottom = drawShopHead(ctx, PAD, headH, shopName, shopNumber, `AI 품질 인증 과일가게 · ${dateText(openedAt)} 개점`, 84, qr);

  const statTop = subBottom + 44;
  ctx.fillStyle = LINE;
  ctx.fillRect(PAD, statTop, CW, 2);

  const premium = products.filter((p) => p.grade === "A+").length;
  const diffs = products.map(diffPercent).filter((d): d is number => d != null);
  const avgDiff = diffs.length ? Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length) : null;
  const stats: [string, string, string][] = [
    ["진열 상품", `${products.length}개`, NAVY],
    ["AI 특상", `${premium}개`, "#059669"],
    [
      "시세 대비",
      avgDiff == null ? "-" : avgDiff > 0 ? `${avgDiff}% 저렴` : avgDiff < 0 ? `${-avgDiff}% 높음` : "시세 수준",
      avgDiff != null && avgDiff > 0 ? BLUE : NAVY,
    ],
  ];
  const colW = CW / 3;
  const statBottom = PAD + headH;
  stats.forEach(([label, value, color], i) => {
    const cx = PAD + i * colW;
    if (i > 0) {
      ctx.fillStyle = LINE;
      ctx.fillRect(cx, statTop, 2, statBottom - statTop);
    }
    ctx.fillStyle = SLATE_400;
    ctx.font = `600 24px ${FONT}`;
    ctx.fillText(label, cx + 48, statTop + 52);
    ctx.fillStyle = color;
    fitFont(ctx, value, 800, 40, colW - 80);
    ctx.fillText(value, cx + 48, statTop + 102);
  });

  // 진열 상품 목록
  ctx.fillStyle = NAVY;
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText("오늘의 진열대", PAD + 8, listTop - 30);
  ctx.textAlign = "right";
  ctx.fillStyle = SLATE_400;
  ctx.font = `600 24px ${FONT}`;
  ctx.fillText(products.length > 4 ? `${products.length}개 중 4개` : `${products.length}개 상품`, W - PAD - 8, listTop - 32);
  ctx.textAlign = "left";

  if (shown.length === 0) {
    whiteCard(ctx, PAD, listTop, CW, 140, 32);
    ctx.fillStyle = SLATE_400;
    ctx.font = `600 28px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("아직 진열한 상품이 없어요", W / 2, listTop + 80);
    ctx.textAlign = "left";
  }

  for (let i = 0; i < shown.length; i++) {
    const p = shown[i];
    const y = listTop + i * (rowH + rowGap);
    whiteCard(ctx, PAD, y, CW, rowH, 32);
    const thumb = rowH - 36;
    await drawProductImage(ctx, p.id, PAD + 18, y + 18, thumb, thumb, 22);

    const tx = PAD + 18 + thumb + 32;
    const right = PAD + CW - 40;
    // 가격(오른쪽)을 먼저 재서 이름이 겹치지 않게 한다
    ctx.font = `900 42px ${FONT}`;
    const priceText = `${p.price.toLocaleString("ko-KR")}원`;
    const priceW = ctx.measureText(priceText).width;

    ctx.fillStyle = NAVY;
    fitFont(ctx, p.title, 800, 36, right - tx - priceW - 40);
    ctx.fillText(p.title, tx, y + 64);
    gradePill(ctx, p.grade, tx, y + 88, null, 22);

    ctx.textAlign = "right";
    ctx.fillStyle = BLUE;
    ctx.font = `900 42px ${FONT}`;
    ctx.fillText(priceText, right, y + 76);
    const diff = diffPercent(p);
    if (diff != null && diff !== 0) {
      ctx.fillStyle = diff > 0 ? "#059669" : "#E11D48";
      ctx.font = `700 22px ${FONT}`;
      ctx.fillText(diff > 0 ? `시세보다 ${diff}% 저렴` : `시세보다 ${-diff}% 높음`, right, y + 116);
    }
    ctx.textAlign = "left";
  }

  // 한줄평(진열대 아래, 연파랑 박스 + 왼쪽 파란 막대)
  const line = tagline?.trim() || shopOneLiner(products);
  ctx.fillStyle = "#EAF1FF";
  roundRect(ctx, PAD, lineTop, CW, lineBoxH, 28);
  ctx.fill();
  ctx.fillStyle = BLUE;
  roundRect(ctx, PAD + 32, lineTop + 26, 6, lineBoxH - 52, 3);
  ctx.fill();
  ctx.fillStyle = NAVY;
  fitFont(ctx, `“${line}”`, 700, 30, CW - 120);
  ctx.textBaseline = "middle";
  ctx.fillText(`“${line}”`, PAD + 62, lineTop + lineBoxH / 2 + 1);
  ctx.textBaseline = "alphabetic";

  drawFooter(ctx, CH);
  return toBlob(canvas);
}

// ---------- 상품 페이지 전체(/r/{id}의 "내 가게 카드 저장") ----------
// 페이지 내용 그대로 한 장에: 가게 머리 카드(QR) → 상품(작은 사진·등급·가격·설명·태그)
// → AI 품질 판정(속성 막대·종합 의견) → 공공 시세 비교 → AI 도슨트.

// AttributeBars와 같은 기준: 특상·적음이 가장 좋고, 중·많음이 가장 나쁘다.
const ATTR_RANK: Record<string, 0 | 1 | 2> = { 특상: 0, 적음: 0, 상: 1, 보통: 1, 중: 2, 많음: 2 };
const ATTR_COLOR = ["#10B981", "#F59E0B", "#F87171"];
const ATTR_WIDTH = [0.92, 0.62, 0.3];

// 띄어쓰기 단위로 줄바꿈하고, 한 단어가 너무 길면 글자 단위로 자른다.
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxW) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      let chunk = "";
      for (const ch of word) {
        if (ctx.measureText(chunk + ch).width > maxW) {
          lines.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawParagraph(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 99) {
  let lines = wrapLines(ctx, text, maxW);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{1,2}$/, "…");
  }
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineH));
  return y + (lines.length - 1) * lineH;
}

function sectionTitle(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.fillStyle = BLUE;
  ctx.font = `800 28px ${FONT}`;
  ctx.fillText(text, x, y);
}

export async function makeProductPageCard(
  product: BoothProduct,
  store: { name: string; number: number; openedAt: string | null },
  docent?: string | null,
  pageUrl?: string
): Promise<Blob> {
  await (document as any).fonts?.ready?.catch?.(() => {});

  let qr: HTMLImageElement | null = null;
  if (pageUrl) {
    try {
      qr = await loadImage(
        await QRCode.toDataURL(pageUrl, { width: 400, margin: 1, errorCorrectionLevel: "M", color: { dark: NAVY, light: "#FFFFFF" } })
      );
    } catch {
      qr = null;
    }
  }

  // 높이를 미리 알 수 없으니 넉넉한 캔버스에 그린 뒤 실제 높이만큼 잘라낸다.
  const big = document.createElement("canvas");
  big.width = W;
  big.height = 4200;
  const ctx = big.getContext("2d")!;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, big.height);
  const x = PAD + 48;
  const innerW = CW - 96;
  const right = PAD + CW - 48;
  const GAP = 28;

  // 1) 가게 머리 카드
  const headH = 300;
  drawShopHead(ctx, PAD, headH, store.name, store.number, `AI 품질 인증 과일가게 · ${dateText(store.openedAt)} 개점`, 76, qr);
  let y = PAD + headH + GAP;

  // 카드 하나를 그리는 공통 순서: 내용 높이를 먼저 계산 → 흰 카드 → 내용
  const card = async (height: number, draw: (top: number) => Promise<void> | void) => {
    whiteCard(ctx, PAD, y, CW, height, 36);
    await draw(y);
    y += height + GAP;
  };

  // 2) 상품: 작은 사진 + 이름·등급·가격 / 설명 / 태그
  const thumb = 200;
  ctx.font = `700 30px ${FONT}`;
  const descLines = product.description ? wrapLines(ctx, `“${product.description}”`, innerW).slice(0, 3) : [];
  const tags = (product.tags || "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 4);
  const productH = 48 + thumb + (descLines.length ? 36 + descLines.length * 44 : 0) + (tags.length ? 72 : 0) + 44;
  await card(productH, async (top) => {
    await drawProductImage(ctx, product.id, x, top + 48, thumb, thumb, 28);
    const tx = x + thumb + 36;
    ctx.fillStyle = NAVY;
    fitFont(ctx, product.title, 900, 52, right - tx);
    ctx.fillText(product.title, tx, top + 48 + 56);
    const meta = [product.origin, product.unit].filter(Boolean).join(" · ");
    if (meta) {
      ctx.fillStyle = SLATE_400;
      ctx.font = `600 24px ${FONT}`;
      ctx.fillText(meta, tx, top + 48 + 96);
    }
    gradePill(ctx, product.grade, tx, top + 48 + 114, product.gradeConfidencePercent, 22);
    ctx.fillStyle = BLUE;
    ctx.font = `900 48px ${FONT}`;
    const priceText = `${product.price.toLocaleString("ko-KR")}원`;
    ctx.fillText(priceText, tx, top + 48 + thumb - 4);
    if (product.publicPrice > product.price) {
      const pw = ctx.measureText(priceText).width;
      const pub = `${product.publicPrice.toLocaleString("ko-KR")}원`;
      ctx.fillStyle = SLATE_400;
      ctx.font = `600 26px ${FONT}`;
      const px = tx + pw + 18;
      ctx.fillText(pub, px, top + 48 + thumb - 8);
      ctx.strokeStyle = SLATE_400;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(px, top + 48 + thumb - 17);
      ctx.lineTo(px + ctx.measureText(pub).width, top + 48 + thumb - 17);
      ctx.stroke();
    }
    let cy = top + 48 + thumb;
    if (descLines.length) {
      ctx.fillStyle = NAVY;
      ctx.font = `700 30px ${FONT}`;
      descLines.forEach((l, i) => ctx.fillText(l, x, cy + 36 + 34 + i * 44));
      cy += 36 + descLines.length * 44;
    }
    if (tags.length) {
      let px = x;
      for (const t of tags) {
        const label = t.startsWith("#") ? t : `#${t}`;
        ctx.font = `800 24px ${FONT}`;
        if (px + ctx.measureText(label).width + 40 > right) break;
        px = pill(ctx, label, px, cy + 24, { size: 24, color: BLUE, bg: "#EEF4FF" }) + 12;
      }
    }
  });

  // 3) AI 품질 판정: 속성 막대 + 종합 의견
  const attrs = Object.entries(product.attributeLabels || {});
  ctx.font = `500 28px ${FONT}`;
  const summaryLines = product.aiSummary ? wrapLines(ctx, product.aiSummary, innerW - 48).slice(0, 5) : [];
  const qualityH = 48 + 40 + attrs.length * 76 + (summaryLines.length ? 32 + summaryLines.length * 42 + 44 : 0) + 40;
  if (attrs.length || summaryLines.length) {
    await card(qualityH, (top) => {
      sectionTitle(ctx, "AI 품질 판정", x, top + 64);
      let cy = top + 64 + 34;
      for (const [name, info] of attrs) {
        const rank = ATTR_RANK[(info as any).grade] ?? 1;
        ctx.fillStyle = "#334155";
        ctx.font = `700 26px ${FONT}`;
        ctx.fillText(name, x, cy + 26);
        ctx.textAlign = "right";
        ctx.fillStyle = ATTR_COLOR[rank];
        ctx.fillText((info as any).grade, right, cy + 26);
        ctx.textAlign = "left";
        ctx.fillStyle = "#E2E8F0";
        roundRect(ctx, x, cy + 40, innerW, 14, 7);
        ctx.fill();
        ctx.fillStyle = ATTR_COLOR[rank];
        roundRect(ctx, x, cy + 40, innerW * ATTR_WIDTH[rank], 14, 7);
        ctx.fill();
        cy += 76;
      }
      if (summaryLines.length) {
        const boxH = summaryLines.length * 42 + 44;
        ctx.fillStyle = "#F8FAFC";
        roundRect(ctx, x, cy + 20, innerW, boxH, 24);
        ctx.fill();
        ctx.fillStyle = "#475569";
        ctx.font = `500 28px ${FONT}`;
        summaryLines.forEach((l, i) => ctx.fillText(l, x + 24, cy + 20 + 50 + i * 42));
      }
    });
  }

  // 4) 공공 시세 비교
  if (product.publicPrice > 0) {
    await card(250, (top) => {
      sectionTitle(ctx, "공공 시세 비교", x, top + 64);
      const boxW = (innerW - 20) / 2;
      const boxes: [string, number, string][] = [
        ["우리 가게", product.price, BLUE],
        ["공공 시세", product.publicPrice, NAVY],
      ];
      boxes.forEach(([label, value, color], i) => {
        const bx = x + i * (boxW + 20);
        ctx.fillStyle = "#F8FAFC";
        roundRect(ctx, bx, top + 92, boxW, 110, 22);
        ctx.fill();
        ctx.fillStyle = SLATE_400;
        ctx.font = `600 22px ${FONT}`;
        ctx.fillText(label, bx + 24, top + 92 + 38);
        ctx.fillStyle = color;
        ctx.font = `900 40px ${FONT}`;
        ctx.fillText(`${value.toLocaleString("ko-KR")}원`, bx + 24, top + 92 + 88);
      });
      const diff = diffPercent(product);
      if (diff != null && diff !== 0) {
        ctx.textAlign = "right";
        ctx.fillStyle = diff > 0 ? "#059669" : "#E11D48";
        ctx.font = `800 24px ${FONT}`;
        ctx.fillText(diff > 0 ? `공공 시세보다 ${diff}% 저렴` : `공공 시세보다 ${-diff}% 높음`, right, top + 64);
        ctx.textAlign = "left";
      }
    });
  }

  // 5) AI 도슨트
  if (docent && docent.trim()) {
    ctx.font = `500 28px ${FONT}`;
    const lines = wrapLines(ctx, docent.trim(), innerW).slice(0, 8);
    await card(48 + 40 + 24 + lines.length * 44 + 36, (top) => {
      sectionTitle(ctx, "AI 도슨트", x, top + 64);
      ctx.fillStyle = "#334155";
      ctx.font = `500 28px ${FONT}`;
      lines.forEach((l, i) => ctx.fillText(l, x, top + 64 + 58 + i * 44));
    });
  }

  // 아래 여백 + 꼬리말, 실제 높이로 잘라내기
  const height = Math.max(1080, y + 100);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = height;
  const out = canvas.getContext("2d")!;
  out.drawImage(big, 0, 0);
  drawFooter(out, height);
  return toBlob(canvas);
}
