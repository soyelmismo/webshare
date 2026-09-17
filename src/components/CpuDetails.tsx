import React, { useState } from "react";
import { Cpu, Zap, Activity, CheckCircle2, XCircle, Search } from "lucide-react";
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
    <div className="space-y-4">
      {/* Header Info */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-[#1f242c] border border-[#3b424d] text-[#10b981] shrink-0">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#f3f4f6]">Procesador del Servidor Host (vCPUs)</h2>
            <p className="text-xs text-[#9ca3af] font-mono">
              {cpu.model} • Fabricante: <span className="text-[#34d399] font-semibold">{cpu.vendorId}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono">
          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#1f242c] text-[#34d399] border border-[#3b424d]">
            {cpu.coresCount} vCPUs Asignadas
          </span>
          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d]">
            ~{cpu.speedMHz} MHz
          </span>
        </div>
      </div>

      {/* Primary Hardware Specs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-3.5 space-y-1">
          <span className="text-xs text-[#9ca3af] font-semibold block">Arquitectura & Familia</span>
          <span className="text-sm font-bold text-[#f3f4f6] font-mono block truncate">
            {os.arch} (Familia {cpu.family})
          </span>
          <span className="text-[11px] text-[#6b7280] font-mono">{cpu.addressSizes}</span>
        </div>

        <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-3.5 space-y-1">
          <span className="text-xs text-[#9ca3af] font-semibold block">Memoria Caché L3</span>
          <span className="text-sm font-bold text-[#f3f4f6] font-mono block">
            {cpu.cacheSizeKB} KB ({Math.round(cpu.cacheSizeKB / 1024)} MB)
          </span>
          <span className="text-[11px] text-[#6b7280]">Caché unificada por socket</span>
        </div>

        <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-3.5 space-y-1">
          <span className="text-xs text-[#9ca3af] font-semibold block">Potencia BogoMIPS</span>
          <span className="text-sm font-bold text-[#34d399] font-mono block">
            {cpu.bogomips}
          </span>
          <span className="text-[11px] text-[#6b7280]">Calibración de retardo del kernel</span>
        </div>

        <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-3.5 space-y-1">
          <span className="text-xs text-[#9ca3af] font-semibold block">Carga Media del Host</span>
          <span className="text-sm font-bold text-[#f3f4f6] font-mono block">
            {cpu.loadAverage["1min"]} / {cpu.loadAverage["5min"]} / {cpu.loadAverage["15min"]}
          </span>
          <span className="text-[11px] text-[#6b7280]">Promedios 1m, 5m y 15m</span>
        </div>
      </div>

      {/* Per-Core Distribution Breakdown */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-[#f3f4f6] flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#10b981]" />
          Distribución de Ticks de Procesador por Núcleo (Linux CPU Accounting)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {cpu.cores.map((core) => {
            const { userPct, sysPct, idlePct } = calculateCorePercentages(core.times);
            return (
              <div
                key={core.id}
                className="bg-[#101317] border border-[#22272e] rounded-lg p-3.5 space-y-2.5 font-mono text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#f3f4f6] flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#10b981]" />
                    vCPU Core #{core.id}
                  </span>
                  <span className="text-[#9ca3af]">{core.speedMHz} MHz</span>
                </div>

                {/* Progress Stack */}
                <div className="w-full bg-[#1a1e24] h-2.5 rounded-full overflow-hidden flex border border-[#22272e]">
                  <div
                    title={`Usuario: ${userPct}%`}
                    style={{ width: `${userPct}%` }}
                    className="bg-[#10b981] h-full"
                  />
                  <div
                    title={`Sistema: ${sysPct}%`}
                    style={{ width: `${sysPct}%` }}
                    className="bg-[#3b82f6] h-full"
                  />
                  <div
                    title={`Inactivo (Idle): ${idlePct}%`}
                    style={{ width: `${idlePct}%` }}
                    className="bg-[#262b32] h-full"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 text-[11px]">
                  <div>
                    <span className="text-[#6b7280] font-sans block">Usuario:</span>
                    <span className="text-[#34d399] font-semibold">{core.times.user.toLocaleString()} ticks ({userPct}%)</span>
                  </div>
                  <div>
                    <span className="text-[#6b7280] font-sans block">Sistema:</span>
                    <span className="text-[#60a5fa] font-semibold">{core.times.sys.toLocaleString()} ticks ({sysPct}%)</span>
                  </div>
                  <div>
                    <span className="text-[#6b7280] font-sans block">Inactivo (Idle):</span>
                    <span className="text-[#9ca3af] font-semibold">{core.times.idle.toLocaleString()} ticks ({idlePct}%)</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Instruction Sets & CPU Flags */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#f3f4f6] flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#eab308]" />
              Conjuntos de Instrucciones & Extensiones de Hardware (CPU Flags)
            </h3>
            <p className="text-xs text-[#9ca3af]">
              Instrucciones SIMD, criptografía acelerada y virtualización activas en el procesador.
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[#6b7280] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar flag (AVX, SSE, AES)..."
              value={flagFilter}
              onChange={(e) => setFlagFilter(e.target.value)}
              className="w-full bg-[#101317] border border-[#22272e] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#f3f4f6] placeholder-[#6b7280] focus:outline-none focus:border-[#10b981] font-mono"
            />
          </div>
        </div>

        {/* Highlighted Feature Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {filteredKnownFlags.map((feat) => (
            <div
              key={feat.flag}
              className="p-3 rounded-lg bg-[#101317] border border-[#22272e] flex items-start justify-between gap-2"
            >
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[#f3f4f6] font-mono">{feat.name}</span>
                  <span className="text-[10px] text-[#6b7280] font-mono">({feat.flag})</span>
                </div>
                <p className="text-[11px] text-[#9ca3af] leading-tight mt-0.5">{feat.description}</p>
              </div>
              <div className="shrink-0 mt-0.5">
                {feat.supported ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#064e3b] text-[#34d399] border border-[#059669]/60 font-mono font-bold">
                    [OK]
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#1a1e24] text-[#6b7280] border border-[#22272e] font-mono">
                    [-]
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Raw Flags Section Toggle */}
        <div className="pt-2 border-t border-[#22272e]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#9ca3af] font-mono">
              Todos los Flags Detectados en /proc/cpuinfo ({cpu.flags.length} flags)
            </span>
            <button
              onClick={() => setShowAllRawFlags(!showAllRawFlags)}
              className="text-xs text-[#34d399] hover:underline font-semibold cursor-pointer"
            >
              {showAllRawFlags ? "[Ocultar lista completa]" : "[Ver todos los flags]"}
            </button>
          </div>

          {showAllRawFlags && (
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-3 bg-[#101317] rounded-lg border border-[#22272e]">
              {filteredRawFlags.map((flag, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#1a1e24] text-[#d1d5db] border border-[#262b32]"
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
