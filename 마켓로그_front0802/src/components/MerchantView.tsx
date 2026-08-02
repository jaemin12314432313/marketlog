import React, { useState, useRef } from "react";
import { ProductItem } from "../types";

interface MerchantViewProps {
  products: ProductItem[];
  userDisplayName: string;
  onOpenAiScan: () => void;
  onAddProduct: (product: ProductItem) => void;
  onUpdateProduct?: (product: ProductItem) => void;
  onDeleteProduct: (id: string) => void;
  onOpenLogin: () => void;
  onSelectProduct: (product: ProductItem) => void;
}

export const MerchantView: React.FC<MerchantViewProps> = ({
  products,
  userDisplayName,
  onOpenAiScan,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  onOpenLogin,
  onSelectProduct,
}) => {
  const shopName = userDisplayName || "양동수산";

  // Form states for manual registration
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ProductItem["category"]>("수산물");
  const [price, setPrice] = useState<number | "">("");
  const [publicPrice, setPublicPrice] = useState<number | "">("");
  const [description, setDescription] = useState("");
  const [grade, setGrade] = useState<ProductItem["grade"]>("A+");
  const [freshnessScore, setFreshnessScore] = useState<number>(95);
  const [imageUrl, setImageUrl] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const formRef = useRef<HTMLFormElement | null>(null);

  // Sample preset images for quick selection
  const sampleImages = [
    { label: "생선/갈치", url: "https://images.unsplash.com/photo-1534483509719-3feaee7c30da?auto=format&fit=crop&w=600&q=80" },
    { label: "딸기/과일", url: "https://images.unsplash.com/photo-1464965911861-746a04b4bca6?auto=format&fit=crop&w=600&q=80" },
    { label: "신선 야채", url: "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=600&q=80" },
    { label: "한우/정육", url: "https://images.unsplash.com/photo-1603048588665-791ca8aea617?auto=format&fit=crop&w=600&q=80" },
  ];

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
    setImageUrl("");
  };

  const handleSubmitManual = (e: React.FormEvent) => {
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
      sampleImages[0].url;

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
        isMerchantUploaded: true,
      };

      if (onUpdateProduct) {
        onUpdateProduct(updatedProduct);
      } else {
        onAddProduct(updatedProduct);
      }
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
        isMerchantUploaded: true,
      };

      onAddProduct(newProduct);
      showToast(`'${title}' 상품이 등록되었습니다!`);
    }

    handleCancelEdit();
    setIsFormOpen(false);
  };

  // Filter products belonging to this merchant or uploaded
  const merchantProducts = products.filter(
    (p) => p.shopName === shopName || p.isMerchantUploaded
  );

  return (
    <div className="w-full max-w-[600px] mx-auto pt-20 pb-28 px-4 space-y-6">
      {/* Toast Banner */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[#0F172A] text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 border border-slate-700 animate-in fade-in zoom-in duration-200">
          <span className="material-symbols-outlined text-emerald-400 text-sm">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Action Section: AI SCAN Hero Banner & Manual Registration */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-xs font-bold text-[#64748B] uppercase tracking-wider flex items-center gap-1">
            <span className="material-symbols-outlined text-base text-[#0052FF]">add_circle</span>
            새 물건 등록
          </h3>
        </div>

        {/* AI Scan Action Card - Standardized with App Light Card UI */}
        <div className="bg-white rounded-2xl p-5 border-2 border-[#0052FF]/20 shadow-[0_2px_8px_rgba(0,82,255,0.08)] relative overflow-hidden space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span className="bg-[#DBEAFE] text-[#0052FF] text-[11px] font-extrabold px-2.5 py-1 rounded-full flex items-center gap-1">
                <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>
                  stars
                </span>
                추천 · AI 스캔 등록
              </span>
            </div>
            <div className="w-9 h-9 rounded-full bg-blue-50 text-[#0052FF] flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">photo_camera</span>
            </div>
          </div>

          <div className="space-y-1">
            <h4 className="text-base font-extrabold text-[#0F172A] tracking-tight flex items-center gap-1.5">
              <span>AI SCAN으로 즉시 스캔 & 등록</span>
            </h4>
            <p className="text-xs text-[#64748B] leading-relaxed">
              점포 물건을 촬영하면 AI가 신선도, 품질 등급(A+), 시세 대비 가격을 자동 산정하여 내 점포 상품으로 즉시 게시합니다.
            </p>
          </div>

          <button
            onClick={onOpenAiScan}
            className="w-full bg-[#0052FF] hover:bg-[#0043D6] text-white py-3.5 px-4 rounded-xl font-extrabold text-xs shadow-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-lg">photo_camera</span>
            <span>AI 카메라 스캔 시작하기</span>
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
        </div>

        {/* Secondary Option: Manual Input Form Toggle */}
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
              isFormOpen ? "bg-white/10 text-amber-300" : "bg-slate-100 text-slate-600"
            }`}>
              <span className="material-symbols-outlined text-lg">edit_note</span>
            </div>
            <div>
              <h5 className="text-xs font-bold">
                {editingProductId ? "점포 물건 수동 수정 중" : "직접 물건 상세정보 입력하기"}
              </h5>
              <p className={`text-[11px] mt-0.5 ${isFormOpen ? "text-slate-300" : "text-[#64748B]"}`}>
                {editingProductId ? "목록에서 선택한 상품의 상세정보를 수정합니다." : "상품명, 가격, 카테고리를 수동으로 작성하여 등록합니다."}
              </p>
            </div>
          </div>
          <span className="material-symbols-outlined text-base">
            {isFormOpen ? "keyboard_arrow_up" : "keyboard_arrow_down"}
          </span>
        </button>
      </div>

      {/* Manual Input Form Section (Collapsible) */}
      {isFormOpen && (
        <form
          ref={formRef}
          onSubmit={handleSubmitManual}
          className="bg-white rounded-2xl border border-slate-200 p-5 shadow-lg space-y-4 animate-in fade-in duration-200"
        >
          <div className="flex justify-between items-center border-b pb-3">
            <div className="flex items-center gap-2">
              <h4 className="font-extrabold text-sm text-slate-900 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-blue-600 text-base">
                  {editingProductId ? "edit" : "edit_note"}
                </span>
                {editingProductId ? "점포 물건 정보 수정" : "점포 물건 수동 등록"}
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
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
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
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium bg-white"
              >
                <option value="수산물">수산물</option>
                <option value="과일">과일</option>
                <option value="신선야채">신선야채</option>
                <option value="정육">정육</option>
                <option value="건어물">건어물</option>
                <option value="AI 추천상품">AI 추천상품</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">판매 가격 (원) *</label>
              <input
                type="number"
                placeholder="예: 15000"
                value={price}
                onChange={(e) => setPrice(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                required
              />
            </div>
          </div>

          {/* Image Selection / URL */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700">대표 사진 선택</label>
            <div className="grid grid-cols-4 gap-2">
              {sampleImages.map((img, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setImageUrl(img.url)}
                  className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${
                    imageUrl === img.url ? "border-blue-600 ring-2 ring-blue-500/30" : "border-slate-200 opacity-70 hover:opacity-100"
                  }`}
                >
                  <img src={img.url} alt={img.label} className="w-full h-full object-cover" />
                  <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] font-bold text-center py-0.5">
                    {img.label}
                  </span>
                </button>
              ))}
            </div>
            <input
              type="url"
              placeholder="또는 직접 이미지 URL 입력"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono mt-1"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">상품 설명 / 특이사항</label>
            <textarea
              rows={2}
              placeholder="오늘 새벽 당일 입고된 상품입니다..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium resize-none"
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-extrabold text-xs shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-base">check</span>
            <span>{editingProductId ? "상품 정보 수정 완료" : "상품 등록 완료"}</span>
          </button>
        </form>
      )}

      {/* Registered Products Section */}
      <section className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
            <span className="material-symbols-outlined text-base text-slate-700">inventory_2</span>
            {shopName} 사장님 물건 목록 ({merchantProducts.length})
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
                      ? "border-blue-600 ring-2 ring-blue-500/20 bg-blue-50/20"
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
                    <h4 className="text-sm font-bold text-slate-900 truncate hover:text-blue-600 transition-colors">
                      {p.title}
                    </h4>
                    <div>
                      <span className="text-base font-black text-slate-900">
                        {p.price.toLocaleString()}원
                      </span>
                    </div>
                    <div className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs text-blue-500">edit_note</span>
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
                      className="px-2.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-[#0052FF] text-xs font-extrabold transition-colors flex items-center gap-1 shadow-xs"
                      title="실제 이용자가 보는 화면 미리보기"
                    >
                      <span className="material-symbols-outlined text-sm">visibility</span>
                      <span>미리보기</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`'${p.title}' 상품을 삭제하시겠습니까?`)) {
                          onDeleteProduct(p.id);
                          if (editingProductId === p.id) {
                            handleCancelEdit();
                          }
                          showToast("상품이 삭제되었습니다.");
                        }
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold transition-colors flex items-center gap-1"
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
    </div>
  );
};
