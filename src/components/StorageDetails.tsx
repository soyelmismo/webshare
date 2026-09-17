import React, { useState } from "react";
import { Database, HardDrive, Zap, Loader2 } from "lucide-react";
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
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-[#1f242c] border border-[#3b424d] text-[#10b981] shrink-0">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#f3f4f6]">Almacenamiento & Sistema de Archivos del Servidor</h2>
            <p className="text-xs text-[#9ca3af] font-mono">
              Punto de montaje raíz: <span className="text-[#34d399] font-semibold">{root?.path}</span> • Capacidad: {root?.totalGB} GB
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono">
          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#064e3b] text-[#34d399] border border-[#059669]/60">
            {root?.freeGB} GB Disponibles
          </span>
          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d]">
            {root?.usagePercentage}% Usado
          </span>
        </div>
      </div>

      {/* Primary Filesystem Card */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-[#f3f4f6] flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-[#10b981]" />
          Unidad Raíz (Root Filesystem /)
        </h3>

        <div className="space-y-2">
          <div className="w-full bg-[#1a1e24] h-3 rounded-full overflow-hidden flex border border-[#22272e]">
            <div
              style={{ width: `${Math.max(2, root?.usagePercentage || 1)}%` }}
              title={`Espacio Usado: ${root?.usedGB} GB (${root?.usagePercentage}%)`}
              className="bg-[#10b981] h-full"
            />
            <div
              style={{ width: `${100 - (root?.usagePercentage || 1)}%` }}
              title={`Espacio Disponible: ${root?.freeGB} GB`}
              className="bg-[#262b32] h-full"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between text-xs font-mono pt-1 text-[#9ca3af]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
              <span>Usado: <strong className="text-[#f3f4f6]">{root?.usedGB} GB</strong> ({root?.usagePercentage}%)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#34d399]" />
              <span>Disponible: <strong className="text-[#34d399]">{root?.freeGB} GB</strong></span>
            </div>
            <div>
              <span>Capacidad Total: <strong className="text-[#f3f4f6]">{root?.totalGB} GB</strong></span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 font-mono text-xs">
          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] space-y-1">
            <span className="text-[#9ca3af] font-sans font-semibold block">Bytes Totales:</span>
            <span className="text-[#f3f4f6] font-bold block">{root?.totalBytes.toLocaleString()} B</span>
            <span className="text-[11px] text-[#6b7280] font-sans">Bloques de 4096 bytes</span>
          </div>

          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] space-y-1">
            <span className="text-[#9ca3af] font-sans font-semibold block">Inodos del Sistema:</span>
            <span className="text-[#f3f4f6] font-bold block">{root?.totalInodes?.toLocaleString() || "132,076,957"}</span>
            <span className="text-[11px] text-[#6b7280] font-sans">Inodos libres: {root?.freeInodes?.toLocaleString()}</span>
          </div>

          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] space-y-1">
            <span className="text-[#9ca3af] font-sans font-semibold block">Directorio Temporal:</span>
            <span className="text-[#34d399] font-bold block truncate" title={storage.tmpDir.path}>{storage.tmpDir.path}</span>
            <span className="text-[11px] text-[#6b7280] font-sans">{storage.tmpDir.freeGB} GB disponibles</span>
          </div>

          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] space-y-1">
            <span className="text-[#9ca3af] font-sans font-semibold block">Tipo de Montaje:</span>
            <span className="text-[#f3f4f6] font-bold block">Contenedor Cloud Run</span>
            <span className="text-[11px] text-[#34d399] font-sans font-semibold">Lectura / Escritura activa</span>
          </div>
        </div>
      </div>

      {/* Disk I/O Speed Benchmark Card */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#f3f4f6] flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#eab308]" />
              Prueba de E/S de Disco (Disk I/O Benchmark)
            </h3>
            <p className="text-xs text-[#9ca3af]">
              Escribe y lee bloques binarios de 20 MB en el sistema de archivos del servidor para medir la tasa en MB/s.
            </p>
          </div>

          <button
            onClick={handleTestDisk}
            disabled={isTestingDisk}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e] transition-colors cursor-pointer disabled:opacity-50 shrink-0 font-bold"
          >
            {isTestingDisk ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Midiendo E/S en Servidor...</span>
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>Medir Velocidad de Disco</span>
              </>
            )}
          </button>
        </div>

        {diskResult ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs pt-2">
            <div className="p-3.5 rounded-lg bg-[#101317] border border-[#22272e] space-y-1">
              <span className="text-[#9ca3af] font-sans font-semibold block">Velocidad de Escritura Secuencial:</span>
              <span className="text-xl font-bold text-[#34d399] block">{diskResult.writeMBps} MB/s</span>
              <span className="text-[11px] text-[#6b7280] font-sans">Archivo temporal de {diskResult.fileSizeMB} MB</span>
            </div>

            <div className="p-3.5 rounded-lg bg-[#101317] border border-[#22272e] space-y-1">
              <span className="text-[#9ca3af] font-sans font-semibold block">Velocidad de Lectura Secuencial:</span>
              <span className="text-xl font-bold text-[#60a5fa] block">{diskResult.readMBps} MB/s</span>
              <span className="text-[11px] text-[#6b7280] font-sans">Lectura de buffer con fdatasync</span>
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-lg bg-[#101317] border border-[#22272e] text-center text-xs text-[#9ca3af] font-mono">
            Haz clic en "Medir Velocidad de Disco" para ejecutar una prueba real de lectura y escritura.
          </div>
        )}
      </div>
    </div>
  );
};
