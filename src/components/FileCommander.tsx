import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  HardDrive,
  Cloud,
  Folder,
  FolderPlus,
  FolderOpen,
  ArrowRight,
  ArrowLeft,
  Trash2,
  Download,
  Upload,
  RefreshCw,
  Search,
  ExternalLink,
  CheckSquare,
  Square,
  Check,
  X,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Eye,
  Edit2,
  Columns2,
  ChevronRight,
  ChevronDown,
  FileText,
  FileArchive,
  FileCode,
  Image as ImageIcon,
  File,
  Zap,
  Users,
  UserPlus,
  LogOut,
  Sparkles,
  Layers,
  ArrowUpRight,
  MoveRight,
} from "lucide-react";
import { User } from "firebase/auth";
import {
  ServerFileItem,
  ServerFsListResponse,
  TransferTask,
  DriveFile,
  DriveFolderInfo,
  ServerSpecs,
  SavedGoogleAccount,
} from "../types";
import {
  fetchServerFiles,
  deleteServerFiles,
  renameServerFile,
  transferServerToDrive,
  fetchActiveTransfers,
  copyFromDriveToServer,
} from "../utils/fileCommanderApi";
import {
  initAuth,
  googleSignIn,
  logout,
  switchGoogleAccount,
} from "../utils/firebaseAuth";
import {
  loadDriveSession,
  saveDriveSession,
  StoredDriveSession,
  updateAccountFolder,
  onDriveSessionExpired,
} from "../utils/driveStorage";
import {
  DEFAULT_FOLDER_NAME,
  getOrCreateDedicatedFolder,
  listFilesInFolder,
  deleteFileFromDrive,
  downloadFileFromDrive,
  listUserFolders,
  createDriveFolder,
} from "../utils/googleDriveApi";
import { GoogleIcon } from "./GoogleIcon";
import { DriveDeleteModal } from "./DriveDeleteModal";

interface FileCommanderProps {
  serverSpecs?: ServerSpecs | null;
  onNavigateToStream?: () => void;
}

