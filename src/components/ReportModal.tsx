import React, { useState } from "react";
import { X, Copy, Download, Check, FileText, Code2, CloudDownload, Loader2 } from "lucide-react";
import { ServerSpecs, ServerBenchmarkStats } from "../types";
import { getAccessToken, googleSignIn } from "../utils/firebaseAuth";
import { getOrCreateDedicatedFolder, uploadBlobToDrive } from "../utils/googleDriveApi";

interface ReportModalProps {
  serverSpecs: ServerSpecs;
  benchmarkStats: ServerBenchmarkStats;
  onClose: () => void;
  onNavigateToDriveTab?: () => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  serverSpecs,
  benchmarkStats,
  onClose,
  onNavigateToDriveTab,
}) => {
  const [copied, setCopied] = useState(false);
  const [format, setFormat] = useState<"markdown" | "json">("markdown");
  const [isSavingToDrive, setIsSavingToDrive] = useState(false);
  const [driveSaveStatus, setDriveSaveStatus] = useState<string | null>(null);

  const generateMarkdownReport = (): string => {
    const { os, cpu, memory, storage, network, runtime } = serverSpecs;
    const rootDisk = storage.mounts[0];

    return `# Informe de Especificaciones del Servidor Host
**Fecha de Generación:** ${new Date().toLocaleString()}
**Hostname:** ${os.hostname}
**Distribución:** ${os.distroName}
**Kernel:** ${os.kernelRelease} (${os.arch})
**Tiempo Activo (Uptime):** ${os.uptimeFormatted}

---

## 1. Procesador (CPU)
- **Modelo:** ${cpu.model}
- **Fabricante / Familia:** ${cpu.vendorId} (Familia ${cpu.family})
- **Cores / vCPUs:** ${cpu.coresCount}
- **Frecuencia Reloj:** ~${cpu.speedMHz} MHz
- **Caché L3:** ${cpu.cacheSizeKB} KB (${Math.round(cpu.cacheSizeKB / 1024)} MB)
- **BogoMIPS:** ${cpu.bogomips}
- **Carga Promedio Host (1m, 5m, 15m):** ${cpu.loadAverage["1min"]}, ${cpu.loadAverage["5min"]}, ${cpu.loadAverage["15min"]}
- **Instrucciones Clave:** AVX2 (${cpu.featureFlags.find((f) => f.flag === "avx2")?.supported ? "Sí" : "No"}), SSE4.2, AES-NI

## 2. Memoria RAM & Swap
- **RAM Total Asignada:** ${memory.totalGB} GB (${memory.totalBytes.toLocaleString()} bytes)
- **RAM Usada:** ${memory.usedGB} GB (${memory.usagePercentage}%)
- **RAM Disponible (MemAvailable Kernel):** ${memory.availableGB} GB
- **Caché de Páginas (Cached):** ${memory.cachedMB} MB
- **Búferes Kernel:** ${memory.buffersMB} MB
- **Espacio Swap:** ${memory.swapTotalGB} GB
- **Proceso Node RSS:** ${memory.processMemory.rssMB} MB
- **Límite V8 Heap:** ${memory.v8HeapStats.heapSizeLimitMB} MB

## 3. Almacenamiento & Sistema de Archivos
- **Punto de Montaje Raíz:** ${rootDisk?.path || "/"}
- **Capacidad Total:** ${rootDisk?.totalGB || "504"} GB
- **Espacio Usado:** ${rootDisk?.usedGB} GB (${rootDisk?.usagePercentage}%)
- **Espacio Libre:** ${rootDisk?.freeGB} GB
- **Inodos del Sistema:** ${rootDisk?.totalInodes?.toLocaleString() || "N/A"}
- **Directorio Temporal (/tmp):** ${storage.tmpDir.path} (${storage.tmpDir.freeGB} GB libres)

## 4. Red & Interfaces
- **Hostname:** ${network.hostname}
- **Servidor DNS Primario:** ${network.dnsServers[0] || "169.254.169.254"}
- **Interfaces:**
${network.interfaces.map((i) => `  - ${i.name} (${i.family}): ${i.address} [${i.internal ? "Loopback" : "Ingress"}]`).join("\n")}

## 5. Runtime & Entorno
- **Node.js:** ${runtime.nodeVersion}
- **Motor V8:** ${runtime.v8Version}
- **OpenSSL:** ${runtime.opensslVersion}
- **PID Servidor:** ${runtime.pid} (PPID: ${runtime.ppid})
- **Uptime Proceso Node:** ${runtime.processUptimeFormatted}
- **Usuario de Ejecución:** ${os.user.username} (UID: ${os.user.uid})
- **Directorio de Trabajo:** ${runtime.cwd}

---

## 6. Rendimiento & Benchmark de Servidor
- **Puntuación Global:** ${benchmarkStats.overallScore ? `${benchmarkStats.overallScore} puntos` : "No ejecutado"}
- **Nivel de Servidor:** ${benchmarkStats.tier || "N/A"}
- **CPU Monohilo:** ${benchmarkStats.cpuSingleScore ? `${benchmarkStats.cpuSingleScore} pts (${benchmarkStats.cpuSingleOpsSec?.toLocaleString()} ops/s)` : "N/A"}
- **CPU Multihilo:** ${benchmarkStats.cpuMultiScore ? `${benchmarkStats.cpuMultiScore} pts (${benchmarkStats.cpuMultiOpsSec?.toLocaleString()} ops/s)` : "N/A"}
- **Ancho de Banda de Memoria:** ${benchmarkStats.memoryBandwidthMBps ? `${benchmarkStats.memoryBandwidthMBps} MB/s` : "N/A"}
- **E/S Disco Raíz (Escritura):** ${benchmarkStats.diskWriteMBps ? `${benchmarkStats.diskWriteMBps} MB/s` : "N/A"}
- **E/S Disco Raíz (Lectura):** ${benchmarkStats.diskReadMBps ? `${benchmarkStats.diskReadMBps} MB/s` : "N/A"}

*Generado automáticamente por el Monitor de Especificaciones del Servidor.*
`;
  };

  const reportText =
    format === "markdown"
      ? generateMarkdownReport()
      : JSON.stringify({ serverSpecs, benchmarkStats }, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDownload = () => {
    const ext = format === "markdown" ? "md" : "json";
    const mime = format === "markdown" ? "text/markdown" : "application/json";
    const blob = new Blob([reportText], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `server-specs-report-${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveToDrive = async () => {
    setIsSavingToDrive(true);
    setDriveSaveStatus(null);
    try {
      let token = await getAccessToken();
      if (!token) {
        const authRes = await googleSignIn();
        token = authRes?.accessToken || null;
      }
      if (!token) {
        throw new Error("No se pudo autenticar con Google Drive.");
      }

      const folder = await getOrCreateDedicatedFolder(token);
      const ext = format === "markdown" ? "md" : "json";
      const mime = format === "markdown" ? "text/markdown" : "application/json";
      const fileName = `informe-${serverSpecs.os.hostname}-${Date.now()}.${ext}`;
      const blob = new Blob([reportText], { type: mime });

      await uploadBlobToDrive(token, folder.id, blob, fileName, mime);
      setDriveSaveStatus(`¡Guardado en Drive / ${folder.name}!`);
      setTimeout(() => setDriveSaveStatus(null), 3500);
    } catch (err: any) {
      console.error("Error saving report to Drive:", err);
      setDriveSaveStatus(err?.message || "Error al guardar en Drive");
      setTimeout(() => setDriveSaveStatus(null), 4000);
    } finally {
      setIsSavingToDrive(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-white">Informe Técnico del Servidor</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Format Selector and Action Bar */}
        <div className="px-4 py-3 bg-slate-950/60 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 p-1 bg-slate-800 rounded-lg text-xs font-semibold">
            <button
              onClick={() => setFormat("markdown")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all cursor-pointer ${
                format === "markdown" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Markdown (.md)</span>
            </button>
            <button
              onClick={() => setFormat("json")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all cursor-pointer ${
                format === "json" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>JSON Raw (.json)</span>
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">¡Copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar</span>
                </>
              )}
            </button>

            <button
              onClick={handleSaveToDrive}
              disabled={isSavingToDrive}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-500/40 text-indigo-300 transition-all cursor-pointer disabled:opacity-50"
              title="Guardar archivo en la carpeta dedicada de Google Drive"
            >
              {isSavingToDrive ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Guardando en Drive...</span>
                </>
              ) : (
                <>
                  <CloudDownload className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{driveSaveStatus || "Guardar en Drive"}</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all cursor-pointer shadow-md"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descarga Local</span>
            </button>
          </div>
        </div>

        {/* Text Area Content */}
        <div className="p-4 flex-1 overflow-y-auto bg-slate-950 font-mono text-xs text-slate-300">
          <pre className="whitespace-pre-wrap select-all font-mono leading-relaxed">{reportText}</pre>
        </div>

        {/* Modal Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-900 flex justify-between items-center text-xs text-slate-500 font-mono">
          <span>Servidor Host: {serverSpecs.os.hostname}</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
