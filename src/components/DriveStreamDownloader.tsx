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
  Folder,
  FolderPlus,
  FileUp,
  ListFilter,
  CheckSquare,
  FileText,
  FolderOpen,
  Download,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  StreamTask,
  StreamSourceInfo,
  startStreamJob,
  startBatchStreamJob,
  inspectStreamUrl,
  cancelStreamJob,
  getStreamTasks,
} from "../utils/streamClient";
import { StoredDriveSession, loadDriveSession, onDriveSessionChange } from "../utils/driveStorage";
import { listUserFolders, createDriveFolder } from "../utils/googleDriveApi";
import { DriveFolderInfo } from "../types";
import { UnifiedJobList } from "./UnifiedJobList";

function formatBytes(bytes: number, decimals = 2): string {
  if (!bytes || bytes <= 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
  return `${val} ${sizes[i]}`;
}

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
  const activeToken = accessToken || currentSession?.token || null;
  const hasToken = Boolean(activeToken);

  const [url, setUrl] = useState("");
  const [customFilename, setCustomFilename] = useState("");
  const [chunkSizeMB, setChunkSizeMB] = useState(25);
  const [torrentBase64, setTorrentBase64] = useState<string | null>(null);

  // Folder selection state
  const [userFolders, setUserFolders] = useState<DriveFolderInfo[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>(
    () => propFolderId || currentSession?.dedicatedFolderId || currentSession?.folder?.id || "root"
  );
  const [isFoldersLoading, setIsFoldersLoading] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Inspection & Multi-file torrent state
  const [isInspectLoading, setIsInspectLoading] = useState(false);
  const [sourceInfo, setSourceInfo] = useState<StreamSourceInfo | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(new Set());
  const [fileViewMode, setFileViewMode] = useState<"tree" | "flat">("tree");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  const toggleCollapseFolder = (folderPath: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  };

  const toggleSelectFolderFiles = (filesInFolder: Array<{ path: string }>) => {
    setSelectedFilePaths((prev) => {
      const next = new Set(prev);
      const allSelected = filesInFolder.every((f) => next.has(f.path));
      if (allSelected) {
        filesInFolder.forEach((f) => next.delete(f.path));
      } else {
        filesInFolder.forEach((f) => next.add(f.path));
      }
      return next;
    });
  };

  // Group files by directory hierarchy
  const folderGroups = React.useMemo(() => {
    if (!sourceInfo?.files) return [];
    const groupsMap = new Map<string, Array<{ name: string; length: number; path: string }>>();
    for (const f of sourceInfo.files) {
      const clean = f.path.replace(/\\/g, "/");
      const dir = clean.includes("/") ? clean.substring(0, clean.lastIndexOf("/")) : "";
      if (!groupsMap.has(dir)) {
        groupsMap.set(dir, []);
      }
      groupsMap.get(dir)!.push(f);
    }
    return Array.from(groupsMap.entries()).sort(([a], [b]) => {
      if (a === "" && b !== "") return -1;
      if (b === "" && a !== "") return 1;
      return a.localeCompare(b);
    });
  }, [sourceInfo?.files]);

  // Active Jobs state
  const [tasks, setTasks] = useState<StreamTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleOpenConnect = () => {
    if (onConnectDrive) onConnectDrive();
    else if (onOpenCookieModal) onOpenCookieModal();
    else if (onNavigateToDriveTab) onNavigateToDriveTab();
  };

  // Fetch Drive folders when token is active
  useEffect(() => {
    if (!activeToken) return;
    setIsFoldersLoading(true);
    listUserFolders(activeToken)
      .then((folders) => {
        setUserFolders(folders);
        setSelectedFolderId((prev) => {
          if (!prev || prev === "root") {
            const dedicated = currentSession?.dedicatedFolderId || currentSession?.folder?.id;
            return dedicated || prev;
          }
          return prev;
        });
      })
      .catch(() => {})
      .finally(() => setIsFoldersLoading(false));
  }, [activeToken]);

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

  const handleCreateNewFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeToken || !newFolderName.trim()) return;
    setIsCreatingFolder(true);
    try {
      const created = await createDriveFolder(activeToken, newFolderName.trim());
      setUserFolders((prev) => [...prev, created]);
      setSelectedFolderId(created.id);
      setShowCreateFolder(false);
      setNewFolderName("");
    } catch (err: any) {
      alert(err.message || "No se pudo crear la carpeta en Google Drive");
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleInspect = async (targetUrl?: string, overrideTorrentB64?: string) => {
    const inspectUrl = targetUrl || url.trim();
    const b64 = overrideTorrentB64 !== undefined ? overrideTorrentB64 : torrentBase64;
    if (!inspectUrl && !b64) return;

    setIsInspectLoading(true);
    setInspectError(null);
    setSourceInfo(null);

    try {
      const info = await inspectStreamUrl(inspectUrl, b64 || undefined);
      setSourceInfo(info);
      if (info.suggestedFilename && !customFilename) {
        setCustomFilename(info.suggestedFilename);
      }
      if (info.files && info.files.length > 0) {
        // By default select all files in multi-file torrent
        setSelectedFilePaths(new Set(info.files.map((f) => f.path)));

        // If there are many files (> 15), auto-collapse all folders so the browser doesn't choke rendering hundreds of DOM rows
        if (info.files.length > 15) {
          const folderPaths = new Set<string>();
          for (const f of info.files) {
            const clean = f.path.replace(/\\/g, "/");
            const dir = clean.includes("/") ? clean.substring(0, clean.lastIndexOf("/")) : "";
            folderPaths.add(dir);
          }
          setCollapsedFolders(folderPaths);
        } else {
          setCollapsedFolders(new Set());
        }
      }
    } catch (err: any) {
      setInspectError(err.message || "Error al inspeccionar el enlace o torrent");
    } finally {
      setIsInspectLoading(false);
    }
  };

  const handleTorrentFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = (reader.result as string).split(",")[1];
      setTorrentBase64(b64);
      const cleanName = file.name.replace(/\.torrent$/i, "");
      setUrl(`torrent_file_${file.name}`);
      setCustomFilename(cleanName);
      handleInspect(`torrent_file_${file.name}`, b64);
    };
    reader.readAsDataURL(file);
  };

  const handleStartStream = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!url.trim() && !torrentBase64) || isStarting) return;

    if (!hasToken) {
      setStartError("Debes vincular tu cuenta de Google Drive para iniciar el streaming.");
      return;
    }

    setIsStarting(true);
    setStartError(null);

    try {
      const activeTokenStr = activeToken || "";
      const targetFolder = selectedFolderId || propFolderId || currentSession?.dedicatedFolderId || currentSession?.folder?.id || "root";
      const activeAccountEmail = currentSession?.activeAccount?.email || currentSession?.user?.email || undefined;

      let currentSourceInfo = sourceInfo;
      const isTorrentSource = Boolean(torrentBase64) || url.startsWith("magnet:") || url.toLowerCase().includes(".torrent");
      if (!currentSourceInfo && isTorrentSource) {
        try {
          currentSourceInfo = await inspectStreamUrl(url.trim(), torrentBase64 || undefined);
          setSourceInfo(currentSourceInfo);
          if (currentSourceInfo?.files && currentSourceInfo.files.length > 0) {
            setSelectedFilePaths(new Set(currentSourceInfo.files.map((f) => f.path)));
          }
        } catch {}
      }

      // If multi-file torrent, queue all selected files (or all files if none explicitly filtered)
      if (currentSourceInfo?.files && currentSourceInfo.files.length > 1) {
        const filesToQueue = selectedFilePaths.size > 0
          ? currentSourceInfo.files.filter((f) => selectedFilePaths.has(f.path))
          : currentSourceInfo.files;

        if (filesToQueue.length > 0) {
          const batchRes = await startBatchStreamJob({
            sourceUrl: url.trim() || `torrent_batch_${filesToQueue.length}`,
            folderId: targetFolder,
            accountEmail: activeAccountEmail,
            accessToken: activeTokenStr,
            chunkSizeMB: Number(chunkSizeMB) || 25,
            torrentBase64: torrentBase64 || undefined,
            files: filesToQueue.map((f) => ({ path: f.path, length: f.length, name: f.name })),
          });
          if (batchRes.tasks && batchRes.tasks.length > 0) {
            setActiveTaskId(batchRes.tasks[0].id);
          }
          const list = await getStreamTasks();
          setTasks(list);
          return;
        }
      }

      // Single file / direct download
      const singleFile =
        currentSourceInfo?.files && selectedFilePaths.size === 1
          ? currentSourceInfo.files.find((f) => selectedFilePaths.has(f.path)) || currentSourceInfo.files[0]
          : currentSourceInfo?.files && currentSourceInfo.files.length === 1
          ? currentSourceInfo.files[0]
          : undefined;

      const result = await startStreamJob({
        sourceUrl: url.trim(),
        targetFilename: customFilename.trim() || (singleFile ? singleFile.name : undefined),
        folderId: targetFolder,
        accountEmail: activeAccountEmail,
        accessToken: activeTokenStr,
        chunkSizeMB: Number(chunkSizeMB) || 25,
        torrentBase64: torrentBase64 || undefined,
        selectedFilePath: singleFile?.path,
        selectedFileSize: singleFile?.length,
      });
      setActiveTaskId(result.task.id);

      const list = await getStreamTasks();
      setTasks(list);
    } catch (err: any) {
      setStartError(err.message || "No se pudo iniciar el stream a Google Drive.");
    } finally {
      setIsStarting(false);
    }
  };

  const toggleSelectFile = (path: string) => {
    setSelectedFilePaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleSelectAllFiles = () => {
    if (!sourceInfo?.files) return;
    if (selectedFilePaths.size === sourceInfo.files.length) {
      setSelectedFilePaths(new Set());
    } else {
      setSelectedFilePaths(new Set(sourceInfo.files.map((f) => f.path)));
    }
  };

  const setPresetUrl = (presetUrl: string, presetName: string) => {
    setTorrentBase64(null);
    setUrl(presetUrl);
    setCustomFilename(presetName);
    handleInspect(presetUrl, "");
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
              Streaming Directo de URL / Torrent a Google Drive
            </h2>
            <p className="text-xs text-[#9ca3af]">
              Soporta URLs HTTP/HTTPS, enlaces Magnet y archivos .torrent multi-archivo. Transfiere directo a cualquier carpeta de tu Google Drive.
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
          Configurar Nueva Transferencia
        </h3>

        <form onSubmit={handleStartStream} className="space-y-4">
          {/* Target Folder Selector */}
          <div className="p-3 bg-[#101317] border border-[#22272e] rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#10b981] flex items-center gap-1.5">
                <FolderOpen className="w-4 h-4" />
                Carpeta Destino en Google Drive:
              </label>
              <button
                type="button"
                onClick={() => setShowCreateFolder(!showCreateFolder)}
                className="text-xs text-[#34d399] hover:underline flex items-center gap-1 font-semibold cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                + Crear Carpeta
              </button>
            </div>

            {showCreateFolder ? (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Nombre de nueva carpeta (ej: Películas / Torrents)"
                  className="flex-1 px-3 py-1.5 bg-[#171b21] border border-[#3b424d] rounded-lg text-xs text-[#f3f4f6] focus:outline-none focus:border-[#10b981]"
                />
                <button
                  type="button"
                  onClick={handleCreateNewFolder}
                  disabled={isCreatingFolder || !newFolderName.trim()}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e] cursor-pointer disabled:opacity-50"
                >
                  {isCreatingFolder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Crear"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateFolder(false)}
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-[#1f242c] text-[#9ca3af] hover:text-[#f3f4f6]"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <select
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
                disabled={isFoldersLoading}
                className="w-full px-3 py-2 bg-[#171b21] border border-[#22272e] rounded-lg text-xs font-mono text-[#f3f4f6] focus:outline-none focus:border-[#10b981] cursor-pointer"
              >
                <option value="root">📁 Mi Unidad (Carpeta Raíz)</option>
                {currentSession?.folder && (
                  <option value={currentSession.folder.id}>
                    ⭐ {currentSession.folder.name} (Carpeta Dedicada)
                  </option>
                )}
                {userFolders
                  .filter((f) => f.id !== currentSession?.folder?.id)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      📂 {f.name}
                    </option>
                  ))}
              </select>
            )}
          </div>

          {/* URL or Torrent Upload */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[#9ca3af] block">
                Origen: Enlace HTTP, Magnet URL o Archivo .torrent:
              </label>
              <label className="text-xs text-[#34d399] hover:underline cursor-pointer flex items-center gap-1">
                <FileUp className="w-3.5 h-3.5" />
                <span>Cargar .torrent</span>
                <input
                  type="file"
                  accept=".torrent"
                  onChange={handleTorrentFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                required={!torrentBase64}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setTorrentBase64(null);
                }}
                placeholder="https://.../iso.iso o magnet:?xt=urn:btih:..."
                className="flex-1 px-3 py-2 bg-[#101317] border border-[#22272e] rounded-lg text-xs font-mono text-[#f3f4f6] placeholder-[#6b7280] focus:outline-none focus:border-[#10b981]"
              />
              <button
                type="button"
                onClick={() => handleInspect()}
                disabled={isInspectLoading || (!url.trim() && !torrentBase64)}
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
            <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] font-mono text-xs space-y-2">
              <div className="flex items-center justify-between font-bold text-[#f3f4f6]">
                <span className="flex items-center gap-1.5">
                  {sourceInfo.sourceType === "torrent" ? (
                    <FileCode className="w-4 h-4 text-[#10b981]" />
                  ) : (
                    <DownloadCloud className="w-4 h-4 text-[#10b981]" />
                  )}
                  {sourceInfo.suggestedFilename}
                </span>
                <span className="text-[#34d399]">
                  {sourceInfo.fileSizeFormatted || formatBytes(sourceInfo.fileSize || 0)}
                </span>
              </div>

              {/* Multi-file Torrent Selector with Hierarchical Folder Tree */}
              {sourceInfo.files && sourceInfo.files.length > 1 && (
                <div className="pt-2 border-t border-[#22272e] space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[#9ca3af]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-[#f3f4f6] flex items-center gap-1 text-xs">
                        <ListFilter className="w-3.5 h-3.5 text-[#10b981]" />
                        Archivos en el Torrent ({sourceInfo.files.length}):
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#064e3b]/30 text-[#34d399] border border-[#059669]/50 flex items-center gap-1">
                        <Folder className="w-3 h-3" />
                        Jerarquía en Drive Activa
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* View Mode Toggle: Tree vs Flat */}
                      <div className="flex items-center bg-[#171b21] p-0.5 rounded border border-[#22272e] text-[10px]">
                        <button
                          type="button"
                          onClick={() => setFileViewMode("tree")}
                          className={`px-2 py-0.5 rounded font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                            fileViewMode === "tree"
                              ? "bg-[#1f242c] text-[#10b981] border border-[#3b424d]"
                              : "text-[#9ca3af] hover:text-[#f3f4f6]"
                          }`}
                        >
                          <Folder className="w-2.5 h-2.5" />
                          <span>Árbol</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setFileViewMode("flat")}
                          className={`px-2 py-0.5 rounded font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                            fileViewMode === "flat"
                              ? "bg-[#1f242c] text-[#10b981] border border-[#3b424d]"
                              : "text-[#9ca3af] hover:text-[#f3f4f6]"
                          }`}
                        >
                          <FileText className="w-2.5 h-2.5" />
                          <span>Lista Plana</span>
                        </button>
                      </div>

                      {fileViewMode === "tree" && folderGroups.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            if (collapsedFolders.size >= folderGroups.length) {
                              setCollapsedFolders(new Set());
                            } else {
                              setCollapsedFolders(new Set(folderGroups.map(([p]) => p)));
                            }
                          }}
                          className="text-[11px] text-[#9ca3af] hover:text-[#f3f4f6] hover:underline cursor-pointer"
                        >
                          {collapsedFolders.size >= folderGroups.length ? "Expandir Carpetas" : "Contraer Carpetas"}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={toggleSelectAllFiles}
                        className="text-[11px] text-[#34d399] hover:underline cursor-pointer"
                      >
                        {selectedFilePaths.size === sourceInfo.files.length ? "Deseleccionar Todos" : "Seleccionar Todos"}
                      </button>
                    </div>
                  </div>

                  {/* Banner explaining Drive folder mirroring */}
                  <div className="p-2 rounded bg-[#101317] border border-[#22272e] text-[11px] text-[#9ca3af] flex items-center gap-2">
                    <Folder className="w-3.5 h-3.5 text-[#10b981] shrink-0" />
                    <span>
                      Las subcarpetas del torrent se crearán automáticamente dentro de tu carpeta seleccionada de Google Drive.
                    </span>
                  </div>

                  {fileViewMode === "tree" ? (
                    /* HIERARCHICAL FOLDER TREE VIEW */
                    <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                      {folderGroups.map(([folderPath, filesInGroup]) => {
                        const isCollapsed = collapsedFolders.has(folderPath);
                        const selectedInGroup = filesInGroup.filter((f) => selectedFilePaths.has(f.path)).length;
                        const allSelected = selectedInGroup === filesInGroup.length;
                        const groupSize = filesInGroup.reduce((sum, f) => sum + f.length, 0);

                        return (
                          <div
                            key={folderPath || "root"}
                            className="bg-[#14171a] border border-[#22272e] rounded-lg overflow-hidden"
                          >
                            {/* Folder Header */}
                            <div className="flex items-center justify-between p-2 bg-[#171b21] hover:bg-[#1a1f26] transition-colors">
                              <div className="flex items-center gap-2 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => toggleCollapseFolder(folderPath)}
                                  className="text-[#9ca3af] hover:text-[#f3f4f6] cursor-pointer p-0.5"
                                >
                                  {isCollapsed ? (
                                    <ChevronRight className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <input
                                  type="checkbox"
                                  checked={allSelected}
                                  onChange={() => toggleSelectFolderFiles(filesInGroup)}
                                  className="accent-[#10b981] rounded cursor-pointer"
                                />
                                <Folder className="w-3.5 h-3.5 text-[#10b981] shrink-0" />
                                <span
                                  onClick={() => toggleCollapseFolder(folderPath)}
                                  className="font-bold text-[#f3f4f6] text-xs truncate cursor-pointer font-mono"
                                  title={folderPath || "Carpeta Principal"}
                                >
                                  {folderPath || "Carpeta Raíz del Torrent"}
                                </span>
                                <span className="text-[10px] text-[#6b7280] font-mono shrink-0">
                                  ({selectedInGroup}/{filesInGroup.length} seleccionados)
                                </span>
                              </div>

                              <span className="text-[10px] font-mono text-[#34d399] shrink-0 pl-2">
                                {formatBytes(groupSize)}
                              </span>
                            </div>

                            {/* Nested Files in Folder */}
                            {!isCollapsed && (
                              <div className="divide-y divide-[#22272e]/50 bg-[#101317] pl-6 pr-2 py-1 space-y-0.5">
                                {filesInGroup.map((file, fIdx) => {
                                  const isSelected = selectedFilePaths.has(file.path);
                                  return (
                                    <div
                                      key={fIdx}
                                      onClick={() => toggleSelectFile(file.path)}
                                      className={`flex items-center justify-between py-1 px-2 rounded cursor-pointer transition-colors ${
                                        isSelected
                                          ? "text-[#f3f4f6] hover:bg-[#1a1f26]"
                                          : "text-[#6b7280] hover:text-[#9ca3af] hover:bg-[#171b21]"
                                      }`}
                                    >
                                      <div className="flex items-center gap-2 truncate pr-2">
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={() => {}}
                                          className="accent-[#10b981] rounded"
                                        />
                                        <FileText className="w-3 h-3 text-[#10b981] shrink-0" />
                                        <span className="truncate text-[11px] font-mono" title={file.path}>
                                          {file.name}
                                        </span>
                                      </div>
                                      <span className="text-[10px] font-mono text-[#34d399] shrink-0">
                                        {formatBytes(file.length)}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* FLAT LIST VIEW WITH PATH BADGES */
                    <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                      {sourceInfo.files.map((file, idx) => {
                        const isSelected = selectedFilePaths.has(file.path);
                        const hasFolder = file.path && file.path.includes("/");
                        const folderPart = hasFolder ? file.path.substring(0, file.path.lastIndexOf("/")) : "";

                        return (
                          <div
                            key={idx}
                            onClick={() => toggleSelectFile(file.path)}
                            className={`flex items-center justify-between p-1.5 rounded cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-[#064e3b]/30 border border-[#059669]/40 text-[#f3f4f6]"
                                : "bg-[#171b21] hover:bg-[#1f242c] text-[#9ca3af]"
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate pr-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {}}
                                className="accent-[#10b981] rounded"
                              />
                              <FileText className="w-3.5 h-3.5 shrink-0 text-[#10b981]" />
                              <div className="truncate flex items-center gap-1.5 min-w-0">
                                {hasFolder && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#1f242c] text-[#10b981] border border-[#3b424d] font-mono shrink-0 flex items-center gap-0.5">
                                    <Folder className="w-2.5 h-2.5" />
                                    <span className="truncate max-w-[120px]">{folderPart}</span>
                                  </span>
                                )}
                                <span className="truncate text-[11px] font-mono" title={file.path}>
                                  {file.name}
                                </span>
                              </div>
                            </div>
                            <span className="text-[10px] font-mono text-[#34d399] shrink-0">
                              {formatBytes(file.length)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
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
              disabled={isStarting || (!url.trim() && !torrentBase64)}
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

      {/* Live Stream / Torrent RAM Pipeline Monitor */}
      {(() => {
        const activeTask =
          tasks.find(
            (t) =>
              t.id === activeTaskId &&
              (t.status === "streaming" || t.status === "initializing" || t.status === "queued")
          ) ||
          tasks.find((t) => t.status === "streaming" || t.status === "initializing");

        if (!activeTask) return null;

        return (
          <div className="bg-[#14171a] border border-[#10b981]/40 rounded-xl p-4 space-y-3 bg-gradient-to-br from-[#064e3b]/25 via-[#14171a] to-[#101317] shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Activity className="w-4 h-4 text-[#10b981] animate-pulse shrink-0" />
                <span className="text-xs font-bold text-[#f3f4f6] truncate">
                  Stream Activo en RAM: {activeTask.fileName}
                </span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-[#10b981]/20 text-[#34d399] border border-[#059669]/50 shrink-0">
                  {activeTask.status}
                </span>
              </div>

              <div className="flex items-center gap-3 text-xs font-mono shrink-0">
                {activeTask.sourceType === "torrent" && (
                  <span className="text-[#34d399] flex items-center gap-1.5 bg-[#101317] px-2.5 py-1 rounded-md border border-[#22272e]">
                    <Download className="w-3.5 h-3.5 text-[#34d399]" />
                    <span>Swarm: {activeTask.torrentSpeedMBs ? `${activeTask.torrentSpeedMBs.toFixed(1)} MB/s` : "0.0 MB/s"}</span>
                    {activeTask.peers !== undefined && (
                      <span className="text-[#9ca3af]">({activeTask.peers} peers)</span>
                    )}
                  </span>
                )}
                <span className="text-[#10b981] flex items-center gap-1.5 bg-[#101317] px-2.5 py-1 rounded-md border border-[#22272e]">
                  <CloudLightning className="w-3.5 h-3.5 text-[#10b981]" />
                  <span>Drive: {activeTask.speedMBs ? `${activeTask.speedMBs.toFixed(1)} MB/s` : "0.0 MB/s"}</span>
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] font-mono text-[#9ca3af]">
                <span>
                  {formatBytes(activeTask.uploadedBytes)} de {formatBytes(activeTask.fileSize)}
                </span>
                <span className="text-[#10b981] font-bold">{activeTask.progressPercent}%</span>
              </div>
              <div className="w-full bg-[#101317] h-2 rounded-full overflow-hidden border border-[#22272e]">
                <div
                  className="bg-[#10b981] h-full transition-all duration-300 rounded-full"
                  style={{ width: `${Math.min(100, activeTask.progressPercent)}%` }}
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* Unified Jobs List */}
      <UnifiedJobList
        session={propSession}
        accessToken={accessToken}
        folderId={selectedFolderId || propFolderId}
        folderName={_folderName}
        onOpenConnectModal={onOpenCookieModal}
      />
    </div>
  );
};
