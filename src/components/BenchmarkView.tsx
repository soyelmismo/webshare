import React from "react";
import {
  Zap,
  Play,
  RotateCw,
  Cpu,
  Layers,
  HardDrive,
  Activity,
  Award,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
} from "lucide-react";
import { ServerSpecs, ServerBenchmarkStats } from "../types";

interface BenchmarkViewProps {
  serverSpecs: ServerSpecs;
  benchmarkStats: ServerBenchmarkStats;
  onRunBenchmark: () => void;
}

export const BenchmarkView: React.FC<BenchmarkViewProps> = ({
  serverSpecs,
  benchmarkStats,
  onRunBenchmark,
}) => {
  const isRunning = benchmarkStats.status === "running";
  const isCompleted = benchmarkStats.status === "completed";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Suite de Benchmark del Servidor Host</h2>
            <p className="text-xs text-slate-400">
              Evaluación de estrés 100% en backend (cómputo monohilo y multihilo en vCPUs, ancho de banda de memoria RAM y E/S de disco).
            </p>
          </div>
        </div>

        <button
          onClick={onRunBenchmark}
          disabled={isRunning}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white transition-all cursor-pointer shadow-lg shadow-amber-600/25 disabled:opacity-50"
        >
          {isRunning ? (
            <>
              <RotateCw className="w-4 h-4 animate-spin text-amber-200" />
              <span>Ejecutando en Servidor...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>{isCompleted ? "Repetir Benchmark" : "Iniciar Benchmark Completo"}</span>
            </>
          )}
        </button>
      </div>

      {/* Progress Card when running */}
      {isRunning && (
        <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-6 space-y-3 shadow-xl animate-pulse">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-amber-300 font-bold">{benchmarkStats.currentStep}</span>
            <span className="text-white font-bold">{benchmarkStats.progressPercent}%</span>
          </div>

          <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-300"
              style={{ width: `${benchmarkStats.progressPercent}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-400 font-mono text-center">
            El servidor host está procesando las cargas de trabajo de prueba en Linux...
          </p>
        </div>
      )}

      {/* Overall Score Badge */}
      {isCompleted && benchmarkStats.overallScore !== null && (
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950/50 to-slate-900 border border-indigo-500/30 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl">
          <div className="flex items-center gap-4">
            <div className="p-4 rounded-2xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <Award className="w-10 h-10" />
            </div>
            <div>
              <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider font-mono block">
                Índice Global de Rendimiento del Servidor
              </span>
              <div className="flex items-baseline gap-3">
                <span className="text-3xl sm:text-4xl font-black text-white font-mono">
                  {benchmarkStats.overallScore.toLocaleString()}
                </span>
                <span className="text-sm font-semibold text-slate-400 font-sans">puntos</span>
              </div>
              <p className="text-xs text-slate-300 font-mono mt-0.5">
                Nivel de Instancia: <strong className="text-amber-300">{benchmarkStats.tier}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 font-mono text-xs bg-slate-950/70 p-3 rounded-xl border border-slate-800">
            <div className="text-center px-3 border-r border-slate-800">
              <span className="text-[10px] text-slate-500 block uppercase font-sans">CPU Multi</span>
              <span className="text-sm font-bold text-indigo-400">{benchmarkStats.cpuMultiScore} pts</span>
            </div>
            <div className="text-center px-3 border-r border-slate-800">
              <span className="text-[10px] text-slate-500 block uppercase font-sans">RAM BW</span>
              <span className="text-sm font-bold text-purple-400">{benchmarkStats.memoryBandwidthMBps} MB/s</span>
            </div>
            <div className="text-center px-3">
              <span className="text-[10px] text-slate-500 block uppercase font-sans">Disco Write</span>
              <span className="text-sm font-bold text-emerald-400">{benchmarkStats.diskWriteMBps} MB/s</span>
            </div>
          </div>
        </div>
      )}

      {/* Grid: 4 Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 font-mono">
        {/* CPU Single */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2.5 text-blue-400 font-sans">
            <Cpu className="w-5 h-5" />
            <h3 className="text-sm font-bold text-white">CPU Monohilo</h3>
          </div>

          <div className="space-y-1">
            <span className="text-2xl font-black text-white block">
              {benchmarkStats.cpuSingleScore ? `${benchmarkStats.cpuSingleScore} pts` : "--"}
            </span>
            <span className="text-xs text-slate-400 block font-sans">
              {benchmarkStats.cpuSingleOpsSec
                ? `${benchmarkStats.cpuSingleOpsSec.toLocaleString()} ops/s (SHA-256)`
                : "Estrés de un solo núcleo"}
            </span>
          </div>

          <p className="text-[11px] text-slate-500 font-sans leading-relaxed pt-2 border-t border-slate-800">
            Mide la velocidad pura de cómputo secuencial y ejecución criptográfica en 1 vCPU.
          </p>
        </div>

        {/* CPU Multi */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2.5 text-indigo-400 font-sans">
            <Activity className="w-5 h-5" />
            <h3 className="text-sm font-bold text-white">CPU Multihilo</h3>
          </div>

          <div className="space-y-1">
            <span className="text-2xl font-black text-white block">
              {benchmarkStats.cpuMultiScore ? `${benchmarkStats.cpuMultiScore} pts` : "--"}
            </span>
            <span className="text-xs text-slate-400 block font-sans">
              {benchmarkStats.cpuMultiOpsSec
                ? `${benchmarkStats.cpuMultiOpsSec.toLocaleString()} ops/s totales`
                : `${serverSpecs.cpu.coresCount} vCPUs con Worker Threads`}
            </span>
          </div>

          <p className="text-[11px] text-slate-500 font-sans leading-relaxed pt-2 border-t border-slate-800">
            Escala el cómputo distribuido entre todas las vCPUs disponibles del servidor host en paralelo.
          </p>
        </div>

        {/* RAM Bandwidth */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2.5 text-purple-400 font-sans">
            <Layers className="w-5 h-5" />
            <h3 className="text-sm font-bold text-white">Ancho Banda RAM</h3>
          </div>

          <div className="space-y-1">
            <span className="text-2xl font-black text-white block">
              {benchmarkStats.memoryBandwidthMBps ? `${benchmarkStats.memoryBandwidthMBps} MB/s` : "--"}
            </span>
            <span className="text-xs text-slate-400 block font-sans">
              Asignación masiva en Node Buffer
            </span>
          </div>

          <p className="text-[11px] text-slate-500 font-sans leading-relaxed pt-2 border-t border-slate-800">
            Tasa de transferencia sostenida de lectura y escritura en la memoria RAM asignada al servidor.
          </p>
        </div>

        {/* Disk I/O */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2.5 text-emerald-400 font-sans">
            <HardDrive className="w-5 h-5" />
            <h3 className="text-sm font-bold text-white">E/S Disco Raíz</h3>
          </div>

          <div className="space-y-1">
            <span className="text-2xl font-black text-white block">
              {benchmarkStats.diskWriteMBps ? `${benchmarkStats.diskWriteMBps} MB/s` : "--"}
            </span>
            <span className="text-xs text-slate-400 block font-sans">
              {benchmarkStats.diskReadMBps ? `Lectura: ${benchmarkStats.diskReadMBps} MB/s` : "Escritura / Lectura secuencial"}
            </span>
          </div>

          <p className="text-[11px] text-slate-500 font-sans leading-relaxed pt-2 border-t border-slate-800">
            Velocidad de persistencia en disco del contenedor host forzando sincronización física (fdatasync).
          </p>
        </div>
      </div>

      {/* Comparison Reference Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2 font-sans">
          <TrendingUp className="w-4 h-4 text-indigo-400" />
          Tabla de Referencia de Entornos Servidor Cloud
        </h3>

        <div className="overflow-x-auto rounded-xl border border-slate-800 font-mono text-xs">
          <table className="w-full text-left">
            <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-sans border-b border-slate-800">
              <tr>
                <th className="p-3">Perfil / Entorno de Servidor</th>
                <th className="p-3">vCPUs</th>
                <th className="p-3">RAM</th>
                <th className="p-3">CPU Monohilo</th>
                <th className="p-3">CPU Multihilo</th>
                <th className="p-3">Puntuación Estimada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 bg-slate-950/40">
              <tr className="bg-indigo-950/30 border-l-4 border-l-indigo-500">
                <td className="p-3 font-bold text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />
                  Este Servidor Host (Cloud Run)
                </td>
                <td className="p-3 text-indigo-300 font-bold">{serverSpecs.cpu.coresCount} vCPUs</td>
                <td className="p-3 text-purple-300">{serverSpecs.memory.totalGB} GB</td>
                <td className="p-3 text-cyan-300 font-bold">{benchmarkStats.cpuSingleScore || "~4,200"} pts</td>
                <td className="p-3 text-indigo-300 font-bold">{benchmarkStats.cpuMultiScore || "~5,000"} pts</td>
                <td className="p-3 font-black text-amber-300">{benchmarkStats.overallScore || "~3,500"} pts</td>
              </tr>
              <tr className="hover:bg-slate-800/30 text-slate-400">
                <td className="p-3 font-semibold text-slate-300">VPS Básico (1 vCPU compartida)</td>
                <td className="p-3">1 vCPU</td>
                <td className="p-3">1.0 GB</td>
                <td className="p-3">~1,800 pts</td>
                <td className="p-3">~1,800 pts</td>
                <td className="p-3 font-semibold text-slate-300">~1,200 pts</td>
              </tr>
              <tr className="hover:bg-slate-800/30 text-slate-400">
                <td className="p-3 font-semibold text-slate-300">Instancia Estándar e2-medium</td>
                <td className="p-3">2 vCPUs</td>
                <td className="p-3">4.0 GB</td>
                <td className="p-3">~3,000 pts</td>
                <td className="p-3">~4,000 pts</td>
                <td className="p-3 font-semibold text-slate-300">~2,800 pts</td>
              </tr>
              <tr className="hover:bg-slate-800/30 text-slate-400">
                <td className="p-3 font-semibold text-slate-300">Instancia Cómputo Workstation (4+ vCPUs)</td>
                <td className="p-3">4 vCPUs</td>
                <td className="p-3">16.0 GB</td>
                <td className="p-3">~4,800 pts</td>
                <td className="p-3">~9,500 pts</td>
                <td className="p-3 font-semibold text-slate-300">~6,500+ pts</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
