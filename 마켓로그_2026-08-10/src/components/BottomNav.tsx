import React from "react";
import { TabType } from "../types";
import { UserRole } from "./LoginModal";

interface BottomNavProps {
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
  onOpenAiScan: () => void;
  isAiScanOpen?: boolean;
  userRole?: UserRole;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  onOpenAiScan,
  isAiScanOpen = false,
  userRole = "customer",
}) => {
  const isMerchant = userRole === "merchant";

  return (
    <>
      {/* Mobile Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-1 pb-safe h-[72px] bg-surface-white border-t border-[#E2E8F0] shadow-[0_-1px_3px_rgba(0,0,0,0.05)] md:hidden">
        {/* Home */}
        <button
          onClick={() => onSelectTab("home")}
          className="flex flex-col items-center justify-center flex-1 h-full group"
        >
          <div
            className={`flex flex-col items-center justify-center transition-all duration-200 ${
              activeTab === "home" && !isAiScanOpen
                ? isMerchant
                  ? "text-emerald-600 font-extrabold"
                  : "text-trust-blue font-extrabold"
                : "text-slate-900 hover:text-black font-semibold"
            }`}
          >
            <span
              className="material-symbols-outlined text-2xl mb-0.5"
              style={{ fontVariationSettings: activeTab === "home" && !isAiScanOpen ? "'FILL' 1" : "'FILL' 0" }}
            >
              home
            </span>
            <span className="text-xs font-semibold">홈</span>
          </div>
        </button>

        {/* map (Hidden for merchants) */}
        {!isMerchant && (
          <button
            onClick={() => onSelectTab("map")}
            className="flex flex-col items-center justify-center flex-1 h-full group"
          >
            <div
              className={`flex flex-col items-center justify-center transition-all duration-200 ${
                activeTab === "map" && !isAiScanOpen
                  ? "text-trust-blue font-extrabold"
                  : "text-slate-900 hover:text-black font-semibold"
              }`}
            >
              <span
                className="material-symbols-outlined text-2xl mb-0.5"
                style={{ fontVariationSettings: activeTab === "map" && !isAiScanOpen ? "'FILL' 1" : "'FILL' 0" }}
              >
                map
              </span>
              <span className="text-xs font-semibold">지도</span>
            </div>
          </button>
        )}

        {/* Center Elevated Floating Action Button (AI scan) - Hidden for merchants */}
        {!isMerchant && (
          <div className="relative -top-5">
            <button
              onClick={onOpenAiScan}
              className={`w-14 h-14 rounded-full flex flex-col items-center justify-center text-white shadow-lg border-4 transition-all ${
                isAiScanOpen
                  ? "bg-trust-blue border-amber-400 scale-105 shadow-blue-500/50"
                  : "bg-trust-blue border-background-slate active:scale-95 hover:bg-trust-blue/90"
              }`}
              title="현장 AI 스캔"
            >
              <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                center_focus_strong
              </span>
              <span className="text-[9px] font-extrabold leading-none mt-0.5">AI scan</span>
            </button>
          </div>
        )}

        {/* 저장 Saved (Hidden for merchants) */}
        {!isMerchant && (
          <button
            onClick={() => onSelectTab("saved")}
            className="flex flex-col items-center justify-center flex-1 h-full group"
          >
            <div
              className={`flex flex-col items-center justify-center transition-all duration-200 ${
                activeTab === "saved" && !isAiScanOpen
                  ? "text-trust-blue font-extrabold"
                  : "text-slate-900 hover:text-black font-semibold"
              }`}
            >
              <span
                className="material-symbols-outlined text-2xl mb-0.5"
                style={{ fontVariationSettings: activeTab === "saved" && !isAiScanOpen ? "'FILL' 1" : "'FILL' 0" }}
              >
                bookmark
              </span>
              <span className="text-xs font-semibold">저장</span>
            </div>
          </button>
        )}

        {/* My */}
        <button
          onClick={() => onSelectTab("my")}
          className="flex flex-col items-center justify-center flex-1 h-full group"
        >
          <div
            className={`flex flex-col items-center justify-center transition-all duration-200 ${
              activeTab === "my" && !isAiScanOpen
                ? isMerchant
                  ? "text-emerald-600 font-extrabold"
                  : "text-trust-blue font-extrabold"
                : "text-slate-900 hover:text-black font-semibold"
            }`}
          >
            <span
              className="material-symbols-outlined text-2xl mb-0.5"
              style={{ fontVariationSettings: activeTab === "my" && !isAiScanOpen ? "'FILL' 1" : "'FILL' 0" }}
            >
              person
            </span>
            <span className="text-xs font-semibold">내 정보</span>
          </div>
        </button>
      </nav>

      {/* Desktop Sidebar Navigation (Hidden on Mobile) */}
      <aside className="hidden md:flex fixed left-0 top-16 w-64 h-[calc(100vh-64px)] bg-surface-white border-r border-[#E2E8F0] flex-col p-4 z-30 shadow-[1px_0_3px_rgba(0,0,0,0.03)]">
        <nav className="flex flex-col gap-2 mt-2">
          <button
            onClick={() => onSelectTab("home")}
            className={`flex items-center gap-3 p-3 rounded-xl text-sm font-bold transition-all ${
              activeTab === "home"
                ? isMerchant
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-[#DBEAFE] text-trust-blue"
                : "text-slate-900 hover:bg-surface-container-low hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined">home</span>
            <span>홈</span>
          </button>

          {!isMerchant && (
            <button
              onClick={() => onSelectTab("map")}
              className={`flex items-center gap-3 p-3 rounded-xl text-sm font-bold transition-all ${
                activeTab === "map"
                  ? "bg-[#DBEAFE] text-trust-blue"
                  : "text-slate-900 hover:bg-surface-container-low hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined">map</span>
              <span>지도</span>
            </button>
          )}

          {!isMerchant && (
            <button
              onClick={() => onSelectTab("saved")}
              className={`flex items-center gap-3 p-3 rounded-xl text-sm font-bold transition-all ${
                activeTab === "saved"
                  ? "bg-[#DBEAFE] text-trust-blue"
                  : "text-slate-900 hover:bg-surface-container-low hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined">bookmark</span>
              <span>저장</span>
            </button>
          )}

          <button
            onClick={() => onSelectTab("my")}
            className={`flex items-center gap-3 p-3 rounded-xl text-sm font-bold transition-all ${
              activeTab === "my"
                ? isMerchant
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-[#DBEAFE] text-trust-blue"
                : "text-slate-900 hover:bg-surface-container-low hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined">person</span>
            <span>내 정보</span>
          </button>
        </nav>

        {!isMerchant && (
          <div className="mt-auto mb-4">
            <button
              onClick={onOpenAiScan}
              className="w-full bg-trust-blue text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2 shadow-sm hover:bg-trust-blue/90 active:scale-95 transition-all text-sm"
            >
              <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                center_focus_strong
              </span>
              <span>AI scan</span>
            </button>
          </div>
        )}
      </aside>
    </>
  );
};

