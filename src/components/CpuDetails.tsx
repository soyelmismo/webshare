import React, { useState } from "react";
import { Cpu, Zap, Activity, CheckCircle2, XCircle, Search, Terminal, Layers } from "lucide-react";
import { ServerSpecs } from "../types";

interface CpuDetailsProps {
  serverSpecs: ServerSpecs;
  onRunBenchmark?: () => void;
}

export const CpuDetails: React.FC<CpuDetailsProps> = ({ serverSpecs, onRunBenchmark }) => {
  const { cpu, os } = serverSpecs;
  const [flagFilter, setFlagFilter] = useState("");
  const [showAllRawFlags, setShowAllRawFlags] = useState(false);

  const filteredKnownFlags = cpu.featureFlags.filter(
    (f) =>
      f.name.toLowerCase().includes(flagFilter.toLowerCase()) ||
      f.flag.toLowerCase().includes(flagFilter.toLowerCase()) ||
      f.description.toLowerCase().includes(flagFilter.toLowerCase())
  );

  const filteredRawFlags = cpu.flags.filter((f) =>
    f.toLowerCase().includes(flagFilter.toLowerCase())
  );

  // Calculate total ticks for per-core breakdown
  const calculateCorePercentages = (times: { user: number; nice: number; sys: number; idle: number; irq: number }) => {
    const total = times.user + times.nice + times.sys + times.idle + times.irq || 1;
    const userPct = Math.round((times.user / total) * 100);
    const sysPct = Math.round((times.sys / total) * 100);
    const idlePct = Math.round((times.idle / total) * 100);
    return { userPct, sysPct, idlePct };
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Procesador del Servidor Host (vCPUs)</h2>
            <p className="text-xs text-slate-400 font-mono">
              {cpu.model} • Fabricante: <span className="text-indigo-400 font-semibold">{cpu.vendorId}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono">
          <span className="px-3 py-1 rounded-lg text-xs font-bold bg-blue-500/10 text-blue-300 border border-blue-500/20">
            {cpu.coresCount} vCPUs Asignadas
          </span>
          <span className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">
            ~{cpu.speedMHz} MHz
          </span>
        </div>
      </div>

      {/* Primary Hardware Specs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-1">
          <span className="text-xs text-slate-400 font-sans block">Arquitectura & Familia</span>
          <span className="text-sm font-bold text-white font-mono block truncate">
            {os.arch} (Familia {cpu.family})
          </span>
          <span className="text-[11px] text-slate-500 font-mono">{cpu.addressSizes}</span>
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-1">
          <span className="text-xs text-slate-400 font-sans block">Memoria Caché L3</span>
          <span className="text-sm font-bold text-cyan-300 font-mono block">
            {cpu.cacheSizeKB} KB ({Math.round(cpu.cacheSizeKB / 1024)} MB)
          </span>
          <span className="text-[11px] text-slate-500">Caché unificada por socket</span>
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-1">
          <span className="text-xs text-slate-400 font-sans block">Potencia BogoMIPS</span>
          <span className="text-sm font-bold text-amber-300 font-mono block">
            {cpu.bogomips}
          </span>
          <span className="text-[11px] text-slate-500">Calibración de retardo del kernel</span>
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-1">
          <span className="text-xs text-slate-400 font-sans block">Carga Media del Host</span>
          <span className="text-sm font-bold text-emerald-400 font-mono block">
            {cpu.loadAverage["1min"]} / {cpu.loadAverage["5min"]} / {cpu.loadAverage["15min"]}
          </span>
          <span className="text-[11px] text-slate-500">Promedios 1m, 5m y 15m</span>
        </div>
      </div>

      {/* Per-Core Distribution Breakdown */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400" />
          Distribución de Ticks de Procesador por Núcleo (Linux CPU Accounting)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cpu.cores.map((core) => {
            const { userPct, sysPct, idlePct } = calculateCorePercentages(core.times);
            return (
              <div
                key={core.id}
                className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 space-y-3 font-mono text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-white flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400" />
                    vCPU Core #{core.id}
                  </span>
                  <span className="text-slate-400">{core.speedMHz} MHz</span>
                </div>

                {/* Progress Stack */}
                <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden flex">
                  <div
                    title={`Usuario: ${userPct}%`}
                    style={{ width: `${userPct}%` }}
                    className="bg-blue-500 h-full"
                  />
                  <div
                    title={`Sistema: ${sysPct}%`}
                    style={{ width: `${sysPct}%` }}
                    className="bg-indigo-500 h-full"
                  />
                  <div
                    title={`Inactivo (Idle): ${idlePct}%`}
                    style={{ width: `${idlePct}%` }}
                    className="bg-slate-700 h-full"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 text-[11px]">
                  <div>
                    <span className="text-slate-500 font-sans block">Usuario:</span>
                    <span className="text-blue-300 font-semibold">{core.times.user.toLocaleString()} ticks</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block">Sistema:</span>
                    <span className="text-indigo-300 font-semibold">{core.times.sys.toLocaleString()} ticks</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-sans block">Inactivo (Idle):</span>
                    <span className="text-slate-400 font-semibold">{core.times.idle.toLocaleString()} ticks</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Instruction Sets & CPU Flags */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              Conjuntos de Instrucciones & Extensiones de Hardware (CPU Flags)
            </h3>
            <p className="text-xs text-slate-400">
              Instrucciones SIMD, criptografía acelerada y virtualización activas en el procesador del servidor.
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar flag (AVX, SSE, AES)..."
              value={flagFilter}
              onChange={(e) => setFlagFilter(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>
        </div>

        {/* Highlighted Feature Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {filteredKnownFlags.map((feat) => (
            <div
              key={feat.flag}
              className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start justify-between gap-2"
            >
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-white font-mono">{feat.name}</span>
                  <span className="text-[10px] text-slate-500 font-mono">({feat.flag})</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-tight mt-0.5">{feat.description}</p>
              </div>
              <div className="shrink-0 mt-0.5">
                {feat.supported ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" title="Activo en el hardware" />
                ) : (
                  <XCircle className="w-4 h-4 text-slate-600" title="No presente" />
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Raw Flags Section Toggle */}
        <div className="pt-2 border-t border-slate-800/80">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400 font-mono">
              Todos los Flags Detectados en /proc/cpuinfo ({cpu.flags.length} flags)
            </span>
            <button
              onClick={() => setShowAllRawFlags(!showAllRawFlags)}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
            >
              {showAllRawFlags ? "Ocultar lista completa" : "Ver todos los flags"}
            </button>
          </div>

          {showAllRawFlags && (
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-3 bg-slate-950 rounded-xl border border-slate-800">
              {filteredRawFlags.map((flag, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-900 text-slate-300 border border-slate-800"
                >
                  {flag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
