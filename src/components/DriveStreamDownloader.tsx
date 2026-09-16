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
  const [chunkSizeMB, setChunkSizeMB] = useState<number>(64);
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

  // Polling loop to keep task statuses up to date
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
    <div id="drive-stream-downloader" className="space-y-4">
      {/* Compact Top Header Card */}
      <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 shrink-0">
            <CloudLightning className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight">
              Streaming Directo a Google Drive
            </h2>
            <p className="text-xs text-slate-400 font-mono">
              Descarga por chunks a RAM y subida continua a Drive • Destino: <span className="text-slate-200 font-semibold">{folderName}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <button
            onClick={() => setShowArchExplainer(!showArchExplainer)}
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          >
            {showArchExplainer ? "Ocultar info" : "Info técnica"}
          </button>
          <button
            onClick={handleRecoverFromDrive}
            disabled={isRecovering || !accessToken}
            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5 transition disabled:opacity-50"
            title="Recuperar transferencias pausadas o interrumpidas desde Drive"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isRecovering ? "animate-spin" : ""}`} />
            <span>{isRecovering ? "Escaneando..." : "Recuperar de Drive"}</span>
          </button>
        </div>
      </div>

      {/* Optional Architecture Explanation */}
      {showArchExplainer && (
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-400">
          <div className="flex items-start gap-2">
            <Layers className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white">Chunks en RAM ({chunkSizeMB} MB):</strong> Descarga solo un fragmento a la vez y libera memoria tras enviar a Drive.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Database className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white">Manifiesto en Drive:</strong> Guarda el estado de progreso en la nube; seguro ante reinicios del contenedor.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white">Validación Criptográfica:</strong> Google Drive valida rangos y confirma el hash MD5 al finalizar.
            </div>
          </div>
        </div>
      )}

      {/* Error & Success Messages */}
      {error && (
        <div className="p-3 bg-red-950/60 border border-red-500/40 rounded-xl text-red-200 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">✕</button>
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-emerald-200 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-400 hover:text-emerald-300">✕</button>
        </div>
      )}

      {/* Drive not connected banner */}
      {!accessToken && (
        <div className="p-3.5 bg-amber-950/40 border border-amber-500/30 rounded-xl flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <Database className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-amber-200 font-medium">Google Drive no está conectado. Requiere autenticación para transferir a tu cuenta.</span>
          </div>
          <button
            onClick={onConnectDrive}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg shrink-0 transition"
          >
            Conectar Drive
          </button>
        </div>
      )}

      {/* Compact Input Form Card */}
      <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-4 space-y-3.5">
        {/* URL / Magnet & Inspection Bar */}
        <div className="space-y-2">
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
              placeholder="Pega URL directa (HTTP/HTTPS) o enlace Magnet..."
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              onClick={() => handleInspect()}
              disabled={isInspecting || (!sourceUrl.trim() && !torrentBase64 && !torrentBase64Ref.current)}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition disabled:opacity-50 shrink-0"
            >
              <Search className={`w-3.5 h-3.5 ${isInspecting ? "animate-spin" : ""}`} />
              <span>{isInspecting ? "Analizando..." : "Inspeccionar"}</span>
            </button>
          </div>

          {/* Preset Buttons & Torrent upload in single row */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-500 font-medium">Ejemplos:</span>
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
                  className="px-2 py-0.5 text-[11px] rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center gap-1"
                >
                  <span>{preset.type === "torrent" ? "🧲" : "💿"}</span>
                  <span className="truncate max-w-[120px]">{preset.name.split(" ")[0]}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer flex items-center gap-1 bg-slate-800/60 hover:bg-slate-800 px-2 py-0.5 rounded border border-slate-700/60">
                <span>Cargar .torrent</span>
                <input
                  type="file"
                  accept=".torrent"
                  onChange={handleTorrentFileUpload}
                  className="hidden"
                />
              </label>
              {uploadedTorrentFileName && (
                <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-mono">
                  {uploadedTorrentFileName}
                  <button type="button" onClick={handleClearUploadedFile} className="text-slate-400 hover:text-rose-400">✕</button>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Inspected info preview */}
        {inspectResult && (
          <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Archivo:</span>
              <span className="text-white font-semibold truncate max-w-xs">{inspectResult.fileName}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Tamaño:</span>
              <span className="text-emerald-400 font-semibold">{inspectResult.fileSizeFormatted}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Streaming:</span>
              <span className="text-slate-200">{inspectResult.acceptRanges ? "Apto (Range OK)" : "Torrent / Flujo"}</span>
            </div>
          </div>
        )}

        {/* Settings & Action Row */}
        <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Chunk:</span>
            <div className="flex gap-1">
              {[16, 32, 64, 128, 256].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setChunkSizeMB(size)}
                  className={`px-2 py-1 text-xs font-mono rounded-md border transition ${
                    chunkSizeMB === size
                      ? "bg-indigo-600 text-white border-indigo-500 font-bold"
                      : "bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  {size}M
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleStartStream}
            disabled={isStarting || (!sourceUrl.trim() && !torrentBase64 && !torrentBase64Ref.current) || !accessToken}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 transition disabled:opacity-50 shadow-sm"
          >
            <Play className={`w-3.5 h-3.5 ${isStarting ? "animate-spin" : ""}`} />
            <span>{isStarting ? "Iniciando..." : "Iniciar Streaming a Drive"}</span>
          </button>
        </div>
      </div>

      {/* Active Tasks List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>Transferencias Activas ({tasks.length})</span>
          </h3>
          <button
            onClick={refreshTasks}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition"
            title="Refrescar estado"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {tasks.length === 0 ? (
          <div className="p-6 text-center bg-slate-900/40 border border-slate-800 rounded-xl">
            <CloudLightning className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-xs text-slate-400">
              No hay transferencias activas. Introduce una URL o magnet arriba para iniciar.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="bg-slate-900 border border-slate-800/80 rounded-xl p-3.5 space-y-2.5 shadow-sm"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{task.sourceType === "torrent" ? "🧲" : "💿"}</span>
                      <h4 className="font-semibold text-white text-xs truncate" title={task.fileName}>
                        {task.fileName}
                      </h4>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400 font-mono">
                      <span>{task.fileSizeFormatted}</span>
                      <span>•</span>
                      <span>Chunk {task.chunkSizeFormatted}</span>
                      <span>•</span>
                      <span
                        className={`font-semibold ${
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
                          ? "Transmitiendo"
                          : task.status === "completed"
                          ? "Completado"
                          : task.status === "paused"
                          ? "Pausado"
                          : "Error"}
                      </span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0">
                    <button
                      onClick={() => handleAudit(task.id)}
                      disabled={auditingTaskId === task.id}
                      className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 rounded-md flex items-center gap-1 transition disabled:opacity-50"
                      title="Auditar bytes guardados en Google Drive"
                    >
                      <Search className={`w-3 h-3 ${auditingTaskId === task.id ? "animate-spin" : ""}`} />
                      <span>{auditingTaskId === task.id ? "Auditando..." : "Auditar"}</span>
                    </button>

                    {task.status === "streaming" && (
                      <button
                        onClick={() => handlePause(task.id)}
                        className="px-2.5 py-1 text-[11px] bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-md flex items-center gap-1 transition"
                      >
                        <Pause className="w-3 h-3" /> Pausar
                      </button>
                    )}

                    {(task.status === "paused" || task.status === "error") && (
                      <button
                        onClick={() => handleResume(task.id)}
                        className="px-2.5 py-1 text-[11px] bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-md flex items-center gap-1 transition"
                      >
                        <Play className="w-3 h-3" /> {task.status === "error" ? "Reintentar" : "Reanudar"}
                      </button>
                    )}

                    {task.webViewLink && (
                      <a
                        href={task.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1 text-[11px] bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-md flex items-center gap-1 transition"
                      >
                        <ExternalLink className="w-3 h-3" /> Drive
                      </a>
                    )}

                    {taskToCancel === task.id ? (
                      <div className="flex items-center gap-1 bg-red-950/40 rounded p-0.5 border border-red-500/30 text-[10px]">
                        <span className="text-red-400 px-1 font-bold">¿Borrar?</span>
                        <button onClick={confirmCancel} className="px-1.5 py-0.5 text-white bg-red-600 rounded">Sí</button>
                        <button onClick={() => setTaskToCancel(null)} className="px-1.5 py-0.5 text-slate-300 bg-slate-700 rounded">No</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleCancel(task.id)}
                        className="p-1 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition"
                        title="Cancelar y eliminar"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-slate-300">
                      {task.uploadedBytesFormatted} / {task.fileSizeFormatted} ({task.progressPercent}%)
                    </span>
                    <span className="text-slate-400 flex items-center gap-2">
                      {task.status === "streaming" && (
                        <>
                          {task.speedMBs > 0 && <span className="text-emerald-400">{task.speedMBs} MB/s</span>}
                          {task.fileSize > task.uploadedBytes && task.speedMBs > 0 && (
                            <span className="text-cyan-300">
                              ETA: {formatEta((task.fileSize - task.uploadedBytes) / (task.speedMBs * 1024 * 1024))}
                            </span>
                          )}
                        </>
                      )}
                      <span>Chunk {task.currentChunkIndex}/{task.totalChunks}</span>
                    </span>
                  </div>

                  <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                    <div
                      className={`h-full transition-all duration-300 ${
                        task.status === "completed"
                          ? "bg-emerald-500"
                          : task.status === "paused"
                          ? "bg-amber-500"
                          : "bg-indigo-500"
                      }`}
                      style={{ width: `${task.progressPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Google Drive Session Live Audit Modal */}
      {auditResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4 text-slate-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h4 className="text-sm font-bold text-white">Certificación Google Drive</h4>
              </div>
              <button
                onClick={() => setAuditResult(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Estado HTTP:</span>
                <span className="text-emerald-400 font-bold">HTTP {auditResult.status} {auditResult.statusText}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Bytes en Google:</span>
                <span className="text-white font-bold">{auditResult.committedBytesFormatted} ({auditResult.progressPercent}%)</span>
              </div>
              {auditResult.rangeHeader && (
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Range:</span>
                  <span className="text-cyan-300">{auditResult.rangeHeader}</span>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              {auditResult.explanation}
            </p>

            <div className="flex justify-end pt-1">
              <button
                onClick={() => setAuditResult(null)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit Error Toast */}
      {auditError && (
        <div className="fixed bottom-4 right-4 z-50 p-3 bg-red-950/90 border border-red-500/40 rounded-lg text-xs text-red-200 shadow-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{auditError}</span>
          <button onClick={() => setAuditError(null)} className="ml-2 text-slate-400 hover:text-white">✕</button>
        </div>
      )}
    </div>
  );
};
