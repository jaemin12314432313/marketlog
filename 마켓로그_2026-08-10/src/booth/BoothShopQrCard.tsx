// 부스 가게 QR — 상품 상세 "레시피" 탭 맨 아래 버튼으로 열린다.
// 두 가지 QR을 고를 수 있다:
//  - 내 가게: 그 상품을 올린 가게의 페이지(/s/{가게 id}, 진열 상품 전체)
//  - 3D 시장: 다른 관람객들의 가게까지 둘러보는 3D 가상 시장(/market3d.html?shop={가게 id}, 내 가게 앞에서 시작)
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { boothApi, market3dUrl, shopPageUrl, type BoothShopInfo } from "./boothApi";

type QrMode = "shop" | "market";

const MODE_TEXT: Record<QrMode, { title: string; sub: string }> = {
  shop: { title: "폰 카메라로 찍어서 내 가게를 가져가세요", sub: "앱 설치 없이 열리고, 내 가게 요약본을 저장할 수 있어요" },
  market: { title: "3D 시장에서 다른 가게를 구경해보세요", sub: "다른 관람객들이 연 가게를 걸어 다니며 볼 수 있어요" },
};

function BoothShopQrPopup({ storeId, shopName, onClose }: { storeId: string; shopName: string; onClose: () => void }) {
  const [mode, setMode] = useState<QrMode>("shop");
  const [shop, setShop] = useState<BoothShopInfo | null>(null);
  const [productCount, setProductCount] = useState<number | null>(null);
  const [qr, setQr] = useState<Record<QrMode, string>>({ shop: "", market: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [shopUrl, marketUrl] = await Promise.all([shopPageUrl(storeId), market3dUrl(storeId)]);
        const opts = { width: 640, margin: 2, errorCorrectionLevel: "M" as const, color: { dark: "#0F172A", light: "#FFFFFF" } };
        const [shopImg, marketImg] = await Promise.all([QRCode.toDataURL(shopUrl, opts), QRCode.toDataURL(marketUrl, opts)]);
        if (cancelled) return;
        setQr({ shop: shopImg, market: marketImg });
        const res = await boothApi.shop(storeId, true);
        if (cancelled) return;
        setShop(res.store);
        setProductCount(res.products.length);
      } catch {
        if (!cancelled) setError("QR을 만들지 못했어요. 잠시 후 다시 열어주세요.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-black/60 flex items-center justify-center p-5" onClick={onClose}>
      <section
        className="w-full max-w-sm rounded-3xl overflow-hidden bg-white shadow-2xl animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1.5 bg-gradient-to-r from-[#0052FF] to-[#6EA8FF]" />
        <div className="p-6 flex flex-col items-center text-center">
          <p className="text-xs font-bold text-[#0052FF]">
            CO-SHOW 가상 시장{shop ? ` · No.${shop.number}` : ""}
          </p>
          <p className="mt-1 text-2xl font-extrabold text-[#0F172A]">{shop?.name || shopName}</p>
          {productCount != null && <p className="mt-0.5 text-sm font-medium text-slate-500">진열 상품 {productCount}개</p>}

          {/* 내 가게 / 3D 시장 */}
          <div className="mt-4 w-full grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100">
            {(
              [
                ["shop", "storefront", "내 가게"],
                ["market", "view_in_ar", "3D 시장"],
              ] as [QrMode, string, string][]
            ).map(([m, icon, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`py-2 rounded-lg text-sm font-extrabold flex items-center justify-center gap-1 transition ${
                  mode === m ? "bg-white text-[#0052FF] shadow-sm" : "text-slate-500"
                }`}
              >
                <span className="material-symbols-outlined text-base">{icon}</span>
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 w-64 h-64 max-w-full rounded-2xl border border-[#E2E8F0] bg-white p-1 flex items-center justify-center">
            {qr[mode] ? (
              <img src={qr[mode]} alt={mode === "shop" ? "내 가게 페이지 QR" : "3D 가상 시장 QR"} className="w-full h-full" />
            ) : error ? (
              <p className="text-xs font-semibold text-slate-400 px-3">{error}</p>
            ) : (
              <div className="w-8 h-8 border-4 border-[#0052FF] border-t-transparent rounded-full animate-spin" />
            )}
          </div>

          <p className="mt-4 text-base font-extrabold text-[#0F172A]">{MODE_TEXT[mode].title}</p>
          <p className="mt-1 text-xs font-medium text-slate-400">{MODE_TEXT[mode].sub}</p>

          <button onClick={onClose} className="mt-5 w-full py-3 rounded-xl bg-slate-100 text-slate-700 font-extrabold">
            닫기
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

// 레시피 탭 맨 아래에 붙는 버튼. 부스(CO-SHOW 가상 시장) 상품일 때만 렌더링한다.
export function BoothShopQrButton({ storeId, shopName }: { storeId: string; shopName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full bg-[#0F172A] hover:bg-black text-white py-3.5 px-4 rounded-xl font-extrabold text-sm shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
      >
        <span className="material-symbols-outlined text-lg">qr_code_2</span>
        <span>내 가게 · 3D 시장 QR</span>
      </button>
      {open && <BoothShopQrPopup storeId={storeId} shopName={shopName} onClose={() => setOpen(false)} />}
    </>
  );
}
