import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  CloudLightning,
  RefreshCw,
  Play,
  Pause,
  XCircle,
  CheckCircle2,
  AlertCircle,
  Search,
  ExternalLink,
  Layers,
  Database,
  ShieldCheck,
  Zap,
  Info,
  RotateCcw,
  Sliders,
  FileCode,
  Clock,
  Download,
} from "lucide-react";

function formatEta(seconds: number): string {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return "";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}
import { StreamDriveTask, DriveSessionAuditResult } from "../types";
import {
  inspectStreamSource,
  fetchStreamTasks,
  startStreamToDrive,
  pauseStreamTask,
  resumeStreamTask,
  cancelStreamTask,
  recoverStreamTasksFromDrive,
  auditDriveSession,
} from "../utils/streamApi";

interface DriveStreamDownloaderProps {
  accessToken: string | null;
  folderId?: string;
  folderName?: string;
  onConnectDrive: () => void;
}

const PRESET_ISOS = [
  {
    name: "Arch Linux 2026.09.01 x86_64 ISO (Torrent / WebSeed)",
    url: "magnet:?xt=urn:btih:f45add9d1a5185d8588df7dd6cd89993dd0174fa&dn=archlinux-2026.09.01-x86_64.iso",
    type: "torrent" as const,
  },
  {
    name: "Ubuntu 24.04 LTS Desktop (Direct)",
    url: "https://releases.ubuntu.com/noble/ubuntu-24.04-desktop-amd64.iso",
    type: "direct" as const,
  },
  {
    name: "Alpine Linux Standard x86_64 (~200MB)",
    url: "https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/x86_64/alpine-standard-3.20.0-x86_64.iso",
    type: "direct" as const,
  },
  {
    name: "Debian 12 Netinst (~700MB)",
    url: "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-12.9.0-amd64-netinst.iso",
    type: "direct" as const,
  },
  {
    name: "Ubuntu 24.04 Desktop (Magnet / Torrent)",
    url: "magnet:?xt=urn:btih:08560824b2bf602e1c3132bc4e5daaa20c7407a5&dn=ubuntu-24.04-desktop-amd64.iso",
    type: "torrent" as const,
  },
];

