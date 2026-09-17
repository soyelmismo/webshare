import React, { useState, useEffect } from "react";
import {
  Folder,
  File,
  HardDrive,
  RefreshCw,
  Trash2,
  Download,
  Upload,
  ArrowRight,
  ArrowLeft,
  Search,
  Plus,
  Loader2,
  FolderPlus,
  CloudDownload,
  CheckCircle2,
  AlertCircle,
  FileText,
  FileArchive,
  FileCode,
  FileImage,
  Film,
  Music,
} from "lucide-react";
import { StoredDriveSession, loadDriveSession, onDriveSessionChange } from "../utils/driveStorage";
import { DriveFile } from "../types";
import { listFilesInDedicatedFolder, deleteDriveFile } from "../utils/googleDriveApi";

interface LocalFileItem {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  modifiedTime: string;
}

interface FileCommanderProps {
  session?: StoredDriveSession;
  accessToken: string | null;
  onOpenCookieModal: () => void;
}

export const FileCommander: React.FC<FileCommanderProps> = ({
  session: propSession,
  accessToken: propToken,
  onOpenCookieModal,
}) => {
  const [driveSession, setDriveSession] = useState<StoredDriveSession>(() => propSession || loadDriveSession());

  useEffect(() => {
    if (propSession) {
      setDriveSession(propSession);
    }
  }, [propSession]);

  useEffect(() => {
    const unsubscribe = onDriveSessionChange((updated) => {
      setDriveSession(updated);
    });
    return () => unsubscribe();
  }, []);

  const session = driveSession;
  // Left pane: Local Server Storage
  const [localPath, setLocalPath] = useState("/tmp");
  const [localFiles, setLocalFiles] = useState<LocalFileItem[]>([]);
  const [selectedLocal, setSelectedLocal] = useState<string | null>(null);
  const [isLocalLoading, setIsLocalLoading] = useState(false);
  const [localSearch, setLocalSearch] = useState("");

  // Right pane: Google Drive
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<string | null>(null);
  const [isDriveLoading, setIsDriveLoading] = useState(false);
  const [driveSearch, setDriveSearch] = useState("");

  // Operation states
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);

  const activeToken = propToken || session?.token || null;
  const hasToken = Boolean(activeToken);

  // Fetch local files
  const fetchLocalFiles = async (dirPath: string) => {
    setIsLocalLoading(true);
    try {
      const res = await fetch(`/api/fs/list?dir=${encodeURIComponent(dirPath)}`);
      if (res.ok) {
        const data = await res.json();
        setLocalFiles(data.files || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLocalLoading(false);
    }
  };

  // Fetch drive files
  const fetchDriveFiles = async () => {
    const token = activeToken;
    if (!token) return;
    setIsDriveLoading(true);
    try {
      const files = await listFilesInDedicatedFolder(token, session?.folder?.id || session?.activeAccount?.folder?.id);
      setDriveFiles(files);
    } catch (e) {
      console.error(e);
    } finally {
      setIsDriveLoading(false);
    }
  };

  useEffect(() => {
    fetchLocalFiles(localPath);
  }, [localPath]);

  useEffect(() => {
    if (hasToken) {
      fetchDriveFiles();
    }
  }, [hasToken, session?.folder?.id, session?.activeAccount?.folder?.id]);

  const handleUploadSelectedToDrive = async () => {
    if (!selectedLocal) return;
    const token = activeToken;
    if (!token) {
      onOpenCookieModal();
      return;
    }

    setIsTransferring(true);
    setActionStatus(`Subiendo ${selectedLocal} a Google Drive...`);
    try {
      const res = await fetch("/api/fs/upload-to-drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: selectedLocal,
          accessToken: token,
          folderId: session?.dedicatedFolderId || session?.folder?.id || session?.activeAccount?.folder?.id || "root",
        }),
      });
      if (res.ok) {
        setActionStatus("¡Archivo subido exitosamente a Google Drive!");
        fetchDriveFiles();
      } else {
        const err = await res.json();
        setActionStatus(`Error al subir: ${err.error || "Fallo en transferencia"}`);
      }
    } catch (e: any) {
      setActionStatus(`Error: ${e.message}`);
    } finally {
      setIsTransferring(false);
    }
  };

  const handleDeleteLocal = async () => {
    if (!selectedLocal) return;
    if (!confirm(`¿Eliminar ${selectedLocal} del servidor?`)) return;

    try {
      const res = await fetch("/api/fs/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: selectedLocal }),
      });
      if (res.ok) {
        fetchLocalFiles(localPath);
        setSelectedLocal(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const getFileIcon = (filename: string, isDir: boolean) => {
    if (isDir) return <Folder className="w-3.5 h-3.5 text-[#10b981]" />;
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    if (["iso", "zip", "tar", "gz", "7z", "rar"].includes(ext)) {
      return <FileArchive className="w-3.5 h-3.5 text-[#f59e0b]" />;
    }
    if (["mp4", "mkv", "avi", "mov"].includes(ext)) {
      return <Film className="w-3.5 h-3.5 text-[#60a5fa]" />;
    }
    if (["mp3", "flac", "wav", "aac"].includes(ext)) {
      return <Music className="w-3.5 h-3.5 text-[#34d399]" />;
    }
    if (["ts", "js", "json", "py", "sh", "html", "css"].includes(ext)) {
      return <FileCode className="w-3.5 h-3.5 text-[#f3f4f6]" />;
    }
    return <FileText className="w-3.5 h-3.5 text-[#9ca3af]" />;
  };

  const filteredLocal = localFiles.filter((f) =>
    f.name.toLowerCase().includes(localSearch.toLowerCase())
  );
  const filteredDrive = driveFiles.filter((f) =>
    f.name.toLowerCase().includes(driveSearch.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-[#1f242c] border border-[#3b424d] text-[#10b981] shrink-0">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#f3f4f6]">
              File Commander de Doble Panel (Servidor ⟷ Google Drive)
            </h2>
            <p className="text-xs text-[#9ca3af]">
              Explora y gestiona archivos locales del host en el panel izquierdo y sincroniza directamente con tu almacenamiento de Google Drive en el derecho.
            </p>
          </div>
        </div>

        {/* Transfer Action Bar */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleUploadSelectedToDrive}
            disabled={!selectedLocal || isTransferring}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e] transition-colors cursor-pointer disabled:opacity-40"
          >
            {isTransferring ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ArrowRight className="w-3.5 h-3.5" />
            )}
            <span>Copiar a Drive ➔</span>
          </button>

          <button
            onClick={handleDeleteLocal}
            disabled={!selectedLocal}
            className="p-1.5 rounded-lg bg-[#1f242c] hover:bg-[#7f1d1d]/40 text-[#f87171] border border-[#3b424d] hover:border-[#ef4444]/50 transition-colors cursor-pointer disabled:opacity-40"
            title="Eliminar archivo local seleccionado"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Action Notification Status */}
      {actionStatus && (
        <div className="p-2.5 rounded-lg bg-[#101317] border border-[#22272e] text-xs font-mono text-[#34d399] flex items-center justify-between">
          <span>{actionStatus}</span>
          <button
            onClick={() => setActionStatus(null)}
            className="text-[#9ca3af] hover:text-[#f3f4f6] font-bold cursor-pointer"
          >
            [X]
          </button>
        </div>
      )}

      {/* Dual Panes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Left Pane: Local Server FS */}
        <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-3.5 space-y-3 flex flex-col h-[520px]">
          <div className="flex items-center justify-between border-b border-[#22272e] pb-2">
            <div className="flex items-center gap-2 min-w-0">
              <HardDrive className="w-4 h-4 text-[#10b981] shrink-0" />
              <span className="text-xs font-bold text-[#f3f4f6] uppercase">Servidor Local:</span>
              <span className="text-xs font-mono text-[#9ca3af] truncate">{localPath}</span>
            </div>
            <button
              onClick={() => fetchLocalFiles(localPath)}
              className="p-1 rounded-lg bg-[#1f242c] hover:bg-[#262b32] text-[#f3f4f6] border border-[#3b424d] text-xs transition-colors cursor-pointer shrink-0"
              title="Refrescar"
            >
              <RefreshCw className={`w-3 h-3 ${isLocalLoading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Quick folder buttons & search */}
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <button
              onClick={() => setLocalPath("/tmp")}
              className={`px-2 py-0.5 rounded-md border text-[11px] cursor-pointer ${
                localPath === "/tmp"
                  ? "bg-[#10b981] text-[#0b0d0e] border-[#10b981] font-bold"
                  : "bg-[#1f242c] text-[#9ca3af] border-[#3b424d] hover:text-[#f3f4f6]"
              }`}
            >
              /tmp
            </button>
            <button
              onClick={() => setLocalPath("/tmp/downloads")}
              className={`px-2 py-0.5 rounded-md border text-[11px] cursor-pointer ${
                localPath === "/tmp/downloads"
                  ? "bg-[#10b981] text-[#0b0d0e] border-[#10b981] font-bold"
                  : "bg-[#1f242c] text-[#9ca3af] border-[#3b424d] hover:text-[#f3f4f6]"
              }`}
            >
              /tmp/downloads
            </button>
            <input
              type="text"
              placeholder="Buscar..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="flex-1 px-2 py-0.5 bg-[#101317] border border-[#22272e] rounded-md text-[11px] text-[#f3f4f6] placeholder-[#6b7280] focus:outline-none focus:border-[#10b981]"
            />
          </div>

          {/* Files List */}
          <div className="flex-1 overflow-y-auto rounded-lg border border-[#22272e]">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#1f242c] text-[#9ca3af] uppercase tracking-wider font-sans border-b border-[#22272e] sticky top-0">
                <tr>
                  <th className="p-2 font-bold">Nombre</th>
                  <th className="p-2 font-bold text-right">Tamaño</th>
                  <th className="p-2 font-bold text-right">Modificado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#22272e] bg-[#101317]">
                {filteredLocal.map((file) => {
                  const isSelected = selectedLocal === file.path;
                  return (
                    <tr
                      key={file.path}
                      onClick={() => setSelectedLocal(file.path)}
                      className={`hover:bg-[#161a1f] cursor-pointer transition-colors ${
                        isSelected ? "bg-[#1f242c] font-semibold" : ""
                      }`}
                    >
                      <td className="p-2 flex items-center gap-1.5 truncate max-w-[200px]">
                        {getFileIcon(file.name, file.isDirectory)}
                        <span className="truncate text-[#f3f4f6]">{file.name}</span>
                      </td>
                      <td className="p-2 text-right text-[#9ca3af]">
                        {file.isDirectory
                          ? "<DIR>"
                          : `${(file.size / (1024 * 1024)).toFixed(2)} MB`}
                      </td>
                      <td className="p-2 text-right text-[#6b7280] text-[10px]">
                        {new Date(file.modifiedTime).toLocaleTimeString()}
                      </td>
                    </tr>
                  );
                })}
                {filteredLocal.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-xs text-[#6b7280]">
                      No hay archivos en este directorio local.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Footer Info */}
          <div className="text-[11px] font-mono text-[#9ca3af] flex justify-between pt-1 border-t border-[#22272e]">
            <span>{filteredLocal.length} elementos</span>
            <span>Seleccionado: <strong className="text-[#f3f4f6]">{selectedLocal ? selectedLocal.split("/").pop() : "Ninguno"}</strong></span>
          </div>
        </div>

        {/* Right Pane: Google Drive */}
        <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-3.5 space-y-3 flex flex-col h-[520px]">
          <div className="flex items-center justify-between border-b border-[#22272e] pb-2">
            <div className="flex items-center gap-2 min-w-0">
              <CloudDownload className="w-4 h-4 text-[#10b981] shrink-0" />
              <span className="text-xs font-bold text-[#f3f4f6] uppercase">Google Drive:</span>
              <span className="text-xs font-mono text-[#9ca3af] truncate">
                {session?.user?.email || session?.activeAccount?.email || "No vinculado"}
              </span>
            </div>
            <button
              onClick={fetchDriveFiles}
              disabled={!hasToken}
              className="p-1 rounded-lg bg-[#1f242c] hover:bg-[#262b32] text-[#f3f4f6] border border-[#3b424d] text-xs transition-colors cursor-pointer shrink-0 disabled:opacity-40"
              title="Refrescar"
            >
              <RefreshCw className={`w-3 h-3 ${isDriveLoading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Search bar & status */}
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <input
              type="text"
              placeholder="Buscar en Google Drive..."
              value={driveSearch}
              onChange={(e) => setDriveSearch(e.target.value)}
              disabled={!hasToken}
              className="flex-1 px-2 py-0.5 bg-[#101317] border border-[#22272e] rounded-md text-[11px] text-[#f3f4f6] placeholder-[#6b7280] focus:outline-none focus:border-[#10b981] disabled:opacity-40"
            />
            {!hasToken && (
              <button
                onClick={onOpenCookieModal}
                className="px-2 py-0.5 rounded-md bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e] text-[11px] font-bold cursor-pointer whitespace-nowrap"
              >
                Conectar
              </button>
            )}
          </div>

          {/* Files List */}
          <div className="flex-1 overflow-y-auto rounded-lg border border-[#22272e]">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#1f242c] text-[#9ca3af] uppercase tracking-wider font-sans border-b border-[#22272e] sticky top-0">
                <tr>
                  <th className="p-2 font-bold">Nombre</th>
                  <th className="p-2 font-bold text-right">Tamaño</th>
                  <th className="p-2 font-bold text-right">Modificado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#22272e] bg-[#101317]">
                {hasToken ? (
                  filteredDrive.map((file) => {
                    const isSelected = selectedDrive === file.id;
                    return (
                      <tr
                        key={file.id}
                        onClick={() => setSelectedDrive(file.id)}
                        className={`hover:bg-[#161a1f] cursor-pointer transition-colors ${
                          isSelected ? "bg-[#1f242c] font-semibold" : ""
                        }`}
                      >
                        <td className="p-2 flex items-center gap-1.5 truncate max-w-[200px]">
                          {getFileIcon(file.name, false)}
                          <span className="truncate text-[#f3f4f6]">{file.name}</span>
                        </td>
                        <td className="p-2 text-right text-[#9ca3af]">
                          {file.size
                            ? `${(Number(file.size) / (1024 * 1024)).toFixed(2)} MB`
                            : "--"}
                        </td>
                        <td className="p-2 text-right text-[#6b7280] text-[10px]">
                          {file.modifiedTime
                            ? new Date(file.modifiedTime).toLocaleTimeString()
                            : "--"}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-xs text-[#9ca3af] space-y-2">
                      <p>Conecta tu cuenta de Google Drive para explorar tus archivos.</p>
                      <button
                        onClick={onOpenCookieModal}
                        className="px-3 py-1 rounded-lg bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e] text-xs font-bold cursor-pointer"
                      >
                        Vincular Cuenta
                      </button>
                    </td>
                  </tr>
                )}
                {hasToken && filteredDrive.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-xs text-[#6b7280]">
                      Carpeta dedicada vacía en Google Drive.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Footer Info */}
          <div className="text-[11px] font-mono text-[#9ca3af] flex justify-between pt-1 border-t border-[#22272e]">
            <span>{hasToken ? `${filteredDrive.length} archivos` : "Desconectado"}</span>
            <span>Seleccionado: <strong className="text-[#f3f4f6]">{selectedDrive ? "1 elemento" : "Ninguno"}</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
};
