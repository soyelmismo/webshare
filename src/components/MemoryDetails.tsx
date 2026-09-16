import React, { useState } from "react";
import { Layers, HardDrive, Activity, Search, ShieldCheck, Database } from "lucide-react";
import { ServerSpecs } from "../types";

interface MemoryDetailsProps {
  serverSpecs: ServerSpecs;
}

export const MemoryDetails: React.FC<MemoryDetailsProps> = ({ serverSpecs }) => {
  const { memory } = serverSpecs;
  const [memSearch, setMemSearch] = useState("");

  const filteredMeminfo = Object.entries(memory.meminfo).filter(([key, val]) =>
    key.toLowerCase().includes(memSearch.toLowerCase()) ||
    String(val).toLowerCase().includes(memSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Memoria RAM & Swap del Servidor</h2>
            <p className="text-xs text-slate-400 font-mono">
              Capacidad física: <span className="text-purple-300 font-semibold">{memory.totalGB} GB</span> ({memory.totalBytes.toLocaleString()} bytes)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono">
          <span className="px-3 py-1 rounded-lg text-xs font-bold bg-purple-500/10 text-purple-300 border border-purple-500/20">
            {memory.usagePercentage}% en Uso
          </span>
          <span className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {memory.availableGB} GB Disponible
          </span>
        </div>
      </div>

      {/* Main RAM Visualizer Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-purple-400" />
          Desglose de Memoria Física del Sistema (Linux Host)
        </h3>

        {/* Multi-segment memory bar */}
        <div className="space-y-2">
          <div className="w-full bg-slate-800 h-4 rounded-xl overflow-hidden flex">
            <div
              style={{ width: `${Math.max(2, memory.usagePercentage)}%` }}
              title={`RAM Usada: ${memory.usedGB} GB (${memory.usagePercentage}%)`}
              className="bg-purple-500 h-full transition-all duration-500"
            />
            <div
              style={{ width: `${100 - memory.usagePercentage}%` }}
              title={`RAM Disponible: ${memory.availableGB} GB`}
              className="bg-emerald-500/80 h-full"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between text-xs font-mono pt-1 text-slate-400">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-purple-500" />
              <span>Usada: <strong className="text-purple-300">{memory.usedGB} GB</strong> ({memory.usagePercentage}%)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500" />
              <span>Disponible (Kernel): <strong className="text-emerald-400">{memory.availableGB} GB</strong></span>
            </div>
            <div>
              <span>RAM Libre estricta: <strong className="text-slate-300">{memory.freeGB} GB</strong></span>
            </div>
          </div>
        </div>

        {/* 4 Cards Subgrid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
            <span className="text-xs text-slate-400 font-sans">RAM Total Asignada:</span>
            <span className="text-base font-bold text-white font-mono block">{memory.totalGB} GB</span>
            <span className="text-[11px] text-slate-500 font-mono">4,194,304 kB</span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
            <span className="text-xs text-slate-400 font-sans">Page Cache (Caché):</span>
            <span className="text-base font-bold text-cyan-300 font-mono block">{memory.cachedMB} MB</span>
            <span className="text-[11px] text-slate-500">Caché de E/S de disco en RAM</span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
            <span className="text-xs text-slate-400 font-sans">Buffers del Kernel:</span>
            <span className="text-base font-bold text-indigo-300 font-mono block">{memory.buffersMB} MB</span>
            <span className="text-[11px] text-slate-500">Búferes de bloques de archivos</span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
            <span className="text-xs text-slate-400 font-sans">Espacio Swap:</span>
            <span className="text-base font-bold text-slate-300 font-mono block">{memory.swapTotalGB} GB</span>
            <span className="text-[11px] text-slate-500">Paginación en disco</span>
          </div>
        </div>
      </div>

      {/* Node.js Process V8 Memory Heap Engine */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          Memoria del Proceso Node.js & Motor V8 (Heap Statistics)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2 font-mono text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-sans">Resident Set Size (RSS):</span>
              <span className="text-sm font-bold text-cyan-300">{memory.processMemory.rssMB} MB</span>
            </div>
            <p className="text-[11px] text-slate-500 font-sans leading-relaxed">
              Memoria física total ocupada por el proceso del servidor en la RAM host (incluyendo código, heap y pila).
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2 font-mono text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-sans">V8 Heap (Usado / Total):</span>
              <span className="text-sm font-bold text-purple-300">
                {memory.processMemory.heapUsedMB} / {memory.processMemory.heapTotalMB} MB
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-sans leading-relaxed">
              Memoria dinámica de objetos y variables gestionada activamente por el recolector de basura (V8 GC).
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2 font-mono text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-sans">Límite Máximo Heap V8:</span>
              <span className="text-sm font-bold text-emerald-400">{memory.v8HeapStats.heapSizeLimitMB} MB (~3.2 GB)</span>
            </div>
            <p className="text-[11px] text-slate-500 font-sans leading-relaxed">
              Tope máximo de memoria asignable al motor V8 antes de requerir ampliación o paginación.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 pt-1 font-mono text-xs text-slate-400 border-t border-slate-800/80">
          <span>External Memory: <strong className="text-slate-200">{memory.processMemory.externalMB} MB</strong></span>
          <span>ArrayBuffers: <strong className="text-slate-200">{memory.processMemory.arrayBuffersMB} MB</strong></span>
          <span>Malloced Memory: <strong className="text-slate-200">{memory.v8HeapStats.mallocedMB} MB</strong></span>
        </div>
      </div>

      {/* Linux Kernel /proc/meminfo Live Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-indigo-400" />
              Métricas Detalladas del Kernel (/proc/meminfo)
            </h3>
            <p className="text-xs text-slate-400">
              Registros en tiempo real de la gestión de memoria virtual del kernel Linux.
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filtrar claves (Anon, Active, Shmem)..."
              value={memSearch}
              onChange={(e) => setMemSearch(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono"
            />
          </div>
        </div>

        <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-sans border-b border-slate-800 sticky top-0">
              <tr>
                <th className="p-3">Métrica (/proc/meminfo)</th>
                <th className="p-3">Valor Reportado</th>
                <th className="p-3">Equivalencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 bg-slate-950/40">
              {filteredMeminfo.map(([key, value]) => {
                const kb = parseInt(String(value));
                const mb = !isNaN(kb) ? (kb / 1024).toFixed(1) : null;
                return (
                  <tr key={key} className="hover:bg-slate-800/40">
                    <td className="p-3 font-bold text-white">{key}</td>
                    <td className="p-3 text-purple-300">{value}</td>
                    <td className="p-3 text-slate-400">{mb ? `${mb} MB` : "-"}</td>
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
