import React, { useState, useEffect } from "react";
import { Cpu, Layers, Database, Network, Terminal } from "lucide-react";
import { ServerSpecs } from "../types";
import { CpuDetails } from "./CpuDetails";
import { MemoryDetails } from "./MemoryDetails";
import { StorageDetails } from "./StorageDetails";
import { NetworkDetails } from "./NetworkDetails";
import { RuntimeDetails } from "./RuntimeDetails";

export type SystemSubTab = "cpu" | "memory" | "storage" | "network" | "runtime";

interface SystemWorkspaceProps {
  serverSpecs: ServerSpecs;
  onRunBenchmark: () => void;
  initialSubTab?: SystemSubTab;
}

export const SystemWorkspace: React.FC<SystemWorkspaceProps> = ({
  serverSpecs,
  onRunBenchmark,
  initialSubTab = "cpu",
}) => {
  const [activeSubTab, setActiveSubTab] = useState<SystemSubTab>(initialSubTab);

  useEffect(() => {
    if (initialSubTab) {
      setActiveSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const subTabs: Array<{ id: SystemSubTab; label: string; icon: React.ReactNode; badge?: string }> = [
    {
      id: "cpu",
      label: "CPU & Procesador",
      icon: <Cpu className="w-3.5 h-3.5" />,
      badge: `${serverSpecs.cpu.coresCount} vCPUs`,
    },
    {
      id: "memory",
      label: "Memoria RAM",
      icon: <Layers className="w-3.5 h-3.5" />,
      badge: `${serverSpecs.memory.usagePercentage}%`,
    },
    {
      id: "storage",
      label: "Almacenamiento",
      icon: <Database className="w-3.5 h-3.5" />,
      badge: `${serverSpecs.storage.mounts[0]?.usagePercentage || 0}%`,
    },
    {
      id: "network",
      label: "Red & Conexiones",
      icon: <Network className="w-3.5 h-3.5" />,
    },
    {
      id: "runtime",
      label: "Runtime Node & OS",
      icon: <Terminal className="w-3.5 h-3.5" />,
      badge: `v${serverSpecs.runtime.nodeVersion.split(".")[0]}`,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Sub-navigation bar */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-lg p-1.5 flex flex-wrap gap-1">
        {subTabs.map((tab) => {
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                isActive
                  ? "bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d] shadow-sm"
                  : "text-[#9ca3af] hover:text-[#f3f4f6] hover:bg-[#1a1e24] border border-transparent"
              }`}
            >
              <span className={isActive ? "text-[#10b981]" : "text-[#6b7280]"}>
                {tab.icon}
              </span>
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                    isActive
                      ? "bg-[#0b0d0e] text-[#10b981] border border-[#262b32]"
                      : "bg-[#1c2026] text-[#6b7280]"
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active Sub-Tab View */}
      <div>
        {activeSubTab === "cpu" && (
          <CpuDetails
            serverSpecs={serverSpecs}
            onRunBenchmark={onRunBenchmark}
          />
        )}
        {activeSubTab === "memory" && <MemoryDetails serverSpecs={serverSpecs} />}
        {activeSubTab === "storage" && <StorageDetails serverSpecs={serverSpecs} />}
        {activeSubTab === "network" && <NetworkDetails serverSpecs={serverSpecs} />}
        {activeSubTab === "runtime" && <RuntimeDetails serverSpecs={serverSpecs} />}
      </div>
    </div>
  );
};
