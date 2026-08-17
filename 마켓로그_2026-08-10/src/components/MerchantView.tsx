import React, { useState, useRef, useEffect } from "react";
import { ProductItem } from "../types";
import { getStoreLocation, getStoreProfile, analyzeProduct, generateProductCopy } from "../lib/api";
import { MerchantAiScanModal } from "./MerchantAiScanModal";

function formatRegisteredDate(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

// 비전 파이프라인이 2단계(특상/보통) 등급으로 바뀌어서, 화면에도 A+/B 같은 영문 등급
// 대신 실제 판정 체계와 맞는 한글 표기를 쓴다 (HomeFeed 등과 동일 규칙).
function displayGrade(grade: string): string {
  return grade === "A+" ? "특상" : "보통";
}

// HomeFeed와 동일한 규칙 — 원산지/단위를 따로 뱃지로 흩어놓지 않고 "[국내산] 완도
// 양배추 1kg"처럼 하나의 문장으로 합친다. 사장님이 자기 상품 목록에서 보는 이름이
// 실제 소비자 피드에 뜨는 이름과 다르면("배추"만 보이는데 피드엔 "완도 양배추 1kg")
// 헷갈리므로 같은 조합 규칙을 그대로 쓴다.
function formatProductDisplayTitle(product: ProductItem): string {
  const [originType, originDetail] = (product.origin || "").split(" · ").map((s) => s.trim());
  const typePart = originType ? `[${originType}] ` : "";
  const detailPart = originDetail ? `${originDetail} ` : "";
  const unitPart = product.unit ? ` ${product.unit}` : "";
  return `${typePart}${detailPart}${product.title}${unitPart}`;
}

// 상품명에 "완도산 전복 (1kg)"처럼 무게/수량을 같이 적어버리면 공공시세 비교 같은 걸 짤 때
// 텍스트를 파싱해야 해서 애를 먹는다 — 그래서 단위를 상품명과 분리된 필드로 따로 받는다.
// 단위는 항상 kg로 고정한다 — 상인마다 개/포기/마리 등 다른 단위를 쓰면 공공시세(kg 기준)
// 대비 할인율 비교가 서로 다른 기준으로 뒤섞여서 의미가 없어진다.
const PRODUCT_UNIT = "kg";

// 상품 목록에 저장된 "1.5kg" 같은 값에서 수량만 다시 뽑아 입력칸에 채워준다. 예전에
// 다른 단위(개/포기 등)로 저장된 값이어도 앞의 숫자만 취하고 단위는 kg로 맞춘다.
function parseProductUnitAmount(unit: string): string {
  const match = unit.trim().match(/^(\d+(?:\.\d+)?)/);
  return match ? match[1] : "1";
}

// 가격 입력창에 숫자를 치면 바로 천 단위 콤마가 붙게 한다 — 0을 잘못 눌러도 자릿수가
// 한눈에 보여서 실수를 줄일 수 있다.
function formatPriceInput(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString();
}

// 원산지도 상품명에 "완도산"처럼 수식어로 섞어 쓰지 않고 별도 필드로 받는다 —
// 대분류(국내산/수입산) + 상세 지역(필수)을 "국내산 · 완도" 형태 문자열로 합쳐 저장한다.
const PRODUCT_ORIGIN_OPTIONS = ["국내산", "수입산"];

function parseProductOrigin(origin: string): { type: string; detail: string } {
  const trimmed = origin.trim();
  if (!trimmed) return { type: PRODUCT_ORIGIN_OPTIONS[0], detail: "" };
  const match = trimmed.match(/^(.+?)\s*·\s*(.+)$/);
  if (match && PRODUCT_ORIGIN_OPTIONS.includes(match[1].trim())) {
    return { type: match[1].trim(), detail: match[2].trim() };
  }
  if (PRODUCT_ORIGIN_OPTIONS.includes(trimmed)) {
    return { type: trimmed, detail: "" };
  }
  return { type: PRODUCT_ORIGIN_OPTIONS[0], detail: trimmed };
}

function buildProductOrigin(type: string, detail: string): string {
  const trimmedDetail = detail.trim();
  return trimmedDetail ? `${type} · ${trimmedDetail}` : type;
}

// 카테고리별로 AI가 골라줄 법한 짧은 키워드 태그 — getAiRecommendations(문장 3개)와는 별개로,
// 상품 설명 아래에 다중 선택 칩으로 보여준다. 스캔 전엔 이 중 앞 3개를 회색 스켈레톤으로
// 미리 보여주고, 스캔 후엔 카테고리에 맞는 실제 태그 세트가 활성화된다. 풀을 넉넉히(8개)
// 두고 "새로고침"을 누를 때마다 시작 위치를 옮겨서 다른 조합 5개가 보이게 한다 — AI 추천
// 설명 카드의 새로고침과 같은 패턴.
const AI_TAG_SUGGESTIONS: Record<string, string[]> = {
  수산물: ["#싱싱한", "#당일조업", "#쫄깃한", "#손질완료", "#자연산", "#급냉", "#탱글탱글", "#고소한"],
  정육: ["#육즙가득", "#부드러운", "#당일정육", "#1등급", "#숙성", "#마블링", "#국내산", "#야들야들"],
  과일: ["#달콤한", "#아삭한", "#당도높은", "#산지직송", "#제철과일", "#새콤달콤", "#과즙가득", "#당일수확"],
  야채: ["#아삭한", "#무농약", "#신선한", "#산지직송", "#유기농", "#아침수확", "#저온보관", "#싱그러운"],
  건어물: ["#바삭한", "#감칠맛", "#자연건조", "#짭짤한", "#고소한", "#국내산", "#숙성건조", "#술안주"],
};
const AI_TAG_SUGGESTIONS_DEFAULT = ["#신선한", "#산지직송", "#인기상품", "#오늘특가", "#추천상품", "#가성비", "#단골추천", "#품절임박"];

function getAiRecommendedTags(rawCategory: string, index: number): string[] {
  const pool = AI_TAG_SUGGESTIONS[rawCategory] || AI_TAG_SUGGESTIONS_DEFAULT;
  const offset = (index * 3) % pool.length;
  return [...pool.slice(offset), ...pool.slice(0, offset)].slice(0, 5);
}

interface MerchantViewProps {
  products: ProductItem[];
  userDisplayName: string;
  marketName: string;
  onOpenAiScan: () => void;
  onAddProduct: (product: ProductItem) => Promise<boolean>;
  onUpdateProduct?: (product: ProductItem) => Promise<boolean>;
  onDeleteProduct: (id: string) => Promise<boolean>;
  onOpenLogin: () => void;
  onSelectProduct: (product: ProductItem) => void;
  // 작성 중인 등록/수정 폼에 실제 입력이 있는지 부모(App.tsx)에게 알린다 — 안드로이드
  // 뒤로가기가 이 화면에서 바로 앱을 백그라운드로 보내버리기 전에 확인을 받기 위함.
  onFormDirtyChange?: (dirty: boolean) => void;
}

export const MerchantView: React.FC<MerchantViewProps> = ({
  products,
  userDisplayName,
  marketName,
  onOpenAiScan,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  onOpenLogin,
  onSelectProduct,
  onFormDirtyChange,
}) => {
  const shopName = userDisplayName || "양동수산";
  // null = 아직 확인 전, true/false = 실제로 위치가 등록돼 있는지. 이게 없으면 이미
  // 저장에 성공해도 화면엔 항상 "등록해주세요"만 보여서 등록됐는지 알 길이 없었다.
  const [hasStoreLocation, setHasStoreLocation] = useState<boolean | null>(null);
  // 위치는 있어도 전화번호/영업시간이 비어있으면 상품은 있는데 연락할 방법이 없는
  // 반쪽짜리 점포가 된다 — 신규 상품 등록은 이 세 가지가 다 채워졌을 때만 허용한다.
  const [hasStoreContactInfo, setHasStoreContactInfo] = useState<boolean | null>(null);
  // marketName은 userMarketId가 있을 때만 채워진다 — 시장 선택 기능이 생기기 전에 가입한
  // 예전 계정은 hasStoreLocation/hasStoreContactInfo가 이미 true라도 소속 전통시장을 아직
  // 안 골랐을 수 있어서, 이걸 빼먹으면 시장 미선택 상태로 계속 상품이 등록되는 문제가 있었다.
  const canRegisterProducts = hasStoreLocation && hasStoreContactInfo && Boolean(marketName);

  const refreshStoreReadiness = () => {
    getStoreLocation()
      .then((res) => setHasStoreLocation(Boolean(res.store)))
      .catch((err) => console.error("점포 위치 확인 실패", err));
    getStoreProfile()
      .then((res) =>
        setHasStoreContactInfo(Boolean(res.profile?.phone?.trim() && res.profile?.hours?.trim()))
      )
      .catch((err) => console.error("점포 연락처 확인 실패", err));
  };

  useEffect(() => {
    refreshStoreReadiness();
  }, []);

  // Form states for manual registration — 기본은 접힌 상태로 시작해서, 앱을 열자마자
  // 등록 폼이 화면을 다 채우는 대신 아래 "등록된 상품 리스트"부터 스크롤 없이 보이게 한다.
  // 새 상품을 등록할 때만 눌러서 펼치면 된다.
  const [isFormOpen, setIsFormOpen] = useState(false);
  // 등록 상품 리스트도 아코디언으로 접었다 펼 수 있게 한다 — 기본은 펼쳐둬서(등록 폼과
  // 반대) 굳이 눌러야만 상품 목록이 보이는 일은 없게 한다.
  const [isProductListOpen, setIsProductListOpen] = useState(true);
  const [isMerchantScanOpen, setIsMerchantScanOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<ProductItem | null>(null);
  const [title, setTitle] = useState("");
  const [unitAmount, setUnitAmount] = useState("1");
  const [originType, setOriginType] = useState(PRODUCT_ORIGIN_OPTIONS[0]);
  const [originDetail, setOriginDetail] = useState("");
  const [category, setCategory] = useState<ProductItem["category"]>("수산물");
  const [price, setPrice] = useState<number | "">("");
  const [publicPrice, setPublicPrice] = useState<number | "">("");
  const [description, setDescription] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [grade, setGrade] = useState<ProductItem["grade"]>("A+");
  const [freshnessScore, setFreshnessScore] = useState<number>(95);
  const [defectScore, setDefectScore] = useState<number>(2);
  const [uniformityScore, setUniformityScore] = useState<number>(95);
  const [imageUrl, setImageUrl] = useState("");
  // 카메라 AI 스캔에서 실제로 받은 제미나이 종합의견 — 있을 때만 상세페이지에 "AI 스캔
  // 종합 의견"이 표시된다. "AI 추천 설명" 3개 중 고르는 홍보문구(description)와는 별개.
  const [aiSummary, setAiSummary] = useState<string | undefined>(undefined);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    const isDirty = Boolean(title.trim() || price || description.trim() || imageUrl.trim());
    onFormDirtyChange?.(isDirty);
  }, [title, price, description, imageUrl, onFormDirtyChange]);

  // AI Recommendation for Description state
  const [recommendationSetIndex, setRecommendationSetIndex] = useState(0);
  const [tagSetIndex, setTagSetIndex] = useState(0);
  // 스캔 직후 우리 점포 정보(주요 품목/소속 시장)를 근거로 Gemini가 실제로 생성한
  // 문구/해시태그. null이면 아직 안 왔거나 실패한 것 — 그 경우 아래 getAiRecommendations/
  // getAiRecommendedTags 정적 템플릿이 그대로 폴백으로 쓰인다.
  const [aiDescriptions, setAiDescriptions] = useState<string[] | null>(null);
  const [aiHashtags, setAiHashtags] = useState<string[] | null>(null);
  const [isGeneratingCopy, setIsGeneratingCopy] = useState(false);

  const requestAiCopy = async (scanTitle: string, scanCategory: string) => {
    setIsGeneratingCopy(true);
    try {
      const res = await generateProductCopy(scanTitle, scanCategory);
      if (res.success && res.descriptions?.length) {
        setAiDescriptions(res.descriptions);
        setDescription(res.descriptions[0]);
      }
      if (res.success && res.hashtags?.length) {
        setAiHashtags(res.hashtags);
      }
    } catch (err) {
      console.error("AI 문구 생성 실패 (정적 추천으로 대체됨)", err);
    } finally {
      setIsGeneratingCopy(false);
    }
  };

  const getAiRecommendations = (rawTitle: string, rawCategory: string, index: number) => {
    const name = rawTitle.trim() || `${rawCategory || "인기"} 상품`;
    const market = marketName || "전통시장";
    const sets = [
      [
        `오늘 새벽 산지에서 직송되어 신선함이 남다른 ${name}입니다! 신선도와 맛이 최고예요 👍`,
        `${market} 단골 손님들이 가장 많이 찾으시는 인기 폭발 ${name}! 자신 있게 추천합니다 🔥`,
        `가성비와 신선함 모두 잡았습니다. ${name} 오늘 특별 할인가로 ${market}에서 만나보세요 ✨`,
      ],
      [
        `산지 직송으로 밭/바다의 신선함을 그대로 담은 ${name}입니다. 선물용으로도 적극 추천합니다! 🎁`,
        `오늘만 이 가격! 매일 조기 품절되는 아주 귀하고 신선한 ${name}입니다. 놓치지 마세요 ⚡`,
        `사장님이 직접 하나하나 까다롭게 엄선한 최상품 ${name}! 품질 백퍼센트 보증합니다 💯`,
      ],
      [
        `새벽 경매에서 최고의 품질로 낙찰받아 가져온 ${name}! 오늘 저녁 맛있는 식탁에 올려보세요 🍲`,
        `믿고 먹는 ${market} 사장님 대표 상품! ${name} 제철이라 맛과 풍미가 더욱 풍부합니다 🌟`,
        `신선함은 기본, 푸짐한 양과 특가 혜택까지! ${name} 수량 소진 시 조기 마감됩니다 ⏳`,
      ],
      [
        `당도와 신선도 정밀 보장! ${name} 사장님이 품질만을 고집하여 정성껏 엄선하였습니다 👍`,
        `온 가족이 함께 안심하고 즐길 수 있는 산뜻한 ${name}, 맛과 신선도 모두 자신있게 추천드립니다 ❤️`,
        `단골 고객들의 연이은 재구매 요청! ${name} 실물 보러 ${market} 매장으로 방문해 보세요 🛒`,
      ],
    ];
    return sets[index % sets.length];
  };

  const formRef = useRef<HTMLFormElement | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const handleEditProduct = (p: ProductItem) => {
    setEditingProductId(p.id);
    setTitle(p.title);
    setUnitAmount(parseProductUnitAmount(p.unit || ""));
    const parsedOrigin = parseProductOrigin(p.origin || "");
    setOriginType(parsedOrigin.type);
    setOriginDetail(parsedOrigin.detail);
    setCategory(p.category);
    setPrice(p.price);
    setPublicPrice(p.publicPrice || "");
    setDescription(p.description || "");
    setSelectedTags(p.tags ? p.tags.split(",").filter(Boolean) : []);
    setGrade(p.grade || "A+");
    setFreshnessScore(p.freshnessScore || 95);
    setDefectScore(p.defectScore ?? 2);
    setUniformityScore(p.uniformityScore ?? 95);
    setImageUrl(p.imageUrl || "");

    // 신선도/등급은 그날그날 실물 상태를 찍은 사진 기준이라, 등록한 날짜가 오늘이
    // 아니면 그 데이터는 이미 낡은 정보다 — 이 경우 aiSummary를 비워서 "재스캔 전엔
    // 저장 불가" 규칙(신규 등록과 동일한 게이트)이 그대로 걸리게 한다. 같은 날 안에
    // 오타 고치는 정도의 수정까지 매번 재스캔을 요구하진 않는다.
    const registeredDate = p.createdAt ? new Date(p.createdAt).toDateString() : null;
    const isStale = registeredDate !== new Date().toDateString();
    setAiSummary(isStale ? undefined : p.aiSummary);
    if (isStale) {
      showToast("이 상품은 오늘 등록된 게 아니라서, 수정하려면 AI 스캔을 다시 해야 합니다.");
    }
    setAiDescriptions(null);
    setAiHashtags(null);

    setIsFormOpen(true);

    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const handleCancelEdit = () => {
    setEditingProductId(null);
    setTitle("");
    setUnitAmount("1");
    setOriginType(PRODUCT_ORIGIN_OPTIONS[0]);
    setOriginDetail("");
    setCategory("수산물");
    setPrice("");
    setPublicPrice("");
    setDescription("");
    setSelectedTags([]);
    setGrade("A+");
    setFreshnessScore(95);
    setDefectScore(2);
    setUniformityScore(95);
    setImageUrl("");
    setAiSummary(undefined);
    setAiDescriptions(null);
    setAiHashtags(null);
  };

  const [isSubmittingProduct, setIsSubmittingProduct] = useState(false);
  const [isAnalyzingDrop, setIsAnalyzingDrop] = useState(false);

  // 사진을 드래그&드롭으로 넣는 것도 카메라 스캔과 동일하게 실제 AI 분석을 거치게 한다 —
  // 그냥 파일만 미리보기에 꽂아두는 우회로를 열어두면 "스캔 필수" 규칙이 무의미해진다.
  const handleDroppedImage = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      if (!base64) return;
      setIsAnalyzingDrop(true);
      try {
        const result = await analyzeProduct({ imageBase64: base64 });
        if (!result.success || !result.data) throw new Error("분석 실패");
        const data = result.data;
        setImageUrl(base64);
        setTitle(data.productName);
        setUnitAmount("1");
        setOriginType(PRODUCT_ORIGIN_OPTIONS[0]);
        setOriginDetail("");
        setCategory(data.category as ProductItem["category"]);
        setPrice(data.sellingPrice || 0);
        setPublicPrice(data.publicMarketPrice);
        setGrade((data.grade || "A+") as ProductItem["grade"]);
        setFreshnessScore(data.freshnessScore);
        setDefectScore(data.defectScore);
        setUniformityScore(data.uniformityScore);
        setAiSummary(data.aiAnalysisSummary);
        // 스캔이 끝나면 추천 문구 중 하나를 바로 채워서 상인이 굳이 카드를 눌러
        // 고르지 않아도 되게 한다 — 마음에 안 들면 아래 카드에서 다른 걸 고르거나
        // 텍스트를 직접 고쳐도 된다.
        setDescription(getAiRecommendations(data.productName, data.category, 0)[0]);
        setSelectedTags([]);
        setAiDescriptions(null);
        setAiHashtags(null);
        requestAiCopy(data.productName, data.category);
      } catch (err) {
        console.error(err);
        alert("AI 분석에 실패했습니다. 잠시 후 다시 시도해주세요.");
      } finally {
        setIsAnalyzingDrop(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const MAX_SELECTED_TAGS = 5;

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      if (prev.includes(tag)) return prev.filter((t) => t !== tag);
      if (prev.length >= MAX_SELECTED_TAGS) {
        showToast(`태그는 최대 ${MAX_SELECTED_TAGS}개까지 선택할 수 있어요.`);
        return prev;
      }
      return [...prev, tag];
    });
  };

  const handleSubmitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProductId && !canRegisterProducts) {
      alert("새 상품을 등록하려면 먼저 소속 전통시장, 점포 위치, 전화번호/영업시간을 등록해주세요.");
      return;
    }
    const numPrice = Number(price);
    if (!title.trim() || !price || numPrice <= 0) {
      alert("상품명과 판매 가격(1원 이상)을 입력해 주세요.");
      return;
    }
    if (!originDetail.trim()) {
      alert("원산지 상세 지역(예: 완도)을 입력해 주세요.");
      return;
    }
    // 등급/신선도/공공시세는 전부 AI 스캔에서만 채워진다 — 스캔 없이 등록되면 이 값들이
    // 전부 기본값(A+/95점/판매가×1.2)으로 그냥 박혀버려서 신뢰할 수 없는 정보가 된다.
    // 신규 등록은 물론, 오늘이 아닌 날 등록된 상품을 수정할 때도(handleEditProduct에서
    // aiSummary를 비워둔 경우) 재스캔 없이는 저장할 수 없게 막는다 — 실물은 매일 달라지는데
    // 며칠 전 사진 기준 등급/신선도를 그대로 두고 가격만 고치는 걸 막기 위함.
    if (!aiSummary) {
      alert("AI 스캔을 먼저 진행해야 저장할 수 있습니다. 위 '스캔 사진'에서 AI 스캔을 실행해주세요.");
      return;
    }

    const numPublicPrice = publicPrice ? Number(publicPrice) : Math.round(numPrice * 1.2);
    const diffPercent = Math.round(((numPublicPrice - numPrice) / numPublicPrice) * 100);
    const priceTag = diffPercent > 0 ? `공공 시세 대비 ${diffPercent}% 저렴` : "시세 적정가";
    const unit = unitAmount.trim() ? `${unitAmount.trim()}${PRODUCT_UNIT}` : "";
    const origin = buildProductOrigin(originType, originDetail);
    const tags = selectedTags.join(",");

    const finalImage =
      imageUrl.trim() ||
      "https://images.unsplash.com/photo-1534483509719-3feaee7c30da?auto=format&fit=crop&w=800&q=80";

    if (editingProductId) {
      const existing = products.find((p) => p.id === editingProductId);
      const updatedProduct: ProductItem = {
        id: editingProductId,
        title: title.trim(),
        unit,
        origin,
        tags,
        shopName: shopName,
        distance: existing?.distance || (marketName ? `${marketName} 내 점포` : ""),
        timeAgo: "방금 수정됨",
        price: numPrice,
        publicPrice: numPublicPrice,
        priceTag: priceTag,
        grade: grade,
        category: category,
        imageUrl: finalImage,
        freshnessScore: freshnessScore,
        defectScore: defectScore,
        uniformityScore: uniformityScore,
        description: description.trim() || `${shopName}에서 정성껏 등록한 ${title.trim()}입니다.`,
        aiSummary: aiSummary,
        isScannedProduct: Boolean(aiSummary),
        isMerchantUploaded: true,
      };

      setIsSubmittingProduct(true);
      const ok = onUpdateProduct
        ? await onUpdateProduct(updatedProduct)
        : await onAddProduct(updatedProduct);
      setIsSubmittingProduct(false);
      if (!ok) return; // 실패 알림은 App.tsx가 이미 보여줬으니 여기선 폼을 그대로 둔다.

      showToast(`'${title}' 상품 정보가 수정되었습니다!`);
    } else {
      const newProduct: ProductItem = {
        id: `merchant-prod-${Date.now()}`,
        title: title.trim(),
        unit,
        origin,
        tags,
        shopName: shopName,
        distance: marketName ? `${marketName} 내 점포` : "",
        timeAgo: "방금 전 등록",
        price: numPrice,
        publicPrice: numPublicPrice,
        priceTag: priceTag,
        grade: grade,
        category: category,
        imageUrl: finalImage,
        freshnessScore: freshnessScore,
        defectScore: defectScore,
        uniformityScore: uniformityScore,
        description: description.trim() || `${shopName}에서 정성껏 등록한 ${title.trim()}입니다.`,
        aiSummary: aiSummary,
        isScannedProduct: Boolean(aiSummary),
        isMerchantUploaded: true,
      };

      setIsSubmittingProduct(true);
      const ok = await onAddProduct(newProduct);
      setIsSubmittingProduct(false);
      if (!ok) return;

      showToast(`'${title}' 상품이 등록되었습니다!`);
    }

    handleCancelEdit();
    setIsFormOpen(false);
  };

  // Filter products belonging to this merchant only (isMerchantUploaded is true for
  // every merchant's products, not just mine — using OR here used to leak every other
  // merchant's inventory into my own management panel).
  const merchantProducts = products.filter((p) => p.shopName === shopName);

  return (
    <div className="w-full max-w-[600px] mx-auto content-pt-safe content-pb-safe px-4 space-y-6">
      {/* Toast Banner */}
      {toastMessage && (
        <div className="toast-safe-top fixed left-1/2 -translate-x-1/2 z-50 bg-[#0F172A] text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 border border-slate-700 animate-in fade-in zoom-in duration-200">
          <span className="material-symbols-outlined text-emerald-400 text-sm">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 점포 위치 등록 UI는 마이 탭의 '점포 기본 상세 정보' 카드로 옮겨서, 위치·전화번호·
          영업시간을 한 곳에서 같이 관리하게 했다. 여기서는 등록 여부만 확인해서 상품
          등록 자체를 막는 게이트로만 쓴다. */}
      {(hasStoreLocation === false || hasStoreContactInfo === false || (hasStoreLocation && hasStoreContactInfo && !marketName)) && (
        <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50 flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-600 shrink-0">warning</span>
          <div className="text-xs text-amber-900">
            <p className="font-extrabold">아직 새 상품을 등록할 수 없어요</p>
            <p className="mt-1 leading-relaxed text-amber-800">
              마이 탭의 '점포 기본 상세 정보'에서 소속 전통시장과 점포 위치, 전화번호, 영업시간을 먼저 등록해주세요.
            </p>
          </div>
        </div>
      )}

      {/* Main Action Section: Store Item Registration — 헤더 바로 밑에 너무 바짝 붙어
          보여서(content-pt-safe만으로는 좁음) 살짝 더 내려준다. */}
      <div className="space-y-3 mt-3">
        <div className="flex justify-between items-center">
          <h3 className="text-xs font-bold text-[#64748B] uppercase tracking-wider flex items-center gap-1">
            <span className="material-symbols-outlined text-base text-emerald-600">add_circle</span>
            새 물건 등록
          </h3>
        </div>

        {/* Store Product Registration Toggle Header */}
        <button
          onClick={() => {
            if (isFormOpen && editingProductId) {
              // 수정 중에 이 배너를 누르면 "새 상품 등록" 모드로 넘어가는 게 아니라,
              // 폼을 접고 원래 목록 화면으로 돌아가야 한다.
              handleCancelEdit();
              setIsFormOpen(false);
            } else {
              setIsFormOpen(!isFormOpen);
            }
          }}
          className={`w-full p-4 rounded-2xl text-left shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-all border flex items-center justify-between ${
            isFormOpen
              ? "bg-[#0F172A] text-white border-[#0F172A]"
              : "bg-white hover:bg-[#F8FAFC] text-[#0F172A] border-[#E2E8F0]"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              isFormOpen ? "bg-white/10 text-emerald-400" : "bg-slate-100 text-slate-600"
            }`}>
              <span className="material-symbols-outlined text-lg">storefront</span>
            </div>
            <div>
              <h5 className="text-xs font-bold">
                {editingProductId ? "점포 물건 수동 수정 중" : "점포 물건 등록"}
              </h5>
              <p className={`text-[11px] mt-0.5 ${isFormOpen ? "text-slate-300" : "text-[#64748B]"}`}>
                {editingProductId ? "목록에서 선택한 상품의 상세정보를 수정합니다." : "AI 스캔으로 빠르게 등록하거나 수동으로 입력하여 등록합니다."}
              </p>
            </div>
          </div>
          <span className="material-symbols-outlined text-base">
            {isFormOpen ? "keyboard_arrow_up" : "keyboard_arrow_down"}
          </span>
        </button>
      </div>

      {/* Store Product Registration Form (Collapsible) */}
      {isFormOpen && (
        <form
          ref={formRef}
          onSubmit={handleSubmitManual}
          className="bg-white rounded-2xl border border-slate-200 p-5 shadow-lg space-y-4 animate-in fade-in duration-200"
        >
          <div className="flex justify-between items-center border-b pb-3">
            <div className="flex items-center gap-2">
              <h4 className="font-extrabold text-sm text-slate-900 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-emerald-600 text-base">
                  {editingProductId ? "edit" : "edit_note"}
                </span>
                {editingProductId ? "점포 물건 정보 수정" : "점포 물건 상세정보 입력"}
              </h4>
              {editingProductId && (
                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  수정 중
                </span>
              )}
            </div>
            {editingProductId ? (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="text-xs font-bold text-slate-500 hover:text-slate-700 underline"
              >
                새 상품 등록으로 전환
              </button>
            ) : (
              <span className="text-[11px] font-medium text-slate-400">* 필수항목</span>
            )}
          </div>

          {/* Integrated AI Scan & Representative Photo Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm text-emerald-600">photo_camera</span>
                <span>스캔 사진</span>
              </label>
              {imageUrl && (
                <button
                  type="button"
                  onClick={() => setImageUrl("")}
                  className="text-[11px] font-bold text-rose-500 hover:text-rose-700 flex items-center gap-0.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-xs">close</span>
                  사진 삭제
                </button>
              )}
            </div>

            {imageUrl ? (
              /* When photo is present: Display scanned photo in preview slot */
              <div className="relative w-full h-48 sm:h-56 rounded-2xl overflow-hidden border border-emerald-200 bg-slate-900 shadow-sm group">
                <img src={imageUrl} alt="대표 상품 사진" className="w-full h-full object-cover" />
                <div className="absolute top-2.5 left-2.5 bg-black/75 backdrop-blur-md text-white text-[10px] font-extrabold px-2.5 py-1 rounded-full border border-white/20 flex items-center gap-1 shadow-md">
                  <span className="material-symbols-outlined text-xs text-emerald-400">verified</span>
                  <span>AI 스캔/촬영 대표 이미지</span>
                </div>
                
                {/* Overlay Action Buttons */}
                <div className="absolute bottom-2.5 right-2.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsMerchantScanOpen(true)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl shadow-md transition-all flex items-center gap-1 cursor-pointer active:scale-95"
                  >
                    <span className="material-symbols-outlined text-sm">photo_camera</span>
                    <span>AI 다시 스캔</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageUrl("")}
                    className="px-2.5 py-1.5 bg-black/60 hover:bg-black/80 text-white text-xs font-bold rounded-xl backdrop-blur-md border border-white/20 transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                    <span>삭제</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Default state when NO photo is present: Clean Minimal Dropzone Preview Slot (Matching reference image) */
              <div
                onClick={() => !isAnalyzingDrop && setIsMerchantScanOpen(true)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (isAnalyzingDrop) return;
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleDroppedImage(file);
                }}
                className={`relative w-full rounded-2xl border-2 border-dashed border-slate-300 hover:border-emerald-500 bg-[#F8FAFC] hover:bg-emerald-50/40 transition-all p-4 sm:p-5 flex flex-col items-center group shadow-2xs ${
                  isAnalyzingDrop ? "cursor-wait opacity-70" : "cursor-pointer"
                }`}
              >
                {/* Primary Action Button & Icon */}
                <div className="flex flex-col items-center justify-center text-center my-1.5">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-2 group-hover:scale-110 group-hover:bg-emerald-600 group-hover:text-white transition-all shadow-xs">
                    {isAnalyzingDrop ? (
                      <div className="w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <span className="material-symbols-outlined text-2xl font-light">
                        photo_camera
                      </span>
                    )}
                  </div>

                  <p className="text-base sm:text-lg font-black text-slate-800 tracking-tight group-hover:text-emerald-900 transition-colors">
                    {isAnalyzingDrop ? "AI가 사진을 분석하는 중..." : "클릭하여 AI 스캔 실행"}
                  </p>

                  <p className="text-xs text-slate-500 mt-0.5 font-medium flex items-center gap-1">
                    <span>사진 파일 드래그 또는 카메라 촬영으로 빠른 등록</span>
                  </p>
                </div>

                {/* Photo Guideline Section: "이렇게 사진을 찍으세요!" */}
                <div className="w-full mt-3 pt-3.5 border-t border-slate-200/80">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-emerald-600">lightbulb</span>
                      <span>📸 이렇게 사진을 찍으세요! (촬영 가이드)</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-left">
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 flex items-start gap-2 shadow-2xs">
                      <div className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="material-symbols-outlined text-sm">wb_sunny</span>
                      </div>
                      <div>
                        <p className="text-[11px] font-extrabold text-slate-800">1. 밝은 조명 아래</p>
                        <p className="text-[10px] text-slate-500 leading-tight mt-0.5">그림자 없이 상품 전체가 잘 보이도록 촬영</p>
                      </div>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 flex items-start gap-2 shadow-2xs">
                      <div className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="material-symbols-outlined text-sm">center_focus_strong</span>
                      </div>
                      <div>
                        <p className="text-[11px] font-extrabold text-slate-800">2. 상품을 중앙에</p>
                        <p className="text-[10px] text-slate-500 leading-tight mt-0.5">상품 하나가 화면 중앙에 꽉 차게 촬영</p>
                      </div>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/90 flex items-start gap-2 shadow-2xs">
                      <div className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="material-symbols-outlined text-sm">crop_free</span>
                      </div>
                      <div>
                        <p className="text-[11px] font-extrabold text-slate-800">3. 깔끔한 배경</p>
                        <p className="text-[10px] text-slate-500 leading-tight mt-0.5">주변 잡동사니 없이 상품만 선명하게</p>
                      </div>
                    </div>
                  </div>

                  {/* Large Sample Photo Banner */}
                  <div className="mt-3 bg-white border border-emerald-200/90 rounded-2xl p-3 shadow-2xs text-left">
                    <div className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-900 mb-2 px-0.5">
                      <span className="material-symbols-outlined text-sm text-emerald-600">check_circle</span>
                      <span>올바른 스캔 사진 예시</span>
                    </div>

                    <div className="relative w-full h-44 sm:h-52 rounded-xl overflow-hidden border border-slate-200 shadow-inner group-hover:scale-[1.01] transition-transform">
                      <img
                        src="https://plus.unsplash.com/premium_photo-1724249990837-f6dfcb7f3eaa?auto=format&fit=crop&w=800&q=80"
                        alt="올바른 촬영 예시 사진"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Product Name — AI 스캔이 사진에서 직접 읽어 채워주는 값이라 직접 타이핑은 막는다.
              상인이 다르게 적어버리면 실제 사진과 등록 정보가 어긋날 수 있어서다. 무게/수량,
              원산지는 각각 아래 별도 필드로 받는다. */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">상품명 *</label>
            <input
              type="text"
              placeholder="AI 스캔을 하면 자동으로 채워집니다"
              value={title}
              disabled
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-xs text-slate-500 font-medium cursor-not-allowed"
              required
            />
          </div>

          {/* Origin — 카테고리는 AI가 골라주는 값을 화면에 굳이 또 보여줄 필요가 없어서
              뺐고(내부적으로는 그대로 쓰임), 원산지는 입력 항목이 둘(구분+상세)이라 한 줄을
              온전히 준다. */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">원산지 *</label>
            <div className="flex items-center gap-1.5">
              <select
                value={originType}
                onChange={(e) => setOriginType(e.target.value)}
                className="w-20 shrink-0 px-2 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium bg-white"
              >
                {PRODUCT_ORIGIN_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="완도"
                value={originDetail}
                onChange={(e) => setOriginDetail(e.target.value)}
                className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
                required
              />
            </div>
          </div>

          {/* Unit / Weight & Price — 공공시세(kg 기준) 대비 할인율이 정확히 계산되도록
              단위를 kg 하나로 고정한다. 무게와 가격은 서로 짝을 이루는 값이라 한 줄에 뒀다. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">단위/중량 * (kg 기준)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="1"
                  value={unitAmount}
                  onChange={(e) => setUnitAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
                />
                <span className="w-12 shrink-0 text-center px-2 py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-xs text-slate-600 font-bold">
                  kg
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">판매 가격 (원) *</label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="예: 15,000"
                value={price === "" ? "" : price.toLocaleString()}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^0-9]/g, "");
                  setPrice(digits === "" ? "" : Number(digits));
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
                required
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 block">상품 설명 / 특이사항</label>

            <textarea
              rows={2}
              placeholder={
                aiSummary
                  ? "직접 입력하거나 아래 AI 추천 설명을 클릭하여 빠르게 선택하세요..."
                  : "AI 스캔을 완료하면 알맞은 설명을 추천해 드립니다."
              }
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium resize-none"
            />

            {/* 스캔 전엔 눌러도 아무 반응 없는 회색 스켈레톤 태그로 "스캔하면 이런 게
                생긴다"는 걸 미리 보여주고, 스캔이 끝나면 카테고리에 맞는 실제 태그
                4~5개가 다중 선택 가능한 칩으로 바뀐다 — 갑자기 나타나는 것보다 자리가
                미리 있는 게 덜 낯설다. */}
            {!aiSummary ? (
              <div className="flex flex-wrap gap-1.5">
                {["#달콤한", "#산지직송", "#오늘아침수확"].map((tag) => (
                  <span
                    key={tag}
                    className="px-2.5 py-1 rounded-full border border-slate-200 bg-slate-100 text-slate-400 text-[11px] font-bold cursor-not-allowed select-none"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                    AI 추천 태그 (최대 {MAX_SELECTED_TAGS}개 선택, {selectedTags.length}/{MAX_SELECTED_TAGS})
                    {isGeneratingCopy && (
                      <span className="material-symbols-outlined text-xs text-emerald-600 animate-spin">progress_activity</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => (aiDescriptions ? requestAiCopy(title, category) : setTagSetIndex((prev) => prev + 1))}
                    disabled={isGeneratingCopy}
                    className="text-[10px] font-bold text-slate-500 hover:text-emerald-700 flex items-center gap-0.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title="다른 태그 보기"
                  >
                    <span className="material-symbols-outlined text-xs">refresh</span>
                    <span>새로고침</span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {/* 이미 골라둔 태그는 새로고침으로 화면에서 밀려나도 계속 보이게, 이번에
                      새로 뜬 추천 태그 앞에 고정으로 붙여준다 — 안 그러면 골라놓고 새로고침
                      했을 때 "방금 고른 게 없어졌나?" 하고 헷갈리게 된다. */}
                  {[...selectedTags, ...(aiHashtags && aiHashtags.length ? aiHashtags : getAiRecommendedTags(category, tagSetIndex))]
                    .filter((tag, idx, arr) => arr.indexOf(tag) === idx)
                    .map((tag) => {
                    const isSelected = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`px-2.5 py-1 rounded-full border text-[11px] font-bold transition-all cursor-pointer active:scale-95 ${
                          isSelected
                            ? "bg-emerald-600 border-emerald-600 text-white"
                            : "bg-white border-slate-200 text-slate-600 hover:border-emerald-300 hover:bg-emerald-50"
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI Recommendation Cards Section - 실제 스캔이 끝나야(aiSummary) 뜬다 */}
            {Boolean(aiSummary) && (
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 space-y-2.5 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold text-emerald-900 flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs text-emerald-600">auto_awesome</span>
                    AI 추천 설명 (클릭 시 자동 입력)
                    {isGeneratingCopy && (
                      <span className="material-symbols-outlined text-xs text-emerald-600 animate-spin">progress_activity</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      aiDescriptions ? requestAiCopy(title, category) : setRecommendationSetIndex((prev) => prev + 1)
                    }
                    disabled={isGeneratingCopy}
                    className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 bg-white hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-md flex items-center gap-1 cursor-pointer active:scale-95 transition-all shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
                    title="다른 추천 멘트 보기"
                  >
                    <span className="material-symbols-outlined text-xs">refresh</span>
                    <span>새로고침</span>
                  </button>
                </div>

                <div className="space-y-1.5">
                  {(aiDescriptions && aiDescriptions.length
                    ? aiDescriptions
                    : getAiRecommendations(title, category, recommendationSetIndex)
                  ).map((recText, idx) => {
                    const isSelected = description === recText;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setDescription(recText)}
                        className={`w-full text-left p-2.5 rounded-xl border text-xs font-medium transition-all cursor-pointer flex items-start gap-2 ${
                          isSelected
                            ? "bg-emerald-600 text-white border-emerald-600 font-bold shadow-xs"
                            : "bg-white hover:bg-emerald-50 text-slate-800 border-emerald-200 hover:border-emerald-300"
                        }`}
                      >
                        <span
                          className={`text-[10px] font-black px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                            isSelected ? "bg-white text-emerald-700" : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          추천 {idx + 1}
                        </span>
                        <span className="flex-1 leading-relaxed">{recText}</span>
                        {isSelected && (
                          <span className="material-symbols-outlined text-sm shrink-0 mt-0.5">check_circle</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Submit Button — 신규 등록이든, 오늘 스캔한 적 없는 상품을 수정하는 것이든
              AI 스캔을 거치기 전엔 눌러도 소용없다는 걸 끝까지 가서야 알게 하지 않도록,
              버튼 자체를 비활성화해서 미리 알려준다. */}
          <button
            type="submit"
            disabled={isSubmittingProduct || !aiSummary}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-extrabold text-xs shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-base">check</span>
            <span>
              {isSubmittingProduct
                ? "처리 중..."
                : !aiSummary
                ? "AI 스캔을 먼저 진행해주세요"
                : editingProductId
                ? "상품 정보 수정 완료"
                : "상품 등록 완료"}
            </span>
          </button>
        </form>
      )}

      {/* Registered Products Section */}
      <section className="space-y-3">
        <button
          type="button"
          onClick={() => setIsProductListOpen((v) => !v)}
          className="w-full flex justify-between items-center cursor-pointer"
        >
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
            <span className="material-symbols-outlined text-base text-slate-700">inventory_2</span>
            사장님 등록 상품 ({merchantProducts.length})
          </h3>
          <span className="flex items-center gap-1 text-[11px] text-slate-400 font-medium">
            {isProductListOpen && "클릭 시 상세정보 수정"}
            <span className="material-symbols-outlined text-lg text-slate-500">
              {isProductListOpen ? "keyboard_arrow_up" : "keyboard_arrow_down"}
            </span>
          </span>
        </button>

        {isProductListOpen && (merchantProducts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center space-y-3">
            <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto text-2xl">
              <span className="material-symbols-outlined">storefront</span>
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">등록된 상품이 없습니다.</p>
              <p className="text-xs text-slate-400 mt-1">
                위의 'AI SCAN' 또는 '직접 입력'을 통해 점포 물건을 등록해 보세요!
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {merchantProducts.map((p) => {
              const isSelectedForEdit = editingProductId === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => handleEditProduct(p)}
                  className={`bg-white rounded-2xl border p-3.5 shadow-sm hover:shadow-md transition-all flex gap-3.5 items-center relative overflow-hidden cursor-pointer ${
                    isSelectedForEdit
                      ? "border-emerald-600 ring-2 ring-emerald-500/20 bg-emerald-50/30"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                  title="클릭 시 점포 물건 수동 등록(수정) 양식으로 이동"
                >
                  {/* Product Image Thumbnail — 소비자 피드 카드(HomeFeed)와 같은 톤(테두리 있는
                      rounded-2xl, 필 형태 등급 배지 + 아이콘)으로 맞춰서, 사장님이 자기 상품이
                      실제로 어떤 느낌으로 노출되는지 관리 화면에서도 바로 감이 오게 한다. */}
                  <div className="relative w-20 h-20 rounded-2xl overflow-hidden flex-shrink-0 border border-[#E2E8F0] bg-slate-100">
                    <img src={p.imageUrl} alt={p.title} className="w-full h-full object-cover" />
                    <div
                      className={`absolute top-1 left-1 px-1.5 py-0.5 rounded-full text-[10px] font-extrabold text-white flex items-center gap-0.5 shadow-sm z-10 ${
                        p.grade?.startsWith("A") ? "bg-[#00C875]" : "bg-[#0052FF]"
                      }`}
                    >
                      <span
                        className="material-symbols-outlined text-[11px] font-extrabold"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        check_circle
                      </span>
                      <span>{displayGrade(p.grade)}</span>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0 space-y-1">
                    {isSelectedForEdit && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                          수정 중
                        </span>
                      </div>
                    )}
                    <h4 className="text-sm font-extrabold text-[#0F172A] truncate hover:text-[#0052FF] transition-colors">
                      {formatProductDisplayTitle(p)}
                    </h4>
                    {/* 등록 시각은 소비자 피드처럼 "N시간 전" 상대 시간이 아니라, 사장님 본인
                        관리 화면이라 언제 올렸는지 헷갈리지 않게 절대 날짜(YYYY.MM.DD)를
                        그대로 유지한다 — 글자 색/크기만 피드의 상대 시간 줄과 맞춘다. */}
                    {p.createdAt && (
                      <p className="text-[11px] text-[#94A3B8] font-medium">
                        {formatRegisteredDate(p.createdAt)} 등록
                      </p>
                    )}
                    <div className="text-lg font-black text-[#0F172A] tracking-tight">
                      {p.price.toLocaleString()}
                      <span className="text-xs font-bold text-[#0F172A] ml-0.5">원</span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectProduct(p);
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-extrabold transition-colors flex items-center gap-1 shadow-xs cursor-pointer"
                      title="실제 이용자가 보는 화면 미리보기"
                    >
                      <span className="material-symbols-outlined text-sm">visibility</span>
                      <span>미리보기</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingProduct(p);
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer"
                      title="삭제"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                      <span>삭제</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </section>

      {/* Delete Confirmation Modal */}
      {deletingProduct && (
        <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-xs w-full p-5 space-y-4 shadow-2xl border border-slate-100 text-center animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto text-2xl">
              <span className="material-symbols-outlined">delete_forever</span>
            </div>
            <div>
              <h4 className="text-sm font-extrabold text-slate-900">상품을 삭제하시겠습니까?</h4>
              <p className="text-xs text-slate-500 mt-1">
                '{deletingProduct.title}' 상품이 사장님 점포 목록에서 삭제됩니다.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                className="w-full py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = deletingProduct;
                  const ok = await onDeleteProduct(target.id);
                  if (!ok) {
                    setDeletingProduct(null);
                    return; // 실패 알림은 App.tsx가 이미 보여줬다.
                  }
                  if (editingProductId === target.id) {
                    handleCancelEdit();
                  }
                  showToast(`'${target.title}' 상품이 삭제되었습니다.`);
                  setDeletingProduct(null);
                }}
                className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md transition-colors cursor-pointer"
              >
                삭제하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merchant AI Scan Modal */}
      <MerchantAiScanModal
        isOpen={isMerchantScanOpen}
        onClose={() => setIsMerchantScanOpen(false)}
        shopName={shopName}
        onRegisterProduct={(scannedProduct) => {
          // 폼에 스캔된 상품 정보와 사진 채워넣기 (바로 등록하지 않고, 폼 확인 후 '상품 등록 완료' 시 등록)
          setImageUrl(scannedProduct.imageUrl);
          setTitle(scannedProduct.title);
          setUnitAmount("1");
          setOriginType(PRODUCT_ORIGIN_OPTIONS[0]);
          setOriginDetail("");
          setCategory(scannedProduct.category);
          setPrice(scannedProduct.price || "");
          setPublicPrice(scannedProduct.publicPrice || "");
          // 스캔이 끝나면 추천 문구 중 하나를 바로 채워서 상인이 굳이 카드를 눌러
          // 고르지 않아도 되게 한다 — 마음에 안 들면 아래 카드에서 다른 걸 고르거나
          // 텍스트를 직접 고쳐도 된다.
          setDescription(
            scannedProduct.description || getAiRecommendations(scannedProduct.title, scannedProduct.category, 0)[0]
          );
          setSelectedTags([]);
          setGrade(scannedProduct.grade || "A+");
          setFreshnessScore(scannedProduct.freshnessScore || 95);
          setDefectScore(scannedProduct.defectScore ?? 2);
          setUniformityScore(scannedProduct.uniformityScore ?? 95);
          setAiSummary(scannedProduct.aiSummary);
          setAiDescriptions(null);
          setAiHashtags(null);
          requestAiCopy(scannedProduct.title, scannedProduct.category);
          setIsFormOpen(true);
          showToast(`'${scannedProduct.title}' AI 스캔 완료! 하단의 '상품 등록 완료'를 눌러 등록하세요.`);

          setTimeout(() => {
            formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 100);
        }}
      />
    </div>
  );
};
