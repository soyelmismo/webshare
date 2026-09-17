import React, { useState, useEffect } from "react";
import {
  CloudLightning,
  Play,
  Square,
  AlertCircle,
  CheckCircle2,
  Loader2,
  HardDrive,
  DownloadCloud,
  FileCode,
  ShieldCheck,
  RefreshCw,
  Clock,
  Sparkles,
  Info,
  Sliders,
  Database,
  ArrowRight,
  Activity,
} from "lucide-react";
import {
  StreamTask,
  StreamSourceInfo,
  startStreamJob,
  inspectStreamUrl,
  cancelStreamJob,
  getStreamTasks,
} from "../utils/streamClient";
import { StoredDriveSession, loadDriveSession, onDriveSessionChange } from "../utils/driveStorage";
import { UnifiedJobList } from "./UnifiedJobList";

interface DriveStreamDownloaderProps {
  session?: StoredDriveSession;
  accessToken?: string | null;
  folderId?: string;
  folderName?: string;
  onConnectDrive?: () => void;
  onOpenCookieModal?: () => void;
  onNavigateToDriveTab?: () => void;
}

export const DriveStreamDownloader: React.FC<DriveStreamDownloaderProps> = ({
  session: propSession,
  accessToken,
  folderId: propFolderId,
  folderName: _folderName,
  onConnectDrive,
  onOpenCookieModal,
  onNavigateToDriveTab,
}) => {
  const [session, setSession] = useState<StoredDriveSession>(() => propSession || loadDriveSession());

  useEffect(() => {
    if (propSession) {
      setSession(propSession);
    }
  }, [propSession]);

  useEffect(() => {
    const unsubscribe = onDriveSessionChange((updated) => {
      setSession(updated);
    });
    return () => unsubscribe();
  }, []);

  const currentSession = session;
  const [url, setUrl] = useState("");
  const [customFilename, setCustomFilename] = useState("");
  const [chunkSizeMB, setChunkSizeMB] = useState(25);
  const [isInspectLoading, setIsInspectLoading] = useState(false);
  const [sourceInfo, setSourceInfo] = useState<StreamSourceInfo | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);

  // Active Jobs state
  const [tasks, setTasks] = useState<StreamTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const activeToken = accessToken || currentSession?.token || null;
  const hasToken = Boolean(activeToken);
  const activeTask = tasks.find((t) => t.id === activeTaskId) || tasks[0];

  const handleOpenConnect = () => {
    if (onConnectDrive) onConnectDrive();
    else if (onOpenCookieModal) onOpenCookieModal();
    else if (onNavigateToDriveTab) onNavigateToDriveTab();
  };

  // Poll tasks every 1.5s
  useEffect(() => {
    let interval: any;
    const fetchTasks = async () => {
      try {
        const list = await getStreamTasks();
        setTasks(list);
        if (!activeTaskId && list.length > 0) {
          setActiveTaskId(list[0].id);
        }
      } catch (err) {
        // silent
      }
    };

    fetchTasks();
    interval = setInterval(fetchTasks, 1500);
    return () => clearInterval(interval);
  }, [activeTaskId]);

  const handleInspect = async (targetUrl?: string) => {
    const inspectUrl = targetUrl || url.trim();
    if (!inspectUrl) return;

    setIsInspectLoading(true);
    setInspectError(null);
    setSourceInfo(null);

    try {
      const info = await inspectStreamUrl(inspectUrl);
      setSourceInfo(info);
      if (info.suggestedFilename && !customFilename) {
        setCustomFilename(info.suggestedFilename);
      }
    } catch (err: any) {
      setInspectError(err.message || "Error al inspeccionar la URL");
    } finally {
      setIsInspectLoading(false);
    }
  };

  const handleStartStream = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || isStarting) return;

    if (!hasToken) {
      setStartError("Debes vincular tu cuenta de Google Drive para iniciar el streaming.");
      return;
    }

    setIsStarting(true);
    setStartError(null);

    try {
      const activeToken = accessToken || currentSession?.token || "";
      const targetFolder = propFolderId || currentSession?.dedicatedFolderId || currentSession?.folder?.id;
      const result = await startStreamJob({
        sourceUrl: url.trim(),
        targetFilename: customFilename.trim() || undefined,
        folderId: targetFolder || undefined,
        accessToken: activeToken,
        chunkSizeMB: Number(chunkSizeMB) || 25,
      });

      setActiveTaskId(result.task.id);
      // Refresh task list
      const list = await getStreamTasks();
      setTasks(list);
    } catch (err: any) {
      setStartError(err.message || "No se pudo iniciar el stream a Google Drive.");
    } finally {
      setIsStarting(false);
    }
  };

  const handleCancelTask = async (taskId: string) => {
    try {
      await cancelStreamJob(taskId);
      const list = await getStreamTasks();
      setTasks(list);
    } catch (err) {
      console.error(err);
    }
  };

  const setPresetUrl = (presetUrl: string, presetName: string) => {
    setUrl(presetUrl);
    setCustomFilename(presetName);
    handleInspect(presetUrl);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-[#1f242c] border border-[#3b424d] text-[#10b981] shrink-0">
            <CloudLightning className="w-5 h-5 text-[#10b981]" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#f3f4f6]">
              Streaming Directo de URL a Google Drive (RAM Pipeline)
            </h2>
            <p className="text-xs text-[#9ca3af]">
              Transfiere archivos gigantes (ISOs, backups, datasets) descargando fragmentos a RAM y subiéndolos concurrentemente sin saturar el almacenamiento en disco.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasToken ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#064e3b] text-[#34d399] border border-[#059669]/60 font-mono">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Drive Vinculado: {currentSession?.user?.email || currentSession?.activeAccount?.email || "Activo"}</span>
            </div>
          ) : (
            <button
              onClick={handleOpenConnect}
              className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e] transition-colors cursor-pointer"
            >
              Vincular Google Drive
            </button>
          )}
        </div>
      </div>

      {/* Main Stream Configuration Form */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-4">
        <h3 className="text-sm font-bold text-[#f3f4f6] flex items-center gap-2">
          <Sliders className="w-4 h-4 text-[#10b981]" />
          Configurar Nueva Transferencia Stream
        </h3>

        <form onSubmit={handleStartStream} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-[#9ca3af] block">
              URL de Descarga Directa (HTTP / HTTPS):
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso"
                className="flex-1 px-3 py-2 bg-[#101317] border border-[#22272e] rounded-lg text-xs font-mono text-[#f3f4f6] placeholder-[#6b7280] focus:outline-none focus:border-[#10b981]"
              />
              <button
                type="button"
                onClick={() => handleInspect()}
                disabled={isInspectLoading || !url.trim()}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#1f242c] hover:bg-[#262b32] text-[#f3f4f6] border border-[#3b424d] transition-colors cursor-pointer disabled:opacity-50 shrink-0"
              >
                {isInspectLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1 text-[#10b981]" />
                ) : (
                  <Info className="w-3.5 h-3.5 inline mr-1 text-[#9ca3af]" />
                )}
                <span>Inspeccionar</span>
              </button>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[#9ca3af] font-medium">Ejemplos rápidos:</span>
            <button
              type="button"
              onClick={() => setPresetUrl("https://releases.ubuntu.com/24.04.1/ubuntu-24.04.1-live-server-amd64.iso", "ubuntu-24.04.1-server.iso")}
              className="px-2.5 py-1 rounded-md bg-[#1f242c] hover:bg-[#262b32] text-[#34d399] border border-[#3b424d] text-[11px] font-mono cursor-pointer transition-colors"
            >
              Ubuntu Server (2.6 GB)
            </button>
            <button
              type="button"
              onClick={() => setPresetUrl("https://download.fedoraproject.org/pub/fedora/linux/releases/40/Server/x86_64/iso/Fedora-Server-dvd-x86_64-40-1.14.iso", "Fedora-Server-40.iso")}
              className="px-2.5 py-1 rounded-md bg-[#1f242c] hover:bg-[#262b32] text-[#34d399] border border-[#3b424d] text-[11px] font-mono cursor-pointer transition-colors"
            >
              Fedora Server (2.4 GB)
            </button>
            <button
              type="button"
              onClick={() => setPresetUrl("https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-12.8.0-amd64-netinst.iso", "debian-12-netinst.iso")}
              className="px-2.5 py-1 rounded-md bg-[#1f242c] hover:bg-[#262b32] text-[#34d399] border border-[#3b424d] text-[11px] font-mono cursor-pointer transition-colors"
            >
              Debian Netinst (650 MB)
            </button>
          </div>

          {/* Source Info Alert */}
          {sourceInfo && (
            <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] font-mono text-xs space-y-1">
              <div className="flex items-center justify-between font-bold text-[#f3f4f6]">
                <span>Archivo: {sourceInfo.suggestedFilename}</span>
                <span className="text-[#34d399]">
                  {sourceInfo.contentLengthFormatted || "Tamaño dinámico / Chunked"}
                </span>
              </div>
              <div className="flex flex-wrap gap-4 text-[#9ca3af] text-[11px]">
                <span>MIME: {sourceInfo.contentType}</span>
                <span>Rangos HTTP (Byte-ranges): {sourceInfo.acceptsRanges ? "Sí (Soportado)" : "No"}</span>
              </div>
            </div>
          )}

          {inspectError && (
            <div className="p-2.5 rounded-lg bg-[#7f1d1d]/30 border border-[#ef4444]/40 text-[#f87171] text-xs flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{inspectError}</span>
            </div>
          )}

          {/* Target filename and chunk size */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#9ca3af] block">
                Nombre de Archivo en Google Drive:
              </label>
              <input
                type="text"
                value={customFilename}
                onChange={(e) => setCustomFilename(e.target.value)}
                placeholder="nombre-archivo.iso"
                className="w-full px-3 py-2 bg-[#101317] border border-[#22272e] rounded-lg text-xs font-mono text-[#f3f4f6] placeholder-[#6b7280] focus:outline-none focus:border-[#10b981]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#9ca3af] block">
                Tamaño de Buffer en RAM por Chunk:
              </label>
              <select
                value={chunkSizeMB}
                onChange={(e) => setChunkSizeMB(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[#101317] border border-[#22272e] rounded-lg text-xs font-mono text-[#f3f4f6] focus:outline-none focus:border-[#10b981]"
              >
                <option value={10}>10 MB (Bajo consumo de RAM)</option>
                <option value={25}>25 MB (Recomendado - Óptimo)</option>
                <option value={50}>50 MB (Mayor velocidad, redes 1 Gbps)</option>
                <option value={100}>100 MB (Alta velocidad extrema)</option>
              </select>
            </div>
          </div>

          {startError && (
            <div className="p-2.5 rounded-lg bg-[#7f1d1d]/30 border border-[#ef4444]/40 text-[#f87171] text-xs flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{startError}</span>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={isStarting || !url.trim()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-bold bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e] transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
            >
              {isStarting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Iniciando Streaming a Drive...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Comenzar Streaming a Google Drive</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Unified Jobs List */}
      <UnifiedJobList
        session={propSession}
        accessToken={accessToken}
        folderId={propFolderId}
        folderName={_folderName}
        onOpenConnectModal={onOpenCookieModal}
      />
    </div>
  );
};
