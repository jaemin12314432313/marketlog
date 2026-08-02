import React from "react";
import { UserRole } from "./LoginModal";
import { ProductItem } from "../types";

interface MyWalletProps {
  quests?: any[];
  coupons?: any[];
  onUseCoupon?: (couponId: string) => void;
  onNavigateToMap?: () => void;
  userRole?: UserRole;
  userDisplayName?: string;
  onOpenLogin?: () => void;
  products?: ProductItem[];
}

export const MyWallet: React.FC<MyWalletProps> = ({
  userRole = "customer",
  userDisplayName,
  onOpenLogin,
  products = [],
}) => {
  const shopName = userDisplayName || (userRole === "merchant" ? "양동수산" : "스마트 장보기 회원");
  const merchantProducts = products.filter(
    (p) => p.shopName === shopName || p.isMerchantUploaded
  );

  return (
    <div className="w-full max-w-[600px] mx-auto pt-20 pb-28 px-4 space-y-6">
      {/* Profile & Store Management Header Card */}
      {userRole === "merchant" ? (
        <section className="bg-white rounded-2xl p-5 border border-[#E2E8F0] shadow-[0_1px_3px_rgba(0,0,0,0.05)] text-[#0F172A] relative overflow-hidden space-y-4">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-2">
              <span className="bg-blue-50 text-[#0052FF] border border-blue-100 px-3 py-1 rounded-full text-xs font-extrabold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm">storefront</span>
                판매자 전용 점포 관리
              </span>
            </div>
            <span className="text-[11px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              영업 중
            </span>
          </div>

          <div className="flex items-center gap-3.5 pt-1">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shadow-md shrink-0">
              <span className="material-symbols-outlined text-3xl">storefront</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-extrabold text-[#0F172A] truncate">{shopName}</h2>
                <span className="text-[10px] bg-[#0052FF] text-white px-2 py-0.5 rounded-md font-bold shrink-0">
                  인증 점포
                </span>
              </div>
              <p className="text-xs text-[#64748B] mt-0.5 truncate">
                광주 서구 양동전통시장 수산물 12호
              </p>
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#E2E8F0]">
            <div className="bg-[#F8FAFC] rounded-xl p-2.5 text-center border border-[#E2E8F0]">
              <p className="text-[10px] text-[#64748B] font-bold">등록된 물건</p>
              <p className="text-base font-extrabold text-[#0F172A] mt-0.5">{merchantProducts.length}개</p>
            </div>
            <div className="bg-[#F8FAFC] rounded-xl p-2.5 text-center border border-[#E2E8F0]">
              <p className="text-[10px] text-[#64748B] font-bold">AI A+ 등급</p>
              <p className="text-base font-extrabold text-[#10B981] mt-0.5">
                {merchantProducts.filter((p) => p.grade === "A+").length}개
              </p>
            </div>
            <div className="bg-[#F8FAFC] rounded-xl p-2.5 text-center border border-[#E2E8F0]">
              <p className="text-[10px] text-[#64748B] font-bold">점포 평점</p>
              <p className="text-base font-extrabold text-[#0052FF] mt-0.5">4.9 ★</p>
            </div>
          </div>
        </section>
      ) : (
        <section className="bg-surface-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-[#E2E8F0] p-4 flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 border border-[#E2E8F0] shadow-sm bg-slate-100 flex items-center justify-center">
            <img
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDcHzZ60qpOclzTvC9ns9AWyb8Pe3-RivCY0NM4Gy5yq0hSS0hYHZx4KKNp3rER9I9nLQxfK0fcDToyDr1fhZeIx2jjKF23ac32J7TUvKASIGW78c_Q1rQYNdHxYMUa0mP2z5LgBDBjV2kooMCd9HcwvomXGIwIEto-tTHZAWKjSr0m3L6730mCh12UAHy8a_JlzVgO2UMusF48EsVoNRBJ2cehdbIAw1N7YxEbZhXkok7ox-Y2SOCmgw"
              alt="프로필 이미지"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[11px] font-extrabold px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200">
                스마트 장보기 회원
              </span>
            </div>
            <h2 className="text-lg font-bold text-on-surface truncate">
              {userDisplayName || "스마트 장보기 회원"}
            </h2>
          </div>
        </section>
      )}

      {/* Membership Mode Switching Dedicated Card */}
      {onOpenLogin && (
        <section className="bg-gradient-to-r from-blue-50 via-slate-50 to-indigo-50 border border-blue-200/80 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white border border-blue-200 flex items-center justify-center text-[#0052FF] shadow-xs shrink-0">
              <span className="material-symbols-outlined text-xl">manage_accounts</span>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-500">회원 유형 관리</div>
              <div className="text-sm font-extrabold text-slate-800 truncate">
                현재: {userRole === "merchant" ? "판매자(상인) 모드" : "구매자 모드"}
              </div>
            </div>
          </div>
          <button
            onClick={onOpenLogin}
            className="bg-[#0052FF] hover:bg-[#0046E0] text-white px-3.5 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 shadow-sm shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            <span>유형 변경</span>
            <span className="material-symbols-outlined text-sm">swap_horiz</span>
          </button>
        </section>
      )}

      {/* Additional Merchant Store Details */}
      {userRole === "merchant" && (
        <section className="bg-white rounded-2xl p-4 border border-[#E2E8F0] shadow-xs space-y-3">
          <h3 className="text-xs font-bold text-[#64748B] uppercase tracking-wider flex items-center gap-1.5">
            <span className="material-symbols-outlined text-base text-[#0052FF]">info</span>
            점포 기본 상세 정보
          </h3>
          <div className="space-y-2 text-xs divide-y divide-[#F1F5F9]">
            <div className="flex justify-between py-1.5">
              <span className="text-[#64748B]">상호명</span>
              <span className="font-extrabold text-[#0F172A]">{shopName}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-[#64748B]">소속 전통시장</span>
              <span className="font-extrabold text-[#0052FF]">광주 양동전통시장</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-[#64748B]">대표 업종</span>
              <span className="font-extrabold text-[#0F172A]">수산물 / 당일 산지 직송</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-[#64748B]">전화번호</span>
              <span className="font-bold text-[#334155]">062-365-1234</span>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};


