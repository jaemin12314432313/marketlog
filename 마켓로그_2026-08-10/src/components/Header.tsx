import React, { useState } from "react";
import { UserRole } from "./LoginModal";
import logoIcon from "../assets/logo-icon.png";
import logoIconMerchant from "../assets/logo-icon-merchant.png";

interface HeaderProps {
  selectedRegion: string;
  allRegions: string[];
  onSelectRegion: (region: string) => void;
  onOpenNotifications: () => void;
  activeTab?: string;
  userRole?: UserRole;
  userDisplayName?: string;
  onOpenLogin?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  selectedRegion,
  allRegions,
  onSelectRegion,
  onOpenNotifications,
  activeTab,
  userRole = "customer",
  userDisplayName,
  onOpenLogin,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  return (
    <header
      className="fixed top-0 left-0 w-full z-40 flex justify-between items-center px-3 sm:px-4 md:px-6 pt-safe bg-surface-white border-b border-[#E2E8F0] shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-all flex-nowrap gap-2"
      style={{ minHeight: "calc(5rem + env(safe-area-inset-top, 0px))" }}
    >
      {/* min-h-20(고정 80px)를 pt-safe(padding-top: env(safe-area-inset-top))와 같이 쓰면
          안전영역이 있는 실기기에서 헤더 총 높이가 80px에 그대로 묶여버린다 — min-height는
          내용+패딩 합이 80px을 넘을 때만 늘어나는 "바닥값"이라, 패딩이 안전영역만큼
          늘어나도 그 합이 여전히 80px 밑이면 헤더는 그대로 80px다. 그런데 마이 탭 등의
          content-pt-safe는 "헤더가 안전영역만큼 커진다"고 가정하고 여백을 계산해서,
          안전영역이 클수록 헤더-콘텐츠 사이 빈 공간이 점점 커지는 버그였다. min-height
          자체에 안전영역을 더해 헤더가 실제로 그만큼 커지도록 고쳤다. */}
      {/* Left: App Logo — 소비자는 파란색, 상인은 초록색 버전을 쓴다(둘 다 같은 장바구니+M
          그라디언트 마크, 색만 역할별로 다름). src/assets/logo-icon(-merchant).png. */}
      <div className="flex items-center gap-2 shrink-0">
        <img
          src={userRole === "merchant" ? logoIconMerchant : logoIcon}
          alt="MarketLog"
          className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 object-contain"
        />
        <div className="flex items-center gap-1.5">
          <span className="text-lg sm:text-xl font-bold tracking-tight text-[#0F172A] select-none">
            MarketLog
          </span>
        </div>
      </div>

      {/* Right controls: Region Selector & Notifications — 알림은 탭과 무관하게 항상
          보여준다. 지역 선택만 마이/저장 탭에서는 안 쓰는 기능이라 홈 탭에서만 보여준다. */}
      <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
        {/* Region Selector — 소비자 홈피드 지역 필터용이라 상인 화면에서는 아무 기능도
            안 하면서 자리만 차지한다. 상인 로그인일 땐 숨기고, 홈 탭이 아닐 때도 숨긴다. */}
        {userRole !== "merchant" && activeTab === "home" && (
        <div className="relative flex items-center shrink-0">
          {/* Region Selector Button */}
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className={`flex items-center gap-1 transition-colors rounded-xl px-2 py-1.5 group shrink-0 whitespace-nowrap border border-transparent ${
              userRole === "merchant"
                ? "hover:bg-emerald-50/70 hover:border-emerald-200"
                : "hover:bg-blue-50/60 hover:border-blue-100"
            }`}
            id="region-selector-btn"
            title="지역 선택"
          >
            <span
              className={`material-symbols-outlined text-lg sm:text-xl shrink-0 ${
                userRole === "merchant" ? "text-emerald-600" : "text-[#0052FF]"
              }`}
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              location_on
            </span>
            <span className={`text-xs sm:text-sm font-extrabold tracking-tight whitespace-nowrap ${
              userRole === "merchant" ? "text-emerald-700" : "text-[#0052FF]"
            }`}>
              {selectedRegion === "전체" ? "전국 (전체)" : selectedRegion}
            </span>
            <span className={`material-symbols-outlined transition-colors text-base shrink-0 ${
              userRole === "merchant" ? "text-emerald-600/70 group-hover:text-emerald-700" : "text-[#0052FF]/70 group-hover:text-[#0052FF]"
            }`}>
              expand_more
            </span>
          </button>

          {/* Region Dropdown Menu */}
          {isDropdownOpen && (
            <div className="absolute top-11 right-0 w-48 sm:w-56 bg-surface-white rounded-xl shadow-xl border border-[#E2E8F0] py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-3 py-1.5 text-[11px] font-extrabold text-outline uppercase tracking-wider">
                <span>지역(도/시) 선택</span>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {allRegions.map((region) => {
                  const isSelected = region === selectedRegion;
                  return (
                    <button
                      key={region}
                      onClick={() => {
                        onSelectRegion(region);
                        setIsDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3.5 py-2.5 text-xs sm:text-sm flex items-center justify-between hover:bg-surface-container-low transition-colors whitespace-nowrap ${
                        isSelected
                          ? userRole === "merchant"
                            ? "font-extrabold text-emerald-700 bg-emerald-50"
                            : "font-extrabold text-trust-blue bg-blue-50/60"
                          : "text-on-surface font-medium"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`material-symbols-outlined text-sm shrink-0 ${
                            isSelected
                              ? userRole === "merchant"
                                ? "text-emerald-600"
                                : "text-trust-blue"
                              : "text-outline"
                          }`}
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          location_on
                        </span>
                        <span>{region === "전체" ? "전국 (전체)" : region}</span>
                      </div>
                      {isSelected && (
                        <span className={`material-symbols-outlined text-sm ${
                          userRole === "merchant" ? "text-emerald-600" : "text-trust-blue"
                        }`}>
                          check
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        )}

        {/* High-visibility Reinstated Notification Alarm Button */}
        <button
          onClick={onOpenNotifications}
          className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 hover:text-trust-blue transition-all active:scale-95 shrink-0 flex items-center justify-center border border-slate-200/80"
          id="notifications-btn"
          title="실시간 알림 목록"
        >
          <span className="material-symbols-outlined text-xl">
            notifications
          </span>
        </button>
      </div>
    </header>
  );
};
