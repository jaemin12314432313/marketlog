import React, { useState } from "react";
import { login, register, setAuthToken } from "../lib/api";

export type UserRole = "customer" | "merchant";
type ViewMode = "login" | "signup" | "findId" | "findPw";

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (role: UserRole, userDisplayName: string, shopName?: string) => void;
  currentRole?: UserRole;
  isFullScreen?: boolean;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  isFullScreen = true,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>("login");
  const [selectedRole, setSelectedRole] = useState<UserRole>("customer");

  // Login Form States
  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [merchantShopName, setMerchantShopName] = useState("양동수산");
  const [loginError, setLoginError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Signup Form States
  const [signupName, setSignupName] = useState("");
  const [signupId, setSignupId] = useState("");
  const [signupPw, setSignupPw] = useState("");
  const [signupPwConfirm, setSignupPwConfirm] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupShopName, setSignupShopName] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(true);
  const [signupSuccessMsg, setSignupSuccessMsg] = useState("");

  // Find ID Form States
  const [findIdName, setFindIdName] = useState("");
  const [findIdPhone, setFindIdPhone] = useState("");
  const [foundIdResult, setFoundIdResult] = useState<string | null>(null);

  // Find Password Form States
  const [findPwId, setFindPwId] = useState("");
  const [findPwPhone, setFindPwPhone] = useState("");
  const [foundPwResult, setFoundPwResult] = useState<string | null>(null);

  if (!isOpen) return null;

  // Handle Login Submit
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");

    if (!loginId.trim()) {
      setLoginError("이메일을 입력해주세요.");
      return;
    }
    if (!loginPw.trim()) {
      setLoginError("비밀번호를 입력해주세요.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await login({ email: loginId.trim(), password: loginPw });
      setAuthToken(res.token);
      onLoginSuccess(res.user.role, res.user.displayName, res.user.shopName ?? undefined);
      onClose();
    } catch (err) {
      setLoginError("이메일 또는 비밀번호가 올바르지 않습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Easy Social Login
  const handleEasyLogin = (providerName: string) => {
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      onLoginSuccess("customer", `${providerName} 회원`);
      onClose();
    }, 300);
  };

  // Handle Signup Submit
  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signupName.trim()) {
      alert("이름을 입력해주세요.");
      return;
    }
    if (!signupId.trim()) {
      alert("이메일을 입력해주세요.");
      return;
    }
    if (!signupPw) {
      alert("비밀번호를 입력해주세요.");
      return;
    }
    if (signupPw.length < 8) {
      alert("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (signupPw !== signupPwConfirm) {
      alert("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    if (!signupPhone.trim()) {
      alert("휴대폰 번호를 입력해주세요.");
      return;
    }
    if (!agreeTerms) {
      alert("서비스 이용약관에 동의해주세요.");
      return;
    }
    if (selectedRole === "merchant" && !signupShopName.trim()) {
      alert("점포 상호명을 입력해주세요.");
      return;
    }

    setIsSubmitting(true);
    try {
      await register({
        email: signupId.trim(),
        password: signupPw,
        role: selectedRole,
        displayName: signupName.trim(),
        shopName: selectedRole === "merchant" ? signupShopName.trim() : undefined,
      });
      setLoginId(signupId.trim());
      setSignupSuccessMsg(`${signupName}님의 회원가입이 정상 완료되었습니다! 가입한 이메일로 로그인해보세요.`);
    } catch (err: any) {
      const message = String(err?.message || "");
      alert(message.includes("409") ? "이미 가입된 이메일입니다." : "회원가입에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Find ID Submit
  const handleFindIdSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!findIdName.trim() || !findIdPhone.trim()) {
      alert("이름과 휴대폰 번호를 모두 입력해주세요.");
      return;
    }
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      const generatedId = findIdName.trim() === "홍길동" ? "gildong123" : `${findIdName.trim().toLowerCase()}_market`;
      setFoundIdResult(generatedId);
    }, 400);
  };

  // Handle Find Password Submit
  const handleFindPwSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!findPwId.trim() || !findPwPhone.trim()) {
      alert("아이디와 휴대폰 번호를 모두 입력해주세요.");
      return;
    }
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setFoundPwResult(`임시 비밀번호가 발송되었습니다: market${Math.floor(1000 + Math.random() * 9000)}!`);
    }, 400);
  };

  // Reset Subviews
  const resetToLogin = () => {
    setViewMode("login");
    setLoginError("");
    setSignupSuccessMsg("");
    setFoundIdResult(null);
    setFoundPwResult(null);
  };

  // Render Core Content per ViewMode
  const renderLoginBody = (isModal: boolean) => (
    <div className={`w-full flex flex-col justify-between ${isModal ? 'p-6 space-y-6' : 'min-h-screen py-8 px-6 sm:px-10 max-w-md mx-auto space-y-6'} relative z-10`}>
      
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
      <div className="text-center pt-2 sm:pt-4 space-y-2">
        {/* Blue Wallet App Icon */}
        <div className="w-16 h-16 sm:w-20 sm:h-20 bg-[#0052FF] rounded-[22px] flex items-center justify-center text-white shadow-xl shadow-blue-500/30 mx-auto relative group transition-transform hover:scale-105">
          <span
            className="material-symbols-outlined text-3xl sm:text-4xl font-bold"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            account_balance_wallet
          </span>
        </div>

        {/* App Title */}
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight pt-1">
          MarketLog
        </h1>

        <p className="text-xs sm:text-sm font-bold text-[#0052FF]">
          {viewMode === "login" && "신뢰 기반 AI 유통 전통시장 플랫폼"}
          {viewMode === "signup" && "MarketLog 신규 회원가입"}
          {viewMode === "findId" && "아이디 찾기"}
          {viewMode === "findPw" && "비밀번호 찾기 / 재설정"}
        </p>
      </div>

      {/* -------------------------------------------------------------
          MODE 1: LOGIN FORM
         ------------------------------------------------------------- */}
      {viewMode === "login" && (
        <div className="space-y-4 my-auto animate-in fade-in duration-200">
          {/* Role Toggle Tab (Customer vs Merchant) */}
          <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-2xl border border-slate-200">
            <button
              type="button"
              onClick={() => setSelectedRole("customer")}
              className={`py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all flex items-center justify-center gap-1.5 ${
                selectedRole === "customer"
                  ? "bg-white text-[#0052FF] shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <span className="material-symbols-outlined text-base">shopping_basket</span>
              일반 고객
            </button>

            <button
              type="button"
              onClick={() => setSelectedRole("merchant")}
              className={`py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all flex items-center justify-center gap-1.5 ${
                selectedRole === "merchant"
                  ? "bg-white text-[#0052FF] shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <span className="material-symbols-outlined text-base">storefront</span>
              판매자 (상인)
            </button>
          </div>

          {/* Actual Login Input Form */}
          <form onSubmit={handleLoginSubmit} className="space-y-3 pt-1">
            {/* ID Input */}
            <div className="space-y-1">
              <label className="text-xs font-extrabold text-slate-700 flex items-center justify-between">
                <span>이메일</span>
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-lg">
                  person
                </span>
                <input
                  type="email"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="example@email.com"
                  className="w-full pl-10 pr-4 py-3 bg-white rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-[#0052FF] focus:ring-1 focus:ring-[#0052FF] font-medium transition-all"
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1">
              <label className="text-xs font-extrabold text-slate-700 flex items-center justify-between">
                <span>비밀번호</span>
                <span className="text-[10px] text-slate-400 font-normal">6자리 이상</span>
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-lg">
                  lock
                </span>
                <input
                  type="password"
                  value={loginPw}
                  onChange={(e) => setLoginPw(e.target.value)}
                  placeholder="비밀번호를 입력하세요"
                  className="w-full pl-10 pr-4 py-3 bg-white rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-[#0052FF] focus:ring-1 focus:ring-[#0052FF] font-medium transition-all"
                />
              </div>
            </div>

            {/* Error Message if any */}
            {loginError && (
              <p className="text-xs font-bold text-red-500 bg-red-50 p-2.5 rounded-lg border border-red-100 text-center">
                {loginError}
              </p>
            )}

            {/* Submit Login Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-[#0052FF] hover:bg-[#0046E0] active:scale-[0.98] text-white py-3.5 px-4 rounded-xl shadow-lg shadow-blue-500/25 transition-all text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              {isSubmitting ? (
                <span>로그인 처리 중...</span>
              ) : (
                <>
                  <span>로그인</span>
                  <span className="material-symbols-outlined text-lg">arrow_forward</span>
                </>
              )}
            </button>
          </form>

          {/* Sublinks: Signup | Find ID | Find PW */}
          <div className="flex items-center justify-center gap-3 text-xs font-bold text-[#475569] pt-2">
            <button
              type="button"
              onClick={() => {
                setViewMode("signup");
                setSignupSuccessMsg("");
              }}
              className="hover:text-[#0052FF] transition-colors"
            >
              회원가입
            </button>
            <span className="text-slate-300 font-normal">|</span>
            <button
              type="button"
              onClick={() => {
                setViewMode("findId");
                setFoundIdResult(null);
              }}
              className="hover:text-[#0052FF] transition-colors"
            >
              아이디 찾기
            </button>
            <span className="text-slate-300 font-normal">|</span>
            <button
              type="button"
              onClick={() => {
                setViewMode("findPw");
                setFoundPwResult(null);
              }}
              className="hover:text-[#0052FF] transition-colors"
            >
              비밀번호 찾기
            </button>
          </div>


        </div>
      )}

      {/* -------------------------------------------------------------
          MODE 2: SIGNUP FORM
         ------------------------------------------------------------- */}
      {viewMode === "signup" && (
        <div className="space-y-4 my-auto animate-in fade-in duration-200">
          {signupSuccessMsg ? (
            <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-4">
              <div className="w-12 h-12 bg-emerald-500 text-white rounded-full flex items-center justify-center mx-auto shadow-md">
                <span className="material-symbols-outlined text-2xl font-bold">check</span>
              </div>
              <div>
                <h3 className="font-extrabold text-slate-900 text-base">가입이 완료되었습니다!</h3>
                <p className="text-xs text-slate-600 font-medium mt-1 leading-relaxed">
                  {signupSuccessMsg}
                </p>
              </div>
              <button
                onClick={resetToLogin}
                className="w-full py-3 bg-[#0052FF] text-white rounded-xl text-xs font-bold shadow-md hover:bg-[#0046E0] transition-colors"
              >
                로그인 화면으로 이동
              </button>
            </div>
          ) : (
            <form onSubmit={handleSignupSubmit} className="space-y-3">
              {/* Role Option */}
              <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl text-xs font-bold mb-2">
                <button
                  type="button"
                  onClick={() => setSelectedRole("customer")}
                  className={`py-2 rounded-lg transition-all ${
                    selectedRole === "customer" ? "bg-white text-[#0052FF] shadow-xs" : "text-slate-500"
                  }`}
                >
                  일반 고객 가입
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRole("merchant")}
                  className={`py-2 rounded-lg transition-all ${
                    selectedRole === "merchant" ? "bg-white text-[#0052FF] shadow-xs" : "text-slate-500"
                  }`}
                >
                  상인(판매자) 가입
                </button>
              </div>

              {/* Name */}
              <div className="space-y-1">
                <label className="text-xs font-extrabold text-slate-700">이름</label>
                <input
                  type="text"
                  value={signupName}
                  onChange={(e) => setSignupName(e.target.value)}
                  placeholder="이름을 입력하세요 (예: 홍길동)"
                  className="w-full px-3.5 py-2.5 bg-white rounded-xl border border-slate-200 text-xs sm:text-sm focus:outline-none focus:border-[#0052FF]"
                />
              </div>

              {/* Email */}
              <div className="space-y-1">
                <label className="text-xs font-extrabold text-slate-700">이메일</label>
                <input
                  type="email"
                  value={signupId}
                  onChange={(e) => setSignupId(e.target.value)}
                  placeholder="example@email.com"
                  className="w-full px-3.5 py-2.5 bg-white rounded-xl border border-slate-200 text-xs sm:text-sm focus:outline-none focus:border-[#0052FF]"
                />
              </div>

              {/* Password */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-extrabold text-slate-700">비밀번호</label>
                  <input
                    type="password"
                    value={signupPw}
                    onChange={(e) => setSignupPw(e.target.value)}
                    placeholder="비밀번호"
                    className="w-full px-3 py-2.5 bg-white rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-[#0052FF]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-extrabold text-slate-700">비밀번호 확인</label>
                  <input
                    type="password"
                    value={signupPwConfirm}
                    onChange={(e) => setSignupPwConfirm(e.target.value)}
                    placeholder="재입력"
                    className="w-full px-3 py-2.5 bg-white rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-[#0052FF]"
                  />
                </div>
              </div>

              {/* Phone */}
              <div className="space-y-1">
                <label className="text-xs font-extrabold text-slate-700">휴대폰 번호</label>
                <input
                  type="tel"
                  value={signupPhone}
                  onChange={(e) => setSignupPhone(e.target.value)}
                  placeholder="'-' 없이 숫자만 입력 (예: 01012345678)"
                  className="w-full px-3.5 py-2.5 bg-white rounded-xl border border-slate-200 text-xs sm:text-sm focus:outline-none focus:border-[#0052FF]"
                />
              </div>

              {/* Shop Name if Merchant */}
              {selectedRole === "merchant" && (
                <div className="space-y-1 bg-blue-50/70 p-3 rounded-xl border border-blue-100">
                  <label className="text-xs font-extrabold text-[#0052FF]">점포 상호명</label>
                  <input
                    type="text"
                    value={signupShopName}
                    onChange={(e) => setSignupShopName(e.target.value)}
                    placeholder="예: 양동수산, 남도과일"
                    className="w-full px-3 py-2 bg-white rounded-lg border border-slate-200 text-xs"
                  />
                </div>
              )}

              {/* Agreement */}
              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="rounded text-[#0052FF] focus:ring-0 w-4 h-4"
                />
                <span className="text-xs text-slate-600 font-medium">
                  [필수] 서비스 이용약관 및 개인정보 처리방침 동의
                </span>
              </label>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-[#0052FF] hover:bg-[#0046E0] text-white py-3 rounded-xl font-extrabold text-xs sm:text-sm shadow-md transition-all cursor-pointer mt-2"
              >
                {isSubmitting ? "가입 처리 중..." : "회원가입 완료"}
              </button>

              <button
                type="button"
                onClick={resetToLogin}
                className="w-full py-2 text-center text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors"
              >
                ← 로그인 화면으로 돌아가기
              </button>
            </form>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------
          MODE 3: FIND ID FORM
         ------------------------------------------------------------- */}
      {viewMode === "findId" && (
        <div className="space-y-4 my-auto animate-in fade-in duration-200">
          {foundIdResult ? (
            <div className="p-5 bg-blue-50 border border-blue-200 rounded-2xl text-center space-y-4">
              <div className="w-12 h-12 bg-[#0052FF] text-white rounded-full flex items-center justify-center mx-auto shadow-md">
                <span className="material-symbols-outlined text-2xl font-bold">badge</span>
              </div>
              <div>
                <span className="text-xs font-bold text-slate-500">조회된 가입 아이디</span>
                <h3 className="text-xl font-black text-[#0052FF] mt-1">{foundIdResult}</h3>
              </div>
              <div className="space-y-2 pt-2">
                <button
                  onClick={() => {
                    setLoginId(foundIdResult);
                    resetToLogin();
                  }}
                  className="w-full py-3 bg-[#0052FF] text-white rounded-xl text-xs font-bold shadow-md hover:bg-[#0046E0] transition-colors"
                >
                  이 아이디로 로그인하기
                </button>
                <button
                  onClick={() => {
                    setViewMode("findPw");
                    setFindPwId(foundIdResult);
                  }}
                  className="w-full py-2 text-xs font-bold text-slate-600 hover:text-[#0052FF]"
                >
                  비밀번호도 찾으시나요?
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleFindIdSubmit} className="space-y-3">
              <p className="text-xs text-slate-500 font-medium">
                가입 시 등록하신 이름과 휴대폰 번호를 입력해주세요.
              </p>

              <div className="space-y-1">
                <label className="text-xs font-extrabold text-slate-700">이름</label>
                <input
                  type="text"
                  value={findIdName}
                  onChange={(e) => setFindIdName(e.target.value)}
                  placeholder="이름 입력 (예: 홍길동)"
                  className="w-full px-3.5 py-2.5 bg-white rounded-xl border border-slate-200 text-xs sm:text-sm focus:outline-none focus:border-[#0052FF]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-extrabold text-slate-700">휴대폰 번호</label>
                <input
                  type="tel"
                  value={findIdPhone}
                  onChange={(e) => setFindIdPhone(e.target.value)}
                  placeholder="'-' 없이 숫자만 입력"
                  className="w-full px-3.5 py-2.5 bg-white rounded-xl border border-slate-200 text-xs sm:text-sm focus:outline-none focus:border-[#0052FF]"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-[#0052FF] hover:bg-[#0046E0] text-white py-3 rounded-xl font-extrabold text-xs sm:text-sm shadow-md transition-all cursor-pointer mt-2"
              >
                {isSubmitting ? "조회 중..." : "아이디 찾기"}
              </button>

              <button
                type="button"
                onClick={resetToLogin}
                className="w-full py-2 text-center text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors"
              >
                ← 로그인 화면으로 돌아가기
              </button>
            </form>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------
          MODE 4: FIND PASSWORD FORM
         ------------------------------------------------------------- */}
      {viewMode === "findPw" && (
        <div className="space-y-4 my-auto animate-in fade-in duration-200">
          {foundPwResult ? (
            <div className="p-5 bg-blue-50 border border-blue-200 rounded-2xl text-center space-y-4">
              <div className="w-12 h-12 bg-amber-500 text-white rounded-full flex items-center justify-center mx-auto shadow-md">
                <span className="material-symbols-outlined text-2xl font-bold">lock_reset</span>
              </div>
              <div>
                <h3 className="font-extrabold text-slate-900 text-sm">임시 비밀번호가 발송되었습니다</h3>
                <p className="text-xs text-[#0052FF] font-black mt-2 bg-white py-2 px-3 rounded-lg border border-blue-100 inline-block">
                  {foundPwResult}
                </p>
              </div>
              <button
                onClick={resetToLogin}
                className="w-full py-3 bg-[#0052FF] text-white rounded-xl text-xs font-bold shadow-md hover:bg-[#0046E0] transition-colors"
              >
                새 비밀번호로 로그인하기
              </button>
            </div>
          ) : (
            <form onSubmit={handleFindPwSubmit} className="space-y-3">
              <p className="text-xs text-slate-500 font-medium">
                가입하신 아이디와 휴대폰 번호를 입력하시면 임시 비밀번호를 발송해 드립니다.
              </p>

              <div className="space-y-1">
                <label className="text-xs font-extrabold text-slate-700">아이디</label>
                <input
                  type="text"
                  value={findPwId}
                  onChange={(e) => setFindPwId(e.target.value)}
                  placeholder="가입한 아이디 입력"
                  className="w-full px-3.5 py-2.5 bg-white rounded-xl border border-slate-200 text-xs sm:text-sm focus:outline-none focus:border-[#0052FF]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-extrabold text-slate-700">휴대폰 번호</label>
                <input
                  type="tel"
                  value={findPwPhone}
                  onChange={(e) => setFindPwPhone(e.target.value)}
                  placeholder="'-' 없이 숫자만 입력"
                  className="w-full px-3.5 py-2.5 bg-white rounded-xl border border-slate-200 text-xs sm:text-sm focus:outline-none focus:border-[#0052FF]"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-[#0052FF] hover:bg-[#0046E0] text-white py-3 rounded-xl font-extrabold text-xs sm:text-sm shadow-md transition-all cursor-pointer mt-2"
              >
                {isSubmitting ? "전송 중..." : "임시 비밀번호 발급"}
              </button>

              <button
                type="button"
                onClick={resetToLogin}
                className="w-full py-2 text-center text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors"
              >
                ← 로그인 화면으로 돌아가기
              </button>
            </form>
          )}
        </div>
      )}

      {/* 5. Footer Copyright */}
      <div className="text-center pt-2 space-y-0.5 border-t border-slate-200/60">
        <p className="text-[11px] text-[#94A3B8] font-medium">
          © 2024 MarketLog AI Logistics Corp.
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

