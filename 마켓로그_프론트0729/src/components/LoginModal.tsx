import React, { useState } from "react";

export type UserRole = "customer" | "merchant";

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (role: UserRole, userDisplayName: string) => void;
  currentRole?: UserRole;
  isFullScreen?: boolean;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  isFullScreen = true,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [merchantShopName, setMerchantShopName] = useState("");
  const [showMerchantDetailInput, setShowMerchantDetailInput] = useState(false);

  if (!isOpen) return null;

  const handleSelectCustomer = () => {
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      onLoginSuccess("customer", "스마트 장보기 회원");
      onClose();
    }, 300);
  };

  const handleSelectMerchant = () => {
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      const name = merchantShopName.trim() || "양동수산 사장님";
      onLoginSuccess("merchant", name);
      onClose();
    }, 300);
  };

  const handleEasyLogin = (providerName: string) => {
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      onLoginSuccess("customer", `${providerName} 회원`);
      onClose();
    }, 300);
  };

  // Main Login Layout Content
  const renderLoginBody = (isModal: boolean) => (
    <div className={`w-full flex flex-col justify-between ${isModal ? 'p-6 space-y-6' : 'min-h-screen py-8 px-6 sm:px-10 max-w-md mx-auto space-y-8'} relative z-10`}>
      
      {/* Optional Close Button for Modal Mode */}
      {isModal && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors z-20"
          title="닫기"
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      )}

      {/* 1. Header Logo & Title Block */}
      <div className="text-center pt-4 sm:pt-6 space-y-3">
        {/* Blue Wallet App Icon */}
        <div className="w-18 h-18 sm:w-22 sm:h-22 bg-[#0052FF] rounded-[24px] flex items-center justify-center text-white shadow-2xl shadow-blue-500/35 mx-auto relative group transition-transform hover:scale-105">
          <span
            className="material-symbols-outlined text-4xl sm:text-5xl font-bold"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            account_balance_wallet
          </span>
        </div>

        {/* App Title */}
        <h1 className="text-3xl sm:text-4xl font-extrabold text-[#0F172A] tracking-tight pt-2">
          MarketLog
        </h1>

        {/* Subtitles */}
        <div className="space-y-1">
          <p className="text-sm sm:text-base font-semibold text-[#64748B]">
            신뢰 기반 AI 유통 플랫폼
          </p>
          <p className="text-sm sm:text-base font-extrabold text-[#0052FF]">
            전통시장 혁신의 새로운 기준
          </p>
        </div>
      </div>

      {/* 2. Primary Role Buttons Card Container */}
      <div className="space-y-4 my-auto">
        {/* Button 1: 일반 고객 로그인 */}
        <button
          type="button"
          onClick={handleSelectCustomer}
          disabled={isSubmitting}
          className="w-full bg-[#0052FF] hover:bg-[#0046E0] active:scale-[0.98] text-white p-4 sm:p-5 rounded-2xl shadow-xl shadow-blue-500/30 transition-all text-center flex flex-col items-center justify-center space-y-1 group"
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-2xl font-bold">
              shopping_basket
            </span>
            <span className="text-lg sm:text-xl font-extrabold tracking-tight">
              일반 고객 로그인
            </span>
          </div>
          <p className="text-xs sm:text-sm text-blue-100 font-medium">
            스마트한 장보기와 혜택을 경험하세요
          </p>
        </button>

        {/* Button 2: 판매자 로그인 */}
        <button
          type="button"
          onClick={() => {
            if (!showMerchantDetailInput) {
              setShowMerchantDetailInput(true);
            } else {
              handleSelectMerchant();
            }
          }}
          disabled={isSubmitting}
          className="w-full bg-white hover:bg-blue-50/50 active:scale-[0.98] text-[#0052FF] p-4 sm:p-5 rounded-2xl shadow-sm border border-[#BFDBFE] hover:border-[#60A5FA] transition-all text-center flex flex-col items-center justify-center space-y-1 group"
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-2xl font-bold text-[#0052FF]">
              storefront
            </span>
            <span className="text-lg sm:text-xl font-extrabold tracking-tight text-[#0052FF]">
              판매자 로그인
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[#64748B] font-medium">
            AI 물류와 재고 관리를 한눈에
          </p>
        </button>

        {/* Optional Merchant Shop Name Prompt if merchant selected */}
        {showMerchantDetailInput && (
          <div className="bg-[#EFF6FF] p-4 rounded-2xl border border-[#BFDBFE] space-y-2.5 animate-in fade-in duration-200">
            <div className="text-xs font-bold text-[#1E293B] flex items-center justify-between">
              <span>점포 상호명 입력 (선택)</span>
              <span className="text-[10px] text-[#0052FF] font-bold">상인 전용 모드</span>
            </div>
            <input
              type="text"
              value={merchantShopName}
              onChange={(e) => setMerchantShopName(e.target.value)}
              placeholder="예: 양동수산, 호남상회 (기본: 양동수산 사장님)"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm focus:outline-none focus:border-[#0052FF] bg-white text-[#0F172A]"
            />
            <button
              type="button"
              onClick={handleSelectMerchant}
              className="w-full py-2.5 bg-[#0052FF] text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-[#0046E0] transition-colors"
            >
              상인 모드로 로그인 입장
            </button>
          </div>
        )}

        {/* 3. Signup / Find ID Sublinks */}
        <div className="flex items-center justify-center gap-4 text-xs sm:text-sm font-bold text-[#334155] pt-2">
          <button
            type="button"
            onClick={() => handleEasyLogin("회원가입")}
            className="hover:text-[#0052FF] transition-colors"
          >
            회원가입
          </button>
          <span className="text-slate-300 font-normal">|</span>
          <button
            type="button"
            onClick={() => alert("아이디/비밀번호 찾기 페이지로 이동합니다.")}
            className="hover:text-[#0052FF] transition-colors"
          >
            아이디/비밀번호 찾기
          </button>
        </div>

        {/* 4. Social Easy Login Divider & Circular Icons */}
        <div className="space-y-4 pt-3">
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <span className="relative bg-[#F8FAFC] px-3 text-xs font-bold text-[#94A3B8]">
              간편 로그인
            </span>
          </div>

          <div className="pt-1">
            {/* Google Login Button */}
            <button
              type="button"
              onClick={() => handleEasyLogin("구글")}
              className="w-full bg-white hover:bg-slate-50 active:scale-[0.98] text-[#1E293B] py-3.5 px-4 rounded-xl border border-slate-300 shadow-sm flex items-center justify-center gap-3 transition-all font-semibold text-sm sm:text-base cursor-pointer"
            >
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Google 계정으로 로그인</span>
            </button>
          </div>
        </div>
      </div>

      {/* 5. Footer Copyright */}
      <div className="text-center pt-4 space-y-0.5 border-t border-slate-200/60">
        <p className="text-xs text-[#94A3B8] font-medium">
          © 2024 MarketLog AI Logistics Corp.
        </p>
        <p className="text-xs text-[#94A3B8] font-medium">
          모든 권리 보유.
        </p>
      </div>
    </div>
  );

  if (isFullScreen) {
    return (
      <div className="min-h-screen w-full bg-gradient-to-b from-[#EFF6FF] via-[#F8FAFC] to-[#F1F5F9] flex flex-col justify-center items-center overflow-x-hidden animate-in fade-in duration-300">
        {renderLoginBody(false)}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-sm sm:max-w-md rounded-3xl shadow-2xl border border-blue-100/80 relative overflow-hidden my-auto max-h-[90vh] overflow-y-auto">
        {renderLoginBody(true)}
      </div>
    </div>
  );
};
