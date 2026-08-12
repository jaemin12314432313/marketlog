import React, { useState } from "react";
import { ProductItem } from "../types";

interface SavedViewProps {
  scannedProducts: ProductItem[];
  bookmarkedProducts: ProductItem[];
  onSelectProduct: (product: ProductItem) => void;
  onNavigateToMap: () => void;
  onRemoveScannedProduct?: (id: string) => void;
  onRemoveBookmarkedProduct?: (id: string) => void;
}

export const SavedView: React.FC<SavedViewProps> = ({
  scannedProducts,
  bookmarkedProducts,
  onSelectProduct,
  onRemoveScannedProduct,
  onRemoveBookmarkedProduct,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<"scanned" | "bookmarked">("scanned");

  return (
    <div className="w-full max-w-[600px] mx-auto pt-20 pb-28 px-4 space-y-5">
      {/* Page Title Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-extrabold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-trust-blue" style={{ fontVariationSettings: "'FILL' 1" }}>
              bookmark
            </span>
            저장 목록
          </h1>
          <p className="text-xs text-outline font-medium mt-0.5">
            스캔 상품 및 관심 상품 관리
          </p>
        </div>
      </div>

      {/* 2 Sub Tabs: 스캔 상품 vs 저장한 상품 */}
      <div className="flex border-b border-[#E2E8F0]">
        <button
          type="button"
          onClick={() => setActiveSubTab("scanned")}
          className={`flex-1 py-3 text-xs font-extrabold text-center border-b-2 transition-all flex items-center justify-center gap-1.5 ${
            activeSubTab === "scanned"
              ? "border-trust-blue text-trust-blue bg-blue-50/50"
              : "border-transparent text-outline hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-base">photo_camera</span>
          <span>스캔 상품 ({scannedProducts.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("bookmarked")}
          className={`flex-1 py-3 text-xs font-extrabold text-center border-b-2 transition-all flex items-center justify-center gap-1.5 ${
            activeSubTab === "bookmarked"
              ? "border-trust-blue text-trust-blue bg-blue-50/50"
              : "border-transparent text-outline hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>
            bookmark
          </span>
          <span>저장한 상품 ({bookmarkedProducts.length})</span>
        </button>
      </div>

      {/* Sub Tab 1: 스캔 상품 */}
      {activeSubTab === "scanned" && (
        <section className="space-y-3">
          {scannedProducts.length === 0 ? (
            <div className="bg-surface-white rounded-2xl p-8 text-center border border-[#E2E8F0] space-y-2">
              <span className="material-symbols-outlined text-4xl text-outline">photo_camera</span>
              <p className="text-sm font-bold text-on-surface">스캔한 상품이 없습니다.</p>
              <p className="text-xs text-outline leading-relaxed max-w-xs mx-auto">
                AI SCAN 버튼을 눌러 매대의 과일, 수산물, 정육 신선도를 측정한 후 저장목록에 저장해 보세요.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E2E8F0]">
              {scannedProducts.map((product) => (
                <article
                  key={product.id}
                  onClick={() => onSelectProduct({ ...product, isScannedProduct: true })}
                  className="flex gap-4 py-3.5 group hover:bg-surface-container-low transition-colors rounded-xl px-1 relative cursor-pointer"
                >
                  <img
                    src={product.imageUrl}
                    alt={product.title}
                    className="w-20 h-20 rounded-xl object-cover border border-[#E2E8F0] flex-shrink-0 shadow-sm"
                  />
                  <div className="flex-1 flex flex-col justify-between min-w-0">
                    <div>
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <h3 className="text-sm font-bold text-on-surface line-clamp-1 group-hover:text-trust-blue">
                            {product.title}
                          </h3>
                        </div>

                        {onRemoveScannedProduct && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveScannedProduct(product.id);
                            }}
                            className="text-outline hover:text-red-500 p-1 transition-colors flex-shrink-0"
                            title="스캔 목록에서 삭제"
                          >
                            <span className="material-symbols-outlined text-base">delete</span>
                          </button>
                        )}
                      </div>

                      <p className="text-xs text-outline font-medium mt-1 flex items-center gap-1">
                        <span>{product.shopName}</span>
                      </p>
                    </div>

                    <div className="flex justify-between items-end mt-2">
                      <div className="text-sm font-extrabold text-slate-900">
                        {product.price.toLocaleString()}원
                      </div>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#DCFCE7] text-[#166534]">
                        AI {product.grade}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Sub Tab 2: 저장한 상품 (Home feed bookmarks) */}
      {activeSubTab === "bookmarked" && (
        <section className="space-y-3">
          {bookmarkedProducts.length === 0 ? (
            <div className="bg-surface-white rounded-2xl p-8 text-center border border-[#E2E8F0] space-y-2">
              <span className="material-symbols-outlined text-4xl text-outline">bookmark_border</span>
              <p className="text-sm font-bold text-on-surface">저장한 상품이 없습니다.</p>
              <p className="text-xs text-outline leading-relaxed max-w-xs mx-auto">
                Home 화면 피드에서 마음에 드는 상품 오른쪽의 북마크 버튼을 눌러 관심 상품에 추가해 보세요.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E2E8F0]">
              {bookmarkedProducts.map((product) => (
                <article
                  key={product.id}
                  className="flex gap-4 py-3.5 group hover:bg-surface-container-low transition-colors rounded-xl px-1 relative"
                >
                  <img
                    src={product.imageUrl}
                    alt={product.title}
                    onClick={() => onSelectProduct(product)}
                    className="w-20 h-20 rounded-xl object-cover border border-[#E2E8F0] flex-shrink-0 cursor-pointer shadow-sm"
                  />
                  <div className="flex-1 flex flex-col justify-between min-w-0">
                    <div>
                      <div className="flex justify-between items-start gap-2">
                        <h3
                          onClick={() => onSelectProduct(product)}
                          className="text-sm font-bold text-on-surface line-clamp-1 cursor-pointer hover:text-trust-blue"
                        >
                          {product.title}
                        </h3>

                        {onRemoveBookmarkedProduct && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveBookmarkedProduct(product.id);
                            }}
                            className="text-trust-blue hover:text-red-500 p-1 transition-colors flex-shrink-0"
                            title="저장 해제"
                          >
                            <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>
                              bookmark
                            </span>
                          </button>
                        )}
                      </div>

                      <p className="text-xs text-outline font-medium mt-1">
                        {product.shopName}
                      </p>
                    </div>

                    <div className="flex justify-between items-end mt-2">
                      <span className="text-sm font-extrabold text-slate-900">
                        {product.price.toLocaleString()}원
                      </span>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#DCFCE7] text-[#166534]">
                        AI {product.grade}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
