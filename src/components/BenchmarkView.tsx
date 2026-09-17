import React from "react";
import { Zap, Cpu, Layers, Database, Activity, Play, Loader2, CheckCircle2 } from "lucide-react";
import { ServerSpecs, ServerBenchmarkStats } from "../types";

interface BenchmarkViewProps {
  stats?: ServerBenchmarkStats;
  benchmarkStats?: ServerBenchmarkStats;
  serverSpecs?: ServerSpecs;
  isRunning?: boolean;
  onRunBenchmark: () => void;
  progressMessage?: string;
}

export const BenchmarkView: React.FC<BenchmarkViewProps> = ({
  stats: propStats,
  benchmarkStats: propBenchmarkStats,
  isRunning = false,
  onRunBenchmark,
  progressMessage = "",
}) => {
  const stats = propStats || propBenchmarkStats || {
    status: "idle",
    cpuSingleScore: null,
    cpuSingleOpsSec: null,
    cpuMultiScore: null,
    cpuMultiOpsSec: null,
    memoryBandwidthMBps: null,
    diskWriteMBps: null,
    diskReadMBps: null,
    apiLatencyMs: null,
    overallScore: null,
    tier: null,
    progressPercent: 0,
    currentStep: "Listo para iniciar",
    timestamp: null,
  };

  const isActuallyRunning = isRunning || stats.status === "running";
  const currentProgressMsg = progressMessage || stats.currentStep || "Procesando prueba de rendimiento...";

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-[#1f242c] border border-[#3b424d] text-[#10b981] shrink-0">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#f3f4f6]">Suite de Rendimiento del Servidor (Benchmark)</h2>
            <p className="text-xs text-[#9ca3af]">
              Evalúa la potencia de cómputo en mononúcleo, multinúcleo, ancho de banda de RAM y velocidad de disco.
            </p>
          </div>
        </div>

        <button
          onClick={onRunBenchmark}
          disabled={isActuallyRunning}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e] transition-colors cursor-pointer disabled:opacity-50 shrink-0"
        >
          {isActuallyRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Ejecutando Pruebas de Carga...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Ejecutar Benchmark Completo</span>
            </>
          )}
        </button>
      </div>

      {/* Progress Bar during benchmark run */}
      {isActuallyRunning && (
        <div className="bg-[#14171a] border border-[#10b981]/40 rounded-xl p-4 space-y-2 font-mono text-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#f3f4f6] flex items-center gap-2">
              <Activity className="w-4 h-4 animate-spin text-[#10b981]" />
              {currentProgressMsg}
            </span>
            <span className="text-[#34d399]">[PROCESANDO]</span>
          </div>
          <div className="w-full bg-[#101317] h-2 rounded-full overflow-hidden border border-[#22272e]">
            <div className="bg-[#10b981] h-full w-2/3 animate-pulse" />
          </div>
        </div>
      )}

      {/* Overall Score Summary */}
      {stats.overallScore ? (
        <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="space-y-1 text-center sm:text-left">
            <span className="text-xs text-[#9ca3af] font-sans font-semibold uppercase tracking-wider block">
              Puntuación Global de Servidor
            </span>
            <div className="flex items-baseline gap-3 justify-center sm:justify-start font-mono">
              <span className="text-4xl font-extrabold text-[#34d399]">{stats.overallScore}</span>
              <span className="text-sm font-semibold text-[#9ca3af]">/ 1,000 pts</span>
            </div>
          </div>

          <div className="text-center sm:text-right space-y-1">
            <span className="px-3 py-1 rounded-lg text-xs font-bold bg-[#064e3b] text-[#34d399] border border-[#059669]/60 font-mono inline-block">
              Nivel: {stats.tier}
            </span>
            <p className="text-[11px] text-[#6b7280] font-mono">
              Última ejecución: {stats.lastRunTime ? new Date(stats.lastRunTime).toLocaleTimeString() : "Reciente"}
            </p>
          </div>
        </div>
      ) : null}

      {/* 4 Detail Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
        {/* Single Core */}
        <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[#9ca3af] font-sans font-semibold">Single-Core CPU</span>
            <Cpu className="w-4 h-4 text-[#10b981]" />
          </div>
          <span className="text-2xl font-bold text-[#f3f4f6] block">
            {stats.cpuSingleScore ? `${stats.cpuSingleScore} pts` : "--"}
          </span>
          <p className="text-[11px] text-[#6b7280] font-sans leading-tight">
            Prueba de cálculo intensivo de primos (1M) en un solo hilo.
          </p>
        </div>

        {/* Multi Core */}
        <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[#9ca3af] font-sans font-semibold">Multi-Core CPU</span>
            <Activity className="w-4 h-4 text-[#10b981]" />
          </div>
          <span className="text-2xl font-bold text-[#f3f4f6] block">
            {stats.cpuMultiScore ? `${stats.cpuMultiScore} pts` : "--"}
          </span>
          <p className="text-[11px] text-[#6b7280] font-sans leading-tight">
            Carga simultánea distribuida entre los núcleos virtuales.
          </p>
        </div>

        {/* Memory Bandwidth */}
        <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[#9ca3af] font-sans font-semibold">Ancho de Banda RAM</span>
            <Layers className="w-4 h-4 text-[#10b981]" />
          </div>
          <span className="text-2xl font-bold text-[#f3f4f6] block">
            {stats.memoryBandwidthMBps ? `${stats.memoryBandwidthMBps} MB/s` : "--"}
          </span>
          <p className="text-[11px] text-[#6b7280] font-sans leading-tight">
            Tasa de copia y asignación directa de ArrayBuffers en V8.
          </p>
        </div>

        {/* Disk I/O */}
        <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[#9ca3af] font-sans font-semibold">Disco Write / Read</span>
            <Database className="w-4 h-4 text-[#10b981]" />
          </div>
          <span className="text-2xl font-bold text-[#f3f4f6] block truncate">
            {stats.diskWriteMBps ? `${stats.diskWriteMBps} / ${stats.diskReadMBps} MB/s` : "--"}
          </span>
          <p className="text-[11px] text-[#6b7280] font-sans leading-tight">
            Escritura y lectura secuencial de bloques de 20 MB con sync.
          </p>
        </div>
      </div>

      {/* Cloud Performance Reference Comparison Table */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-[#f3f4f6]">
          Tabla de Referencia Comparativa con Entornos Cloud
        </h3>

        <div className="overflow-x-auto rounded-lg border border-[#22272e]">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#1f242c] text-[#9ca3af] uppercase tracking-wider font-sans border-b border-[#22272e]">
              <tr>
                <th className="p-2.5 font-bold">Tipo de Entorno</th>
                <th className="p-2.5 font-bold">Single-Core</th>
                <th className="p-2.5 font-bold">Multi-Core</th>
                <th className="p-2.5 font-bold">Ancho de Banda RAM</th>
                <th className="p-2.5 font-bold">Rendimiento Disco</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#22272e] bg-[#101317]">
              <tr className="bg-[#161b22] font-bold">
                <td className="p-2.5 text-[#34d399] flex items-center gap-1.5 font-sans">
                  <span className="w-2 h-2 rounded-full bg-[#10b981]" />
                  Servidor Host Actual
                </td>
                <td className="p-2.5 text-[#f3f4f6]">{stats.cpuSingleScore || "~280"} pts</td>
                <td className="p-2.5 text-[#f3f4f6]">{stats.cpuMultiScore || "~350"} pts</td>
                <td className="p-2.5 text-[#f3f4f6]">{stats.memoryBandwidthMBps || "~4,500"} MB/s</td>
                <td className="p-2.5 text-[#f3f4f6]">{stats.diskWriteMBps || "~120"} MB/s</td>
              </tr>
              <tr className="hover:bg-[#161a1f] text-[#9ca3af] transition-colors">
                <td className="p-2.5 font-medium text-[#f3f4f6]">Google Cloud Run (Standard)</td>
                <td className="p-2.5">~250 pts</td>
                <td className="p-2.5">~320 pts</td>
                <td className="p-2.5">~4,200 MB/s</td>
                <td className="p-2.5">~90 MB/s</td>
              </tr>
              <tr className="hover:bg-[#161a1f] text-[#9ca3af] transition-colors">
                <td className="p-2.5 font-medium text-[#f3f4f6]">AWS Lambda (2048 MB)</td>
                <td className="p-2.5">~220 pts</td>
                <td className="p-2.5">~240 pts</td>
                <td className="p-2.5">~3,800 MB/s</td>
                <td className="p-2.5">~60 MB/s</td>
              </tr>
              <tr className="hover:bg-[#161a1f] text-[#9ca3af] transition-colors">
                <td className="p-2.5 font-medium text-[#f3f4f6]">VPS Estándar (1 vCPU)</td>
                <td className="p-2.5">~150 pts</td>
                <td className="p-2.5">~150 pts</td>
                <td className="p-2.5">~2,100 MB/s</td>
                <td className="p-2.5">~40 MB/s</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
