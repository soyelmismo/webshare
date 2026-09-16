import React from "react";
import { Server, RefreshCw, Zap, Download, Radio, CloudDownload } from "lucide-react";
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
    <header className="border-b border-slate-800/80 bg-slate-950/90 sticky top-0 z-40 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-2.5 flex items-center justify-between gap-3">
        {/* Brand & Host Summary */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
            <Server className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white tracking-tight truncate">
                ServerSpecs
              </h1>
              {serverSpecs && (
                <span className="text-[11px] font-mono text-slate-400 hidden sm:inline truncate">
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
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono transition-all cursor-pointer border ${
              autoRefresh
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
            title="Auto-actualización (2s)"
          >
            <Radio className={`w-3 h-3 ${autoRefresh ? "animate-pulse text-emerald-400" : "text-slate-500"}`} />
            <span className="hidden sm:inline">{autoRefresh ? "Live" : "Pausa"}</span>
          </button>

          {/* Drive */}
          {onOpenDrive && (
            <button
              onClick={onOpenDrive}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-all cursor-pointer"
              title="Google Drive"
            >
              <CloudDownload className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden md:inline">Drive</span>
            </button>
          )}

          {/* Refresh Specs */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-md text-xs bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-all cursor-pointer disabled:opacity-50"
            title="Refrescar métricas"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-indigo-400" : "text-slate-400"}`} />
          </button>

          {/* Quick Benchmark */}
          <button
            onClick={onRunBenchmark}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all cursor-pointer shadow-sm shadow-indigo-600/20"
          >
            <Zap className="w-3 h-3 text-amber-300" />
            <span>Benchmark</span>
          </button>

          {/* Export Report */}
          <button
            onClick={onOpenReport}
            className="p-1.5 sm:px-2.5 sm:py-1 rounded-md text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-all cursor-pointer"
            title="Exportar informe"
          >
            <Download className="w-3.5 h-3.5 text-slate-400 sm:mr-1 inline" />
            <span className="hidden sm:inline">Informe</span>
          </button>
        </div>
      </div>
    </header>
  );
};

