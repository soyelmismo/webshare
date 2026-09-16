import React from "react";
import {
  LayoutDashboard,
  Cpu,
  Layers,
  Database,
  Network,
  Terminal,
  Zap,
  CloudDownload,
  Columns2,
  CloudLightning,
  Gauge,
} from "lucide-react";

export type TabId =
  | "overview"
  | "commander"
  | "stream"
  | "speedtest"
  | "drive"
  | "cpu"
  | "memory"
  | "storage"
  | "network"
  | "runtime"
  | "benchmark";

interface NavigationTabsProps {
  activeTab: TabId;
  onChangeTab: (tab: TabId) => void;
}

export const NavigationTabs: React.FC<NavigationTabsProps> = ({
  activeTab,
  onChangeTab,
}) => {
  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
    {
      id: "overview",
      label: "General",
      icon: <LayoutDashboard className="w-3.5 h-3.5" />,
    },
    {
      id: "stream",
      label: "Streaming a Drive",
      icon: <CloudLightning className="w-3.5 h-3.5 text-emerald-400" />,
    },
    {
      id: "speedtest",
      label: "Speed Test Crudo",
      icon: <Gauge className="w-3.5 h-3.5 text-cyan-400" />,
    },
    {
      id: "commander",
      label: "File Commander",
      icon: <Columns2 className="w-3.5 h-3.5" />,
    },
    {
      id: "drive",
      label: "Google Drive",
      icon: <CloudDownload className="w-3.5 h-3.5" />,
    },
    {
      id: "cpu",
      label: "CPU",
      icon: <Cpu className="w-3.5 h-3.5" />,
    },
    {
      id: "memory",
      label: "Memoria",
      icon: <Layers className="w-3.5 h-3.5" />,
    },
    {
      id: "storage",
      label: "Disco",
      icon: <Database className="w-3.5 h-3.5" />,
    },
    {
      id: "network",
      label: "Red",
      icon: <Network className="w-3.5 h-3.5" />,
    },
    {
      id: "runtime",
      label: "Runtime",
      icon: <Terminal className="w-3.5 h-3.5" />,
    },
    {
      id: "benchmark",
      label: "Benchmark",
      icon: <Zap className="w-3.5 h-3.5 text-amber-400" />,
    },
  ];

  return (
    <nav className="border-b border-slate-800/80 bg-slate-950/80 sticky top-[49px] z-30 backdrop-blur-sm overflow-x-auto scrollbar-none">
      <div className="max-w-7xl mx-auto px-4 lg:px-8 flex items-center gap-1 min-w-max py-1.5">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                isActive
                  ? "bg-slate-800 text-white font-semibold border border-slate-700 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
              }`}
            >
              <span className={isActive ? "text-indigo-400" : "text-slate-500"}>
                {tab.icon}
              </span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
