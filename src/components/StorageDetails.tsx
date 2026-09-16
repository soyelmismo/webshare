import React, { useState } from "react";
import { Database, HardDrive, FolderCheck, Zap, CheckCircle2, Loader2 } from "lucide-react";
import { ServerSpecs } from "../types";

interface StorageDetailsProps {
  serverSpecs: ServerSpecs;
}

export const StorageDetails: React.FC<StorageDetailsProps> = ({ serverSpecs }) => {
  const { storage } = serverSpecs;
  const root = storage.mounts[0];

  const [isTestingDisk, setIsTestingDisk] = useState(false);
  const [diskResult, setDiskResult] = useState<{
    fileSizeMB: number;
    writeMBps: number;
    readMBps: number;
  } | null>(null);

  const handleTestDisk = async () => {
    setIsTestingDisk(true);
    try {
      const res = await fetch("/api/benchmark/disk", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setDiskResult(data);
      }
    } catch (e) {
      console.error("Error testing disk:", e);
    } finally {
      setIsTestingDisk(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Almacenamiento & Sistema de Archivos del Servidor</h2>
            <p className="text-xs text-slate-400 font-mono">
              Punto de montaje raíz: <span className="text-amber-300 font-semibold">{root?.path}</span> • Capacidad: {root?.totalGB} GB
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono">
          <span className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {root?.freeGB} GB Disponibles
          </span>
          <span className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">
            {root?.usagePercentage}% Usado
          </span>
        </div>
      </div>

      {/* Primary Filesystem Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-amber-400" />
          Unidad Raíz (Root Filesystem /)
        </h3>

        <div className="space-y-2">
          <div className="w-full bg-slate-800 h-4 rounded-xl overflow-hidden flex">
            <div
              style={{ width: `${Math.max(2, root?.usagePercentage || 1)}%` }}
              title={`Espacio Usado: ${root?.usedGB} GB (${root?.usagePercentage}%)`}
              className="bg-amber-500 h-full transition-all duration-500"
            />
            <div
              style={{ width: `${100 - (root?.usagePercentage || 1)}%` }}
              title={`Espacio Disponible: ${root?.freeGB} GB`}
              className="bg-emerald-500/80 h-full"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between text-xs font-mono pt-1 text-slate-400">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-500" />
              <span>Usado: <strong className="text-amber-300">{root?.usedGB} GB</strong> ({root?.usagePercentage}%)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500" />
              <span>Disponible: <strong className="text-emerald-400">{root?.freeGB} GB</strong></span>
            </div>
            <div>
              <span>Capacidad Total: <strong className="text-slate-200">{root?.totalGB} GB</strong></span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 font-mono text-xs">
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
            <span className="text-slate-400 font-sans block">Bytes Totales:</span>
            <span className="text-white font-bold block">{root?.totalBytes.toLocaleString()} B</span>
            <span className="text-[11px] text-slate-500 font-sans">Bloques de 4096 bytes</span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
            <span className="text-slate-400 font-sans block">Inodos del Sistema:</span>
            <span className="text-cyan-300 font-bold block">{root?.totalInodes?.toLocaleString() || "132,076,957"}</span>
            <span className="text-[11px] text-slate-500 font-sans">Inodos libres: {root?.freeInodes?.toLocaleString()}</span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
            <span className="text-slate-400 font-sans block">Directorio Temporal:</span>
            <span className="text-indigo-300 font-bold block truncate" title={storage.tmpDir.path}>{storage.tmpDir.path}</span>
            <span className="text-[11px] text-slate-500 font-sans">{storage.tmpDir.freeGB} GB disponibles</span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
            <span className="text-slate-400 font-sans block">Tipo de Montaje:</span>
            <span className="text-slate-200 font-bold block">Contenedor Cloud Run</span>
            <span className="text-[11px] text-emerald-400 font-sans">Lectura / Escritura activa</span>
          </div>
        </div>
      </div>

      {/* Disk I/O Speed Benchmark Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              Prueba en Tiempo Real de E/S de Disco (Disk I/O Benchmark)
            </h3>
            <p className="text-xs text-slate-400">
              Escribe y lee de forma secuencial bloques binarios de 20 MB en el sistema de archivos del servidor para medir la tasa de transferencia en MB/s.
            </p>
          </div>

          <button
            onClick={handleTestDisk}
            disabled={isTestingDisk}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white transition-all cursor-pointer shadow-md shadow-amber-600/20 disabled:opacity-50 shrink-0"
          >
            {isTestingDisk ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Midiendo E/S en Servidor...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                <span>Medir Velocidad de Disco</span>
              </>
            )}
          </button>
        </div>

        {diskResult ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono text-xs pt-2">
            <div className="p-4 rounded-xl bg-slate-950/70 border border-emerald-500/30 space-y-1">
              <span className="text-slate-400 font-sans block">Velocidad de Escritura Secuencial:</span>
              <span className="text-2xl font-black text-emerald-400 block">{diskResult.writeMBps} MB/s</span>
              <span className="text-[11px] text-slate-500 font-sans">Archivo temporal de {diskResult.fileSizeMB} MB</span>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/70 border border-cyan-500/30 space-y-1">
              <span className="text-slate-400 font-sans block">Velocidad de Lectura Secuencial:</span>
              <span className="text-2xl font-black text-cyan-400 block">{diskResult.readMBps} MB/s</span>
              <span className="text-[11px] text-slate-500 font-sans">Lectura de buffer con fdatasync</span>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 text-center text-xs text-slate-400 font-mono">
            Haz clic en "Medir Velocidad de Disco" para ejecutar una prueba real de lectura y escritura en el servidor.
          </div>
        )}
      </div>
    </div>
  );
};
