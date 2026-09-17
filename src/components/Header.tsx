import React from "react";
import { Server, RefreshCw, Zap, Download, Radio, CloudLightning, Activity } from "lucide-react";
import { ServerSpecs } from "../types";

interface HeaderProps {
  serverSpecs: ServerSpecs | null;
  onRefresh: () => void;
  onRunBenchmark: () => void;
  isRefreshing: boolean;
  onOpenReport: () => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onOpenDrive?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  serverSpecs,
  onRefresh,
  onRunBenchmark,
  isRefreshing,
  onOpenReport,
  autoRefresh,
  onToggleAutoRefresh,
  onOpenDrive,
}) => {
  return (
    <header className="border-b border-[#22272e] bg-[#101317] sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-3">
        {/* Brand & Host Summary */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-[#1a1e24] text-[#10b981] border border-[#2a303c] flex items-center justify-center shrink-0">
            <Server className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-[#f3f4f6] tracking-tight">
                SERVER<span className="text-[#9ca3af] font-normal">SPECS</span>
              </h1>
              {serverSpecs && (
                <span className="text-[11px] font-mono text-[#9ca3af] bg-[#161a1f] px-2 py-0.5 rounded border border-[#262b32] hidden sm:inline truncate">
                  {serverSpecs.os.hostname} • {serverSpecs.os.distroName}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Live Indicator */}
          <button
            onClick={onToggleAutoRefresh}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-all cursor-pointer border ${
              autoRefresh
                ? "bg-[#064e3b]/30 border-[#059669]/60 text-[#34d399]"
                : "bg-[#161a1f] border-[#262b32] text-[#6b7280] hover:text-[#9ca3af] hover:bg-[#1a1e24]"
            }`}
            title="Auto-actualización cada 2s"
          >
            <Radio className={`w-3 h-3 ${autoRefresh ? "animate-pulse text-[#10b981]" : "text-[#4b5563]"}`} />
            <span className="hidden sm:inline font-semibold">{autoRefresh ? "LIVE 2s" : "PAUSA"}</span>
          </button>

          {/* Drive */}
          {onOpenDrive && (
            <button
              onClick={onOpenDrive}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-[#14171a] hover:bg-[#1c2127] text-[#f3f4f6] border border-[#262b32] transition-colors cursor-pointer"
              title="Google Drive & Archivos"
            >
              <CloudLightning className="w-3.5 h-3.5 text-[#10b981]" />
              <span className="hidden md:inline">Drive</span>
            </button>
          )}

          {/* Refresh Specs */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-md text-xs bg-[#14171a] hover:bg-[#1c2127] text-[#9ca3af] hover:text-[#f3f4f6] border border-[#262b32] transition-colors cursor-pointer disabled:opacity-50"
            title="Refrescar métricas del servidor"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-[#10b981]" : ""}`} />
          </button>

          {/* Quick Benchmark */}
          <button
            onClick={onRunBenchmark}
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-semibold bg-[#1f242c] hover:bg-[#28303b] text-[#f3f4f6] border border-[#3b424d] transition-colors cursor-pointer"
          >
            <Zap className="w-3 h-3 text-[#f59e0b]" />
            <span>Benchmark</span>
          </button>

          {/* Export Report */}
          <button
            onClick={onOpenReport}
            className="p-1.5 sm:px-2.5 sm:py-1 rounded-md text-xs font-medium bg-[#14171a] hover:bg-[#1c2127] text-[#f3f4f6] border border-[#262b32] transition-colors cursor-pointer"
            title="Exportar informe del sistema"
          >
            <Download className="w-3.5 h-3.5 text-[#9ca3af] sm:mr-1 inline" />
            <span className="hidden sm:inline">Informe</span>
          </button>
        </div>
      </div>
    </header>
  );
};

