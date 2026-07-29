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
    <header className="fixed top-0 left-0 w-full z-40 flex justify-between items-center px-3 sm:px-4 md:px-6 h-16 bg-surface-white border-b border-[#E2E8F0] shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-all flex-nowrap">
      {/* Region Selector */}
      <div className="relative flex items-center shrink-0">
        {/* Region Selector Button */}
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex items-center gap-1.5 hover:bg-blue-50/60 transition-colors rounded-xl px-2.5 py-1.5 group shrink-0 whitespace-nowrap border border-transparent hover:border-blue-100"
          id="region-selector-btn"
          title="지역 선택"
        >
          <span
            className="material-symbols-outlined text-[#0052FF] text-xl shrink-0"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            location_on
          </span>
          <span className="text-base sm:text-lg font-black tracking-tight text-[#0052FF] whitespace-nowrap">
            {selectedRegion === "전체" ? "전국 (전체)" : selectedRegion}
          </span>
          <span className="material-symbols-outlined text-[#0052FF]/70 group-hover:text-[#0052FF] transition-colors text-base shrink-0">
            expand_more
          </span>
        </button>

        {/* Region Dropdown Menu */}
        {isDropdownOpen && (
          <div className="absolute top-12 left-0 w-52 sm:w-60 bg-surface-white rounded-xl shadow-xl border border-[#E2E8F0] py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-3 py-1.5 text-[11px] font-extrabold text-outline uppercase tracking-wider flex items-center gap-1">
              <span className="material-symbols-outlined text-xs">map</span>
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
                        ? "font-extrabold text-trust-blue bg-blue-50/60"
                        : "text-on-surface font-medium"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs">
                        {region === "전체" ? "🌐" : "📍"}
                      </span>
                      <span>{region === "전체" ? "전국 (전체)" : region}</span>
                    </div>
                    {isSelected && (
                      <span className="material-symbols-outlined text-sm text-trust-blue">
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

      {/* Right controls: Notifications */}
      <div className="flex items-center space-x-2 shrink-0">
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
          {/* Active Red Pulse Badge */}
          <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 border border-white"></span>
          </span>
        </button>
      </div>
    </header>
  );
};
