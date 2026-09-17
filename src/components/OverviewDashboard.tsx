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
  Server,
  Activity,
  HardDrive,
} from "lucide-react";
import { ServerSpecs, ServerBenchmarkStats, ServerHistoryPoint } from "../types";
import { TabId } from "./NavigationTabs";

interface OverviewDashboardProps {
  serverSpecs: ServerSpecs;
  benchmarkStats?: ServerBenchmarkStats;
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
      {/* Top System Summary Banner */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#10b981] animate-pulse" />
            <h2 className="text-base font-bold text-[#f3f4f6] tracking-tight">
              {os.distroName}
            </h2>
            <span className="text-xs font-mono text-[#9ca3af] bg-[#1a1e24] px-2 py-0.5 rounded border border-[#262b32]">
              {os.hostname} • {os.arch}
            </span>
          </div>
          <p className="text-xs text-[#9ca3af] font-mono">
            Kernel {os.kernelRelease} • Uptime {os.uptimeFormatted}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full md:w-auto font-mono text-xs">
          <div className="bg-[#0e1013] px-3 py-2 rounded-lg border border-[#22272e] text-center">
            <span className="text-[10px] text-[#6b7280] block uppercase font-sans font-semibold">CPU 1m</span>
            <span className="text-sm font-bold text-[#f3f4f6]">{cpu.loadAverage["1min"]}</span>
          </div>
          <div className="bg-[#0e1013] px-3 py-2 rounded-lg border border-[#22272e] text-center">
            <span className="text-[10px] text-[#6b7280] block uppercase font-sans font-semibold">RAM</span>
            <span className="text-sm font-bold text-[#10b981]">{memory.usagePercentage}%</span>
          </div>
          <div className="bg-[#0e1013] px-3 py-2 rounded-lg border border-[#22272e] text-center">
            <span className="text-[10px] text-[#6b7280] block uppercase font-sans font-semibold">Disco /</span>
            <span className="text-sm font-bold text-[#3b82f6]">{rootDisk?.usagePercentage || 0}%</span>
          </div>
          <div className="bg-[#0e1013] px-3 py-2 rounded-lg border border-[#22272e] text-center">
            <span className="text-[10px] text-[#6b7280] block uppercase font-sans font-semibold">Ping API</span>
            <span className="text-sm font-bold text-[#f59e0b]">{apiLatency > 0 ? `${apiLatency}ms` : "<1ms"}</span>
          </div>
        </div>
      </div>

      {/* Grid of Hardware Modules */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* CPU */}
        <div
          onClick={() => onNavigateTab("cpu")}
          className="bg-[#14171a] border border-[#22272e] hover:border-[#3b424d] hover:bg-[#181c22] rounded-xl p-4 space-y-3 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded bg-[#1f242c] text-[#10b981]">
                <Cpu className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-bold text-[#f3f4f6] group-hover:text-[#10b981] transition-colors">
                CPU ({cpu.coresCount} vCPUs)
              </h3>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-[#6b7280] group-hover:text-[#f3f4f6] group-hover:translate-x-0.5 transition-all" />
          </div>

          <div className="space-y-1.5 font-mono text-[11px]">
            <div className="flex justify-between text-[#9ca3af]">
              <span>Modelo:</span>
              <span className="text-[#f3f4f6] font-medium truncate max-w-[170px]" title={cpu.model}>
                {cpu.model}
              </span>
            </div>
            <div className="flex justify-between text-[#9ca3af]">
              <span>Frecuencia:</span>
              <span className="text-[#f3f4f6] font-semibold">~{cpu.speedMHz} MHz</span>
            </div>
            <div className="flex justify-between text-[#9ca3af]">
              <span>Carga (1/5/15m):</span>
              <span className="text-[#f3f4f6] font-semibold">
                {cpu.loadAverage["1min"]} • {cpu.loadAverage["5min"]} • {cpu.loadAverage["15min"]}
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-[#22272e]">
            <div className="text-[10px] text-[#6b7280] font-sans mb-1">Historial de Carga CPU</div>
            {renderSparkline(cpuLoadHistory, "#10b981", 0, Math.max(2, ...cpuLoadHistory))}
          </div>
        </div>

        {/* RAM */}
        <div
          onClick={() => onNavigateTab("memory")}
          className="bg-[#14171a] border border-[#22272e] hover:border-[#3b424d] hover:bg-[#181c22] rounded-xl p-4 space-y-3 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded bg-[#1f242c] text-[#3b82f6]">
                <Layers className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-bold text-[#f3f4f6] group-hover:text-[#3b82f6] transition-colors">
                Memoria ({memory.totalGB} GB)
              </h3>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-[#6b7280] group-hover:text-[#f3f4f6] group-hover:translate-x-0.5 transition-all" />
          </div>

          <div className="space-y-1.5 font-mono text-[11px]">
            <div className="flex justify-between text-[#9ca3af]">
              <span>Usada:</span>
              <span className="text-[#f3f4f6] font-semibold">{memory.usedGB} GB ({memory.usagePercentage}%)</span>
            </div>
            <div className="flex justify-between text-[#9ca3af]">
              <span>Disponible:</span>
              <span className="text-[#34d399] font-semibold">{memory.availableGB} GB</span>
            </div>
            <div className="flex justify-between text-[#9ca3af]">
              <span>Node RSS:</span>
              <span className="text-[#f3f4f6]">{memory.processMemory.rssMB} MB</span>
            </div>
          </div>

          <div className="pt-2 border-t border-[#22272e]">
            <div className="text-[10px] text-[#6b7280] font-sans mb-1">Historial de Uso de RAM</div>
            {renderSparkline(memUsageHistory, "#3b82f6", 0, 100)}
          </div>
        </div>

        {/* Storage */}
        <div
          onClick={() => onNavigateTab("storage")}
          className="bg-[#14171a] border border-[#22272e] hover:border-[#3b424d] hover:bg-[#181c22] rounded-xl p-4 space-y-3 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded bg-[#1f242c] text-[#8b5cf6]">
                <Database className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-bold text-[#f3f4f6] group-hover:text-[#8b5cf6] transition-colors">
                Disco ({rootDisk?.totalGB || "504"} GB)
              </h3>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-[#6b7280] group-hover:text-[#f3f4f6] group-hover:translate-x-0.5 transition-all" />
          </div>

          <div className="space-y-1.5 font-mono text-[11px]">
            <div className="flex justify-between text-[#9ca3af]">
              <span>Montaje:</span>
              <span className="text-[#f3f4f6] font-medium">{rootDisk?.path || "/"}</span>
            </div>
            <div className="flex justify-between text-[#9ca3af]">
              <span>Usado:</span>
              <span className="text-[#f3f4f6] font-semibold">{rootDisk?.usedGB} GB ({rootDisk?.usagePercentage}%)</span>
            </div>
            <div className="flex justify-between text-[#9ca3af]">
              <span>Libre:</span>
              <span className="text-[#34d399] font-semibold">{rootDisk?.freeGB} GB</span>
            </div>
          </div>

          <div className="pt-2 border-t border-[#22272e]">
            <div className="w-full bg-[#0b0d0e] h-2 rounded-full overflow-hidden border border-[#22272e]">
              <div
                className="h-full bg-[#8b5cf6] rounded-full"
                style={{ width: `${Math.max(2, rootDisk?.usagePercentage || 1)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Network */}
        <div
          onClick={() => onNavigateTab("network")}
          className="bg-[#14171a] border border-[#22272e] hover:border-[#3b424d] hover:bg-[#181c22] rounded-xl p-4 space-y-3 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded bg-[#1f242c] text-[#06b6d4]">
                <Network className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-bold text-[#f3f4f6] group-hover:text-[#06b6d4] transition-colors">
                Red ({network.interfaces.length} ifaces)
              </h3>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-[#6b7280] group-hover:text-[#f3f4f6] group-hover:translate-x-0.5 transition-all" />
          </div>

          <div className="space-y-1.5 font-mono text-[11px]">
            <div className="flex justify-between text-[#9ca3af]">
              <span>IP Principal:</span>
              <span className="text-[#f3f4f6] font-semibold">
                {network.interfaces.find((i) => !i.internal)?.address || "127.0.0.1"}
              </span>
            </div>
            <div className="flex justify-between text-[#9ca3af]">
              <span>DNS:</span>
              <span className="text-[#f3f4f6]">{network.dnsServers[0] || "169.254.169.254"}</span>
            </div>
            <div className="flex justify-between text-[#9ca3af]">
              <span>Latencia API:</span>
              <span className="text-[#34d399] font-semibold">{apiLatency > 0 ? `${apiLatency} ms` : "< 1 ms"}</span>
            </div>
          </div>
        </div>

        {/* Runtime */}
        <div
          onClick={() => onNavigateTab("runtime")}
          className="bg-[#14171a] border border-[#22272e] hover:border-[#3b424d] hover:bg-[#181c22] rounded-xl p-4 space-y-3 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded bg-[#1f242c] text-[#ec4899]">
                <Terminal className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-bold text-[#f3f4f6] group-hover:text-[#ec4899] transition-colors">
                Runtime (Node {runtime.nodeVersion})
              </h3>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-[#6b7280] group-hover:text-[#f3f4f6] group-hover:translate-x-0.5 transition-all" />
          </div>

          <div className="space-y-1.5 font-mono text-[11px]">
            <div className="flex justify-between text-[#9ca3af]">
              <span>PID / PPID:</span>
              <span className="text-[#f3f4f6]">{runtime.pid} / {runtime.ppid}</span>
            </div>
            <div className="flex justify-between text-[#9ca3af]">
              <span>Uptime Proceso:</span>
              <span className="text-[#f3f4f6] font-semibold">{runtime.processUptimeFormatted}</span>
            </div>
            <div className="flex justify-between text-[#9ca3af]">
              <span>Usuario Host:</span>
              <span className="text-[#f3f4f6]">{os?.user?.username || "root"}</span>
            </div>
          </div>
        </div>

        {/* Benchmark */}
        <div
          onClick={() => onNavigateTab("benchmark")}
          className="bg-[#14171a] border border-[#22272e] hover:border-[#3b424d] hover:bg-[#181c22] rounded-xl p-4 space-y-3 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded bg-[#1f242c] text-[#f59e0b]">
                <Zap className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-bold text-[#f3f4f6] group-hover:text-[#f59e0b] transition-colors">
                Benchmark {benchmarkStats?.overallScore ? `(${benchmarkStats.overallScore} pts)` : ""}
              </h3>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-[#6b7280] group-hover:text-[#f3f4f6] group-hover:translate-x-0.5 transition-all" />
          </div>

          {benchmarkStats?.overallScore ? (
            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex justify-between text-[#9ca3af]">
                <span>Nivel Instancia:</span>
                <span className="text-[#f59e0b] font-bold">{benchmarkStats.tier}</span>
              </div>
              <div className="flex justify-between text-[#9ca3af]">
                <span>Single / Multi:</span>
                <span className="text-[#f3f4f6]">{benchmarkStats.cpuSingleScore} / {benchmarkStats.cpuMultiScore} pts</span>
              </div>
              <div className="flex justify-between text-[#9ca3af]">
                <span>Disco Write/Read:</span>
                <span className="text-[#f3f4f6]">{benchmarkStats.diskWriteMBps} / {benchmarkStats.diskReadMBps} MB/s</span>
              </div>
            </div>
          ) : (
            <div className="pt-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRunBenchmark();
                }}
                className="w-full py-1.5 px-2.5 rounded-lg bg-[#1f242c] hover:bg-[#28303b] text-[#f3f4f6] border border-[#3b424d] text-xs font-semibold transition-colors cursor-pointer"
              >
                Ejecutar Test
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Quick Action Banners */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Speed Test Banner */}
        <div
          onClick={() => onNavigateTab("speedtest")}
          className="bg-[#14171a] hover:bg-[#181c22] border border-[#22272e] hover:border-[#3b424d] rounded-xl p-3.5 flex items-center justify-between gap-3 cursor-pointer transition-all group"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-[#1a1e24] text-[#3b82f6] border border-[#262b32] shrink-0">
              <Gauge className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#f3f4f6] group-hover:text-[#3b82f6] transition-colors truncate">
                Speed Test Crudo & Limitador
              </p>
              <p className="text-[11px] text-[#9ca3af] truncate font-mono">
                Mide velocidad y limita ancho de banda en bajada y subida.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold text-[#9ca3af] group-hover:text-[#f3f4f6] shrink-0 font-mono">
            <span>[Abrir]</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>

        {/* Quick Stream Banner */}
        <div
          onClick={() => onNavigateTab("stream")}
          className="bg-[#14171a] hover:bg-[#181c22] border border-[#22272e] hover:border-[#3b424d] rounded-xl p-3.5 flex items-center justify-between gap-3 cursor-pointer transition-all group"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-[#1a1e24] text-[#10b981] border border-[#262b32] shrink-0">
              <CloudLightning className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#f3f4f6] group-hover:text-[#10b981] transition-colors truncate">
                Streaming Directo a Google Drive
              </p>
              <p className="text-[11px] text-[#9ca3af] truncate font-mono">
                Descarga a RAM y subida continua sin llenar el disco.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold text-[#9ca3af] group-hover:text-[#f3f4f6] shrink-0 font-mono">
            <span>[Abrir]</span>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>
      </div>
    </div>
  );
};

