import React from "react";
import {
  Server,
  Cpu,
  Layers,
  Database,
  Network,
  Clock,
  Activity,
  Zap,
  CheckCircle2,
  Terminal,
  ArrowRight,
  TrendingUp,
  CloudDownload,
  Folder,
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

  // SVG mini-sparkline generator
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
    const w = 240;
    const h = 40;
    const points = data
      .map((val, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - ((val - min) / range) * (h - 8) - 4;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    return (
      <svg className="w-full h-10 overflow-visible" viewBox={`0 0 ${w} ${h}`}>
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
    );
  };

  const cpuLoadHistory = history.map((h) => h.cpuLoad1m);
  const memUsageHistory = history.map((h) => h.memUsagePercent);
  const procRssHistory = history.map((h) => h.processRssMB);

  return (
    <div className="space-y-6">
      {/* Top Banner: Host summary & Status */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute -right-8 -bottom-8 w-48 h-48 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                HOST LINUX DEDICADO
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Servidor Activo
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              {os.distroName}
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 font-mono flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>Hostname: <strong className="text-indigo-300">{os.hostname}</strong></span>
              <span>Kernel: <strong className="text-slate-200">{os.kernelRelease}</strong> ({os.arch})</span>
              <span>Uptime: <strong className="text-emerald-300">{os.uptimeFormatted}</strong></span>
            </p>
          </div>

          <div className="flex items-center gap-3 bg-slate-950/70 p-3 rounded-xl border border-slate-800/80 font-mono text-xs">
            <div className="text-center px-3 border-r border-slate-800">
              <span className="text-[10px] text-slate-500 block uppercase font-sans">Carga 1m</span>
              <span className="text-base font-bold text-amber-400">{cpu.loadAverage["1min"]}</span>
            </div>
            <div className="text-center px-3 border-r border-slate-800">
              <span className="text-[10px] text-slate-500 block uppercase font-sans">RAM Usada</span>
              <span className="text-base font-bold text-indigo-400">{memory.usagePercentage}%</span>
            </div>
            <div className="text-center px-3">
              <span className="text-[10px] text-slate-500 block uppercase font-sans">Latencia API</span>
              <span className="text-base font-bold text-emerald-400">{apiLatency > 0 ? `${apiLatency} ms` : "< 1 ms"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bento Grid: 6 Primary Core Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Card 1: CPU */}
        <div
          onClick={() => onNavigateTab("cpu")}
          className="bg-slate-900/80 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-5 space-y-4 transition-all hover:bg-slate-900 cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white group-hover:text-blue-300 transition-colors">
                  Procesador (CPU)
                </h3>
                <span className="text-[11px] text-slate-400 font-mono">
                  {cpu.coresCount} vCPUs • {cpu.vendorId}
                </span>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" />
          </div>

          <div className="space-y-2 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Modelo:</span>
              <span className="text-white font-semibold truncate max-w-[170px]" title={cpu.model}>
                {cpu.model}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Frecuencia / Clock:</span>
              <span className="text-cyan-300">~{cpu.speedMHz} MHz</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Caché L3:</span>
              <span className="text-slate-200">{cpu.cacheSizeKB} KB (8 MB)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Carga Promedio (1/5/15m):</span>
              <span className="text-amber-400">
                {cpu.loadAverage["1min"]}, {cpu.loadAverage["5min"]}, {cpu.loadAverage["15min"]}
              </span>
            </div>
          </div>

          {/* Mini Sparkline for CPU load */}
          <div className="pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
              <span>Historial Carga CPU (40s)</span>
              <span className="font-mono text-blue-400">{cpu.loadAverage["1min"]}</span>
            </div>
            {renderSparkline(cpuLoadHistory, "#60a5fa", 0, Math.max(2, ...cpuLoadHistory))}
          </div>
        </div>

        {/* Card 2: Memory & Swap */}
        <div
          onClick={() => onNavigateTab("memory")}
          className="bg-slate-900/80 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-5 space-y-4 transition-all hover:bg-slate-900 cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white group-hover:text-purple-300 transition-colors">
                  Memoria RAM & Swap
                </h3>
                <span className="text-[11px] text-slate-400 font-mono">
                  {memory.totalGB} GB Total • {memory.availableGB} GB Disp.
                </span>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-purple-400 group-hover:translate-x-0.5 transition-all" />
          </div>

          <div className="space-y-2 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">RAM Total:</span>
              <span className="text-white font-semibold">{memory.totalGB} GB ({memory.totalBytes.toLocaleString()} B)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">RAM Usada:</span>
              <span className="text-purple-300 font-semibold">{memory.usedGB} GB ({memory.usagePercentage}%)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">RAM Disponible (Kernel):</span>
              <span className="text-emerald-400">{memory.availableGB} GB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Node RSS (Proceso):</span>
              <span className="text-slate-300">{memory.processMemory.rssMB} MB</span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(5, memory.usagePercentage))}%` }}
              />
            </div>
          </div>

          {/* Mini Sparkline for RAM */}
          <div className="pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
              <span>Uso RAM en Tiempo Real</span>
              <span className="font-mono text-purple-400">{memory.usagePercentage}%</span>
            </div>
            {renderSparkline(memUsageHistory, "#c084fc", 0, 100)}
          </div>
        </div>

        {/* Card 3: Storage (Disk) */}
        <div
          onClick={() => onNavigateTab("storage")}
          className="bg-slate-900/80 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-5 space-y-4 transition-all hover:bg-slate-900 cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white group-hover:text-amber-300 transition-colors">
                  Almacenamiento (Disco)
                </h3>
                <span className="text-[11px] text-slate-400 font-mono">
                  {rootDisk?.totalGB || "504"} GB en / (Root)
                </span>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all" />
          </div>

          <div className="space-y-2 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Montado en:</span>
              <span className="text-white font-semibold">{rootDisk?.path || "/"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Capacidad Total:</span>
              <span className="text-amber-300 font-semibold">{rootDisk?.totalGB} GB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Espacio Usado:</span>
              <span className="text-slate-300">{rootDisk?.usedGB} GB ({rootDisk?.usagePercentage}%)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Espacio Libre:</span>
              <span className="text-emerald-400">{rootDisk?.freeGB} GB</span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full"
                style={{ width: `${Math.max(2, rootDisk?.usagePercentage || 1)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 font-mono">
              <span>{rootDisk?.usedGB} GB Usado</span>
              <span>{rootDisk?.freeGB} GB Libre</span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono">
            <span className="text-slate-500 font-sans">Directorio Temp:</span>
            <span className="text-slate-300">{storage.tmpDir.path} ({storage.tmpDir.freeGB} GB libres)</span>
          </div>
        </div>

        {/* Card 4: Network & Interfaces */}
        <div
          onClick={() => onNavigateTab("network")}
          className="bg-slate-900/80 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-5 space-y-4 transition-all hover:bg-slate-900 cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Network className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white group-hover:text-emerald-300 transition-colors">
                  Red & Interfaces Host
                </h3>
                <span className="text-[11px] text-slate-400 font-mono">
                  {network.interfaces.length} Interfaces de Red
                </span>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all" />
          </div>

          <div className="space-y-2 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Hostname:</span>
              <span className="text-white font-semibold truncate max-w-[150px]">{network.hostname}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">DNS del Host:</span>
              <span className="text-indigo-300">{network.dnsServers[0] || "169.254.169.254"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">IP Primaria:</span>
              <span className="text-emerald-400">
                {network.interfaces.find((i) => !i.internal)?.address || "127.0.0.1"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Latencia RTT API:</span>
              <span className="text-cyan-300">{apiLatency > 0 ? `${apiLatency} ms` : "< 1 ms"}</span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap gap-1.5">
            {network.interfaces.map((iface, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700"
              >
                {iface.name}: {iface.family}
              </span>
            ))}
          </div>
        </div>

        {/* Card 5: Runtime, Kernel & Process */}
        <div
          onClick={() => onNavigateTab("runtime")}
          className="bg-slate-900/80 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-5 space-y-4 transition-all hover:bg-slate-900 cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Terminal className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                  Runtime & Kernel
                </h3>
                <span className="text-[11px] text-slate-400 font-mono">
                  Node.js {runtime.nodeVersion} • V8 {runtime.v8Version}
                </span>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" />
          </div>

          <div className="space-y-2 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">PID Servidor:</span>
              <span className="text-white font-semibold">{runtime.pid} (PPID: {runtime.ppid})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Uptime del Proceso:</span>
              <span className="text-cyan-300">{runtime.processUptimeFormatted}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">OpenSSL / Cripto:</span>
              <span className="text-slate-300">{runtime.opensslVersion}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Usuario de Ejecución:</span>
              <span className="text-indigo-300">{os.user.username} (UID: {os.user.uid})</span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
              <span>RSS Memoria Proceso</span>
              <span className="font-mono text-cyan-400">{memory.processMemory.rssMB} MB</span>
            </div>
            {renderSparkline(procRssHistory, "#22d3ee")}
          </div>
        </div>

        {/* Card 6: Benchmark & Rating */}
        <div
          onClick={() => onNavigateTab("benchmark")}
          className="bg-slate-900/80 border border-slate-800 hover:border-amber-500/50 rounded-2xl p-5 space-y-4 transition-all hover:bg-slate-900 cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Zap className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white group-hover:text-amber-300 transition-colors">
                  Benchmark del Servidor
                </h3>
                <span className="text-[11px] text-slate-400 font-mono">
                  {benchmarkStats.overallScore ? `${benchmarkStats.overallScore} Puntos` : "Sin ejecutar aún"}
                </span>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all" />
          </div>

          {benchmarkStats.overallScore ? (
            <div className="space-y-2 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Nivel de Instancia:</span>
                <span className="text-amber-300 font-bold">{benchmarkStats.tier}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">CPU Monohilo:</span>
                <span className="text-white">{benchmarkStats.cpuSingleScore} pts</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">CPU Multihilo:</span>
                <span className="text-indigo-300">{benchmarkStats.cpuMultiScore} pts</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 font-sans">Disco I/O (Write/Read):</span>
                <span className="text-emerald-400">{benchmarkStats.diskWriteMBps} / {benchmarkStats.diskReadMBps} MB/s</span>
              </div>
            </div>
          ) : (
            <div className="py-2 text-center space-y-2">
              <p className="text-xs text-slate-400">
                Ejecuta pruebas de estrés monohilo, multihilo, ancho de banda RAM e I/O de disco 100% en el servidor.
              </p>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRunBenchmark();
                }}
                className="w-full py-2 px-3 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold transition-all cursor-pointer"
              >
                Lanzar Prueba de Rendimiento
              </button>
            </div>
          )}

          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
            <span>Algoritmo SHA-256 + Worker Threads</span>
            <span className="text-indigo-400 font-semibold">100% Host</span>
          </div>
        </div>

        {/* Card 7: Google Drive Download Client Integration */}
        <div
          onClick={() => onNavigateTab("drive")}
          className="bg-slate-900/80 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-5 space-y-4 transition-all hover:bg-slate-900 cursor-pointer group md:col-span-2 lg:col-span-3 bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/30"
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <CloudDownload className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors">
                    Cliente de Descarga • Google Drive
                  </h3>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    NUEVA INTEGRACIÓN
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Descarga archivos web desde URLs y guarda informes técnicos del servidor directamente en tu carpeta dedicada de Drive.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              <span className="text-xs font-semibold text-indigo-400 group-hover:text-indigo-300 flex items-center gap-1.5 font-mono">
                <span>Abrir Cliente</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