export const DriveStreamDownloader: React.FC<DriveStreamDownloaderProps> = ({
  accessToken,
  folderId,
  folderName = "Descargas Servidor",
  onConnectDrive,
}) => {
  const [sourceUrl, setSourceUrl] = useState("");
  const [customFileName, setCustomFileName] = useState("");
  const [chunkSizeMB, setChunkSizeMB] = useState<number>(16);
  const [tasks, setTasks] = useState<StreamDriveTask[]>([]);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [inspectResult, setInspectResult] = useState<{
    fileName: string;
    fileSize: number;
    fileSizeFormatted: string;
    sourceType: "direct" | "torrent";
    acceptRanges: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showArchExplainer, setShowArchExplainer] = useState(true);
  const [torrentBase64, setTorrentBase64] = useState<string | null>(null);
  const [uploadedTorrentFileName, setUploadedTorrentFileName] = useState<string | null>(null);

  const [auditingTaskId, setAuditingTaskId] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<DriveSessionAuditResult | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [taskToCancel, setTaskToCancel] = useState<string | null>(null);

  const torrentBase64Ref = useRef<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Fetch current stream tasks
  const refreshTasks = useCallback(async () => {
    try {
      const activeTasks = await fetchStreamTasks();
      setTasks(activeTasks);
    } catch {
      // ignore
    }
  }, []);

  // Polling loop when tasks are streaming
  useEffect(() => {
    refreshTasks();
    pollingRef.current = setInterval(() => {
      refreshTasks();
    }, 2000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [refreshTasks]);

  // 2. Inspect source URL/magnet/torrent
  const handleInspect = async (overrideUrl?: string, overrideBase64?: string) => {
    const activeUrl = (overrideUrl !== undefined ? overrideUrl : sourceUrl).trim();
    const activeBase64 = overrideBase64 !== undefined ? overrideBase64 : (torrentBase64Ref.current || torrentBase64);

    if (!activeUrl && !activeBase64) {
      setError("Introduce una URL de descarga directa, enlace Magnet o carga un archivo .torrent.");
      return;
    }
    setError(null);
    setIsInspecting(true);
    setInspectResult(null);

    try {
      const result = await inspectStreamSource(activeUrl || "uploaded_file.torrent", activeBase64 || undefined);
      setInspectResult(result);
      if (result.fileName) {
        setCustomFileName(result.fileName);
      }
    } catch (err: any) {
      setError(err.message || "No se pudo inspeccionar el origen");
    } finally {
      setIsInspecting(false);
    }
  };

  // Handler for .torrent file upload
  const handleTorrentFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Immediately format the name from the filename
    const cleanName = file.name.replace(/\.torrent$/i, "");
    setCustomFileName(cleanName);
    setUploadedTorrentFileName(file.name);
    const virtualUrl = `torrent_file_${file.name}`;
    setSourceUrl(virtualUrl);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const resStr = ev.target?.result as string;
      const base64 = resStr.includes(",") ? resStr.split(",")[1] : resStr;
      setTorrentBase64(base64);
      torrentBase64Ref.current = base64;
      // Auto-inspect immediately
      handleInspect(virtualUrl, base64);
    };
    reader.readAsDataURL(file);
  };

  const handleClearUploadedFile = () => {
    setTorrentBase64(null);
    torrentBase64Ref.current = null;
    setUploadedTorrentFileName(null);
    setSourceUrl("");
    setInspectResult(null);
    setCustomFileName("");
  };

  // 3. Start streaming directly to Google Drive
  const handleStartStream = async () => {
    if (!accessToken) {
      setError("Conecta tu cuenta de Google Drive para iniciar la transmisión continua.");
      return;
    }
    const activeBase64 = torrentBase64Ref.current || torrentBase64;
    if (!sourceUrl.trim() && !activeBase64) {
      setError("Introduce una URL, Magnet o carga un archivo .torrent.");
      return;
    }

    setError(null);
    setIsStarting(true);
    try {
      const result = await startStreamToDrive({
        sourceUrl: sourceUrl.trim() || "uploaded_file.torrent",
        accessToken,
        folderId: folderId || "",
        customChunkSizeMB: chunkSizeMB,
        customFileName: customFileName.trim() || undefined,
        torrentBase64: activeBase64 || undefined,
      });

      setSuccessMessage(
        `¡Transmisión iniciada para ${result.task.fileName}! Se está subiendo en bloques de ${chunkSizeMB}MB.`
      );
      setSourceUrl("");
      setCustomFileName("");
      setInspectResult(null);
      setTorrentBase64(null);
      torrentBase64Ref.current = null;
      setUploadedTorrentFileName(null);
      await refreshTasks();
    } catch (err: any) {
      setError(err.message || "Error al iniciar la transmisión a Google Drive.");
    } finally {
      setIsStarting(false);
    }
  };

  // 4. Recover tasks from Google Drive manifests
  const handleRecoverFromDrive = async () => {
    if (!accessToken) {
      setError("Conecta Google Drive para escanear manifiestos de estado.");
      return;
    }
    setError(null);
    setIsRecovering(true);
    try {
      const res = await recoverStreamTasksFromDrive(accessToken, folderId);
      if (res.recoveredCount > 0) {
        setSuccessMessage(
          `Se recuperaron ${res.recoveredCount} tarea(s) desde los manifiestos JSON en Google Drive.`
        );
      } else {
        setSuccessMessage(
          "No se encontraron manifiestos de streaming incompletos en la carpeta de Google Drive."
        );
      }
      await refreshTasks();
    } catch (err: any) {
      setError(err.message || "Error al escanear manifiestos en Google Drive.");
    } finally {
      setIsRecovering(false);
    }
  };

  // Controls
  const handlePause = async (taskId: string) => {
    await pauseStreamTask(taskId, accessToken || undefined);
    await refreshTasks();
  };

  const handleAudit = async (taskId: string) => {
    setAuditingTaskId(taskId);
    setAuditError(null);
    try {
      const result = await auditDriveSession(taskId);
      setAuditResult(result);
      await refreshTasks();
    } catch (err: any) {
      setAuditError(err.message || "Error al auditar sesión con Google Drive");
    } finally {
      setAuditingTaskId(null);
    }
  };

  const handleResume = async (taskId: string) => {
    setError(null);
    try {
      await resumeStreamTask(taskId, accessToken || "");
      await refreshTasks();
    } catch (err: any) {
      setError(err.message || "Error al reanudar la subida.");
    }
  };

  const handleCancel = async (taskId: string) => {
    setTaskToCancel(taskId);
  };

  const confirmCancel = async () => {
    if (!taskToCancel) return;
    await cancelStreamTask(taskToCancel, accessToken || undefined);
    await refreshTasks();
    setTaskToCancel(null);
  };

  return (
    <div id="drive-stream-downloader" className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-emerald-950/70 via-slate-900 to-indigo-950/70 border border-emerald-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
              <CloudLightning className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white tracking-tight">
                  Streaming ISO a Google Drive
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Zero-Disk & Anti-Wipe
                </span>
              </div>
              <p className="text-sm text-slate-300 mt-1 max-w-2xl">
                Descarga y sube simultáneamente archivos ISO masivos por fragmentos en memoria (16MB–64MB).
                El estado se guarda en Google Drive mediante archivos de manifiesto JSON.
                <strong> Nunca se satura el disco ni se pierde progreso si el contenedor se reinicia o /tmp se wipea.</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowArchExplainer(!showArchExplainer)}
              className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition"
            >
              <Info className="w-4 h-4 text-emerald-400" />
              {showArchExplainer ? "Ocultar Explicación" : "¿Cómo Funciona?"}
            </button>
            <button
              onClick={handleRecoverFromDrive}
              disabled={isRecovering || !accessToken}
              className="px-3 py-2 text-xs font-medium rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 transition disabled:opacity-50"
              title="Escanea la carpeta de Google Drive en busca de archivos .stream_manifest_*.json para reanudar descargas interrumpidas"
            >
              <RotateCcw className={`w-4 h-4 ${isRecovering ? "animate-spin" : ""}`} />
              {isRecovering ? "Escaneando Drive..." : "Recuperar desde Drive"}
            </button>
          </div>
        </div>

        {/* Visual Architecture Flow Diagram */}
        {showArchExplainer && (
          <div className="mt-6 pt-5 border-t border-slate-800 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 flex flex-col gap-1">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                <Layers className="w-4 h-4" /> 1. Ventana Deslizante
              </div>
              <p className="text-slate-400">
                Solo se descarga en RAM un bloque de <strong>{chunkSizeMB} MB</strong> a la vez
                mediante peticiones HTTP Range o piezas Torrent secuenciales.
              </p>
            </div>

            <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 flex flex-col gap-1">
              <div className="flex items-center gap-2 text-indigo-400 font-semibold">
                <Zap className="w-4 h-4" /> 2. Subida en Streaming
              </div>
              <p className="text-slate-400">
                El chunk se envía de inmediato a Google Drive (vía Resumable Upload PUT).
                Al confirmarse con HTTP 308, <strong>se libera la RAM</strong>. 0 bytes en /tmp.
              </p>
            </div>

            <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 flex flex-col gap-1">
              <div className="flex items-center gap-2 text-amber-400 font-semibold">
                <Database className="w-4 h-4" /> 3. Manifiesto en Drive
              </div>
              <p className="text-slate-400">
                Se sincroniza un archivo <code>.stream_manifest_*.json</code> en Drive. Si el
                servidor se reinicia, se recupera el byte exacto y se continúa.
              </p>
            </div>

            <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 flex flex-col gap-1">
              <div className="flex items-center gap-2 text-blue-400 font-semibold">
                <ShieldCheck className="w-4 h-4" /> 4. Integridad 100%
              </div>
              <p className="text-slate-400">
                Google Drive valida rangos contiguos. Al terminar, la API emite el hash criptográfico
                MD5 oficial confirmando la integridad del ISO.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      {error && (
        <div className="p-4 bg-red-950/60 border border-red-500/40 rounded-xl text-red-200 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Aviso</p>
            <p className="text-xs text-red-300 mt-0.5">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 text-xs">
            ✕
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-emerald-200 text-sm flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs text-emerald-300">{successMessage}</p>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-400 hover:text-emerald-300 text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Connection warning if Drive not connected */}
      {!accessToken && (
        <div className="p-4 bg-amber-950/40 border border-amber-500/30 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-amber-400" />
            <div>
              <p className="text-sm font-semibold text-amber-200">Google Drive no conectado</p>
              <p className="text-xs text-amber-300/80">
                Se requiere autorización para transmitir los chunks y almacenar el manifiesto de estado.
              </p>
            </div>
          </div>
          <button
            onClick={onConnectDrive}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg text-xs transition"
          >
            Conectar Google Drive
          </button>
        </div>
      )}

      {/* Input & Form Area */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-4">
        <h3 className="text-base font-semibold text-white flex items-center gap-2">
          <Zap className="w-5 h-5 text-emerald-400" />
          Nueva Transmisión Directa a Google Drive
        </h3>

        {/* Source URL input */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">
              Enlace de Descarga Directa (HTTP/HTTPS) o Magnet Torrent:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={sourceUrl}
                onChange={(e) => {
                  setSourceUrl(e.target.value);
                  if (!e.target.value.startsWith("torrent_file_")) {
                    setTorrentBase64(null);
                    torrentBase64Ref.current = null;
                    setUploadedTorrentFileName(null);
                  }
                }}
                placeholder="https://releases.ubuntu.com/.../ubuntu.iso o magnet:?xt=urn:btih:..."
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => handleInspect()}
                disabled={isInspecting || (!sourceUrl.trim() && !torrentBase64 && !torrentBase64Ref.current)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition disabled:opacity-50"
              >
                <Search className={`w-4 h-4 ${isInspecting ? "animate-spin" : ""}`} />
                {isInspecting ? "Inspeccionando..." : "Inspeccionar"}
              </button>
            </div>
          </div>

          {/* Dedicated File Upload row */}
          <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80">
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-slate-400">O carga un archivo .torrent local:</label>
              <input
                type="file"
                accept=".torrent"
                onChange={handleTorrentFileUpload}
                className="text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700 cursor-pointer"
              />
            </div>
            {uploadedTorrentFileName && (
              <div className="flex items-center gap-2 text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-1 rounded-lg">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="truncate max-w-[200px] font-medium">{uploadedTorrentFileName}</span>
                <button
                  type="button"
                  onClick={handleClearUploadedFile}
                  className="ml-1 text-slate-400 hover:text-rose-400 transition"
                  title="Quitar archivo"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Quick presets */}
        <div className="space-y-1.5">
          <label className="text-xs text-slate-400">Ejemplos listos para probar:</label>
          <div className="flex flex-wrap gap-2">
            {PRESET_ISOS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => {
                  setSourceUrl(preset.url);
                  setInspectResult(null);
                  setTorrentBase64(null);
                  torrentBase64Ref.current = null;
                  setUploadedTorrentFileName(null);
                }}
                className="px-2.5 py-1 text-xs rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/80 hover:border-emerald-500/50 transition flex items-center gap-1"
              >
                <span>{preset.type === "torrent" ? "🧲" : "💿"}</span>
                <span>{preset.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Inspected info preview */}
        {inspectResult && (
          <div className="p-4 bg-slate-950/80 border border-emerald-500/30 rounded-xl grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-slate-400">Archivo detectado:</span>
              <p className="font-semibold text-slate-200 truncate" title={inspectResult.fileName}>
                {inspectResult.fileName}
              </p>
            </div>
            <div>
              <span className="text-slate-400">Tamaño total:</span>
              <p className="font-semibold text-emerald-400">{inspectResult.fileSizeFormatted}</p>
            </div>
            <div>
              <span className="text-slate-400">Soporta Rangos HTTP / Chunks:</span>
              <p className="font-semibold text-slate-200">
                {inspectResult.acceptRanges ? "✅ Sí (Apto para streaming)" : "⚠️ No garantizado"}
              </p>
            </div>
          </div>
        )}

        {/* Chunk Size & Filename configuration */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div>
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-emerald-400" />
              Tamaño del Chunk (Ventana de memoria RAM):
            </label>
            <div className="grid grid-cols-4 gap-2 mt-1.5">
              {[8, 16, 32, 64].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setChunkSizeMB(size)}
                  className={`py-2 text-xs font-medium rounded-lg border transition ${
                    chunkSizeMB === size
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500"
                      : "bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  {size} MB {size === 16 ? "⭐" : ""}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {chunkSizeMB} MB serán descargados y subidos por ciclo. Múltiplo de 256KB requerido por Google.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <FileCode className="w-3.5 h-3.5 text-emerald-400" />
              Nombre en Google Drive (Opcional):
            </label>
            <input
              type="text"
              value={customFileName}
              onChange={(e) => setCustomFileName(e.target.value)}
              placeholder="ubuntu-24.04-custom.iso"
              className="mt-1.5 w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Destino: <strong>{folderName}</strong>
            </p>
          </div>
        </div>

        {/* Start Button */}
        <div className="pt-2 flex justify-end">
          <button
            onClick={handleStartStream}
            disabled={isStarting || !sourceUrl.trim() || !accessToken}
            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm shadow-lg shadow-emerald-950/40 flex items-center gap-2 transition disabled:opacity-50"
          >
            <Play className={`w-4 h-4 ${isStarting ? "animate-spin" : ""}`} />
            {isStarting ? "Iniciando Sesión en Drive..." : "Iniciar Streaming a Google Drive"}
          </button>
        </div>
      </div>

      {/* Active Tasks List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            Tareas de Streaming Activas y en Google Drive ({tasks.length})
          </h3>
          <button
            onClick={refreshTasks}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
            title="Refrescar estado"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Real-time Resumable Upload & Cloud Persistence Callout */}
        <div className="p-4 bg-slate-900/80 border border-indigo-500/30 rounded-xl flex flex-col sm:flex-row items-start gap-3 text-xs text-slate-300">
          <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400 shrink-0">
            <Info className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-white">
              ¿Por qué no se ve aún el archivo .iso en la lista web de drive.google.com al pausar?
            </p>
            <p className="text-slate-300 leading-relaxed">
              Google Drive gestiona las subidas por chunks mediante <strong>sesiones reanudables atómicas</strong>. Cada chunk enviado queda sellado y persistido en la infraestructura de Google Cloud. Para evitar que tu cuenta tenga archivos de 0 bytes o imágenes de disco truncadas, <strong>Google solo materializa el archivo .iso en la interfaz de usuario cuando se recibe el 100%</strong>. Si reinicias la máquina o borras el disco local, la sesión y los datos siguen en Google (vigentes hasta 7 días). Pulsa <strong>&quot;Auditar en Google&quot;</strong> en cualquier tarea para verificar los bytes certificados en vivo por la API de Google.
            </p>
          </div>
        </div>

        {tasks.length === 0 ? (
          <div className="p-8 text-center bg-slate-900/60 border border-slate-800 rounded-2xl">
            <CloudLightning className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-300">
              No hay tareas de streaming en ejecución
            </p>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              Pega un enlace de ISO o magnet arriba para iniciar la descarga y subida en streaming
              directo a Google Drive.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span
                      className={`p-2 rounded-xl text-lg ${
                        task.status === "completed"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                          : task.status === "streaming"
                          ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/30"
                          : task.status === "paused"
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                          : "bg-red-500/10 text-red-400 border border-red-500/30"
                      }`}
                    >
                      {task.sourceType === "torrent" ? "🧲" : "💿"}
                    </span>
                    <div>
                      <h4 className="font-semibold text-white text-sm truncate max-w-md" title={task.fileName}>
                        {task.fileName}
                      </h4>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                        <span>{task.fileSizeFormatted}</span>
                        <span>•</span>
                        <span>Chunk: {task.chunkSizeFormatted}</span>
                        <span>•</span>
                        <span
                          className={`font-semibold capitalize ${
                            task.status === "completed"
                              ? "text-emerald-400"
                              : task.status === "streaming"
                              ? "text-indigo-400"
                              : task.status === "paused"
                              ? "text-amber-400"
                              : "text-red-400"
                          }`}
                        >
                          {task.status === "streaming"
                            ? "Transmitiendo a Drive..."
                            : task.status === "completed"
                            ? "Completado en Drive"
                            : task.status === "paused"
                            ? "Pausado"
                            : "Error"}
                        </span>
                      </div>
                    </div>
                  </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap items-center gap-2 self-end sm:self-auto">
                      <button
                        onClick={() => handleAudit(task.id)}
                        disabled={auditingTaskId === task.id}
                        className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/40 rounded-lg flex items-center gap-1.5 transition disabled:opacity-50"
                        title="Pregunta directamente a los servidores de Google Drive cuántos bytes han sido guardados para esta sesión"
                      >
                        <Search className={`w-3.5 h-3.5 ${auditingTaskId === task.id ? "animate-spin" : ""}`} />
                        {auditingTaskId === task.id ? "Auditando..." : "Auditar en Google"}
                      </button>

                      {task.status === "streaming" && (
                        <button
                          onClick={() => handlePause(task.id)}
                          className="px-3 py-1.5 text-xs bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-lg flex items-center gap-1 transition"
                        >
                          <Pause className="w-3.5 h-3.5" /> Pausar
                        </button>
                      )}

                    {(task.status === "paused" || task.status === "error") && (
                      <button
                        onClick={() => handleResume(task.id)}
                        className="px-3 py-1.5 text-xs bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-lg flex items-center gap-1 transition"
                      >
                        <Play className="w-3.5 h-3.5" /> {task.status === "error" ? "Reintentar" : "Reanudar"}
                      </button>
                    )}

                    {task.webViewLink && (
                      <a
                        href={task.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 text-xs bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 rounded-lg flex items-center gap-1 transition"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Ver en Drive
                      </a>
                    )}

                    {taskToCancel === task.id ? (
                      <div className="flex items-center gap-1 bg-red-950/40 rounded-lg p-1 border border-red-500/30">
                        <span className="text-[10px] text-red-400 font-bold uppercase px-1">¿Borrar?</span>
                        <button
                          onClick={confirmCancel}
                          className="p-1 text-white bg-red-600 hover:bg-red-500 rounded transition"
                        >
                          Sí
                        </button>
                        <button
                          onClick={() => setTaskToCancel(null)}
                          className="p-1 text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded transition"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleCancel(task.id)}
                        className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition"
                        title="Cancelar y eliminar de la lista"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-medium">
                      Progreso: {task.uploadedBytesFormatted} de {task.fileSizeFormatted} (
                      {task.progressPercent}%)
                    </span>
                    <span className="text-slate-400 flex flex-wrap justify-end gap-3 items-center">
                      {task.status === "streaming" && (
                        <>
                          {task.sourceType === "torrent" && task.torrentSpeedMBs !== undefined && (
                            <span className="text-indigo-400 font-semibold inline-flex items-center gap-1" title="Velocidad real de descarga del enjambre Torrent">
                              <Download className="w-3 h-3" /> {task.torrentSpeedMBs} MB/s 
                              <span className="text-slate-500 font-normal text-[10px] uppercase ml-1">({task.peers || 0} pares)</span>
                            </span>
                          )}
                          {task.speedMBs > 0 && (
                            <span className="text-emerald-400 font-semibold inline-flex items-center gap-1" title="Velocidad de subida a Google Drive">
                              ☁️ {task.speedMBs} MB/s
                            </span>
                          )}
                          {task.fileSize > task.uploadedBytes && task.speedMBs > 0 && (
                            <span className="text-cyan-300 font-medium inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" /> ETA:{" "}
                              {formatEta(
                                (task.fileSize - task.uploadedBytes) / (task.speedMBs * 1024 * 1024)
                              )}
                            </span>
                          )}
                        </>
                      )}
                      <span>Chunk {task.currentChunkIndex} de {task.totalChunks}</span>
                    </span>
                  </div>

                  <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800">
                    <div
                      className={`h-full transition-all duration-300 ${
                        task.status === "completed"
                          ? "bg-emerald-500"
                          : task.status === "paused"
                          ? "bg-amber-500"
                          : "bg-gradient-to-r from-emerald-500 to-indigo-500"
                      }`}
                      style={{ width: `${task.progressPercent}%` }}
                    />
                  </div>
                </div>

                {/* Metadata badges */}
                <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-400">
                  <span className="px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 font-mono">
                    ID: {task.id}
                  </span>
                  {task.resumableUploadUrl && (
                    <span
                      className="px-2 py-0.5 rounded-md bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 flex items-center gap-1 cursor-help"
                      title="Sesión Resumable de Google Drive autónoma: Validez de 7 días. La transferencia de chunks PUT hacia Google no requiere el token OAuth de 1 hora."
                    >
                      <ShieldCheck className="w-3 h-3 text-emerald-400" /> Sesión Cloud Autónoma (7 días)
                    </span>
                  )}
                  {task.status === "streaming" && (
                    <span className="px-2 py-0.5 rounded-md bg-indigo-950/60 border border-indigo-500/30 text-indigo-300 flex items-center gap-1">
                      <Zap className="w-3 h-3 text-indigo-400" /> Pipeline Double-Buffer Activo
                    </span>
                  )}
                  {task.manifestFileId && (
                    <span className="px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 flex items-center gap-1 text-slate-300">
                      <Database className="w-3 h-3 text-amber-400" /> Manifiesto guardado en Drive
                    </span>
                  )}
                  {task.md5Checksum && (
                    <span className="px-2 py-0.5 rounded-md bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-emerald-400" /> MD5 Google Drive: {task.md5Checksum}
                    </span>
                  )}
                  {task.activeMirrorUrl && (
                    <span className="px-2 py-0.5 rounded-md bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 flex items-center gap-1">
                      <Zap className="w-3 h-3 text-cyan-400" /> Espejo HTTP: {task.activeMirrorUrl.replace(/^https?:\/\//, "").split("/")[0]}
                    </span>
                  )}
                  {task.webSeeds && task.webSeeds.length > 0 && !task.activeMirrorUrl && (
                    <span className="px-2 py-0.5 rounded-md bg-indigo-950/60 border border-indigo-500/30 text-indigo-300 flex items-center gap-1">
                      <Zap className="w-3 h-3 text-indigo-400" /> {task.webSeeds.length} espejos WebSeed
                    </span>
                  )}
                  {task.error && (
                    <span className="text-red-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {task.error}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Google Drive Session Live Audit Modal */}
      {auditResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 text-slate-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">Certificación en Vivo de Google Drive</h4>
                  <p className="text-xs text-slate-400">Respuesta HTTP oficial de Google Cloud Storage</p>
                </div>
              </div>
              <button
                onClick={() => setAuditResult(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Audit Status Badge */}
            <div className="p-3 bg-slate-950 border border-emerald-500/40 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Estado de la Sesión en Google:</span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  HTTP {auditResult.status} {auditResult.statusText}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Bytes Guardados en Google:</span>
                <span className="text-sm font-bold text-emerald-400">
                  {auditResult.committedBytesFormatted} de {auditResult.totalBytesFormatted} ({auditResult.progressPercent}%)
                </span>
              </div>
              {auditResult.rangeHeader && (
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-slate-400">Cabecera Range de Google:</span>
                  <span className="text-cyan-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                    Range: {auditResult.rangeHeader}
                  </span>
                </div>
              )}
              {auditResult.uploadId && (
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-slate-400">ID de Sesión (upload_id):</span>
                  <span className="text-slate-300 truncate max-w-xs" title={auditResult.uploadId}>
                    {auditResult.uploadId}
                  </span>
                </div>
              )}
              {auditResult.googleServer && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Servidor Cloud:</span>
                  <span className="text-slate-300">{auditResult.googleServer}</span>
                </div>
              )}
            </div>

            {/* Explanation box */}
            <div className="p-4 bg-indigo-950/40 border border-indigo-500/30 rounded-xl text-xs space-y-2">
              <div className="flex items-center gap-1.5 font-semibold text-indigo-300">
                <Info className="w-4 h-4" />
                <span>¿Por qué tus chunks están 100% a salvo en la nube?</span>
              </div>
              <p className="text-slate-300 leading-relaxed">
                {auditResult.explanation}
              </p>
            </div>

            {/* Action buttons in modal */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setAuditResult(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit Error Toast */}
      {auditError && (
        <div className="fixed bottom-6 right-6 z-50 p-4 bg-red-950/90 border border-red-500/40 rounded-xl text-xs text-red-200 shadow-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{auditError}</span>
          <button onClick={() => setAuditError(null)} className="ml-2 text-slate-400 hover:text-white">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
