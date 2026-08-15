import React, { useState } from "react";
import { UserRole } from "./LoginModal";

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
  userRole = "customer",
  userDisplayName,
  onOpenLogin,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 w-full z-40 flex justify-between items-center px-3 sm:px-4 md:px-6 min-h-20 pt-safe bg-surface-white border-b border-[#E2E8F0] shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-all flex-nowrap gap-2">
      {/* Left: App Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center text-white shrink-0 transition-colors ${
          userRole === "merchant"
            ? "bg-emerald-600 shadow-md shadow-emerald-500/20"
            : "bg-[#0052FF] shadow-md shadow-blue-500/20"
        }`}>
          <span
            className="material-symbols-outlined text-lg sm:text-xl font-bold"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            {userRole === "merchant" ? "storefront" : "account_balance_wallet"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-lg sm:text-xl font-black tracking-tight text-[#0F172A] select-none">
            MarketLog
          </span>
        </div>
      </div>

      {/* Right controls: Region Selector & Notifications */}
      <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
        {/* Region Selector */}
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
