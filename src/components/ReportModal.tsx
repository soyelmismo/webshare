import React, { useState } from "react";
import { X, Copy, Download, Check, FileText, Code2, CloudDownload, Loader2 } from "lucide-react";
import { ServerSpecs, ServerBenchmarkStats } from "../types";
import { getAccessToken, googleSignIn } from "../utils/firebaseAuth";
import { getOrCreateDedicatedFolder, uploadBlobToDrive } from "../utils/googleDriveApi";

interface ReportModalProps {
  serverSpecs: ServerSpecs;
  benchmarkStats?: ServerBenchmarkStats;
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
- **Usuario de Ejecución:** ${os?.user?.username || "root"} (UID: ${os?.user?.uid ?? 0})
- **Directorio de Trabajo:** ${runtime.cwd}

---

## 6. Rendimiento & Benchmark de Servidor
- **Puntuación Global:** ${benchmarkStats?.overallScore ? `${benchmarkStats.overallScore} puntos` : "No ejecutado"}
- **Nivel de Servidor:** ${benchmarkStats?.tier || "N/A"}
- **CPU Monohilo:** ${benchmarkStats?.cpuSingleScore ? `${benchmarkStats.cpuSingleScore} pts (${benchmarkStats.cpuSingleOpsSec?.toLocaleString()} ops/s)` : "N/A"}
- **CPU Multihilo:** ${benchmarkStats?.cpuMultiScore ? `${benchmarkStats.cpuMultiScore} pts (${benchmarkStats.cpuMultiOpsSec?.toLocaleString()} ops/s)` : "N/A"}
- **Ancho de Banda de Memoria:** ${benchmarkStats?.memoryBandwidthMBps ? `${benchmarkStats.memoryBandwidthMBps} MB/s` : "N/A"}
- **E/S Disco Raíz (Escritura):** ${benchmarkStats?.diskWriteMBps ? `${benchmarkStats.diskWriteMBps} MB/s` : "N/A"}
- **E/S Disco Raíz (Lectura):** ${benchmarkStats?.diskReadMBps ? `${benchmarkStats.diskReadMBps} MB/s` : "N/A"}

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
      if (err?.message?.includes("popup-closed-by-user")) {
        setDriveSaveStatus(null);
      } else {
        console.error("Error saving report to Drive:", err);
        setDriveSaveStatus(err?.message || "Error al guardar en Drive");
        setTimeout(() => setDriveSaveStatus(null), 4000);
      }
    } finally {
      setIsSavingToDrive(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#000000]/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 border-b border-[#22272e] flex items-center justify-between bg-[#101317]">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[#1f242c] text-[#10b981]">
              <FileText className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-[#f3f4f6]">Informe Técnico del Servidor</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#9ca3af] hover:text-[#f3f4f6] hover:bg-[#1f242c] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Format Selector and Action Bar */}
        <div className="px-4 py-3 bg-[#0e1013] border-b border-[#22272e] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-[#14171a] border border-[#22272e] rounded-lg text-xs font-semibold">
            <button
              onClick={() => setFormat("markdown")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors cursor-pointer ${
                format === "markdown" ? "bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d]" : "text-[#9ca3af] hover:text-[#f3f4f6]"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Markdown (.md)</span>
            </button>
            <button
              onClick={() => setFormat("json")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors cursor-pointer ${
                format === "json" ? "bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d]" : "text-[#9ca3af] hover:text-[#f3f4f6]"
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>JSON (.json)</span>
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#1a1e24] hover:bg-[#222831] border border-[#262b32] text-[#f3f4f6] transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#10b981]" />
                  <span className="text-[#10b981]">¡Copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[#9ca3af]" />
                  <span>Copiar</span>
                </>
              )}
            </button>

            <button
              onClick={handleSaveToDrive}
              disabled={isSavingToDrive}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#1a1e24] hover:bg-[#222831] border border-[#262b32] text-[#f3f4f6] transition-colors cursor-pointer disabled:opacity-50"
              title="Guardar archivo en la carpeta dedicada de Google Drive"
            >
              {isSavingToDrive ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#10b981]" />
                  <span>Guardando en Drive...</span>
                </>
              ) : (
                <>
                  <CloudDownload className="w-3.5 h-3.5 text-[#10b981]" />
                  <span>{driveSaveStatus || "Guardar en Drive"}</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e] transition-colors cursor-pointer shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descarga Local</span>
            </button>
          </div>
        </div>

        {/* Text Area Content */}
        <div className="p-4 flex-1 overflow-y-auto bg-[#0b0d0e] font-mono text-xs text-[#d1d5db] border-y border-[#22272e]">
          <pre className="whitespace-pre-wrap select-all font-mono leading-relaxed">{reportText}</pre>
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-[#101317] flex justify-between items-center text-xs text-[#9ca3af] font-mono">
          <span>Servidor: {serverSpecs.os.hostname}</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#1a1e24] hover:bg-[#222831] border border-[#262b32] text-[#f3f4f6] font-semibold cursor-pointer transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