export const FileCommander: React.FC<FileCommanderProps> = ({
  serverSpecs,
  onNavigateToStream,
}) => {
  // Session & Auth state
  const [driveSession, setDriveSession] = useState<StoredDriveSession>(() => loadDriveSession());
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const s = loadDriveSession();
    if (s.token && s.user) {
      return {
        uid: s.user.uid || "google-user",
        displayName: s.user.displayName,
        email: s.user.email,
        photoURL: s.user.photoURL,
      } as unknown as User;
    }
    return null;
  });
  const [accessToken, setAccessToken] = useState<string | null>(() => {
    return loadDriveSession().token;
  });
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSessionExpired, setIsSessionExpired] = useState<boolean>(() => {
    return loadDriveSession().isExpired;
  });
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const unsub = onDriveSessionExpired((reason) => {
      setIsSessionExpired(true);
      setTransferErrorMsg(
        reason ||
          "Tu sesión de Google Drive ha expirado (límite de seguridad de 1 hora de Google). Haz clic en 'Reconectar con Google' para renovar tu acceso."
      );
    });
    return unsub;
  }, []);

  // Target Drive Folder state
  const [targetFolder, setTargetFolder] = useState<DriveFolderInfo | null>(() => {
    return loadDriveSession().folder;
  });
  const [availableFolders, setAvailableFolders] = useState<DriveFolderInfo[]>([]);
  const [isFolderMenuOpen, setIsFolderMenuOpen] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderNameInput, setNewFolderNameInput] = useState("");
  const [isCreatingFolderLoading, setIsCreatingFolderLoading] = useState(false);
  const folderMenuRef = useRef<HTMLDivElement | null>(null);

  // Left Pane: Server Filesystem State
  const [currentServerDir, setCurrentServerDir] = useState<string>("/tmp/zero_disk_downloads");
  const [serverBasePaths, setServerBasePaths] = useState<Array<{ name: string; path: string }>>([]);
  const [serverFiles, setServerFiles] = useState<ServerFileItem[]>([]);
  const [isServerLoading, setIsServerLoading] = useState(true);
  const [serverSearch, setServerSearch] = useState("");
  const [serverViewMode, setServerViewMode] = useState<"tree" | "flat">("flat");
  const [selectedServerPaths, setSelectedServerPaths] = useState<Set<string>>(new Set());
  const [serverDiskStats, setServerDiskStats] = useState<{
    usedInDownloads: number;
    usedInDownloadsFormatted: string;
    totalFiles: number;
  }>({ usedInDownloads: 0, usedInDownloadsFormatted: "0 B", totalFiles: 0 });

  // Right Pane: Google Drive Files State
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [isDriveLoading, setIsDriveLoading] = useState(false);
  const [driveSearch, setDriveSearch] = useState("");
  const [selectedDriveFileIds, setSelectedDriveFileIds] = useState<Set<string>>(new Set());

  // Transfers & Operations State
  const [activeTransfers, setActiveTransfers] = useState<TransferTask[]>([]);
  const [transferSuccessMsg, setTransferSuccessMsg] = useState<string | null>(null);
  const [transferErrorMsg, setTransferErrorMsg] = useState<string | null>(null);

  // Modals & Confirmation States
  const [isServerDeleteModalOpen, setIsServerDeleteModalOpen] = useState(false);
  const [isDeletingServer, setIsDeletingServer] = useState(false);
  const [serverFileToRename, setServerFileToRename] = useState<ServerFileItem | null>(null);
  const [renameInputVal, setRenameInputVal] = useState("");
  const [isRenamingServer, setIsRenamingServer] = useState(false);

  // Drive Delete Modal
  const [driveFileToDelete, setDriveFileToDelete] = useState<DriveFile | null>(null);
  const [isDriveDeleteModalOpen, setIsDriveDeleteModalOpen] = useState(false);
  const [isDeletingDrive, setIsDeletingDrive] = useState(false);

  // Close dropdowns on click outside
  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setIsAccountMenuOpen(false);
      }
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
        setIsFolderMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleDocClick);
    return () => document.removeEventListener("mousedown", handleDocClick);
  }, []);

  // Auth listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setCurrentUser(user);
        setAccessToken(token);
        setDriveSession(loadDriveSession());
      },
      () => {
        const stored = loadDriveSession();
        if (stored.token && stored.user) {
          setAccessToken(stored.token);
          setDriveSession(stored);
        } else {
          setCurrentUser(null);
          setAccessToken(null);
          setDriveSession(stored);
        }
      }
    );
    return () => unsubscribe();
  }, []);

  // Load Server Files
  const loadServerFiles = useCallback(async () => {
    setIsServerLoading(true);
    try {
      const data = await fetchServerFiles(
        serverViewMode === "flat" ? "/tmp/zero_disk_downloads" : currentServerDir,
        serverViewMode === "flat"
      );
      setServerFiles(data.files);
      setServerBasePaths(data.basePaths);
      setServerDiskStats(data.diskStats);
      if (serverViewMode === "tree") {
        setCurrentServerDir(data.currentPath);
      }
    } catch (err: any) {
      console.error("Error loading server files:", err);
      setTransferErrorMsg(`Error al leer almacenamiento del servidor: ${err.message}`);
    } finally {
      setIsServerLoading(false);
    }
  }, [currentServerDir, serverViewMode]);

  useEffect(() => {
    loadServerFiles();
  }, [loadServerFiles]);

  // Load Google Drive folder & files
  const loadDriveFiles = useCallback(async () => {
    if (!currentUser || !accessToken) return;
    const session = loadDriveSession();
    if (session.isExpired) {
      setIsSessionExpired(true);
      setTransferErrorMsg(
        "Tu sesión de Google Drive ha expirado (límite de seguridad de 1 hora de Google). Haz clic en 'Reconectar con Google' para renovar tu acceso."
      );
      return;
    }

    setIsDriveLoading(true);
    try {
      let folder = targetFolder;
      if (!folder) {
        folder = await getOrCreateDedicatedFolder(accessToken, DEFAULT_FOLDER_NAME);
        setTargetFolder(folder);
        updateAccountFolder(currentUser.email || "", folder);
      }

      const fileList = await listFilesInFolder(accessToken, folder.id);
      setDriveFiles(fileList);
      setIsSessionExpired(false);

      // Also list available folders for quick switching
      listUserFolders(accessToken)
        .then((folders) => setAvailableFolders(folders))
        .catch(() => {});
    } catch (err: any) {
      const errMsg = err?.message || "";
      const isAuth =
        err?.isAuthError ||
        errMsg.includes("401") ||
        errMsg.includes("UNAUTHENTICATED") ||
        errMsg.includes("Invalid Credentials") ||
        errMsg.includes("authError");

      if (isAuth) {
        setIsSessionExpired(true);
        setTransferErrorMsg(
          "Tu sesión de Google Drive ha expirado (límite de seguridad de 1 hora de Google). Haz clic en 'Reconectar con Google' para renovar tu acceso."
        );
      } else {
        console.warn("Error loading Drive files:", err);
        setTransferErrorMsg(`Error al conectar con Google Drive: ${err.message}`);
      }
    } finally {
      setIsDriveLoading(false);
    }
  }, [currentUser, accessToken, targetFolder]);

  useEffect(() => {
    if (currentUser && accessToken) {
      loadDriveFiles();
    }
  }, [currentUser, accessToken, targetFolder, loadDriveFiles]);

  // Periodic active transfers polling
  useEffect(() => {
    const pollTransfers = async () => {
      try {
        const transfers = await fetchActiveTransfers();
        setActiveTransfers(transfers);

        const hasActive = transfers.some(
          (t) => t.status === "transferring" || t.status === "queued"
        );

        // If any transfer just completed, refresh file lists
        const justFinished = transfers.find(
          (t) =>
            t.status === "completed" &&
            Date.now() - (t.completedAt || 0) < 3000
        );
        if (justFinished) {
          loadServerFiles();
          if (currentUser && accessToken) loadDriveFiles();
        }

        return hasActive;
      } catch {
        return false;
      }
    };

    pollTransfers();
    const interval = setInterval(async () => {
      const active = await pollTransfers();
      if (!active) {
        // slow down polling if no active transfers
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [currentUser, accessToken, loadServerFiles, loadDriveFiles]);

  // Google Sign In Handler
  const handleSignIn = async () => {
    setIsSigningIn(true);
    setTransferErrorMsg(null);
    try {
      const res = await googleSignIn(false);
      if (res) {
        setCurrentUser(res.user);
        setAccessToken(res.accessToken);
        setIsSessionExpired(false);
        setDriveSession(loadDriveSession());
      }
    } catch (err: any) {
      console.error(err);
      setTransferErrorMsg(`Error al iniciar sesión con Google: ${err.message}`);
    } finally {
      setIsSigningIn(false);
    }
  };

  // Google Account Switcher
  const handleSwitchAccount = (account: SavedGoogleAccount) => {
    const switched = switchGoogleAccount(account.id);
    if (switched) {
      setDriveSession(loadDriveSession());
      setCurrentUser(switched.user);
      setAccessToken(switched.token);
      setTargetFolder(switched.account.folder || null);
      setSelectedDriveFileIds(new Set());
      setIsAccountMenuOpen(false);
    }
  };

  // Switch Drive Folder
  const handleSelectDriveFolder = (folder: DriveFolderInfo) => {
    setTargetFolder(folder);
    if (currentUser?.email) {
      updateAccountFolder(currentUser.email, folder);
    }
    setIsFolderMenuOpen(false);
    setSelectedDriveFileIds(new Set());
  };

  // Create new folder in Drive
  const handleCreateNewDriveFolder = async () => {
    if (!accessToken || !newFolderNameInput.trim()) return;
    setIsCreatingFolderLoading(true);
    try {
      const created = await createDriveFolder(accessToken, newFolderNameInput.trim());
      setAvailableFolders((prev) => [created, ...prev]);
      setTargetFolder(created);
      if (currentUser?.email) {
        updateAccountFolder(currentUser.email, created);
      }
      setIsCreatingFolder(false);
      setNewFolderNameInput("");
      setTransferSuccessMsg(`Carpeta "${created.name}" creada en Google Drive.`);
    } catch (err: any) {
      setTransferErrorMsg(`Error al crear carpeta en Drive: ${err.message}`);
    } finally {
      setIsCreatingFolderLoading(false);
    }
  };

  // Selection helpers: Server
  const toggleSelectServerFile = (path: string) => {
    setSelectedServerPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectAllServerFiles = () => {
    if (selectedServerPaths.size === filteredServerFiles.length) {
      setSelectedServerPaths(new Set());
    } else {
      setSelectedServerPaths(new Set(filteredServerFiles.map((f) => f.path)));
    }
  };

  // Selection helpers: Drive
  const toggleSelectDriveFile = (id: string) => {
    setSelectedDriveFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllDriveFiles = () => {
    if (selectedDriveFileIds.size === filteredDriveFiles.length) {
      setSelectedDriveFileIds(new Set());
    } else {
      setSelectedDriveFileIds(new Set(filteredDriveFiles.map((f) => f.id)));
    }
  };

  // TRANSFER ACTION: Copy/Move selected Server files to Drive
  const handleTransferServerToDrive = async (mode: "copy" | "move") => {
    if (!currentUser || !accessToken || !targetFolder) {
      setTransferErrorMsg("Conecta una cuenta de Google Drive para transferir archivos.");
      return;
    }

    const pathsToTransfer = Array.from<string>(selectedServerPaths);
    if (pathsToTransfer.length === 0) {
      setTransferErrorMsg("Selecciona al menos un archivo del servidor para transferir.");
      return;
    }

    setTransferErrorMsg(null);
    setTransferSuccessMsg(
      `${mode === "move" ? "Moviendo" : "Copiando"} ${pathsToTransfer.length} archivo(s) a Google Drive (${targetFolder.name})...`
    );

    for (const filePath of pathsToTransfer) {
      const fileItem = serverFiles.find((f) => f.path === filePath);
      const name = fileItem ? fileItem.name : undefined;

      try {
        await transferServerToDrive(filePath, name || "", accessToken, targetFolder.id, mode);
      } catch (err: any) {
        setTransferErrorMsg(`Error al iniciar transferencia de ${name || filePath}: ${err.message}`);
      }
    }

    setSelectedServerPaths(new Set());
  };

  // TRANSFER ACTION: Copy selected Drive file down to Server
  const handleCopyDriveToServer = async () => {
    if (!accessToken) {
      setTransferErrorMsg("Se requiere conexión a Google Drive.");
      return;
    }

    const ids = Array.from<string>(selectedDriveFileIds);
    if (ids.length === 0) {
      setTransferErrorMsg("Selecciona al menos un archivo en Google Drive para transferir al servidor.");
      return;
    }

    setTransferErrorMsg(null);
    setTransferSuccessMsg(`Descargando ${ids.length} archivo(s) de Drive hacia el servidor...`);

    for (const id of ids) {
      const df = driveFiles.find((f) => f.id === id);
      if (!df) continue;

      try {
        await copyFromDriveToServer(id, df.name, accessToken, "/tmp/zero_disk_downloads");
      } catch (err: any) {
        setTransferErrorMsg(`Error al transferir ${df.name} al servidor: ${err.message}`);
      }
    }

    setSelectedDriveFileIds(new Set());
  };

  // DELETE ACTION: Delete selected server files
  const handleConfirmServerDelete = async () => {
    const paths = Array.from<string>(selectedServerPaths);
    if (paths.length === 0) return;

    setIsDeletingServer(true);
    setTransferErrorMsg(null);
    try {
      const res = await deleteServerFiles(paths);
      if (res.deletedCount > 0) {
        setTransferSuccessMsg(
          `Se eliminaron ${res.deletedCount} elemento(s) del disco del servidor y se liberó espacio.`
        );
      }
      if (res.errors && res.errors.length > 0) {
        setTransferErrorMsg(res.errors.join(", "));
      }
      setSelectedServerPaths(new Set());
      setIsServerDeleteModalOpen(false);
      await loadServerFiles();
    } catch (err: any) {
      setTransferErrorMsg(`Error al eliminar del servidor: ${err.message}`);
    } finally {
      setIsDeletingServer(false);
    }
  };

  // RENAME ACTION: Server file
  const handleConfirmServerRename = async () => {
    if (!serverFileToRename || !renameInputVal.trim()) return;

    setIsRenamingServer(true);
    setTransferErrorMsg(null);
    try {
      await renameServerFile(serverFileToRename.path, renameInputVal.trim());
      setTransferSuccessMsg(`Archivo renombrado exitosamente a "${renameInputVal.trim()}".`);
      setServerFileToRename(null);
      setRenameInputVal("");
      await loadServerFiles();
    } catch (err: any) {
      setTransferErrorMsg(`Error al renombrar: ${err.message}`);
    } finally {
      setIsRenamingServer(false);
    }
  };

  // DOWNLOAD TO BROWSER ACTION: Server file
  const handleDownloadServerFileToBrowser = (path: string) => {
    const downloadUrl = `/api/fs/server/download-file?path=${encodeURIComponent(path)}`;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // DOWNLOAD TO BROWSER ACTION: Drive file
  const handleDownloadDriveFileToBrowser = async (file: DriveFile) => {
    if (!accessToken) return;
    try {
      setTransferSuccessMsg(`Descargando "${file.name}" a tu equipo local...`);
      const blob = await downloadFileFromDrive(accessToken, file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setTransferErrorMsg(`Error al descargar ${file.name}: ${err.message}`);
    }
  };

  // DELETE ACTION: Google Drive file
  const handleConfirmDriveDelete = async () => {
    if (!driveFileToDelete || !accessToken) return;
    setIsDeletingDrive(true);
    setTransferErrorMsg(null);
    try {
      await deleteFileFromDrive(accessToken, driveFileToDelete.id);
      setTransferSuccessMsg(`"${driveFileToDelete.name}" eliminado de Google Drive.`);
      setDriveFiles((prev) => prev.filter((f) => f.id !== driveFileToDelete.id));
      setSelectedDriveFileIds((prev) => {
        const next = new Set(prev);
        next.delete(driveFileToDelete.id);
        return next;
      });
      setIsDriveDeleteModalOpen(false);
      setDriveFileToDelete(null);
    } catch (err: any) {
      setTransferErrorMsg(`Error al eliminar de Drive: ${err.message}`);
    } finally {
      setIsDeletingDrive(false);
    }
  };

  // Formatters & icon helpers
  const getFileIcon = (fileName: string, isDirectory?: boolean) => {
    if (isDirectory) {
      return <Folder className="w-4 h-4 text-amber-400 shrink-0" />;
    }
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    if (["iso", "img", "bin", "dmg"].includes(ext)) {
      return <HardDrive className="w-4 h-4 text-emerald-400 shrink-0" />;
    }
    if (["zip", "tar", "gz", "rar", "7z", "bz2", "xz"].includes(ext)) {
      return <FileArchive className="w-4 h-4 text-purple-400 shrink-0" />;
    }
    if (["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(ext)) {
      return <ImageIcon className="w-4 h-4 text-sky-400 shrink-0" />;
    }
    if (["json", "js", "ts", "py", "sh", "html", "css"].includes(ext)) {
      return <FileCode className="w-4 h-4 text-amber-300 shrink-0" />;
    }
    if (["txt", "log", "md", "pdf"].includes(ext)) {
      return <FileText className="w-4 h-4 text-slate-300 shrink-0" />;
    }
    return <File className="w-4 h-4 text-indigo-400 shrink-0" />;
  };

  const formatDate = (timestamp?: number | string) => {
    if (!timestamp) return "-";
    const d = new Date(typeof timestamp === "string" ? timestamp : timestamp);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleString("es-ES", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Filtered lists
  const filteredServerFiles = serverFiles.filter((f) =>
    f.name.toLowerCase().includes(serverSearch.toLowerCase())
  );

  const filteredDriveFiles = driveFiles.filter((f) =>
    f.name.toLowerCase().includes(driveSearch.toLowerCase())
  );

  // Total size selected on server
  const selectedServerBytes = serverFiles
    .filter((f) => selectedServerPaths.has(f.path))
    .reduce((acc, f) => acc + f.size, 0);

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const activeTransferTask = activeTransfers.find((t) => t.status === "transferring");

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* 1. Header Banner: Commander Overview & Storage Status */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-52 h-52 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-sky-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-lg shadow-indigo-950/50 shrink-0">
              <Columns2 className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-white tracking-tight">
                  File Commander • Servidor ⇄ Google Drive
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-mono">
                  Dual-Pane Manager
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono flex items-center gap-1">
                  <HardDrive className="w-3 h-3 text-emerald-400" />
                  Descargas Servidor: {serverDiskStats.usedInDownloadsFormatted}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                Administra, visualiza y borra archivos descargados en el servidor local a la izquierda, y transfiere, mueve o copia directamente a tu carpeta seleccionada de Google Drive a la derecha.
              </p>
            </div>
          </div>

          {/* Account Selector & Target Folder Switcher */}
          <div className="flex items-center gap-2.5 self-end md:self-auto flex-wrap justify-end">
            {currentUser ? (
              <div className="relative" ref={accountMenuRef}>
                <button
                  onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)}
                  className="flex items-center gap-2.5 bg-slate-950/90 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/50 rounded-xl px-3 py-1.5 transition-all cursor-pointer shadow-md"
                  title="Cambiar o gestionar cuentas de Google"
                >
                  {currentUser.photoURL ? (
                    <img
                      src={currentUser.photoURL}
                      alt={currentUser.displayName || "Google"}
                      className="w-6 h-6 rounded-full border border-indigo-400/40 object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-xs font-bold text-indigo-300">
                      {currentUser.displayName ? currentUser.displayName[0].toUpperCase() : "G"}
                    </div>
                  )}
                  <div className="text-left hidden sm:block">
                    <p className="text-xs font-semibold text-white leading-none truncate max-w-[120px]">
                      {currentUser.displayName || "Google Drive"}
                    </p>
                    <p className="text-[10px] text-emerald-400 font-mono leading-none mt-1">
                      Conectado
                    </p>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {/* Account Switcher Dropdown */}
                {isAccountMenuOpen && (
                  <div className="absolute right-0 mt-2 w-72 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl py-2 z-50 animate-in fade-in">
                    <div className="px-3 py-2 border-b border-slate-800 text-[11px] font-semibold text-slate-400 flex items-center justify-between">
                      <span>Cuentas de Google Drive</span>
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                    </div>

                    <div className="max-h-56 overflow-y-auto py-1">
                      {driveSession.accounts.map((acc) => {
                        const isActive = acc.email === currentUser.email;
                        return (
                          <div
                            key={acc.email}
                            onClick={() => handleSwitchAccount(acc)}
                            className={`flex items-center justify-between px-3 py-2 text-xs transition-colors cursor-pointer ${
                              isActive ? "bg-indigo-600/20 text-white" : "text-slate-300 hover:bg-slate-800"
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              {acc.photoURL ? (
                                <img
                                  src={acc.photoURL}
                                  alt=""
                                  className="w-6 h-6 rounded-full shrink-0"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] text-slate-200 shrink-0">
                                  {acc.displayName?.[0] || "G"}
                                </div>
                              )}
                              <div className="truncate text-left">
                                <p className="font-semibold truncate">{acc.displayName || "Usuario"}</p>
                                <p className="text-[10px] text-slate-400 font-mono truncate">{acc.email}</p>
                              </div>
                            </div>
                            {isActive && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                          </div>
                        );
                      })}
                    </div>

                    <div className="p-2 border-t border-slate-800 text-xs space-y-1">
                      <button
                        onClick={handleSignIn}
                        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-800 text-indigo-300 font-semibold cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Conectar otra cuenta</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={handleSignIn}
                disabled={isSigningIn}
                className="gsi-material-button text-xs"
                title="Conectar Google Drive"
              >
                <div className="gsi-material-button-icon">
                  <GoogleIcon className="w-4 h-4" />
                </div>
                <span className="gsi-material-button-contents">
                  {isSigningIn ? "Conectando..." : "Conectar Google Drive"}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Global Notifications */}
        {transferSuccessMsg && (
          <div className="mt-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center justify-between gap-3 shadow-md">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{transferSuccessMsg}</span>
            </div>
            <button
              onClick={() => setTransferSuccessMsg(null)}
              className="text-emerald-400 hover:text-white px-2 py-0.5 rounded cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {transferErrorMsg && (
          <div className={`mt-3 p-3 rounded-xl text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md ${
            isSessionExpired
              ? "bg-amber-500/15 border border-amber-500/40 text-amber-200"
              : "bg-rose-500/10 border border-rose-500/30 text-rose-300"
          }`}>
            <div className="flex items-center gap-2">
              <AlertCircle className={`w-4 h-4 shrink-0 ${isSessionExpired ? "text-amber-400" : "text-rose-400"}`} />
              <span>{transferErrorMsg}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              {isSessionExpired && (
                <button
                  onClick={handleSignIn}
                  disabled={isSigningIn}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors shadow-md cursor-pointer"
                >
                  <GoogleIcon className="w-3.5 h-3.5" />
                  <span>{isSigningIn ? "Reconectando..." : "Reconectar con Google"}</span>
                </button>
              )}
              <button
                onClick={() => {
                  setTransferErrorMsg(null);
                  setIsSessionExpired(false);
                }}
                className="text-slate-400 hover:text-white px-2 py-0.5 rounded cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. Active Transfer Real-Time Progress Bar */}
      {activeTransferTask && (
        <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-4 shadow-xl space-y-2 animate-in fade-in">
          <div className="flex items-center justify-between text-xs font-semibold">
            <div className="flex items-center gap-2 text-indigo-300">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
              <span>
                {activeTransferTask.direction === "server-to-drive"
                  ? activeTransferTask.mode === "move"
                    ? "Moviendo a Google Drive (Servidor ➔ Drive):"
                    : "Copiando a Google Drive (Servidor ➔ Drive):"
                  : "Descargando de Google Drive (Drive ➔ Servidor):"}
              </span>
              <strong className="text-white font-mono">{activeTransferTask.fileName}</strong>
            </div>
            <span className="font-mono text-indigo-300 font-bold">
              {activeTransferTask.progress}%
            </span>
          </div>

          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-sky-400 to-emerald-400 transition-all duration-300"
              style={{ width: `${Math.max(activeTransferTask.progress, 4)}%` }}
            />
          </div>

          <div className="flex justify-between text-[11px] font-mono text-slate-400">
            <span>
              Velocidad: <strong className="text-indigo-300">{activeTransferTask.speed}</strong>
            </span>
            <span>
              {formatBytes(activeTransferTask.transferredBytes)} de{" "}
              {formatBytes(activeTransferTask.totalBytes)}
            </span>
            <span>
              Destino:{" "}
              <strong className="text-slate-300">
                {activeTransferTask.direction === "server-to-drive"
                  ? targetFolder?.name || "Google Drive"
                  : "/tmp/zero_disk_downloads"}
              </strong>
            </span>
          </div>
        </div>
      )}

      {/* 3. Commander Dual-Pane Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ========================================================
            LEFT PANE: SERVER FILESYSTEM
           ======================================================== */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col h-[680px] shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <HardDrive className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5 truncate">
                  <span>FS Servidor Local</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/40 font-mono">
                    Linux Host
                  </span>
                </h3>
                <p className="text-[10px] font-mono text-slate-400 truncate" title={currentServerDir}>
                  📁 {serverViewMode === "flat" ? "Todos los Archivos Descargados" : currentServerDir}
                </p>
              </div>
            </div>

            {/* View Switcher & Reload */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => {
                  setServerViewMode(serverViewMode === "flat" ? "tree" : "flat");
                }}
                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                title={serverViewMode === "flat" ? "Cambiar a vista de árbol" : "Cambiar a vista plana"}
              >
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                <span>{serverViewMode === "flat" ? "Vista Plana" : "Explorador"}</span>
              </button>

              <button
                onClick={loadServerFiles}
                disabled={isServerLoading}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                title="Recargar archivos del servidor"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isServerLoading ? "animate-spin text-indigo-400" : ""}`} />
              </button>
            </div>
          </div>

          {/* Directory Navigation bar (when in tree mode) */}
          {serverViewMode === "tree" && (
            <div className="py-2 flex items-center gap-1 text-xs font-mono overflow-x-auto shrink-0">
              <button
                onClick={() => {
                  const parent = currentServerDir.substring(0, currentServerDir.lastIndexOf("/"));
                  if (parent && parent.startsWith("/tmp")) {
                    setCurrentServerDir(parent);
                  }
                }}
                disabled={currentServerDir === "/tmp"}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 text-[11px] flex items-center gap-1 cursor-pointer shrink-0"
                title="Subir al nivel superior"
              >
                <span>.. (Subir)</span>
              </button>

              {serverBasePaths.map((bp) => (
                <button
                  key={bp.path}
                  onClick={() => setCurrentServerDir(bp.path)}
                  className={`px-2 py-1 rounded text-[10px] whitespace-nowrap cursor-pointer ${
                    currentServerDir === bp.path
                      ? "bg-indigo-600 text-white font-bold"
                      : "bg-slate-800/80 hover:bg-slate-700 text-slate-300"
                  }`}
                >
                  {bp.name}
                </button>
              ))}
            </div>
          )}

          {/* Search and Action Toolbar */}
          <div className="py-2.5 flex items-center justify-between gap-2 shrink-0">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar en servidor..."
                value={serverSearch}
                onChange={(e) => setServerSearch(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Selection info & Server Actions */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={selectAllServerFiles}
                className="px-2 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-[11px] text-slate-300 font-medium cursor-pointer"
                title="Seleccionar o deseleccionar todos"
              >
                {selectedServerPaths.size > 0 && selectedServerPaths.size === filteredServerFiles.length
                  ? "Deseleccionar"
                  : "Todos"}
              </button>

              {selectedServerPaths.size > 0 && (
                <>
                  <button
                    onClick={() => setIsServerDeleteModalOpen(true)}
                    className="px-2 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                    title="Eliminar archivos seleccionados del servidor y liberar espacio"
                  >
                    <Trash2 className="w-3 h-3 text-rose-400" />
                    <span>Borrar ({selectedServerPaths.size})</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Table / List View */}
          <div className="flex-1 overflow-y-auto border border-slate-800/80 rounded-xl bg-slate-950/60 divide-y divide-slate-800/60">
            {isServerLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-2">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                <span className="text-xs">Leyendo archivos en el servidor...</span>
              </div>
            ) : filteredServerFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 p-6 text-center space-y-2">
                <FolderOpen className="w-8 h-8 text-slate-600" />
                <p className="text-xs font-semibold text-slate-400">No hay archivos en este directorio</p>
                <p className="text-[11px] text-slate-500">
                  Usa el acelerador Descarga Secuencial para descargar archivos web o torrents directamente a este almacenamiento.
                </p>
                {onNavigateToStream && (
                  <button
                    onClick={onNavigateToStream}
                    className="mt-2 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold cursor-pointer"
                  >
                    Ir al Motor Descarga Secuencial
                  </button>
                )}
              </div>
            ) : (
              filteredServerFiles.map((file) => {
                const isSelected = selectedServerPaths.has(file.path);
                return (
                  <div
                    key={file.id}
                    onClick={() => {
                      if (file.isDirectory && serverViewMode === "tree") {
                        setCurrentServerDir(file.path);
                      } else {
                        toggleSelectServerFile(file.path);
                      }
                    }}
                    className={`flex items-center justify-between p-2.5 text-xs transition-colors cursor-pointer group ${
                      isSelected
                        ? "bg-indigo-950/50 border-l-2 border-indigo-500 text-white"
                        : "hover:bg-slate-900/80 text-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectServerFile(file.path);
                        }}
                        className="cursor-pointer shrink-0"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-indigo-400" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                        )}
                      </div>

                      {getFileIcon(file.name, file.isDirectory)}

                      <div className="min-w-0">
                        <p className="font-semibold truncate text-xs group-hover:text-white" title={file.name}>
                          {file.name}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-0.5">
                          <span>{file.sizeFormatted}</span>
                          <span>•</span>
                          <span>{formatDate(file.modifiedTime)}</span>
                          {file.isJobActive && (
                            <>
                              <span>•</span>
                              <span className="text-amber-400 flex items-center gap-1">
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                Descargando
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Quick Row Actions on hover */}
                    <div
                      className="flex items-center gap-1 opacity-80 group-hover:opacity-100 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => handleDownloadServerFileToBrowser(file.path)}
                        className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                        title="Descargar este archivo a mi PC"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => {
                          setServerFileToRename(file);
                          setRenameInputVal(file.name);
                        }}
                        className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-amber-300 transition-colors cursor-pointer"
                        title="Renombrar archivo"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => {
                          setSelectedServerPaths(new Set([file.path]));
                          setIsServerDeleteModalOpen(true);
                        }}
                        className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition-colors cursor-pointer"
                        title="Borrar del servidor"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer of Left Pane */}
          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
            <span>
              {filteredServerFiles.length} elemento(s){" "}
              {selectedServerPaths.size > 0 && `(${selectedServerPaths.size} seleccionados: ${formatBytes(selectedServerBytes)})`}
            </span>
            <span className="text-slate-500">Disco /tmp</span>
          </div>
        </div>

        {/* ========================================================
            RIGHT PANE: GOOGLE DRIVE STORAGE
           ======================================================== */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col h-[680px] shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                <Cloud className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5 truncate">
                  <span>Google Drive Cloud</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-800/40 font-mono">
                    Nube
                  </span>
                </h3>
                <p className="text-[10px] font-mono text-slate-400 truncate">
                  📁 {targetFolder?.name || DEFAULT_FOLDER_NAME}
                </p>
              </div>
            </div>

            {/* Folder Selector & Drive External Link */}
            <div className="flex items-center gap-1.5 shrink-0">
              {currentUser && (
                <div className="relative" ref={folderMenuRef}>
                  <button
                    onClick={() => setIsFolderMenuOpen(!isFolderMenuOpen)}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer max-w-[140px] truncate"
                    title="Cambiar carpeta de destino en Google Drive"
                  >
                    <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="truncate">{targetFolder?.name || "Elegir Carpeta"}</span>
                    <ChevronDown className="w-3 h-3 shrink-0" />
                  </button>

                  {/* Folder Dropdown */}
                  {isFolderMenuOpen && (
                    <div className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl py-2 z-50 animate-in fade-in">
                      <div className="px-3 py-1.5 border-b border-slate-800 text-[11px] font-semibold text-slate-400 flex items-center justify-between">
                        <span>Carpetas en Google Drive</span>
                        <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                      </div>

                      <div className="max-h-48 overflow-y-auto py-1">
                        {availableFolders.map((f) => (
                          <div
                            key={f.id}
                            onClick={() => handleSelectDriveFolder(f)}
                            className={`px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-800 cursor-pointer ${
                              targetFolder?.id === f.id ? "bg-indigo-600/20 text-white font-bold" : "text-slate-300"
                            }`}
                          >
                            <span className="truncate">📁 {f.name}</span>
                            {targetFolder?.id === f.id && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                          </div>
                        ))}
                      </div>

                      <div className="p-2 border-t border-slate-800 text-xs">
                        {isCreatingFolder ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              placeholder="Nombre de la carpeta..."
                              value={newFolderNameInput}
                              onChange={(e) => setNewFolderNameInput(e.target.value)}
                              className="w-full px-2.5 py-1 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white"
                            />
                            <div className="flex items-center gap-1.5 justify-end">
                              <button
                                onClick={() => setIsCreatingFolder(false)}
                                className="px-2 py-1 rounded text-slate-400 hover:text-white"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={handleCreateNewDriveFolder}
                                disabled={isCreatingFolderLoading || !newFolderNameInput.trim()}
                                className="px-2.5 py-1 rounded bg-indigo-600 text-white font-bold disabled:opacity-50"
                              >
                                Crear
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setIsCreatingFolder(true)}
                            className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-800 text-indigo-300 font-semibold cursor-pointer"
                          >
                            <FolderPlus className="w-3.5 h-3.5" />
                            <span>+ Nueva Carpeta en Drive</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {targetFolder?.webViewLink && (
                <a
                  href={targetFolder.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                  title="Abrir esta carpeta directamente en drive.google.com"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
                </a>
              )}

              <button
                onClick={loadDriveFiles}
                disabled={isDriveLoading || !currentUser}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                title="Recargar archivos de Drive"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isDriveLoading ? "animate-spin text-sky-400" : ""}`} />
              </button>
            </div>
          </div>

          {/* Search and Action Toolbar */}
          <div className="py-2.5 flex items-center justify-between gap-2 shrink-0">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar en Google Drive..."
                value={driveSearch}
                onChange={(e) => setDriveSearch(e.target.value)}
                disabled={!currentUser}
                className="w-full pl-8 pr-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 disabled:opacity-50"
              />
            </div>

            {/* Selection info & Actions */}
            {currentUser && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={selectAllDriveFiles}
                  className="px-2 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-[11px] text-slate-300 font-medium cursor-pointer"
                  title="Seleccionar o deseleccionar todos"
                >
                  {selectedDriveFileIds.size > 0 && selectedDriveFileIds.size === filteredDriveFiles.length
                    ? "Deseleccionar"
                    : "Todos"}
                </button>
              </div>
            )}
          </div>

          {/* Table / List View */}
          <div className="flex-1 overflow-y-auto border border-slate-800/80 rounded-xl bg-slate-950/60 divide-y divide-slate-800/60">
            {!currentUser ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 p-6 text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center">
                  <Cloud className="w-6 h-6" />
                </div>
                <div className="space-y-1 max-w-sm">
                  <h4 className="text-sm font-bold text-white">Google Drive No Conectado</h4>
                  <p className="text-xs text-slate-400">
                    Inicia sesión para sincronizar, ver tus carpetas y transferir archivos directamente con un clic.
                  </p>
                </div>
                <button
                  onClick={handleSignIn}
                  disabled={isSigningIn}
                  className="gsi-material-button text-xs"
                >
                  <div className="gsi-material-button-icon">
                    <GoogleIcon className="w-4 h-4" />
                  </div>
                  <span className="gsi-material-button-contents">
                    {isSigningIn ? "Conectando..." : "Conectar Google Drive"}
                  </span>
                </button>
              </div>
            ) : isSessionExpired ? (
              <div className="flex flex-col items-center justify-center h-full text-amber-200/90 p-6 text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div className="space-y-1 max-w-sm">
                  <h4 className="text-sm font-bold text-white">Sesión de Google Drive Expirada</h4>
                  <p className="text-xs text-amber-200/80">
                    Tu pase de autorización cumplió el límite de seguridad de 1 hora de Google. Reconéctate con un clic para continuar.
                  </p>
                </div>
                <button
                  onClick={handleSignIn}
                  disabled={isSigningIn}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors shadow-lg cursor-pointer"
                >
                  <GoogleIcon className="w-4 h-4" />
                  <span>{isSigningIn ? "Reconectando..." : "Reconectar con Google"}</span>
                </button>
              </div>
            ) : isDriveLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-2">
                <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
                <span className="text-xs">Consultando Google Drive API...</span>
              </div>
            ) : filteredDriveFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 p-6 text-center space-y-2">
                <FolderOpen className="w-8 h-8 text-slate-600" />
                <p className="text-xs font-semibold text-slate-400">No hay archivos en esta carpeta de Drive</p>
                <p className="text-[11px] text-slate-500">
                  Selecciona archivos en el panel izquierdo y haz clic en "Copiar a Drive" o "Mover a Drive".
                </p>
              </div>
            ) : (
              filteredDriveFiles.map((file) => {
                const isSelected = selectedDriveFileIds.has(file.id);
                return (
                  <div
                    key={file.id}
                    onClick={() => toggleSelectDriveFile(file.id)}
                    className={`flex items-center justify-between p-2.5 text-xs transition-colors cursor-pointer group ${
                      isSelected
                        ? "bg-sky-950/50 border-l-2 border-sky-500 text-white"
                        : "hover:bg-slate-900/80 text-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectDriveFile(file.id);
                        }}
                        className="cursor-pointer shrink-0"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-sky-400" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                        )}
                      </div>

                      {getFileIcon(file.name)}

                      <div className="min-w-0">
                        <p className="font-semibold truncate text-xs group-hover:text-white" title={file.name}>
                          {file.name}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-0.5">
                          <span>{file.size ? formatBytes(parseInt(file.size, 10)) : "Drive Doc"}</span>
                          <span>•</span>
                          <span>{formatDate(file.createdTime)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Quick Row Actions on hover */}
                    <div
                      className="flex items-center gap-1 opacity-80 group-hover:opacity-100 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {file.webViewLink && (
                        <a
                          href={file.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-sky-300 transition-colors"
                          title="Abrir en Google Drive"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}

                      <button
                        onClick={() => handleDownloadDriveFileToBrowser(file)}
                        className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                        title="Descargar este archivo a mi PC"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => {
                          setDriveFileToDelete(file);
                          setIsDriveDeleteModalOpen(true);
                        }}
                        className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition-colors cursor-pointer"
                        title="Eliminar de Google Drive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer of Right Pane */}
          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
            <span>
              {filteredDriveFiles.length} archivo(s){" "}
              {selectedDriveFileIds.size > 0 && `(${selectedDriveFileIds.size} seleccionados)`}
            </span>
            <span className="text-slate-500">{currentUser?.email || "Sin conectar"}</span>
          </div>
        </div>
      </div>

      {/* 4. Central File Commander Bridge / Action Hub */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
          <span>Operaciones File Commander:</span>
          {selectedServerPaths.size > 0 && (
            <span className="text-indigo-300 font-bold bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-500/30">
              {selectedServerPaths.size} en Servidor ({formatBytes(selectedServerBytes)})
            </span>
          )}
          {selectedDriveFileIds.size > 0 && (
            <span className="text-sky-300 font-bold bg-sky-950/80 px-2 py-0.5 rounded border border-sky-500/30">
              {selectedDriveFileIds.size} en Google Drive
            </span>
          )}
          {selectedServerPaths.size === 0 && selectedDriveFileIds.size === 0 && (
            <span className="text-slate-500">Selecciona archivos en los paneles para transferir o mover</span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Copy to Drive */}
          <button
            onClick={() => handleTransferServerToDrive("copy")}
            disabled={selectedServerPaths.size === 0 || !currentUser}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/20 flex items-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Copiar archivos seleccionados del servidor a Google Drive sin borrarlos del servidor"
          >
            <span>Copiar a Drive</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          {/* Move to Drive (Free disk space) */}
          <button
            onClick={() => handleTransferServerToDrive("move")}
            disabled={selectedServerPaths.size === 0 || !currentUser}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 flex items-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Mover archivos a Google Drive y borrarlos automáticamente del servidor para liberar espacio SSD"
          >
            <span>Mover a Drive (Libera Espacio)</span>
            <MoveRight className="w-4 h-4 text-emerald-200" />
          </button>

          {/* Reverse Transfer: Download from Drive to Server */}
          <button
            onClick={handleCopyDriveToServer}
            disabled={selectedDriveFileIds.size === 0 || !currentUser}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold border border-slate-700 flex items-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Descargar archivos de Google Drive directamente hacia el almacenamiento del servidor"
          >
            <ArrowLeft className="w-4 h-4 text-sky-400" />
            <span>Bajar al Servidor</span>
          </button>
        </div>
      </div>

      {/* 5. Server File Delete Confirmation Modal */}
      {isServerDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <button
                onClick={() => setIsServerDeleteModalOpen(false)}
                disabled={isDeletingServer}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <h3 className="text-base font-bold text-white">
                ¿Eliminar {selectedServerPaths.size} archivo(s) del servidor?
              </h3>
              <p className="text-xs text-slate-300">
                Esta acción borrará permanentemente los archivos seleccionados del disco local del host para liberar espacio:
              </p>
              <div className="p-3 bg-slate-950/90 border border-slate-800 rounded-xl font-mono text-xs text-rose-300 max-h-36 overflow-y-auto space-y-1">
                {Array.from<string>(selectedServerPaths).map((p) => (
                  <div key={p} className="truncate">
                    • {p.split("/").pop()}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-emerald-400 font-mono">
                Espacio total a liberar: {formatBytes(selectedServerBytes)}
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setIsServerDeleteModalOpen(false)}
                disabled={isDeletingServer}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmServerDelete}
                disabled={isDeletingServer}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isDeletingServer ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Borrando...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Confirmar y Liberar Espacio</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Rename Server File Modal */}
      {serverFileToRename && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                <Edit2 className="w-5 h-5" />
              </div>
              <button
                onClick={() => setServerFileToRename(null)}
                disabled={isRenamingServer}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <h3 className="text-base font-bold text-white">Renombrar archivo en servidor</h3>
              <p className="text-xs text-slate-400">Ingresa el nuevo nombre para este archivo o carpeta:</p>
              <input
                type="text"
                value={renameInputVal}
                onChange={(e) => setRenameInputVal(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                autoFocus
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setServerFileToRename(null)}
                disabled={isRenamingServer}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmServerRename}
                disabled={isRenamingServer || !renameInputVal.trim()}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isRenamingServer ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>Guardar Nombre</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Drive Delete Modal (conforming to Workspace skill requirements) */}
      <DriveDeleteModal
        file={driveFileToDelete}
        isOpen={isDriveDeleteModalOpen}
        isDeleting={isDeletingDrive}
        onConfirm={handleConfirmDriveDelete}
        onClose={() => {
          setIsDriveDeleteModalOpen(false);
          setDriveFileToDelete(null);
        }}
      />
    </div>
  );
};
