import React, { useState } from "react";
import { QuestItem, CouponItem } from "../types";
import { UserRole } from "./LoginModal";

interface MyWalletProps {
  quests: QuestItem[];
  coupons: CouponItem[];
  onUseCoupon: (couponId: string) => void;
  onNavigateToMap: () => void;
  userRole?: UserRole;
  userDisplayName?: string;
  onOpenLogin?: () => void;
}

export const MyWallet: React.FC<MyWalletProps> = ({
  quests,
  coupons,
  onUseCoupon,
  onNavigateToMap,
  userRole = "customer",
  userDisplayName,
  onOpenLogin,
}) => {
  const [selectedCoupon, setSelectedCoupon] = useState<CouponItem | null>(null);
  const [isRedeemed, setIsRedeemed] = useState(false);

  const handleRedeem = (c: CouponItem) => {
    setSelectedCoupon(c);
    setIsRedeemed(false);
  };

  const confirmRedeem = () => {
    if (selectedCoupon) {
      onUseCoupon(selectedCoupon.id);
      setIsRedeemed(true);
      setTimeout(() => {
        setSelectedCoupon(null);
      }, 2000);
    }
  };

  return (
    <div className="w-full max-w-[600px] mx-auto pt-20 pb-28 px-4 space-y-6">
      {/* Profile Card */}
      <section className="bg-surface-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-[#E2E8F0] p-4 flex items-center gap-4">
        <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 border border-[#E2E8F0] shadow-sm bg-slate-100 flex items-center justify-center">
          {userRole === "merchant" ? (
            <span className="material-symbols-outlined text-3xl text-amber-600">storefront</span>
          ) : (
            <img
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDcHzZ60qpOclzTvC9ns9AWyb8Pe3-RivCY0NM4Gy5yq0hSS0hYHZx4KKNp3rER9I9nLQxfK0fcDToyDr1fhZeIx2jjKF23ac32J7TUvKASIGW78c_Q1rQYNdHxYMUa0mP2z5LgBDBjV2kooMCd9HcwvomXGIwIEto-tTHZAWKjSr0m3L6730mCh12UAHy8a_JlzVgO2UMusF48EsVoNRBJ2cehdbIAw1N7YxEbZhXkok7ox-Y2SOCmgw"
              alt="프로필 이미지"
              className="w-full h-full object-cover"
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className={`text-[11px] font-extrabold px-2 py-0.5 rounded ${
                userRole === "merchant"
                  ? "bg-amber-100 text-amber-800 border border-amber-200"
                  : "bg-blue-100 text-blue-800 border border-blue-200"
              }`}
            >
              {userRole === "merchant" ? "인증 전통시장 상인" : "스마트 장보기 회원"}
            </span>
          </div>
          <h2 className="text-lg font-bold text-on-surface truncate">
            {userDisplayName || (userRole === "merchant" ? "양동수산 사장님" : "스마트 장보기 회원")}
          </h2>
        </div>
      </section>

      {/* Membership Mode Switching Dedicated Card */}
      {onOpenLogin && (
        <section className="bg-gradient-to-r from-blue-50 via-slate-50 to-indigo-50 border border-blue-200/80 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white border border-blue-200 flex items-center justify-center text-trust-blue shadow-xs shrink-0">
              <span className="material-symbols-outlined text-xl">account_circle</span>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-500">회원 유형 관리</div>
              <div className="text-sm font-extrabold text-slate-800 truncate">
                현재: {userRole === "merchant" ? "판매자(상인) 모드" : "스마트 장보기 회원 모드"}
              </div>
            </div>
          </div>
          <button
            onClick={onOpenLogin}
            className="bg-[#0052FF] hover:bg-[#0046E0] text-white px-3.5 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 shadow-sm shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            <span>회원 유형 변경</span>
            <span className="material-symbols-outlined text-sm">swap_horiz</span>
          </button>
        </section>
      )}

      {/* ESG Data Wallet Section */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-outline uppercase tracking-wider flex items-center gap-1">
          <span className="material-symbols-outlined text-base text-[#10B981]">park</span>
          ESG 데이터 지갑
        </h3>

        <div className="grid grid-cols-2 gap-3">
          {/* Carbon XP */}
          <div className="bg-surface-white border border-[#E2E8F0] rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-bold text-outline">탄소 절감 포인트</span>
              <span className="material-symbols-outlined text-[#10B981]">park</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-extrabold text-on-surface">1,240</span>
              <span className="text-xs font-semibold text-outline">XP</span>
            </div>
          </div>

          {/* Synergy Points */}
          <div className="bg-surface-white border border-[#E2E8F0] rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-bold text-outline">상생 적립금</span>
              <span className="material-symbols-outlined text-trust-blue" style={{ fontVariationSettings: "'FILL' 1" }}>
                favorite
              </span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-extrabold text-trust-blue">4,500</span>
              <span className="text-xs font-semibold text-outline">P</span>
            </div>
          </div>
        </div>
      </section>

      {/* Active Quests Section */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-outline uppercase tracking-wider flex items-center gap-1">
          <span className="material-symbols-outlined text-base text-trust-blue">explore</span>
          진행 중인 크로스셀링 퀘스트
        </h3>

        <div className="space-y-3">
          {quests.map((q) => (
            <div
              key={q.id}
              className="bg-surface-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-[#E2E8F0] p-4 space-y-3"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-surface-container-low border border-[#E2E8F0] flex items-center justify-center text-trust-blue">
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                      soup_kitchen
                    </span>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-outline">{q.marketName}</p>
                    <p className="text-base font-bold text-on-surface">{q.title}</p>
                  </div>
                </div>
                <span className="text-trust-blue font-extrabold text-lg">{q.progressPercent}%</span>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-2 bg-surface-container-low border border-[#E2E8F0] rounded-full overflow-hidden">
                <div
                  className="h-full bg-trust-blue rounded-full relative transition-all duration-500"
                  style={{ width: `${q.progressPercent}%` }}
                ></div>
              </div>

              <div className="flex justify-between items-center text-xs">
                <span className="text-outline font-medium">{q.remainingMessage}</span>
                <button
                  onClick={onNavigateToMap}
                  className="font-bold text-trust-blue hover:underline flex items-center gap-0.5"
                >
                  동선 지도보기
                  <span className="material-symbols-outlined text-sm">chevron_right</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Coupon Wallet Section */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-on-surface-variant flex items-center gap-1">
          <span className="material-symbols-outlined text-base text-caution-amber">confirmation_number</span>
          내 쿠폰함
        </h3>

        <div className="space-y-3">
          {coupons.map((c) => (
            <div
              key={c.id}
              className={`coupon-ticket flex ${c.isUsed ? "opacity-50 grayscale" : ""}`}
              style={{
                borderLeftColor:
                  c.badgeType === "emerald"
                    ? "#10B981"
                    : c.badgeType === "amber"
                    ? "#F59E0B"
                    : "#0052FF",
              }}
            >
              <div className="flex-1 p-4 py-5 flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className={`text-white text-[10px] font-bold px-2 py-0.5 rounded ${
                      c.badgeType === "emerald"
                        ? "bg-safe-emerald"
                        : c.badgeType === "amber"
                        ? "bg-caution-amber"
                        : "bg-trust-blue"
                    }`}
                  >
                    {c.badgeText}
                  </span>
                  <span className="text-xs font-semibold text-outline">{c.shopName}</span>
                </div>
                <h4 className="text-lg font-bold text-on-surface mb-1">{c.title}</h4>
                <p className="text-xs font-medium text-outline">유효기간: {c.expiryDate}</p>
              </div>

              <div
                onClick={() => !c.isUsed && handleRedeem(c)}
                className="w-20 coupon-divider flex flex-col items-center justify-center bg-surface-container-low/50 relative cursor-pointer hover:bg-surface-container transition-colors"
              >
                <span className="text-xs font-extrabold text-trust-blue -rotate-90 whitespace-nowrap tracking-widest">
                  {c.isUsed ? "사용완료" : "사용하기"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Coupon Redemption Modal */}
      {selectedCoupon && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-white rounded-3xl p-6 w-full max-w-sm text-center space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b pb-3">
              <span className="text-xs font-bold text-trust-blue">{selectedCoupon.shopName}</span>
              <button onClick={() => setSelectedCoupon(null)} className="text-outline">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {isRedeemed ? (
              <div className="py-6 space-y-2">
                <div className="w-16 h-16 bg-safe-emerald text-white rounded-full flex items-center justify-center mx-auto text-3xl shadow-lg">
                  <span className="material-symbols-outlined">check</span>
                </div>
                <h3 className="text-xl font-bold text-on-surface">쿠폰 사용이 완료되었습니다!</h3>
                <p className="text-xs text-outline">상생 적립금 +100P 가 적립되었습니다.</p>
              </div>
            ) : (
              <>
                <div>
                  <h3 className="text-xl font-bold text-on-surface">{selectedCoupon.title}</h3>
                  <p className="text-xs text-outline mt-1">
                    매대 사장님께 바코드를 보여주시면 즉시 할인 적용됩니다.
                  </p>
                </div>

                {/* Simulated Barcode */}
                <div className="bg-surface-container-low p-4 rounded-2xl border border-outline-variant/30 space-y-2">
                  <div className="h-16 bg-white border border-dashed border-outline-variant rounded flex items-center justify-center tracking-widest font-mono text-lg font-bold text-on-surface">
                    |||| ||| |||||| ||||
                  </div>
                  <div className="text-xs font-mono text-outline">{selectedCoupon.barcode}</div>
                </div>

                <button
                  onClick={confirmRedeem}
                  className="w-full bg-trust-blue text-white py-3.5 rounded-2xl text-sm font-bold shadow-md hover:bg-trust-blue/90"
                >
                  사장님 확인 (쿠폰 사용하기)
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
