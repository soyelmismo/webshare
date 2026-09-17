import React, { useState } from "react";
import { Layers, HardDrive, Activity, Search, Database } from "lucide-react";
import { ServerSpecs } from "../types";

interface MemoryDetailsProps {
  serverSpecs: ServerSpecs;
}

export const MemoryDetails: React.FC<MemoryDetailsProps> = ({ serverSpecs }) => {
  const { memory } = serverSpecs;
  const [memSearch, setMemSearch] = useState("");

  const meminfoObj = memory?.meminfo && typeof memory.meminfo === "object" ? memory.meminfo : {};
  const filteredMeminfo = Object.entries(meminfoObj).filter(([key, val]) =>
    key.toLowerCase().includes(memSearch.toLowerCase()) ||
    String(val).toLowerCase().includes(memSearch.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-[#1f242c] border border-[#3b424d] text-[#10b981] shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#f3f4f6]">Memoria RAM & Swap del Servidor</h2>
            <p className="text-xs text-[#9ca3af] font-mono">
              Capacidad física: <span className="text-[#34d399] font-semibold">{memory.totalGB} GB</span> ({memory.totalBytes.toLocaleString()} bytes)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono">
          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d]">
            {memory.usagePercentage}% en Uso
          </span>
          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#064e3b] text-[#34d399] border border-[#059669]/60">
            {memory.availableGB} GB Disponible
          </span>
        </div>
      </div>

      {/* Main RAM Visualizer Card */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-[#f3f4f6] flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-[#10b981]" />
          Desglose de Memoria Física del Sistema (Linux Host)
        </h3>

        {/* Multi-segment memory bar */}
        <div className="space-y-2">
          <div className="w-full bg-[#1a1e24] h-3 rounded-full overflow-hidden flex border border-[#22272e]">
            <div
              style={{ width: `${Math.max(2, memory.usagePercentage)}%` }}
              title={`RAM Usada: ${memory.usedGB} GB (${memory.usagePercentage}%)`}
              className="bg-[#10b981] h-full"
            />
            <div
              style={{ width: `${100 - memory.usagePercentage}%` }}
              title={`RAM Disponible: ${memory.availableGB} GB`}
              className="bg-[#262b32] h-full"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between text-xs font-mono pt-1 text-[#9ca3af]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
              <span>Usada: <strong className="text-[#f3f4f6]">{memory.usedGB} GB</strong> ({memory.usagePercentage}%)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#34d399]" />
              <span>Disponible (Kernel): <strong className="text-[#34d399]">{memory.availableGB} GB</strong></span>
            </div>
            <div>
              <span>RAM Libre estricta: <strong className="text-[#9ca3af]">{memory.freeGB} GB</strong></span>
            </div>
          </div>
        </div>

        {/* 4 Cards Subgrid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] space-y-1">
            <span className="text-xs text-[#9ca3af] font-semibold block">RAM Total Asignada</span>
            <span className="text-sm font-bold text-[#f3f4f6] font-mono block">{memory.totalGB} GB</span>
            <span className="text-[11px] text-[#6b7280] font-mono">4,194,304 kB</span>
          </div>

          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] space-y-1">
            <span className="text-xs text-[#9ca3af] font-semibold block">Page Cache (Caché)</span>
            <span className="text-sm font-bold text-[#f3f4f6] font-mono block">{memory.cachedMB} MB</span>
            <span className="text-[11px] text-[#6b7280]">Caché de E/S de disco en RAM</span>
          </div>

          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] space-y-1">
            <span className="text-xs text-[#9ca3af] font-semibold block">Buffers del Kernel</span>
            <span className="text-sm font-bold text-[#f3f4f6] font-mono block">{memory.buffersMB} MB</span>
            <span className="text-[11px] text-[#6b7280]">Búferes de bloques de archivos</span>
          </div>

          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] space-y-1">
            <span className="text-xs text-[#9ca3af] font-semibold block">Espacio Swap</span>
            <span className="text-sm font-bold text-[#f3f4f6] font-mono block">{memory.swapTotalGB} GB</span>
            <span className="text-[11px] text-[#6b7280]">Paginación en disco</span>
          </div>
        </div>
      </div>

      {/* Node.js Process V8 Memory Heap Engine */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-[#f3f4f6] flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#10b981]" />
          Memoria del Proceso Node.js & Motor V8 (Heap Statistics)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-lg bg-[#101317] border border-[#22272e] space-y-1.5 font-mono text-xs">
            <div className="flex justify-between items-center">
              <span className="text-[#9ca3af] font-sans font-semibold">Resident Set Size (RSS):</span>
              <span className="text-sm font-bold text-[#34d399]">{memory.processMemory.rssMB} MB</span>
            </div>
            <p className="text-[11px] text-[#6b7280] font-sans leading-relaxed">
              Memoria física total ocupada por el proceso del servidor en la RAM host (código, heap y pila).
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-[#101317] border border-[#22272e] space-y-1.5 font-mono text-xs">
            <div className="flex justify-between items-center">
              <span className="text-[#9ca3af] font-sans font-semibold">V8 Heap (Usado / Total):</span>
              <span className="text-sm font-bold text-[#f3f4f6]">
                {memory.processMemory.heapUsedMB} / {memory.processMemory.heapTotalMB} MB
              </span>
            </div>
            <p className="text-[11px] text-[#6b7280] font-sans leading-relaxed">
              Memoria dinámica de objetos y variables gestionada activamente por el recolector de basura (V8 GC).
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-[#101317] border border-[#22272e] space-y-1.5 font-mono text-xs">
            <div className="flex justify-between items-center">
              <span className="text-[#9ca3af] font-sans font-semibold">Límite Máximo Heap V8:</span>
              <span className="text-sm font-bold text-[#f3f4f6]">{memory.v8HeapStats.heapSizeLimitMB} MB</span>
            </div>
            <p className="text-[11px] text-[#6b7280] font-sans leading-relaxed">
              Tope máximo de memoria asignable al motor V8 antes de requerir ampliación o paginación.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 pt-2 font-mono text-xs text-[#9ca3af] border-t border-[#22272e]">
          <span>External Memory: <strong className="text-[#f3f4f6]">{memory.processMemory.externalMB} MB</strong></span>
          <span>ArrayBuffers: <strong className="text-[#f3f4f6]">{memory.processMemory.arrayBuffersMB} MB</strong></span>
          <span>Malloced Memory: <strong className="text-[#f3f4f6]">{memory.v8HeapStats.mallocedMB} MB</strong></span>
        </div>
      </div>

      {/* Linux Kernel /proc/meminfo Live Table */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#f3f4f6] flex items-center gap-2">
              <Database className="w-4 h-4 text-[#10b981]" />
              Métricas Detalladas del Kernel (/proc/meminfo)
            </h3>
            <p className="text-xs text-[#9ca3af]">
              Registros en tiempo real de la gestión de memoria virtual del kernel Linux.
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[#6b7280] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filtrar claves (Anon, Active, Shmem)..."
              value={memSearch}
              onChange={(e) => setMemSearch(e.target.value)}
              className="w-full bg-[#101317] border border-[#22272e] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#f3f4f6] placeholder-[#6b7280] focus:outline-none focus:border-[#10b981] font-mono"
            />
          </div>
        </div>

        <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-lg border border-[#22272e]">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#1f242c] text-[#9ca3af] uppercase tracking-wider font-sans border-b border-[#22272e] sticky top-0">
              <tr>
                <th className="p-2.5 font-bold">Métrica (/proc/meminfo)</th>
                <th className="p-2.5 font-bold">Valor Reportado</th>
                <th className="p-2.5 font-bold">Equivalencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#22272e] bg-[#101317]">
              {filteredMeminfo.map(([key, value]) => {
                const kb = parseInt(String(value));
                const mb = !isNaN(kb) ? (kb / 1024).toFixed(1) : null;
                return (
                  <tr key={key} className="hover:bg-[#161a1f] transition-colors">
                    <td className="p-2.5 font-bold text-[#f3f4f6]">{key}</td>
                    <td className="p-2.5 text-[#34d399]">{value}</td>
                    <td className="p-2.5 text-[#9ca3af]">{mb ? `${mb} MB` : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
