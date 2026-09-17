import React, { useState, useEffect } from "react";
import { Zap, Gauge } from "lucide-react";
import { ServerSpecs, ServerBenchmarkStats } from "../types";
import { BenchmarkView } from "./BenchmarkView";
import { SpeedTestView } from "./SpeedTestView";

export type PerformanceSubTab = "benchmark" | "speedtest";

interface PerformanceWorkspaceProps {
  serverSpecs: ServerSpecs;
  benchmarkStats: ServerBenchmarkStats;
  onRunBenchmark: () => void;
  initialSubTab?: PerformanceSubTab;
}

export const PerformanceWorkspace: React.FC<PerformanceWorkspaceProps> = ({
  serverSpecs,
  benchmarkStats,
  onRunBenchmark,
  initialSubTab = "benchmark",
}) => {
  const [activeSubTab, setActiveSubTab] = useState<PerformanceSubTab>(initialSubTab);

  useEffect(() => {
    if (initialSubTab) {
      setActiveSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  return (
    <div className="space-y-4">
      {/* Sub-navigation bar */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-lg p-1.5 flex flex-wrap gap-1">
        <button
          onClick={() => setActiveSubTab("benchmark")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === "benchmark"
              ? "bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d] shadow-sm"
              : "text-[#9ca3af] hover:text-[#f3f4f6] hover:bg-[#1a1e24] border border-transparent"
          }`}
        >
          <Zap className={`w-3.5 h-3.5 ${activeSubTab === "benchmark" ? "text-[#f59e0b]" : "text-[#6b7280]"}`} />
          <span>Benchmark de Servidor & Cómputo</span>
          {benchmarkStats?.overallScore && (
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#0b0d0e] text-[#f59e0b] border border-[#262b32]">
              {benchmarkStats.overallScore} pts
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab("speedtest")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === "speedtest"
              ? "bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d] shadow-sm"
              : "text-[#9ca3af] hover:text-[#f3f4f6] hover:bg-[#1a1e24] border border-transparent"
          }`}
        >
          <Gauge className={`w-3.5 h-3.5 ${activeSubTab === "speedtest" ? "text-[#3b82f6]" : "text-[#6b7280]"}`} />
          <span>Test de Velocidad de Red (Speed Test)</span>
        </button>
      </div>

      {/* Active Sub View */}
      <div>
        {activeSubTab === "benchmark" && (
          <BenchmarkView
            serverSpecs={serverSpecs}
            stats={benchmarkStats}
            benchmarkStats={benchmarkStats}
            isRunning={benchmarkStats.status === "running"}
            progressMessage={benchmarkStats.currentStep}
            onRunBenchmark={onRunBenchmark}
          />
        )}
        {activeSubTab === "speedtest" && <SpeedTestView serverSpecs={serverSpecs} />}
      </div>
    </div>
  );
};
