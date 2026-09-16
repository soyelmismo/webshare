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
    <header className="border-b border-slate-800/80 bg-slate-950/95 sticky top-0 z-40 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        {/* Brand & Host Title */}
        <div className="flex items-center gap-3.5">
          <div className="h-10 w-10 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400 shadow-lg shadow-indigo-950/40 shrink-0">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-bold text-white tracking-tight">
                Especificaciones del Servidor
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 flex items-center gap-1.5 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                Host Linux • Servidor Dedicado
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5 truncate max-w-xl">
              {serverSpecs ? (
                <>
                  <span className="text-slate-300 font-semibold">{serverSpecs.os.hostname}</span>
                  {" • "}
                  <span>{serverSpecs.os.distroName}</span>
                  {" • "}
                  <span className="text-indigo-300">Kernel {serverSpecs.os.kernelRelease}</span>
                </>
              ) : (
                "Conectando con el host del servidor..."
              )}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 self-end md:self-auto flex-wrap">
          {/* Auto Refresh Toggle */}
          <button
            onClick={onToggleAutoRefresh}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer font-mono ${
              autoRefresh
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300 shadow-sm shadow-emerald-950"
                : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
            title="Actualización automática de métricas cada 2 segundos"
          >
            <Radio className={`w-3.5 h-3.5 ${autoRefresh ? "text-emerald-400 animate-pulse" : "text-slate-500"}`} />
            <span>En vivo: {autoRefresh ? "2s" : "Pausado"}</span>
          </button>

          {/* Drive Downloader Tab Shortcut */}
          {onOpenDrive && (
            <button
              onClick={onOpenDrive}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-950/70 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-500/30 transition-all cursor-pointer shadow-sm"
              title="Abrir Cliente de Descarga Google Drive"
            >
              <CloudDownload className="w-3.5 h-3.5 text-indigo-400" />
              <span>Drive</span>
            </button>
          )}

          {/* Refresh Specs */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-all cursor-pointer disabled:opacity-50"
            title="Refrescar especificaciones del servidor ahora"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-indigo-400" : "text-slate-400"}`} />
            <span className="hidden sm:inline">Refrescar</span>
          </button>

          {/* Quick Benchmark */}
          <button
            onClick={onRunBenchmark}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all cursor-pointer shadow-md shadow-indigo-600/20"
          >
            <Zap className="w-3.5 h-3.5 text-amber-300" />
            <span>Benchmark</span>
          </button>

          {/* Export Report */}
          <button
            onClick={onOpenReport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition-all cursor-pointer"
            title="Exportar informe técnico completo del servidor"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Informe</span>
          </button>
        </div>
      </div>
    </header>
  );
};
