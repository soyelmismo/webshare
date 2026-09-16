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
} from "lucide-react";

export type TabId =
  | "overview"
  | "commander"
  | "stream"
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
  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode; badge?: string }> = [
    {
      id: "overview",
      label: "Vista General",
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: "stream",
      label: "Streaming ISO a Drive",
      icon: <CloudLightning className="w-4 h-4 text-emerald-400" />,
      badge: "Zero-Disk & Anti-Wipe",
    },
    {
      id: "commander",
      label: "File Commander",
      icon: <Columns2 className="w-4 h-4" />,
      badge: "Servidor ⇄ Drive",
    },
    {
      id: "drive",
      label: "Cliente Drive",
      icon: <CloudDownload className="w-4 h-4" />,
      badge: "Google Drive",
    },
    {
      id: "cpu",
      label: "Procesador (CPU)",
      icon: <Cpu className="w-4 h-4" />,
    },
    {
      id: "memory",
      label: "Memoria & Swap",
      icon: <Layers className="w-4 h-4" />,
    },
    {
      id: "storage",
      label: "Almacenamiento (Disco)",
      icon: <Database className="w-4 h-4" />,
    },
    {
      id: "network",
      label: "Red & Interfaces",
      icon: <Network className="w-4 h-4" />,
    },
    {
      id: "runtime",
      label: "Runtime & Kernel",
      icon: <Terminal className="w-4 h-4" />,
    },
    {
      id: "benchmark",
      label: "Benchmark Servidor",
      icon: <Zap className="w-4 h-4" />,
    },
  ];

  return (
    <nav className="border-b border-slate-800/80 bg-slate-950/60 sticky top-[61px] z-30 backdrop-blur-sm overflow-x-auto scrollbar-none">
      <div className="max-w-7xl mx-auto px-4 lg:px-8 flex items-center gap-1.5 min-w-max py-2">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                isActive
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/80"
              }`}
            >
              <span className={isActive ? "text-indigo-200" : "text-slate-500"}>
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
