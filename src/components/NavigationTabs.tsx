import React from "react";
import {
  LayoutDashboard,
  Cpu,
  CloudLightning,
  Zap,
} from "lucide-react";

export type TabId =
  | "overview"
  | "system"
  | "drive"
  | "performance"
  // Legacy aliases for backward-compatible routing / direct links:
  | "commander"
  | "stream"
  | "speedtest"
  | "cpu"
  | "memory"
  | "storage"
  | "network"
  | "runtime"
  | "benchmark";

export type MainTabId = "overview" | "system" | "drive" | "performance";

interface NavigationTabsProps {
  activeTab: MainTabId | TabId;
  onChangeTab: (tab: TabId) => void;
}

export const NavigationTabs: React.FC<NavigationTabsProps> = ({
  activeTab,
  onChangeTab,
}) => {
  // Normalize legacy tab names into main category highlight if needed
  const getNormalizedMainTab = (tab: string): MainTabId => {
    if (tab === "overview") return "overview";
    if (["system", "cpu", "memory", "storage", "network", "runtime"].includes(tab)) return "system";
    if (["drive", "stream", "commander"].includes(tab)) return "drive";
    if (["performance", "benchmark", "speedtest"].includes(tab)) return "performance";
    return "overview";
  };

  const normalizedActive = getNormalizedMainTab(activeTab);

  const mainTabs: Array<{ id: MainTabId; label: string; sub: string; icon: React.ReactNode }> = [
    {
      id: "overview",
      label: "Dashboard",
      sub: "Resumen y Métricas",
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: "system",
      label: "Hardware & Sistema",
      sub: "CPU • RAM • Disco • Red • Runtime",
      icon: <Cpu className="w-4 h-4" />,
    },
    {
      id: "drive",
      label: "Drive & Archivos",
      sub: "Streaming • File Commander • Cloud",
      icon: <CloudLightning className="w-4 h-4" />,
    },
    {
      id: "performance",
      label: "Rendimiento & Tests",
      sub: "Benchmark Host • Speed Test",
      icon: <Zap className="w-4 h-4" />,
    },
  ];

  return (
    <nav className="border-b border-[#22272e] bg-[#101317]/80 backdrop-blur sticky top-[53px] z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-1 sm:gap-2 py-1.5 overflow-x-auto scrollbar-none">
          {mainTabs.map((tab) => {
            const isActive = normalizedActive === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onChangeTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? "bg-[#1c2128] text-[#f3f4f6] font-semibold border border-[#3b424d] shadow-sm"
                    : "text-[#9ca3af] hover:text-[#f3f4f6] hover:bg-[#161a1f] font-medium border border-transparent"
                }`}
              >
                <span className={isActive ? "text-[#10b981]" : "text-[#6b7280]"}>
                  {tab.icon}
                </span>
                <span className="font-semibold tracking-wide">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

