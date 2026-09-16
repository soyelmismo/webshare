import React from "react";
import {
  Cpu,
  Layers,
  Database,
  Network,
  Terminal,
  Zap,
  ArrowRight,
  CloudLightning,
  Gauge,
} from "lucide-react";
import { ServerSpecs, ServerBenchmarkStats, ServerHistoryPoint } from "../types";
import { TabId } from "./NavigationTabs";

interface OverviewDashboardProps {
  serverSpecs: ServerSpecs;
  benchmarkStats: ServerBenchmarkStats;
  history: ServerHistoryPoint[];
  onNavigateTab: (tab: TabId) => void;
  onRunBenchmark: () => void;
  apiLatency: number;
}

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({
  serverSpecs,
  benchmarkStats,
  history,
  onNavigateTab,
  onRunBenchmark,
  apiLatency,
}) => {
  const { os, cpu, memory, storage, network, runtime } = serverSpecs;
  const rootDisk = storage.mounts[0];

  const renderSparkline = (
    data: number[],
    color: string,
    minVal?: number,
    maxVal?: number
  ) => {
    if (data.length < 2) return null;
    const min = minVal !== undefined ? minVal : Math.min(...data);
    const max = maxVal !== undefined ? maxVal : Math.max(...data);
    const range = max - min || 1;
    const w = 180;
    const h = 24;
    const points = data
      .map((val, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - ((val - min) / range) * (h - 6) - 3;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    return (
      <svg className="w-full h-6 overflow-visible" viewBox={`0 0 ${w} ${h}`}>
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
    );
  };

  const cpuLoadHistory = history.map((h) => h.cpuLoad1m);
  const memUsageHistory = history.map((h) => h.memUsagePercent);

  return (
    <div className="space-y-4">
      {/* Top Metrics Row */}
      <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              {os.distroName}
            </h2>
            <span className="text-xs font-mono text-slate-400">
              ({os.hostname} • {os.arch})
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono">
            Kernel {os.kernelRelease} • Uptime {os.uptimeFormatted}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 w-full md:w-auto font-mono text-xs">
          <div className="bg-slate-950/80 px-3 py-2 rounded-lg border border-slate-800 text-center">
            <span className="text-[10px] text-slate-500 block uppercase font-sans">CPU 1m</span>
            <span className="text-sm font-bold text-amber-400">{cpu.loadAverage["1min"]}</span>
          </div>
          <div className="bg-slate-950/80 px-3 py-2 rounded-lg border border-slate-800 text-center">
            <span className="text-[10px] text-slate-500 block uppercase font-sans">RAM</span>
            <span className="text-sm font-bold text-purple-400">{memory.usagePercentage}%</span>
          </div>
          <div className="bg-slate-950/80 px-3 py-2 rounded-lg border border-slate-800 text-center">
            <span className="text-[10px] text-slate-500 block uppercase font-sans">Disco /</span>
            <span className="text-sm font-bold text-emerald-400">{rootDisk?.usagePercentage || 0}%</span>
          </div>
          <div className="bg-slate-950/80 px-3 py-2 rounded-lg border border-slate-800 text-center">
            <span className="text-[10px] text-slate-500 block uppercase font-sans">Ping API</span>
            <span className="text-sm font-bold text-cyan-400">{apiLatency > 0 ? `${apiLatency}ms` : "<1ms"}</span>
          </div>
        </div>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* CPU */}
        <div
          onClick={() => onNavigateTab("cpu")}
          className="bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl p-4 space-y-3 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-blue-400" />
              <h3 className="text-xs font-bold text-white group-hover:text-blue-300">
                CPU ({cpu.coresCount} vCPUs)
              </h3>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-blue-400" />
          </div>

          <div className="space-y-1.5 font-mono text-[11px]">
            <div className="flex justify-between text-slate-400">
              <span>Modelo:</span>
              <span className="text-white font-medium truncate max-w-[170px]" title={cpu.model}>
                {cpu.model}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Frecuencia:</span>
              <span className="text-cyan-300">~{cpu.speedMHz} MHz</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Carga (1/5/15m):</span>
              <span className="text-amber-400">
                {cpu.loadAverage["1min"]} • {cpu.loadAverage["5min"]} • {cpu.loadAverage["15min"]}
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80">
            {renderSparkline(cpuLoadHistory, "#60a5fa", 0, Math.max(2, ...cpuLoadHistory))}
          </div>
        </div>

        {/* RAM */}
        <div
          onClick={() => onNavigateTab("memory")}
          className="bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl p-4 space-y-3 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              <h3 className="text-xs font-bold text-white group-hover:text-purple-300">
                Memoria ({memory.totalGB} GB)
              </h3>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-purple-400" />
          </div>

          <div className="space-y-1.5 font-mono text-[11px]">
            <div className="flex justify-between text-slate-400">
              <span>Usada:</span>
              <span className="text-purple-300">{memory.usedGB} GB ({memory.usagePercentage}%)</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Disponible:</span>
              <span className="text-emerald-400">{memory.availableGB} GB</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Node RSS:</span>
              <span className="text-slate-300">{memory.processMemory.rssMB} MB</span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80">
            {renderSparkline(memUsageHistory, "#c084fc", 0, 100)}
          </div>
        </div>

        {/* Storage */}
        <div
          onClick={() => onNavigateTab("storage")}
          className="bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl p-4 space-y-3 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold text-white group-hover:text-amber-300">
                Disco ({rootDisk?.totalGB || "504"} GB)
              </h3>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-amber-400" />
          </div>

          <div className="space-y-1.5 font-mono text-[11px]">
            <div className="flex justify-between text-slate-400">
              <span>Montaje:</span>
              <span className="text-white">{rootDisk?.path || "/"}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Usado:</span>
              <span className="text-slate-300">{rootDisk?.usedGB} GB ({rootDisk?.usagePercentage}%)</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Libre:</span>
              <span className="text-emerald-400">{rootDisk?.freeGB} GB</span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80">
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full"
                style={{ width: `${Math.max(2, rootDisk?.usagePercentage || 1)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Network */}
        <div
          onClick={() => onNavigateTab("network")}
          className="bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl p-4 space-y-3 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Network className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-white group-hover:text-emerald-300">
                Red ({network.interfaces.length} ifaces)
              </h3>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-emerald-400" />
          </div>

          <div className="space-y-1.5 font-mono text-[11px]">
            <div className="flex justify-between text-slate-400">
              <span>IP Principal:</span>
              <span className="text-emerald-400">
                {network.interfaces.find((i) => !i.internal)?.address || "127.0.0.1"}
              </span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>DNS:</span>
              <span className="text-indigo-300">{network.dnsServers[0] || "169.254.169.254"}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Latencia:</span>
              <span className="text-cyan-300">{apiLatency > 0 ? `${apiLatency} ms` : "< 1 ms"}</span>
            </div>
          </div>
        </div>

        {/* Runtime */}
        <div
          onClick={() => onNavigateTab("runtime")}
          className="bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl p-4 space-y-3 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-cyan-400" />
              <h3 className="text-xs font-bold text-white group-hover:text-cyan-300">
                Runtime (Node {runtime.nodeVersion})
              </h3>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-cyan-400" />
          </div>

          <div className="space-y-1.5 font-mono text-[11px]">
            <div className="flex justify-between text-slate-400">
              <span>PID / PPID:</span>
              <span className="text-white">{runtime.pid} / {runtime.ppid}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Uptime Proceso:</span>
              <span className="text-cyan-300">{runtime.processUptimeFormatted}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Usuario:</span>
              <span className="text-indigo-300">{os.user.username}</span>
            </div>
          </div>
        </div>

        {/* Benchmark */}
        <div
          onClick={() => onNavigateTab("benchmark")}
          className="bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl p-4 space-y-3 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold text-white group-hover:text-amber-300">
                Benchmark {benchmarkStats.overallScore ? `(${benchmarkStats.overallScore} pts)` : ""}
              </h3>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-amber-400" />
          </div>

          {benchmarkStats.overallScore ? (
            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex justify-between text-slate-400">
                <span>Tier:</span>
                <span className="text-amber-300 font-bold">{benchmarkStats.tier}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Single / Multi:</span>
                <span className="text-white">{benchmarkStats.cpuSingleScore} / {benchmarkStats.cpuMultiScore} pts</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Disco Write/Read:</span>
                <span className="text-emerald-400">{benchmarkStats.diskWriteMBps} / {benchmarkStats.diskReadMBps} MB/s</span>
              </div>
            </div>
          ) : (
            <div className="pt-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRunBenchmark();
                }}
                className="w-full py-1.5 px-2.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 text-xs font-semibold transition-all cursor-pointer"
              >
                Ejecutar Test
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Quick Banners Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Speed Test Banner */}
        <div
          onClick={() => onNavigateTab("speedtest")}
          className="bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl p-3 flex items-center justify-between gap-3 cursor-pointer transition-all group"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shrink-0">
              <Gauge className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white group-hover:text-cyan-300 truncate">
                Speed Test Crudo & Limitador
              </p>
              <p className="text-[11px] text-slate-400 truncate font-mono">
                Mide velocidad y limita ancho de banda en bajada y subida.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs font-medium text-cyan-400 shrink-0 font-mono">
            <span>Abrir</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>

        {/* Quick Stream Banner */}
        <div
          onClick={() => onNavigateTab("stream")}
          className="bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl p-3 flex items-center justify-between gap-3 cursor-pointer transition-all group"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
              <CloudLightning className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white group-hover:text-emerald-300 truncate">
                Streaming Directo a Google Drive
              </p>
              <p className="text-[11px] text-slate-400 truncate font-mono">
                Descarga a RAM y subida continua sin llenar el disco.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs font-medium text-emerald-400 shrink-0 font-mono">
            <span>Abrir</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>
      </div>
    </div>
  );
};
