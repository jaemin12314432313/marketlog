// 부스 가게 QR — 상품 상세 "레시피" 탭 맨 아래 버튼으로 열린다.
// 내 가게 페이지(/s/{가게 id}, 진열 상품 전체)로 연결한다.
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { boothApi, shopPageUrl, type BoothShopInfo } from "./boothApi";

function BoothShopQrPopup({ storeId, shopName, onClose }: { storeId: string; shopName: string; onClose: () => void }) {
  const [shop, setShop] = useState<BoothShopInfo | null>(null);
  const [productCount, setProductCount] = useState<number | null>(null);
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const shopUrl = await shopPageUrl(storeId);
        const opts = { width: 640, margin: 2, errorCorrectionLevel: "M" as const, color: { dark: "#0F172A", light: "#FFFFFF" } };
        const shopImg = await QRCode.toDataURL(shopUrl, opts);
        if (cancelled) return;
        setQr(shopImg);
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
            CO-SHOW 가상 시장
          </p>
          <p className="mt-1 text-2xl font-extrabold text-[#0F172A]">{shop?.name || shopName}</p>
          {productCount != null && <p className="mt-0.5 text-sm font-medium text-slate-500">진열 상품 {productCount}개</p>}

          <div className="mt-4 w-64 h-64 max-w-full rounded-2xl border border-[#E2E8F0] bg-white p-1 flex items-center justify-center">
            {qr ? (
              <img src={qr} alt="내 가게 페이지 QR" className="w-full h-full" />
            ) : error ? (
              <p className="text-xs font-semibold text-slate-400 px-3">{error}</p>
            ) : (
              <div className="w-8 h-8 border-4 border-[#0052FF] border-t-transparent rounded-full animate-spin" />
            )}
          </div>

          <p className="mt-4 text-base font-extrabold text-[#0F172A]">폰 카메라로 찍어서 내 가게를 가져가세요</p>
          <p className="mt-1 text-xs font-medium text-slate-400">앱 설치 없이 열리고, 내 가게 요약본을 저장할 수 있어요</p>

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
        className="w-full bg-[#0F172A] hover:bg-black text-white py-3.5 px-4 rounded-xl font-semibold text-sm shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
      >
        <span className="material-symbols-outlined text-lg">qr_code_2</span>
        <span>내 가게 QR</span>
      </button>
      {open && <BoothShopQrPopup storeId={storeId} shopName={shopName} onClose={() => setOpen(false)} />}
    </>
  );
}
