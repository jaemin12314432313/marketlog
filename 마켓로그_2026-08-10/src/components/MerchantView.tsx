import React, { useState, useRef } from "react";
import { ProductItem } from "../types";
import { MerchantAiScanModal } from "./MerchantAiScanModal";
import { StoreLocationPicker } from "./StoreLocationPicker";

function formatRegisteredDate(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
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
}) => {
  const shopName = userDisplayName || "양동수산";
  const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false);

  // Form states for manual registration
  const [isFormOpen, setIsFormOpen] = useState(true);
  const [isMerchantScanOpen, setIsMerchantScanOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<ProductItem | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ProductItem["category"]>("수산물");
  const [price, setPrice] = useState<number | "">("");
  const [publicPrice, setPublicPrice] = useState<number | "">("");
  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("062-360-7000");
  const [grade, setGrade] = useState<ProductItem["grade"]>("A+");
  const [freshnessScore, setFreshnessScore] = useState<number>(95);
  const [imageUrl, setImageUrl] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // AI Recommendation for Description state
  const [recommendationSetIndex, setRecommendationSetIndex] = useState(0);

  const getAiRecommendations = (rawTitle: string, rawCategory: string, index: number) => {
    const name = rawTitle.trim() || `${rawCategory || "인기"} 상품`;
    const sets = [
      [
        `오늘 새벽 산지에서 직송되어 신선함이 남다른 ${name}입니다! 신선도와 맛이 최고예요 👍`,
        `양동시장 단골 손님들이 가장 많이 찾으시는 인기 폭발 ${name}! 자신 있게 추천합니다 🔥`,
        `가성비와 신선함 모두 잡았습니다. ${name} 오늘 특별 할인가로 양동시장에서 만나보세요 ✨`,
      ],
      [
        `산지 직송으로 밭/바다의 신선함을 그대로 담은 ${name}입니다. 선물용으로도 적극 추천합니다! 🎁`,
        `오늘만 이 가격! 매일 조기 품절되는 아주 귀하고 신선한 ${name}입니다. 놓치지 마세요 ⚡`,
        `사장님이 직접 하나하나 까다롭게 엄선한 최상품 ${name}! 품질 백퍼센트 보증합니다 💯`,
      ],
      [
        `새벽 경매에서 최고의 품질로 낙찰받아 가져온 ${name}! 오늘 저녁 맛있는 식탁에 올려보세요 🍲`,
        `믿고 먹는 양동시장 사장님 대표 상품! ${name} 제철이라 맛과 풍미가 더욱 풍부합니다 🌟`,
        `신선함은 기본, 푸짐한 양과 특가 혜택까지! ${name} 수량 소진 시 조기 마감됩니다 ⏳`,
      ],
      [
        `당도와 신선도 정밀 보장! ${name} 사장님이 품질만을 고집하여 정성껏 엄선하였습니다 👍`,
        `온 가족이 함께 안심하고 즐길 수 있는 산뜻한 ${name}, 맛과 신선도 모두 자신있게 추천드립니다 ❤️`,
        `단골 고객들의 연이은 재구매 요청! ${name} 실물 보러 양동시장 매장으로 방문해 보세요 🛒`,
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
    setCategory(p.category);
    setPrice(p.price);
    setPublicPrice(p.publicPrice || "");
    setDescription(p.description || "");
    setPhone(p.phone || "062-360-7000");
    setGrade(p.grade || "A+");
    setFreshnessScore(p.freshnessScore || 95);
    setImageUrl(p.imageUrl || "");
    setIsFormOpen(true);

    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const handleCancelEdit = () => {
    setEditingProductId(null);
    setTitle("");
    setPrice("");
    setPublicPrice("");
    setDescription("");
    setPhone("062-360-7000");
    setImageUrl("");
  };

  const [isSubmittingProduct, setIsSubmittingProduct] = useState(false);

  const handleSubmitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !price) {
      alert("상품명과 판매 가격을 입력해 주세요.");
      return;
    }

    const numPrice = Number(price);
    const numPublicPrice = publicPrice ? Number(publicPrice) : Math.round(numPrice * 1.2);
    const diffPercent = Math.round(((numPublicPrice - numPrice) / numPublicPrice) * 100);
    const priceTag = diffPercent > 0 ? `공공 시세 대비 ${diffPercent}% 저렴` : "시세 적정가";

    const finalImage =
      imageUrl.trim() ||
      "https://images.unsplash.com/photo-1534483509719-3feaee7c30da?auto=format&fit=crop&w=800&q=80";

    if (editingProductId) {
      const existing = products.find((p) => p.id === editingProductId);
      const updatedProduct: ProductItem = {
        id: editingProductId,
        title: title.trim(),
        shopName: shopName,
        distance: existing?.distance || "양동전통시장 내 점포",
        timeAgo: "방금 수정됨",
        price: numPrice,
        publicPrice: numPublicPrice,
        priceTag: priceTag,
        grade: grade,
        category: category,
        imageUrl: finalImage,
        freshnessScore: freshnessScore,
        defectScore: Math.max(0, 100 - freshnessScore - 2),
        uniformityScore: 95,
        description: description.trim() || `${shopName}에서 정성껏 등록한 ${title.trim()}입니다.`,
        phone: phone.trim() || "062-360-7000",
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
        shopName: shopName,
        distance: "양동전통시장 내 점포",
        timeAgo: "방금 전 등록",
        price: numPrice,
        publicPrice: numPublicPrice,
        priceTag: priceTag,
        grade: grade,
        category: category,
        imageUrl: finalImage,
        freshnessScore: freshnessScore,
        defectScore: Math.max(0, 100 - freshnessScore - 2),
        uniformityScore: 95,
        description: description.trim() || `${shopName}에서 정성껏 등록한 ${title.trim()}입니다.`,
        phone: phone.trim() || "062-360-7000",
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
    <div className="w-full max-w-[600px] mx-auto pt-20 pb-28 px-4 space-y-6">
      {/* Toast Banner */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[#0F172A] text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 border border-slate-700 animate-in fade-in zoom-in duration-200">
          <span className="material-symbols-outlined text-emerald-400 text-sm">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 점포 위치 등록 — 지도의 실제 점포와 이름이 정확히 일치할 때만 상품이 지도에
          뜨던 문제 때문에, 상인이 직접 자기 위치에 핀을 찍어 등록할 수 있게 한다. */}
      <button
        type="button"
        onClick={() => setIsLocationPickerOpen(true)}
        className="w-full p-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-50 flex items-center justify-between gap-3 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-lg">location_on</span>
          </div>
          <div className="min-w-0 text-left">
            <h5 className="text-xs font-extrabold text-slate-900">점포 위치 등록</h5>
            <p className="text-[11px] text-slate-500 mt-0.5">지도에서 내 점포 위치를 찍어야 상품이 지도에 표시돼요</p>
          </div>
        </div>
        <span className="material-symbols-outlined text-emerald-600 shrink-0">chevron_right</span>
      </button>

      {/* Main Action Section: Store Item Registration */}
      <div className="space-y-3">
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
              handleCancelEdit();
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

          {/* Product Name */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">상품명 *</label>
            <input
              type="text"
              placeholder="예: 싱싱한 완도산 전복 (1kg)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
              required
            />
          </div>

          {/* Category & Price */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">카테고리</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ProductItem["category"])}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium bg-white"
              >
                <option value="수산물">수산물</option>
                <option value="과일">과일</option>
                <option value="야채">야채</option>
                <option value="정육">정육</option>
                <option value="건어물">건어물</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">판매 가격 (원) *</label>
              <input
                type="number"
                placeholder="예: 15000"
                value={price}
                onChange={(e) => setPrice(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
                required
              />
            </div>
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
                onClick={() => setIsMerchantScanOpen(true)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    const file = e.dataTransfer.files[0];
                    if (file.type.startsWith("image/")) {
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        if (event.target?.result) {
                          setImageUrl(event.target.result as string);
                        }
                      };
                      reader.readAsDataURL(file);
                    }
                  }
                }}
                className="relative w-full rounded-2xl border-2 border-dashed border-slate-300 hover:border-emerald-500 bg-[#F8FAFC] hover:bg-emerald-50/40 transition-all p-4 sm:p-5 flex flex-col items-center cursor-pointer group shadow-2xs"
              >
                {/* Primary Action Button & Icon */}
                <div className="flex flex-col items-center justify-center text-center my-1.5">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-2 group-hover:scale-110 group-hover:bg-emerald-600 group-hover:text-white transition-all shadow-xs">
                    <span className="material-symbols-outlined text-2xl font-light">
                      photo_camera
                    </span>
                  </div>

                  <p className="text-base sm:text-lg font-black text-slate-800 tracking-tight group-hover:text-emerald-900 transition-colors">
                    클릭하여 AI 스캔 실행
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

          {/* Description */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 block">상품 설명 / 특이사항</label>

            <textarea
              rows={2}
              placeholder="직접 입력하거나 아래 AI 추천 설명을 클릭하여 빠르게 선택하세요..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium resize-none"
            />

            {/* AI Recommendation Cards Section - Only show when image is registered or scanned */}
            {Boolean(imageUrl) && (
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 space-y-2.5 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold text-emerald-900 flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs text-emerald-600">auto_awesome</span>
                    AI 추천 설명 (클릭 시 자동 입력)
                  </span>
                  <button
                    type="button"
                    onClick={() => setRecommendationSetIndex((prev) => prev + 1)}
                    className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 bg-white hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-md flex items-center gap-1 cursor-pointer active:scale-95 transition-all shadow-2xs"
                    title="다른 추천 멘트 보기"
                  >
                    <span className="material-symbols-outlined text-xs">refresh</span>
                    <span>새로고침</span>
                  </button>
                </div>

                <div className="space-y-1.5">
                  {getAiRecommendations(title, category, recommendationSetIndex).map((recText, idx) => {
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

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmittingProduct}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-extrabold text-xs shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-base">check</span>
            <span>
              {isSubmittingProduct
                ? "처리 중..."
                : editingProductId
                ? "상품 정보 수정 완료"
                : "상품 등록 완료"}
            </span>
          </button>
        </form>
      )}

      {/* Registered Products Section */}
      <section className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
            <span className="material-symbols-outlined text-base text-slate-700">inventory_2</span>
            사장님 등록 상품 ({merchantProducts.length})
          </h3>
          <span className="text-[11px] text-slate-400 font-medium">클릭 시 상세정보 수정</span>
        </div>

        {merchantProducts.length === 0 ? (
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
                  {/* Product Image Thumbnail */}
                  <div className="w-20 h-20 rounded-xl bg-slate-100 overflow-hidden flex-shrink-0 relative">
                    <img src={p.imageUrl} alt={p.title} className="w-full h-full object-cover" />
                    <span className="absolute top-1 left-1 bg-emerald-600 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded shadow-xs">
                      {p.grade}
                    </span>
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
                    <h4 className="text-sm font-bold text-slate-900 truncate hover:text-emerald-600 transition-colors">
                      {p.title}
                    </h4>
                    <div className="flex items-center gap-1.5">
                      <span className="text-base font-black text-slate-900">
                        {p.price.toLocaleString()}원
                      </span>
                      {p.createdAt && (
                        <span className="text-[10px] font-bold text-slate-400">
                          {formatRegisteredDate(p.createdAt)} 등록
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs text-emerald-600">edit_note</span>
                      <span>클릭하여 수동 등록 정보 수정</span>
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
        )}
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
          setCategory(scannedProduct.category);
          setPrice(scannedProduct.price || "");
          setPublicPrice(scannedProduct.publicPrice || "");
          setDescription(scannedProduct.description || "");
          setGrade(scannedProduct.grade || "A+");
          setFreshnessScore(scannedProduct.freshnessScore || 95);
          setIsFormOpen(true);
          showToast(`'${scannedProduct.title}' AI 스캔 완료! 하단의 '상품 등록 완료'를 눌러 등록하세요.`);

          setTimeout(() => {
            formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 100);
        }}
      />

      {/* Store Location Picker Modal */}
      <StoreLocationPicker
        isOpen={isLocationPickerOpen}
        onClose={() => setIsLocationPickerOpen(false)}
        marketName={marketName}
        onSaved={() => showToast("점포 위치가 지도에 등록되었습니다!")}
      />
    </div>
  );
};
