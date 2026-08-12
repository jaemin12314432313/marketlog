import React, { useState, useEffect } from "react";
import { UserRole } from "./LoginModal";
import { ProductItem } from "../types";
import { ApiError, getStoreProfile, updateProfile, updateStoreProfile } from "../lib/api";

interface MyWalletProps {
  onNavigateToMap?: () => void;
  userRole?: UserRole;
  userDisplayName?: string;
  userUsername?: string;
  userPhone?: string;
  isLoggedIn?: boolean;
  onOpenLogin?: () => void;
  onLogout?: () => void;
  products?: ProductItem[];
  onUpdateShopName?: (newName: string) => void;
  onProfileUpdated?: (displayName: string, phone: string) => void;
}

export const MyWallet: React.FC<MyWalletProps> = ({
  userRole = "customer",
  userDisplayName,
  userUsername = "",
  userPhone = "",
  isLoggedIn = false,
  onOpenLogin,
  onLogout,
  products = [],
  onUpdateShopName,
  onProfileUpdated,
}) => {
  const initialShopName = userDisplayName || (userRole === "merchant" ? "양동수산 사장님" : "스마트 장보기 회원");

  // Merchant Store Details Editable State — 점포 위치 등록(지도 핀) 이후에만 저장 가능한
  // 실제 백엔드 데이터. hasStoreProfile이 false면 아직 위치 등록 전이라는 뜻.
  const [isEditingShopInfo, setIsEditingShopInfo] = useState(false);
  const [hasStoreProfile, setHasStoreProfile] = useState<boolean | null>(null); // null = 로딩 중
  const [shopInfo, setShopInfo] = useState({
    name: initialShopName,
    marketName: "광주 양동전통시장",
    category: "",
    phone: "",
    hours: "",
    description: "",
  });

  // Merchant Header Name Editing State
  const [isEditingShopNameHeader, setIsEditingShopNameHeader] = useState(false);
  const [shopNameHeaderInput, setShopNameHeaderInput] = useState(initialShopName);

  // Customer Profile & Nickname Editable State
  const [customerNickname, setCustomerNickname] = useState(
    userDisplayName || "스마트 장보기 회원"
  );
  const [isEditingCustomerNickname, setIsEditingCustomerNickname] = useState(false);
  const [customerNicknameInput, setCustomerNicknameInput] = useState(customerNickname);
  const [customerProfileImage, setCustomerProfileImage] = useState<string | null>(null);
  const customerFileInputRef = React.useRef<HTMLInputElement>(null);

  // Personal Information Editing State — 실제 로그인한 유저의 진짜 정보를 사용한다.
  const [personalInfo, setPersonalInfo] = useState({
    userName: userDisplayName || "",
    userPhone: userPhone || "",
    currentPw: "",
    newPw: "",
    confirmPw: "",
  });
  const [isEditingPersonalInfo, setIsEditingPersonalInfo] = useState(false);
  const [isSavingPersonalInfo, setIsSavingPersonalInfo] = useState(false);

  useEffect(() => {
    setPersonalInfo((prev) => ({
      ...prev,
      userName: userDisplayName || prev.userName,
      userPhone: userPhone || prev.userPhone,
    }));
  }, [userDisplayName, userPhone]);

  useEffect(() => {
    if (userDisplayName) {
      setCustomerNickname(userDisplayName);
      setCustomerNicknameInput(userDisplayName);
    }
  }, [userDisplayName]);

  const handleSavePersonalInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personalInfo.userName.trim()) {
      alert("이름을 입력해주세요.");
      return;
    }
    if (!personalInfo.userPhone.trim()) {
      alert("휴대폰 번호를 입력해주세요.");
      return;
    }
    if (personalInfo.newPw) {
      if (!personalInfo.currentPw) {
        alert("비밀번호를 변경하려면 현재 비밀번호를 입력해주세요.");
        return;
      }
      if (personalInfo.newPw.length < 8) {
        alert("새 비밀번호는 8자 이상이어야 합니다.");
        return;
      }
      if (personalInfo.newPw !== personalInfo.confirmPw) {
        alert("새 비밀번호 확인이 일치하지 않습니다.");
        return;
      }
    }

    setIsSavingPersonalInfo(true);
    try {
      const res = await updateProfile({
        displayName: personalInfo.userName.trim(),
        phone: personalInfo.userPhone.trim(),
        ...(personalInfo.newPw
          ? { currentPassword: personalInfo.currentPw, newPassword: personalInfo.newPw }
          : {}),
      });
      if (onProfileUpdated) {
        onProfileUpdated(res.user.displayName, res.user.phone || "");
      }
      setIsEditingPersonalInfo(false);
      setPersonalInfo((prev) => ({ ...prev, currentPw: "", newPw: "", confirmPw: "" }));
      showToast("개인정보가 성공적으로 수정되었습니다.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        alert("현재 비밀번호가 올바르지 않습니다.");
      } else {
        alert("개인정보 수정에 실패했습니다. 잠시 후 다시 시도해주세요.");
      }
    } finally {
      setIsSavingPersonalInfo(false);
    }
  };

  const handleCustomerImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCustomerProfileImage(reader.result as string);
        showToast("프로필 사진이 성공적으로 변경되었습니다.");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveCustomerNickname = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = customerNicknameInput.trim();
    if (!trimmed) {
      alert("닉네임을 입력해주세요.");
      return;
    }
    setCustomerNickname(trimmed);
    if (onUpdateShopName) {
      onUpdateShopName(trimmed);
    }
    setIsEditingCustomerNickname(false);
  };

  // User Profile Icon State
  const [selectedIcon, setSelectedIcon] = useState<string>(
    userRole === "merchant" ? "storefront" : "person"
  );
  const [selectedBgGradient, setSelectedBgGradient] = useState<string>(
    userRole === "merchant"
      ? "from-emerald-500 to-teal-700"
      : "from-blue-600 to-indigo-700"
  );
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);

  // Available Icon & Color Options
  const iconOptions = [
    { id: "person", label: "사용자", icon: "person" },
    { id: "storefront", label: "점포/매장", icon: "storefront" },
    { id: "account_circle", label: "프로필", icon: "account_circle" },
    { id: "badge", label: "신분증", icon: "badge" },
    { id: "shopping_bag", label: "장보기", icon: "shopping_bag" },
    { id: "phishing", label: "수산물", icon: "phishing" },
    { id: "nutrition", label: "야채/식자재", icon: "nutrition" },
    { id: "verified_user", label: "인증회원", icon: "verified_user" },
    { id: "workspace_premium", label: "프리미엄", icon: "workspace_premium" },
    { id: "eco", label: "친환경", icon: "eco" },
  ];

  const colorOptions = [
    { id: "emerald", label: "에메랄드", gradient: "from-emerald-500 to-teal-700", border: "border-emerald-200" },
    { id: "blue", label: "블루", gradient: "from-blue-600 to-indigo-700", border: "border-blue-200" },
    { id: "amber", label: "엠버/오렌지", gradient: "from-amber-500 to-orange-600", border: "border-amber-200" },
    { id: "purple", label: "퍼플", gradient: "from-purple-600 to-indigo-700", border: "border-purple-200" },
    { id: "rose", label: "로즈", gradient: "from-rose-500 to-pink-600", border: "border-rose-200" },
    { id: "slate", label: "다크 슬레이트", gradient: "from-slate-700 to-slate-900", border: "border-slate-300" },
  ];

  // Edit form buffer
  const [editForm, setEditForm] = useState({ ...shopInfo });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (userDisplayName) {
      setShopInfo((prev) => ({ ...prev, name: userDisplayName }));
      setEditForm((prev) => ({ ...prev, name: userDisplayName }));
    }
  }, [userDisplayName]);

  // 점포 상세정보는 "점포 위치 등록"을 먼저 해야 저장할 Store 레코드가 생긴다 —
  // 위치 등록 전이면 hasStoreProfile=false로 두고 안내 문구를 보여준다.
  useEffect(() => {
    if (userRole !== "merchant") return;
    getStoreProfile()
      .then((res) => {
        if (res.profile) {
          setHasStoreProfile(true);
          setShopInfo((prev) => ({
            ...prev,
            category: res.profile!.subtitle,
            phone: res.profile!.phone,
            hours: res.profile!.hours,
            description: res.profile!.storyText,
          }));
        } else {
          setHasStoreProfile(false);
        }
      })
      .catch((err) => {
        console.error("점포 상세정보를 불러오지 못했습니다.", err);
        setHasStoreProfile(false);
      });
  }, [userRole]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  const [isSavingShopInfo, setIsSavingShopInfo] = useState(false);

  const handleStartEdit = () => {
    if (!hasStoreProfile) {
      alert("점포 상세정보를 저장하려면 먼저 '점포 위치 등록'으로 지도에 점포를 등록해주세요.");
      return;
    }
    setEditForm({ ...shopInfo });
    setIsEditingShopInfo(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingShopInfo(true);
    try {
      const res = await updateStoreProfile({
        subtitle: editForm.category,
        phone: editForm.phone,
        hours: editForm.hours,
        storyText: editForm.description,
      });
      setShopInfo((prev) => ({
        ...prev,
        category: res.profile.subtitle,
        phone: res.profile.phone,
        hours: res.profile.hours,
        description: res.profile.storyText,
      }));
      setIsEditingShopInfo(false);
      showToast("점포 기본 상세 정보가 성공적으로 수정되었습니다.");
    } catch (err) {
      console.error(err);
      alert("점포 상세정보 저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsSavingShopInfo(false);
    }
  };

  const handleCancelEdit = () => {
    setEditForm({ ...shopInfo });
    setIsEditingShopInfo(false);
  };

  const currentShopName = shopInfo.name || initialShopName;
  const merchantProducts = products.filter((p) => p.shopName === currentShopName);

  // 로그인하지 않은 상태에서는 로그인한 것처럼 보이는 가짜 프로필 카드(+ 눌러도 의미
  // 없는 로그아웃 버튼)를 보여주는 대신, 이 탭을 명확한 로그인 진입점으로 쓴다.
  if (!isLoggedIn) {
    return (
      <div className="w-full max-w-[600px] mx-auto pt-20 pb-28 px-4">
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(0,0,0,0.05)] p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 text-trust-blue flex items-center justify-center mx-auto">
            <span className="material-symbols-outlined text-3xl">account_circle</span>
          </div>
          <div>
            <h2 className="text-base font-extrabold text-on-surface">로그인이 필요합니다</h2>
            <p className="text-xs text-outline mt-1.5 leading-relaxed">
              로그인하면 내 정보 관리, 찜한 상품, AI 스캔 저장목록을 이용할 수 있어요.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenLogin}
            className="w-full py-3 bg-trust-blue hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-md transition-colors"
          >
            로그인 / 회원가입
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[600px] mx-auto pt-20 pb-28 px-4 space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[#0F172A] text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 border border-slate-700 animate-in fade-in zoom-in duration-200">
          <span className="material-symbols-outlined text-base text-emerald-400">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Profile & Store Management Header Card */}
      {userRole === "merchant" ? (
        <section className="bg-white rounded-2xl p-5 border border-[#E2E8F0] shadow-[0_1px_3px_rgba(0,0,0,0.05)] text-[#0F172A] relative overflow-hidden space-y-4">
          <div className="flex items-center justify-between gap-3.5">
            <div className="flex items-center gap-3.5 min-w-0">
              <div
                className="relative group cursor-pointer shrink-0"
                onClick={() => setIsIconPickerOpen(true)}
                title="프로필 아이콘 설정"
              >
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${selectedBgGradient} text-white flex items-center justify-center shadow-md relative overflow-hidden transition-transform group-hover:scale-105`}>
                  <span className="material-symbols-outlined text-3xl">{selectedIcon}</span>
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <span className="material-symbols-outlined text-base text-white">edit</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="absolute -bottom-1 -right-1 w-5 h-5 bg-white border border-slate-200 rounded-full flex items-center justify-center text-slate-700 shadow-xs text-[10px]"
                  title="아이콘 변경"
                >
                  <span className="material-symbols-outlined text-[12px]">settings</span>
                </button>
              </div>
              <div className="min-w-0 flex-1">
                {!isEditingShopNameHeader ? (
                  <div className="flex items-center gap-1.5">
                    <h2 className="text-base sm:text-lg font-extrabold text-[#0F172A] truncate">{currentShopName}</h2>
                    <button
                      type="button"
                      onClick={() => {
                        setShopNameHeaderInput(currentShopName);
                        setIsEditingShopNameHeader(true);
                      }}
                      className="text-slate-400 hover:text-emerald-600 transition-colors p-1 rounded-lg cursor-pointer flex items-center shrink-0"
                      title="이름 수정"
                    >
                      <span className="material-symbols-outlined text-sm">edit</span>
                    </button>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const trimmed = shopNameHeaderInput.trim();
                      if (trimmed) {
                        setShopInfo((prev) => ({ ...prev, name: trimmed }));
                        if (onUpdateShopName) {
                          onUpdateShopName(trimmed);
                        }
                        showToast("이름이 수정되었습니다.");
                      }
                      setIsEditingShopNameHeader(false);
                    }}
                    className="flex items-center gap-1.5"
                  >
                    <input
                      type="text"
                      value={shopNameHeaderInput}
                      onChange={(e) => setShopNameHeaderInput(e.target.value)}
                      placeholder="이름 입력"
                      className="px-2 py-0.5 text-xs sm:text-sm border border-emerald-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 w-36 text-slate-800 font-extrabold"
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-2.5 py-1 rounded-lg transition-colors cursor-pointer shrink-0"
                    >
                      저장
                    </button>
                  </form>
                )}
              </div>
            </div>

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="text-[11px] font-bold text-slate-500 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 px-2 py-1 rounded-lg transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                title="로그아웃"
              >
                <span className="material-symbols-outlined text-xs">logout</span>
                <span>로그아웃</span>
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="bg-surface-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-[#E2E8F0] p-4 flex items-center gap-4">
          {/* File Input for Customer Image Upload */}
          <input
            type="file"
            ref={customerFileInputRef}
            accept="image/*"
            onChange={handleCustomerImageUpload}
            className="hidden"
          />

          {/* User Profile Avatar with Direct Photo Selection */}
          <div className="relative group shrink-0">
            <div
              className="w-16 h-16 rounded-2xl overflow-hidden border-2 border-slate-200 shadow-xs bg-slate-100 relative cursor-pointer group-hover:border-[#0052FF] transition-all flex items-center justify-center"
              onClick={() => customerFileInputRef.current?.click()}
              title="클릭하여 원하는 프로필 사진 선택"
            >
              {customerProfileImage ? (
                <img
                  src={customerProfileImage}
                  alt="프로필 사진"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-slate-100 flex items-center justify-center text-slate-400">
                  <span className="material-symbols-outlined text-4xl">account_circle</span>
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                <span className="material-symbols-outlined text-xl">add_a_photo</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => customerFileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#0052FF] text-white border-2 border-white rounded-full flex items-center justify-center shadow-xs cursor-pointer hover:bg-blue-700 transition-colors"
              title="원하는 사진 추가"
            >
              <span className="material-symbols-outlined text-[13px]">add_a_photo</span>
            </button>
          </div>

          {/* Profile Name & Editable Nickname */}
          <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
            {/* Editable Nickname Container */}
            <div className="flex-1 min-w-0 flex items-center h-8">
              {isEditingCustomerNickname ? (
                <input
                  type="text"
                  value={customerNicknameInput}
                  onChange={(e) => setCustomerNicknameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSaveCustomerNickname();
                    } else if (e.key === "Escape") {
                      setIsEditingCustomerNickname(false);
                    }
                  }}
                  onBlur={handleSaveCustomerNickname}
                  placeholder="닉네임 입력"
                  className="text-base font-extrabold text-slate-900 border-b-2 border-[#0052FF] bg-transparent focus:outline-none w-full max-w-[160px] py-0.5 leading-none"
                  autoFocus
                />
              ) : (
                <div
                  onClick={() => {
                    setCustomerNicknameInput(customerNickname);
                    setIsEditingCustomerNickname(true);
                  }}
                  className="flex items-center gap-1.5 cursor-pointer group/nick max-w-full"
                  title="닉네임 클릭하여 수정"
                >
                  <h2 className="text-base font-extrabold text-slate-900 group-hover/nick:text-[#0052FF] transition-colors truncate leading-none">
                    {customerNickname}
                  </h2>
                  <span className="material-symbols-outlined text-sm text-slate-400 group-hover/nick:text-[#0052FF] transition-colors shrink-0">
                    edit
                  </span>
                </div>
              )}
            </div>

            {/* Logout Button */}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="text-xs font-bold text-slate-600 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                title="로그아웃"
              >
                <span className="material-symbols-outlined text-sm">logout</span>
                <span>로그아웃</span>
              </button>
            )}
          </div>
        </section>
      )}

      {/* Personal Information Edit Section */}
      <section className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-[#E2E8F0] p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                userRole === "merchant"
                  ? "bg-emerald-50 border border-emerald-100 text-emerald-600"
                  : "bg-blue-50 border border-blue-100 text-[#0052FF]"
              }`}
            >
              <span className="material-symbols-outlined text-lg">manage_accounts</span>
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-sm">개인정보 수정</h3>
            </div>
          </div>
          {!isEditingPersonalInfo && (
            <button
              type="button"
              onClick={() => {
                if (!isLoggedIn) {
                  onOpenLogin?.();
                  return;
                }
                setIsEditingPersonalInfo(true);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer shrink-0 ${
                userRole === "merchant"
                  ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-700"
              }`}
            >
              <span className="material-symbols-outlined text-sm">edit</span>
              <span>정보 수정</span>
            </button>
          )}
        </div>

        {isEditingPersonalInfo ? (
          <form onSubmit={handleSavePersonalInfo} className="space-y-3.5 pt-1">
            {/* ID Field (Read-only) */}
            <div className="space-y-1">
              <label className="text-xs font-extrabold text-slate-700 block">아이디 (수정 불가)</label>
              <input
                type="text"
                value={userUsername}
                disabled
                className="w-full px-3 py-2 text-xs font-bold bg-slate-100 border border-slate-200 rounded-xl text-slate-500 cursor-not-allowed"
              />
            </div>

            {/* Name Field */}
            <div className="space-y-1">
              <label className="text-xs font-extrabold text-slate-700 block">이름</label>
              <input
                type="text"
                value={personalInfo.userName}
                onChange={(e) => setPersonalInfo({ ...personalInfo, userName: e.target.value })}
                placeholder="이름 입력"
                className={`w-full px-3 py-2 text-xs font-bold bg-white border border-slate-300 rounded-xl focus:outline-none text-slate-900 ${
                  userRole === "merchant" ? "focus:border-emerald-500" : "focus:border-[#0052FF]"
                }`}
              />
            </div>

            {/* Phone Number Field */}
            <div className="space-y-1">
              <label className="text-xs font-extrabold text-slate-700 block">휴대폰 번호</label>
              <input
                type="tel"
                value={personalInfo.userPhone}
                onChange={(e) => setPersonalInfo({ ...personalInfo, userPhone: e.target.value })}
                placeholder="010-0000-0000"
                className={`w-full px-3 py-2 text-xs font-bold bg-white border border-slate-300 rounded-xl focus:outline-none text-slate-900 ${
                  userRole === "merchant" ? "focus:border-emerald-500" : "focus:border-[#0052FF]"
                }`}
              />
            </div>

            {/* Password Field */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <label className="text-xs font-extrabold text-slate-700 block">비밀번호 변경 (선택)</label>
              <input
                type="password"
                value={personalInfo.currentPw}
                onChange={(e) => setPersonalInfo({ ...personalInfo, currentPw: e.target.value })}
                placeholder="현재 비밀번호 (변경 시 필수)"
                className={`w-full px-3 py-2 text-xs font-bold bg-white border border-slate-300 rounded-xl focus:outline-none text-slate-900 ${
                  userRole === "merchant" ? "focus:border-emerald-500" : "focus:border-[#0052FF]"
                }`}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="password"
                  value={personalInfo.newPw}
                  onChange={(e) => setPersonalInfo({ ...personalInfo, newPw: e.target.value })}
                  placeholder="새 비밀번호"
                  className={`w-full px-3 py-2 text-xs font-bold bg-white border border-slate-300 rounded-xl focus:outline-none text-slate-900 ${
                    userRole === "merchant" ? "focus:border-emerald-500" : "focus:border-[#0052FF]"
                  }`}
                />
                <input
                  type="password"
                  value={personalInfo.confirmPw}
                  onChange={(e) => setPersonalInfo({ ...personalInfo, confirmPw: e.target.value })}
                  placeholder="새 비밀번호 확인"
                  className={`w-full px-3 py-2 text-xs font-bold bg-white border border-slate-300 rounded-xl focus:outline-none text-slate-900 ${
                    userRole === "merchant" ? "focus:border-emerald-500" : "focus:border-[#0052FF]"
                  }`}
                />
              </div>
            </div>

            {/* Save / Cancel Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsEditingPersonalInfo(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={isSavingPersonalInfo}
                className={`px-4 py-2 rounded-xl text-white text-xs font-bold shadow-xs transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-60 ${
                  userRole === "merchant"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-[#0052FF] hover:bg-blue-700"
                }`}
              >
                <span className="material-symbols-outlined text-sm">check</span>
                <span>{isSavingPersonalInfo ? "저장 중..." : "저장하기"}</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-100">
              <div>
                <span className="text-slate-400 font-bold block text-[10px]">아이디</span>
                <span className="font-extrabold text-slate-800">{userUsername}</span>
              </div>
              <div>
                <span className="text-slate-400 font-bold block text-[10px]">이름</span>
                <span className="font-extrabold text-slate-800">{personalInfo.userName}</span>
              </div>
              <div>
                <span className="text-slate-400 font-bold block text-[10px]">휴대폰 번호</span>
                <span className="font-extrabold text-slate-800">{personalInfo.userPhone}</span>
              </div>
              <div>
                <span className="text-slate-400 font-bold block text-[10px]">비밀번호</span>
                <span className="font-extrabold text-slate-800">••••••••</span>
              </div>
            </div>
          </div>
        )}
      </section>



      {/* Editable Merchant Store Details */}
      {userRole === "merchant" && (
        <section className="bg-white rounded-2xl p-5 border border-[#E2E8F0] shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#F1F5F9]">
            <h3 className="text-xs font-extrabold text-[#64748B] uppercase tracking-wider flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base text-emerald-600">edit_note</span>
              점포 기본 상세 정보
            </h3>
            {!isEditingShopInfo ? (
              <button
                onClick={handleStartEdit}
                className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-extrabold transition-colors flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
                <span>정보 수정</span>
              </button>
            ) : (
              <span className="text-[11px] font-extrabold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                수정 모드
              </span>
            )}
          </div>

          {hasStoreProfile === false && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
              <span className="material-symbols-outlined text-amber-600 text-lg shrink-0">info</span>
              <p className="text-[11px] text-amber-800 font-medium leading-relaxed">
                점포 상세정보를 저장하려면 먼저 위쪽의 "점포 위치 등록"으로 지도에 점포를 등록해주세요.
                위치가 등록돼야 이 정보도 저장할 수 있어요.
              </p>
            </div>
          )}

          {!isEditingShopInfo ? (
            /* View Mode */
            <div className="space-y-3">
              <div className="space-y-2 text-xs divide-y divide-[#F1F5F9]">
                <div className="flex justify-between py-1.5">
                  <span className="text-[#64748B] font-medium">상호명</span>
                  <span className="font-extrabold text-[#0F172A]">{shopInfo.name}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-[#64748B] font-medium">소속 전통시장</span>
                  <span className="font-extrabold text-emerald-600">{shopInfo.marketName}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-[#64748B] font-medium">주요 품목</span>
                  <span className="font-extrabold text-[#0F172A]">{shopInfo.category || "미등록"}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-[#64748B] font-medium">전화번호</span>
                  <span className="font-bold text-[#334155]">{shopInfo.phone || "미등록"}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-[#64748B] font-medium">영업시간</span>
                  <span className="font-bold text-[#334155]">{shopInfo.hours || "미등록"}</span>
                </div>
              </div>

              {/* Shop Description Box */}
              <div className="bg-[#F8FAFC] rounded-xl p-3 border border-[#E2E8F0] space-y-1 mt-2">
                <span className="text-[11px] font-bold text-[#64748B] block">점포 한줄 안내 / 소개</span>
                <p className="text-xs text-[#334155] leading-relaxed font-medium">
                  {shopInfo.description || "등록된 점포 소개글이 없습니다."}
                </p>
              </div>
            </div>
          ) : (
            /* Edit Form Mode */
            <form onSubmit={handleSaveEdit} className="space-y-3.5 text-xs">
              {/* 상호명은 상단 이름 옆 연필 아이콘에서 변경한다 — 여기선 참고용 표시만 */}
              <div className="space-y-1">
                <label className="font-bold text-[#334155] block">상호명</label>
                <input
                  type="text"
                  value={editForm.name}
                  disabled
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-500 cursor-not-allowed"
                />
                <p className="text-[10px] text-slate-400">상호명은 상단 이름 옆 연필 아이콘에서 바꿀 수 있어요.</p>
              </div>

              {/* 주요 품목 */}
              <div className="space-y-1">
                <label className="font-bold text-[#334155] block">주요 품목</label>
                <input
                  type="text"
                  value={editForm.category}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, category: e.target.value }))}
                  placeholder="예: 수산물 / 당일 산지 직송"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:border-emerald-500 text-xs font-semibold"
                />
              </div>

              {/* 영업시간 */}
              <div className="space-y-1">
                <label className="font-bold text-[#334155] block">영업시간</label>
                <input
                  type="text"
                  value={editForm.hours}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, hours: e.target.value }))}
                  placeholder="예: 08:00 - 20:00 (연중무휴)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:border-emerald-500 text-xs font-semibold"
                />
              </div>

              {/* 전화번호 */}
              <div className="space-y-1">
                <label className="font-bold text-[#334155] block">전화번호</label>
                <input
                  type="text"
                  value={editForm.phone}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="062-365-1234"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:border-emerald-500 text-xs font-semibold"
                />
              </div>

              {/* 점포 한줄 안내 / 소개 */}
              <div className="space-y-1">
                <label className="font-bold text-[#334155] block">점포 한줄 안내 / 소개</label>
                <textarea
                  rows={2}
                  value={editForm.description}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="고객에게 안내할 점포 관련 인사말 및 특징을 적어주세요."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:border-emerald-500 text-xs font-semibold resize-none"
                />
              </div>

              {/* Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="w-full py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSavingShopInfo}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">check</span>
                  <span>{isSavingShopInfo ? "저장 중..." : "저장 완료"}</span>
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Icon Picker Modal */}
      {isIconPickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600">badge</span>
                <h3 className="font-extrabold text-slate-900 text-base">프로필 아이콘 설정</h3>
              </div>
              <button
                onClick={() => setIsIconPickerOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Preview Box */}
              <div className="flex flex-col items-center justify-center space-y-2 py-3 bg-slate-50 rounded-2xl border border-slate-100">
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${selectedBgGradient} text-white flex items-center justify-center shadow-lg`}>
                  <span className="material-symbols-outlined text-4xl">{selectedIcon}</span>
                </div>
                <span className="text-xs font-bold text-slate-600">미리보기</span>
              </div>

              {/* Icon Choice Grid */}
              <div className="space-y-2">
                <label className="text-xs font-extrabold text-slate-700 block">아이콘 선택</label>
                <div className="grid grid-cols-5 gap-2">
                  {iconOptions.map((opt) => {
                    const isSelected = selectedIcon === opt.icon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setSelectedIcon(opt.icon)}
                        className={`p-2 rounded-xl flex flex-col items-center justify-center gap-1 border transition-all cursor-pointer ${
                          isSelected
                            ? "border-emerald-500 bg-emerald-50/80 text-emerald-700 ring-2 ring-emerald-500/20 shadow-xs"
                            : "border-slate-200 hover:bg-slate-50 text-slate-600"
                        }`}
                        title={opt.label}
                      >
                        <span className="material-symbols-outlined text-2xl">{opt.icon}</span>
                        <span className="text-[9px] font-bold truncate max-w-full">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Color Gradient Choice Grid */}
              <div className="space-y-2">
                <label className="text-xs font-extrabold text-slate-700 block">배경 색상 선택</label>
                <div className="grid grid-cols-3 gap-2">
                  {colorOptions.map((color) => {
                    const isSelected = selectedBgGradient === color.gradient;
                    return (
                      <button
                        key={color.id}
                        type="button"
                        onClick={() => setSelectedBgGradient(color.gradient)}
                        className={`p-2 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${
                          isSelected
                            ? "border-emerald-500 ring-2 ring-emerald-500/20 bg-slate-50 font-extrabold text-slate-900"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50 font-bold"
                        }`}
                      >
                        <span className={`w-5 h-5 rounded-full bg-gradient-to-br ${color.gradient} shrink-0 shadow-xs`}></span>
                        <span className="text-[11px] truncate">{color.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Action Buttons */}
              <button
                type="button"
                onClick={() => {
                  setIsIconPickerOpen(false);
                  showToast("프로필 아이콘이 성공적으로 변경되었습니다.");
                }}
                className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-base">check_circle</span>
                <span>아이콘 변경 완료</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};



