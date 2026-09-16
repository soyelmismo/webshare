import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  CloudDownload,
  Folder,
  ExternalLink,
  Trash2,
  Download,
  Upload,
  Link as LinkIcon,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Search,
  HardDrive,
  FileCode,
  FileArchive,
  Image as ImageIcon,
  File,
  Sparkles,
  UserCheck,
  LogOut,
  FolderOpen,
  Zap,
  Cookie,
  Key,
  ShieldCheck,
  Users,
  UserPlus,
  ChevronDown,
  Check,
  Columns2,
  CloudLightning,
} from "lucide-react";
import { User } from "firebase/auth";
import { DriveFile, DriveFolderInfo, DownloadJob, ServerSpecs, ServerBenchmarkStats } from "../types";
import {
  initAuth,
  googleSignIn,
  logout,
  getAccessToken,
  setCustomDriveToken,
  switchGoogleAccount,
  removeSavedAccount,
  clearAllAccounts,
} from "../utils/firebaseAuth";
import {
  saveDriveSession,
  loadDriveSession,
  clearDriveSession,
  clearAllDriveSessions,
  updateAccountFolder,
  StoredDriveSession,
  getClientCookie,
  onDriveSessionExpired,
} from "../utils/driveStorage";
import {
  DEFAULT_FOLDER_NAME,
  getOrCreateDedicatedFolder,
  listFilesInFolder,
  uploadBlobToDrive,
  deleteFileFromDrive,
  downloadFileFromDrive,
} from "../utils/googleDriveApi";
import { GoogleIcon } from "./GoogleIcon";
import { DriveDeleteModal } from "./DriveDeleteModal";
import { DriveCookieModal } from "./DriveCookieModal";
import { DriveStreamDownloader } from "./DriveStreamDownloader";

interface DriveDownloadClientProps {
  serverSpecs: ServerSpecs | null;
  benchmarkStats: ServerBenchmarkStats;
  onNavigateToCommander?: () => void;
}

export const DriveDownloadClient: React.FC<DriveDownloadClientProps> = ({
  serverSpecs,
  benchmarkStats,
  onNavigateToCommander,
}) => {
  // Persistent drive session state (client-side Cookies & LocalStorage)
  const [driveSession, setDriveSession] = useState<StoredDriveSession>(() => loadDriveSession());
  const [isCookieModalOpen, setIsCookieModalOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  // Close account menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auth state
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const session = loadDriveSession();
    if (session.token && session.user) {
      return {
        uid: session.user.uid || "google-user",
        displayName: session.user.displayName,
        email: session.user.email,
        photoURL: session.user.photoURL,
        emailVerified: true,
        isAnonymous: false,
        metadata: {},
        providerData: [],
        refreshToken: "",
        tenantId: null,
        delete: async () => {},
        getIdToken: async () => "",
        getIdTokenResult: async () => ({} as any),
        reload: async () => {},
        toJSON: () => ({}),
        phoneNumber: null,
        providerId: "google.com",
      } as unknown as User;
    }
    return null;
  });
  const [accessToken, setAccessToken] = useState<string | null>(() => {
    const session = loadDriveSession();
    return session.token;
  });
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSessionExpired, setIsSessionExpired] = useState<boolean>(() => {
    return loadDriveSession().isExpired;
  });

  // Download mode: "stream" (zero-disk streaming), "sequential" (accelerated), "proxy" (direct), "diagnostics", "local"
  const [downloadMode, setDownloadMode] = useState<"stream" | "proxy" | "diagnostics" | "local">("stream");

  // Folder & Files state
  const [folderInfo, setFolderInfo] = useState<DriveFolderInfo | null>(() => {
    const session = loadDriveSession();
    return session.folder;
  });
  const [folderName, setFolderName] = useState(DEFAULT_FOLDER_NAME);
  const [isFolderLoading, setIsFolderLoading] = useState(false);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [isFilesLoading, setIsFilesLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Download URL form state
  const [downloadUrl, setDownloadUrl] = useState("");
  const [customFileName, setCustomFileName] = useState("");
  const [urlDownloadEngine, setUrlDownloadEngine] = useState<"proxy">("sequential");
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{
    percent: number;
    statusText: string;
  }>({ percent: 0, statusText: "" });
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  // Upload local file state
  const [isUploadingLocal, setIsUploadingLocal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Download jobs queue (persisted across page reloads in localStorage)
  const [jobs, setJobs] = useState<DownloadJob[]>(() => {
    try {
      const saved = localStorage.getItem("drive_download_jobs");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem("drive_download_jobs", JSON.stringify(jobs.slice(0, 50)));
    } catch {
      // ignore
    }
  }, [jobs]);

  // Delete modal state
  const [fileToDelete, setFileToDelete] = useState<DriveFile | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Listen to auth state
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setCurrentUser(user);
        setAccessToken(token);
        setDriveSession(loadDriveSession());
        setIsAuthLoading(false);
      },
      () => {
        // If there's an active token stored in cookie/localStorage, don't drop session
        const stored = loadDriveSession();
        if (stored.token && stored.user) {
          setAccessToken(stored.token);
          setDriveSession(stored);
          if (stored.isExpired) {
            setIsSessionExpired(true);
            setDownloadError(
              "Tu sesión de Google Drive ha expirado tras cumplir el tiempo reglamentario de seguridad de Google (1 hora). Haz clic en 'Reconectar con Google' para renovar tu acceso."
            );
          }
        } else {
          setCurrentUser(null);
          setAccessToken(null);
          setDriveSession(stored);
        }
        setIsAuthLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Listen to drive session expired notifications from API calls
  useEffect(() => {
    const unsub = onDriveSessionExpired((reason) => {
      setIsSessionExpired(true);
      setDownloadError(
        reason ||
          "Tu sesión de Google Drive ha expirado tras cumplir el tiempo reglamentario de seguridad de Google (1 hora). Haz clic en 'Reconectar con Google' para renovar tu acceso."
      );
    });
    return unsub;
  }, []);

  // Handle Google Sign In
  const handleSignIn = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const result = await googleSignIn(false);
      if (result) {
        setCurrentUser(result.user);
        setAccessToken(result.accessToken);
        setDriveSession(loadDriveSession());
      }
    } catch (err: any) {
      if (err?.message?.includes("popup-closed-by-user")) {
        console.warn("Sign-in cancelled by user.");
      } else {
        console.error("Sign-in failed:", err);
        setAuthError(err?.message || "Error al autenticar con Google.");
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  // Add an additional Google account (forces Google account chooser)
  const handleAddAnotherAccount = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    setIsAccountMenuOpen(false);
    try {
      const result = await googleSignIn(true);
      if (result) {
        setCurrentUser(result.user);
        setAccessToken(result.accessToken);
        setFolderInfo(null);
        setDriveSession(loadDriveSession());
        setDownloadSuccess(`¡Cuenta agregada y activada: ${result.account.email || result.user.displayName}!`);
        loadFolderAndFiles(result.accessToken);
      }
    } catch (err: any) {
      if (err?.message?.includes("popup-closed-by-user")) {
        console.warn("Sign-in cancelled by user (Add Account).");
      } else {
        console.error("Error al agregar cuenta:", err);
        setAuthError(err?.message || "Error al agregar cuenta de Google.");
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  // Switch between saved Google accounts
  const handleSwitchAccount = async (accountId: string) => {
    setIsAccountMenuOpen(false);
    const switched = switchGoogleAccount(accountId);
    if (switched) {
      setCurrentUser(switched.user);
      setAccessToken(switched.token);
      setFolderInfo(switched.account.folder || null);
      setDriveSession(loadDriveSession());
      setDownloadSuccess(`Cuenta cambiada a: ${switched.account.email || switched.account.displayName}`);
      loadFolderAndFiles(switched.token);
    }
  };

  // Remove a specific saved account
  const handleRemoveAccount = async (accountId: string) => {
    removeSavedAccount(accountId);
    const updated = loadDriveSession();
    setDriveSession(updated);
    if (updated.token && updated.user) {
      if (updated.activeAccount) {
        await handleSwitchAccount(updated.activeAccount.id);
      }
    } else {
      setCurrentUser(null);
      setAccessToken(null);
      setFolderInfo(null);
      setFiles([]);
    }
  };

  // Clear all accounts & sessions
  const handleClearAllAccounts = async () => {
    await clearAllAccounts();
    setCurrentUser(null);
    setAccessToken(null);
    setFolderInfo(null);
    setFiles([]);
    setDriveSession(loadDriveSession());
    setIsCookieModalOpen(false);
    setIsAccountMenuOpen(false);
  };

  // Handle Logout of current account
  const handleLogout = async () => {
    await logout();
    setCurrentUser(null);
    setAccessToken(null);
    setFolderInfo(null);
    setFiles([]);
    setDriveSession(loadDriveSession());
    setIsCookieModalOpen(false);
    setIsAccountMenuOpen(false);
  };

  // Save manual token directly to Cookies and LocalStorage
  const handleSaveManualToken = async (manualToken: string, email?: string, name?: string) => {
    const res = setCustomDriveToken(manualToken, { email, displayName: name });
    setCurrentUser(res.user);
    setAccessToken(manualToken);
    setFolderInfo(null);
    const updatedSession = loadDriveSession();
    setDriveSession(updatedSession);
    setIsCookieModalOpen(false);
    setDownloadSuccess(`Cuenta (${res.account.email}) guardada en Cookies y LocalStorage.`);
    loadFolderAndFiles(manualToken);
  };

  // Load or create dedicated folder
  const loadFolderAndFiles = useCallback(
    async (token: string, nameToUse: string = folderName) => {
      const session = loadDriveSession();
      if (session.isExpired) {
        setIsSessionExpired(true);
        setDownloadError(
          "Tu sesión de Google Drive ha expirado tras cumplir el tiempo reglamentario de seguridad de Google (1 hora). Haz clic en 'Reconectar con Google' para renovar tu acceso."
        );
        return;
      }

      setIsFolderLoading(true);
      setIsFilesLoading(true);
      try {
        const folder = await getOrCreateDedicatedFolder(token, nameToUse);
        setFolderInfo(folder);
        // Persist folder in client session cache and update specific account
        saveDriveSession(token, 3600, currentUser, folder);
        const currentActive = loadDriveSession().activeAccount;
        if (currentActive) {
          updateAccountFolder(currentActive.id, folder);
        }
        setDriveSession(loadDriveSession());
        const folderFiles = await listFilesInFolder(token, folder.id);
        setFiles(folderFiles);
        setIsSessionExpired(false);
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
          setDownloadError(
            "Tu sesión de Google Drive ha expirado tras cumplir el tiempo reglamentario de seguridad de Google (1 hora). Haz clic en 'Reconectar con Google' para renovar tu acceso."
          );
        } else {
          console.warn("Error loading folder/files:", err);
          setDownloadError(err?.message || "Error al acceder a Google Drive.");
        }
      } finally {
        setIsFolderLoading(false);
        setIsFilesLoading(false);
      }
    },
    [folderName, currentUser]
  );

  // When token is available, load the dedicated folder
  useEffect(() => {
    if (accessToken) {
      const session = loadDriveSession();
      if (session.isExpired) {
        setIsSessionExpired(true);
        setDownloadError(
          "Tu sesión de Google Drive ha expirado tras cumplir el tiempo reglamentario de seguridad de Google (1 hora). Haz clic en 'Reconectar con Google' para renovar tu acceso."
        );
        return;
      }
      loadFolderAndFiles(accessToken);
    }
  }, [accessToken, loadFolderAndFiles]);

  // Refresh files list
  const handleRefreshFiles = async () => {
    if (!accessToken || !folderInfo) return;
    const session = loadDriveSession();
    if (session.isExpired) {
      setIsSessionExpired(true);
      setDownloadError(
        "Tu sesión de Google Drive ha expirado tras cumplir el tiempo reglamentario de seguridad de Google (1 hora). Haz clic en 'Reconectar con Google' para renovar tu acceso."
      );
      return;
    }

    setIsFilesLoading(true);
    try {
      const updated = await listFilesInFolder(accessToken, folderInfo.id);
      setFiles(updated);
      setIsSessionExpired(false);
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
        setDownloadError(
          "Tu sesión de Google Drive ha expirado tras cumplir el tiempo reglamentario de seguridad de Google (1 hora). Haz clic en 'Reconectar con Google' para renovar tu acceso."
        );
      } else {
        console.warn("Error refreshing Drive files:", err);
        setDownloadError(err?.message || "Error al actualizar la lista de archivos de Drive.");
      }
    } finally {
      setIsFilesLoading(false);
    }
  };

  // Execute download from URL and save directly to Drive
  const handleDownloadFromUrl = async (urlToDownload?: string, suggestedName?: string) => {
    const targetUrl = (urlToDownload || downloadUrl).trim();
    if (!targetUrl) return;

    if (!accessToken || !folderInfo) {
      setDownloadError("Debes iniciar sesión con Google para guardar archivos en Drive.");
      return;
    }

    // If using the persistent sequential engine (recommended for heavy files, resists reloads & pause/resume)
    if (false) {
      setIsDownloading(true);
      setDownloadError(null);
      setDownloadSuccess(null);
      setDownloadProgress({ percent: 15, statusText: "Iniciando motor persistente de alta velocidad (Descarga Secuencial)..." });

      try {
        const res = await fetch("/api/sequential/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: targetUrl,
            fileName: customFileName.trim() || suggestedName || undefined,
            connections: 4,
            split: 4,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "No se pudo iniciar la descarga persistente en el servidor.");
        }

        setDownloadSuccess(
          `¡Descarga persistente iniciada! El progreso se guarda en disco y no se perderá al recargar la página.`
        );
        setDownloadUrl("");
        setCustomFileName("");
        // Automatically navigate to the persistent multi-thread tab to view progress & controls
        setDownloadMode("sequential");
      } catch (err: any) {
        setDownloadError(err.message || "Error al iniciar descarga con Descarga Secuencial");
      } finally {
        setIsDownloading(false);
        setDownloadProgress({ percent: 0, statusText: "" });
      }
      return;
    }

    setIsDownloading(true);
    setDownloadError(null);
    setDownloadSuccess(null);
    setDownloadProgress({ percent: 15, statusText: "Conectando y descargando recurso remoto..." });

    const jobId = `job_${Date.now()}`;
    const newJob: DownloadJob = {
      id: jobId,
      name: suggestedName || customFileName || "Descarga remota",
      sourceUrl: targetUrl,
      status: "downloading",
      progress: 20,
      statusText: "Descargando desde URL...",
      createdAt: Date.now(),
    };
    setJobs((prev) => [newJob, ...prev]);

    try {
      // Use the server proxy to bypass CORS restrictions
      const proxyUrl = `/api/download/proxy?url=${encodeURIComponent(targetUrl)}`;
      const response = await fetch(proxyUrl);

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({ error: "Error desconocido" }));
        throw new Error(errJson.error || `Error ${response.status}: ${response.statusText}`);
      }

      setDownloadProgress({ percent: 55, statusText: "Archivo recibido. Procesando contenido..." });

      // Determine final filename and mimeType
      const headerFilename = response.headers.get("X-File-Name");
      const contentType = response.headers.get("Content-Type") || "application/octet-stream";

      let finalName = customFileName.trim() || suggestedName || headerFilename || "";
      if (!finalName) {
        try {
          const pathSegments = new URL(targetUrl).pathname.split("/");
          finalName = pathSegments[pathSegments.length - 1] || `archivo_${Date.now()}.bin`;
        } catch {
          finalName = `archivo_${Date.now()}.bin`;
        }
      }

      const blob = await response.blob();

      setDownloadProgress({
        percent: 75,
        statusText: `Subiendo "${finalName}" a la carpeta "${folderInfo.name}" en Drive...`,
      });

      // Upload directly into the dedicated Drive folder
      const uploadedFile = await uploadBlobToDrive(
        accessToken,
        folderInfo.id,
        blob,
        finalName,
        contentType
      );

      setDownloadProgress({ percent: 100, statusText: "¡Guardado exitosamente en Google Drive!" });
      setDownloadSuccess(`Archivo guardado con éxito en tu Google Drive: "${uploadedFile.name}"`);

      // Update job
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                name: uploadedFile.name,
                status: "completed",
                progress: 100,
                statusText: "Completado en Drive",
                driveFile: uploadedFile,
                sizeBytes: blob.size,
              }
            : j
        )
      );

      // Refresh folder files
      await handleRefreshFiles();
      setDownloadUrl("");
      setCustomFileName("");
    } catch (err: any) {
      console.error("Download failed:", err);
      const msg = err?.message || "Error al descargar el archivo y guardarlo en Google Drive.";
      setDownloadError(msg);
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: "error",
                statusText: "Error en descarga",
                error: msg,
              }
            : j
        )
      );
    } finally {
      setIsDownloading(false);
      setTimeout(() => {
        setDownloadProgress({ percent: 0, statusText: "" });
      }, 4000);
    }
  };

  // Quick preset downloads
  const samplePresets = [
    {
      name: "Linux Kernel Docs (MD)",
      filename: "linux-kernel-summary.md",
      url: "https://raw.githubusercontent.com/torvalds/linux/master/README",
      desc: "README oficial del repositorio de Linux Kernel",
    },
    {
      name: "Tux Linux SVG",
      filename: "tux-linux-logo.svg",
      url: "https://raw.githubusercontent.com/valeriangalliat/tux/master/tux.svg",
      desc: "Logotipo vectorial en alta resolución",
    },
    {
      name: "Node.js License (TXT)",
      filename: "nodejs-license.txt",
      url: "https://raw.githubusercontent.com/nodejs/node/main/LICENSE",
      desc: "Licencia de runtime de Node.js",
    },
  ];

  // Save server diagnostics report directly to Drive
  const handleSaveServerReportToDrive = async (format: "markdown" | "json") => {
    if (!accessToken || !folderInfo || !serverSpecs) {
      setDownloadError("Debes estar conectado a Google Drive para guardar el informe.");
      return;
    }

    setIsDownloading(true);
    setDownloadProgress({ percent: 40, statusText: `Generando informe del servidor (${format.toUpperCase()})...` });

    try {
      let content = "";
      let fileName = "";
      let mimeType = "";

      if (format === "markdown") {
        fileName = `informe-servidor-${serverSpecs.os.hostname}-${Date.now()}.md`;
        mimeType = "text/markdown";
        content = `# Informe de Especificaciones del Servidor Host
**Fecha:** ${new Date().toLocaleString()}
**Hostname:** ${serverSpecs.os.hostname}
**Distribución:** ${serverSpecs.os.distroName}
**Kernel:** ${serverSpecs.os.kernelRelease} (${serverSpecs.os.arch})
**Uptime:** ${serverSpecs.os.uptimeFormatted}

## 1. CPU & Núcleos
- Modelo: ${serverSpecs.cpu.model}
- Núcleos: ${serverSpecs.cpu.coresCount}
- Caché L3: ${serverSpecs.cpu.cacheSizeKB} KB
- Carga: ${serverSpecs.cpu.loadAverage["1min"]} (1m), ${serverSpecs.cpu.loadAverage["5min"]} (5m)

## 2. Memoria RAM
- Total: ${serverSpecs.memory.totalGB} GB
- Usada: ${serverSpecs.memory.usedGB} GB (${serverSpecs.memory.usagePercentage}%)
- Disponible: ${serverSpecs.memory.availableGB} GB

## 3. Almacenamiento
- Disco Raíz: ${serverSpecs.storage.mounts[0]?.totalGB || "N/A"} GB
- Usado: ${serverSpecs.storage.mounts[0]?.usedGB || "N/A"} GB

*Guardado directamente en Google Drive vía Cliente de Descarga.*
`;
      } else {
        fileName = `metricas-servidor-${serverSpecs.os.hostname}-${Date.now()}.json`;
        mimeType = "application/json";
        content = JSON.stringify({ serverSpecs, benchmarkStats, generatedAt: new Date().toISOString() }, null, 2);
      }

      const blob = new Blob([content], { type: mimeType });

      setDownloadProgress({ percent: 80, statusText: `Subiendo "${fileName}" a Google Drive...` });

      const uploaded = await uploadBlobToDrive(accessToken, folderInfo.id, blob, fileName, mimeType);

      setDownloadSuccess(`¡Informe guardado en Google Drive! Archivo: "${uploaded.name}"`);
      await handleRefreshFiles();
    } catch (err: any) {
      setDownloadError(err?.message || "Error al guardar el informe en Drive.");
    } finally {
      setIsDownloading(false);
      setTimeout(() => {
        setDownloadProgress({ percent: 0, statusText: "" });
      }, 4000);
    }
  };

  // Handle local file upload to dedicated Drive folder
  const handleLocalFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0 || !accessToken || !folderInfo) return;

    const file = fileList[0];
    setIsUploadingLocal(true);
    setDownloadProgress({
      percent: 50,
      statusText: `Subiendo archivo local "${file.name}" a Drive...`,
    });

    try {
      const uploaded = await uploadBlobToDrive(
        accessToken,
        folderInfo.id,
        file,
        file.name,
        file.type || "application/octet-stream"
      );
      setDownloadSuccess(`Archivo "${uploaded.name}" guardado exitosamente en tu carpeta de Drive.`);
      await handleRefreshFiles();
    } catch (err: any) {
      setDownloadError(err?.message || "Error al subir archivo a Google Drive.");
    } finally {
      setIsUploadingLocal(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTimeout(() => {
        setDownloadProgress({ percent: 0, statusText: "" });
      }, 4000);
    }
  };

  // Open confirmation modal for file deletion (MANDATORY per Workspace guidelines)
  const handleRequestDelete = (file: DriveFile) => {
    setFileToDelete(file);
    setIsDeleteModalOpen(true);
  };

  // Confirm file deletion
  const handleConfirmDelete = async () => {
    if (!fileToDelete || !accessToken) return;
    setIsDeleting(true);
    try {
      await deleteFileFromDrive(accessToken, fileToDelete.id);
      setFiles((prev) => prev.filter((f) => f.id !== fileToDelete.id));
      setIsDeleteModalOpen(false);
      setFileToDelete(null);
      setDownloadSuccess(`El archivo "${fileToDelete.name}" fue eliminado de Google Drive con tu confirmación.`);
    } catch (err: any) {
      const errMsg = err?.message || "";
      const isAuth = err?.isAuthError || errMsg.includes("401") || errMsg.includes("authError");
      if (isAuth) {
        setIsSessionExpired(true);
        setDownloadError("Tu sesión de Google Drive ha expirado. Haz clic en 'Reconectar con Google' para renovar tu acceso.");
      } else {
        console.warn("Error deleting file from Google Drive:", err);
        setDownloadError(err?.message || "Error al eliminar el archivo de Google Drive.");
      }
    } finally {
      setIsDeleting(false);
    }
  };

  // Download file locally from Drive
  const handleDownloadFileLocally = async (file: DriveFile) => {
    if (!accessToken) return;
    try {
      const blob = await downloadFileFromDrive(accessToken, file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      const errMsg = err?.message || "";
      const isAuth = err?.isAuthError || errMsg.includes("401") || errMsg.includes("authError");
      if (isAuth) {
        setIsSessionExpired(true);
        setDownloadError("Tu sesión de Google Drive ha expirado. Haz clic en 'Reconectar con Google' para renovar tu acceso.");
      } else {
        console.warn("Error downloading file locally from Drive:", err);
        setDownloadError(`Error al descargar ${file.name} localmente: ${err?.message}`);
      }
    }
  };

  // Filter files by search query
  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Helper for file type icons
  const getFileIcon = (fileName: string, mimeType: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    if (["jpg", "jpeg", "png", "gif", "svg", "webp"].includes(ext) || mimeType.startsWith("image/")) {
      return <ImageIcon className="w-4 h-4 text-emerald-400" />;
    }
    if (["json", "js", "ts", "py", "sh", "html", "css"].includes(ext)) {
      return <FileCode className="w-4 h-4 text-amber-400" />;
    }
    if (["zip", "tar", "gz", "rar", "7z", "bz2"].includes(ext)) {
      return <FileArchive className="w-4 h-4 text-purple-400" />;
    }
    if (["md", "txt", "log"].includes(ext) || mimeType.startsWith("text/")) {
      return <FileText className="w-4 h-4 text-sky-400" />;
    }
    return <File className="w-4 h-4 text-indigo-400" />;
  };

  // Format file size helper
  const formatBytes = (bytesStr?: string) => {
    if (!bytesStr) return "Desconocido";
    const bytes = parseInt(bytesStr, 10);
    if (isNaN(bytes)) return "Desconocido";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Compute total size of stored files
  const totalFolderBytes = files.reduce((acc, f) => acc + (parseInt(f.size || "0", 10) || 0), 0);

  return (
    <div className="space-y-4">
      {/* 1. Compact Header Banner */}
      <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
            <CloudDownload className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white">Google Drive</h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
                <FolderOpen className="w-3 h-3 text-indigo-400" />
                {folderName}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Descarga directa a Drive, subida de archivos locales y explorador sincronizado.
            </p>
          </div>
        </div>

        {/* Auth Controls & Cookie Persistence */}
        <div className="flex items-center gap-2 self-end md:self-auto flex-wrap">
          {onNavigateToCommander && (
            <button
              onClick={onNavigateToCommander}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/30 text-xs font-semibold text-indigo-300 hover:text-white transition-colors cursor-pointer"
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>Commander</span>
            </button>
          )}

          <button
            onClick={() => setIsCookieModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/40 text-xs text-slate-300 transition-colors cursor-pointer"
          >
            <Cookie className="w-3.5 h-3.5 text-amber-400" />
            <span>Tokens</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                currentUser ? "bg-emerald-400" : "bg-slate-600"
              }`}
            />
          </button>

          {isAuthLoading ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/80 rounded-lg text-xs text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
              <span>Verificando...</span>
            </div>
          ) : currentUser ? (
            <div className="relative" ref={accountMenuRef}>
              <button
                onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)}
                className="flex items-center gap-2 bg-slate-950 hover:bg-slate-850 border border-slate-800 hover:border-indigo-500/50 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer"
              >
                {currentUser.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    alt={currentUser.displayName || "Usuario"}
                    className="w-5 h-5 rounded-full border border-indigo-500/40 shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                    {currentUser.displayName?.[0] || "U"}
                  </div>
                )}
                <span className="text-xs font-medium text-white truncate max-w-[120px] hidden sm:inline">
                  {currentUser.displayName || currentUser.email?.split("@")[0]}
                </span>
                <ChevronDown
                  className={`w-3 h-3 text-slate-400 transition-transform ${
                    isAccountMenuOpen ? "rotate-180 text-indigo-400" : ""
                  }`}
                />
              </button>

              {/* Multi-Account Dropdown Menu */}
              {isAccountMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-64 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl z-50 overflow-hidden">
                  <div className="p-2.5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs">
                    <span className="font-semibold text-white">Cuentas ({driveSession.accounts.length})</span>
                    <button
                      onClick={handleAddAnotherAccount}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
                    >
                      + Agregar
                    </button>
                  </div>

                  <div className="max-h-52 overflow-y-auto p-1 space-y-1">
                    {driveSession.accounts.map((acc) => {
                      const isActive =
                        acc.id === (currentUser.email || currentUser.uid) ||
                        acc.email === currentUser.email;

                      return (
                        <div
                          key={acc.id}
                          onClick={() => {
                            if (!isActive) handleSwitchAccount(acc.id);
                          }}
                          className={`p-2 rounded-lg flex items-center justify-between gap-2 text-xs transition-colors ${
                            isActive
                              ? "bg-indigo-600/15 border border-indigo-500/30 text-white"
                              : "hover:bg-slate-800 text-slate-300 cursor-pointer"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {acc.photoURL ? (
                              <img
                                src={acc.photoURL}
                                alt=""
                                className="w-5 h-5 rounded-full object-cover shrink-0"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-200 shrink-0">
                                {acc.displayName ? acc.displayName[0].toUpperCase() : "G"}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-semibold truncate">{acc.displayName || "Usuario"}</p>
                              <p className="text-[10px] text-slate-400 truncate font-mono">{acc.email}</p>
                            </div>
                          </div>
                          {isActive && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>

                  <div className="p-1.5 border-t border-slate-800 bg-slate-950/80 space-y-0.5 text-xs">
                    <button
                      onClick={handleAddAnotherAccount}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-indigo-300 font-medium transition-colors cursor-pointer text-left"
                    >
                      <UserPlus className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Conectar otra cuenta</span>
                    </button>
                    <button
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        setIsCookieModalOpen(true);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-amber-300 font-medium transition-colors cursor-pointer text-left"
                    >
                      <Cookie className="w-3.5 h-3.5 text-amber-400" />
                      <span>Gestionar Tokens</span>
                    </button>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 text-rose-300 font-medium transition-colors cursor-pointer text-left"
                    >
                      <LogOut className="w-3.5 h-3.5 text-rose-400" />
                      <span>Cerrar sesión</span>
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
            >
              <div className="gsi-material-button-icon">
                <GoogleIcon className="w-4 h-4" />
              </div>
              <span className="gsi-material-button-contents">
                {isSigningIn ? "Conectando..." : "Conectar Drive"}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {downloadSuccess && (
        <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-300 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{downloadSuccess}</span>
          </div>
          <button
            onClick={() => setDownloadSuccess(null)}
            className="text-emerald-400 hover:text-white text-xs font-bold px-1.5 py-0.5"
          >
            ✕
          </button>
        </div>
      )}

      {downloadError && (
        <div className={`p-3 rounded-lg text-xs flex items-center justify-between gap-2 ${
          isSessionExpired
            ? "bg-amber-500/15 border border-amber-500/40 text-amber-200"
            : "bg-rose-500/10 border border-rose-500/30 text-rose-300"
        }`}>
          <div className="flex items-center gap-2">
            <AlertCircle className={`w-4 h-4 shrink-0 ${isSessionExpired ? "text-amber-400" : "text-rose-400"}`} />
            <span>{downloadError}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isSessionExpired && (
              <button
                onClick={handleSignIn}
                disabled={isSigningIn}
                className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                Reconectar
              </button>
            )}
            <button
              onClick={() => {
                setDownloadError(null);
                setIsSessionExpired(false);
              }}
              className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Progress Bar */}
      {downloadProgress.percent > 0 && (
        <div className="bg-slate-900 border border-indigo-500/30 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-indigo-300 font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{downloadProgress.statusText}</span>
            </span>
            <span className="font-mono text-indigo-400 font-semibold">{downloadProgress.percent}%</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-indigo-500 h-full transition-all duration-300"
              style={{ width: `${downloadProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Unauthenticated notice */}
      {!currentUser && !isAuthLoading && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center max-w-md mx-auto space-y-3">
          <Folder className="w-8 h-8 text-indigo-400 mx-auto" />
          <div>
            <h3 className="text-sm font-bold text-white">Google Drive Desconectado</h3>
            <p className="text-xs text-slate-400 mt-1">
              Conecta tu cuenta de Google para transferir y gestionar tus archivos directamente en la nube.
            </p>
          </div>
          <div className="pt-2 flex items-center justify-center gap-2">
            <button
              onClick={handleSignIn}
              disabled={isSigningIn}
              className="gsi-material-button"
            >
              <div className="gsi-material-button-icon">
                <GoogleIcon className="w-4 h-4" />
              </div>
              <span className="gsi-material-button-contents">
                {isSigningIn ? "Conectando..." : "Iniciar con Google"}
              </span>
            </button>
            <button
              onClick={() => setIsCookieModalOpen(true)}
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 hover:border-amber-500/40 text-xs text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              Tokens
            </button>
          </div>
        </div>
      )}

      {/* Main Grid: Tools (Left) & File Explorer (Right) */}
      {currentUser && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column: Actions (7 cols) */}
          <div className="lg:col-span-7 space-y-3">
            {/* Sub-mode selector pills */}
            <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
              <button
                onClick={() => setDownloadMode("proxy")}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer text-center ${
                  downloadMode === "proxy"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-white hover:bg-slate-900"
                }`}
              >
                Descargar URL
              </button>
              <button
                onClick={() => setDownloadMode("local")}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer text-center ${
                  downloadMode === "local"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-white hover:bg-slate-900"
                }`}
              >
                Subir Archivo
              </button>
              <button
                onClick={() => setDownloadMode("diagnostics")}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer text-center ${
                  downloadMode === "diagnostics"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-white hover:bg-slate-900"
                }`}
              >
                Informe Servidor
              </button>
            </div>

            {/* Mode 1: URL Download Form */}
            {downloadMode === "proxy" && (
              <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    URL del Archivo
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      placeholder="https://ejemplo.com/archivo.zip"
                      value={downloadUrl}
                      onChange={(e) => setDownloadUrl(e.target.value)}
                      disabled={isDownloading}
                      className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 focus:border-indigo-500 text-xs font-mono text-white placeholder:text-slate-600 outline-none"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const clip = await navigator.clipboard.readText();
                          if (clip) setDownloadUrl(clip);
                        } catch {}
                      }}
                      className="px-2.5 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer shrink-0"
                    >
                      Pegar
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Nombre Opcional
                    </label>
                    <input
                      type="text"
                      placeholder="archivo.zip"
                      value={customFileName}
                      onChange={(e) => setCustomFileName(e.target.value)}
                      disabled={isDownloading}
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-white placeholder:text-slate-600 outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Destino
                    </label>
                    <div className="px-3 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-xs font-mono text-slate-400 truncate">
                      📁 {folderInfo?.name || folderName}
                    </div>
                  </div>
                </div>

                {/* Quick Presets */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-slate-500">Ejemplos:</span>
                    {samplePresets.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => {
                          setDownloadUrl(preset.url);
                          setCustomFileName(preset.filename);
                        }}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono transition-colors cursor-pointer"
                      >
                        {preset.name.split(" ")[0]}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => handleDownloadFromUrl()}
                    disabled={isDownloading || !downloadUrl.trim()}
                    className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isDownloading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CloudDownload className="w-3.5 h-3.5" />
                    )}
                    <span>Descargar a Drive</span>
                  </button>
                </div>
              </div>
            )}

            {/* Mode 2: Local Upload */}
            {downloadMode === "local" && (
              <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-4 space-y-3">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border border-dashed border-slate-800 hover:border-indigo-500/60 bg-slate-950/60 rounded-xl p-6 text-center cursor-pointer transition-colors group"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleLocalFileUpload}
                    className="hidden"
                  />
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 mx-auto flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                    {isUploadingLocal ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                  </div>
                  <p className="text-xs font-medium text-white group-hover:text-indigo-300">
                    {isUploadingLocal
                      ? "Subiendo a Google Drive..."
                      : "Haz clic para seleccionar o arrastra un archivo"}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5 font-mono">
                    Destino: {folderInfo?.name || folderName}
                  </p>
                </div>
              </div>
            )}

            {/* Mode 3: Server Diagnostics */}
            {downloadMode === "diagnostics" && (
              <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-4 space-y-3">
                <p className="text-xs text-slate-400">
                  Guarda un reporte del estado del servidor directamente en tu Google Drive.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleSaveServerReportToDrive("markdown")}
                    disabled={isDownloading || !serverSpecs}
                    className="p-3 rounded-lg bg-slate-950 hover:bg-slate-850 border border-slate-800 hover:border-indigo-500/40 text-left transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-white mb-0.5">
                      <FileText className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Markdown (.md)</span>
                    </div>
                    <p className="text-[10px] text-slate-400">Reporte legible</p>
                  </button>

                  <button
                    onClick={() => handleSaveServerReportToDrive("json")}
                    disabled={isDownloading || !serverSpecs}
                    className="p-3 rounded-lg bg-slate-950 hover:bg-slate-850 border border-slate-800 hover:border-indigo-500/40 text-left transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold text-white mb-0.5">
                      <FileCode className="w-3.5 h-3.5 text-emerald-400" />
                      <span>JSON (.json)</span>
                    </div>
                    <p className="text-[10px] text-slate-400">Métricas completas</p>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: File Explorer (5 cols) */}
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800/80 rounded-xl p-3.5 flex flex-col min-h-[380px]">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs font-bold text-white">Archivos en Drive</h3>
                <span className="text-[10px] font-mono text-slate-400">({files.length})</span>
              </div>
              <div className="flex items-center gap-1">
                {folderInfo?.webViewLink && (
                  <a
                    href={folderInfo.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded text-slate-400 hover:text-indigo-300 hover:bg-slate-800 transition-colors"
                    title="Abrir en Drive"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <button
                  onClick={handleRefreshFiles}
                  disabled={isFilesLoading}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Refrescar"
                >
                  <RefreshCw className={`w-3 h-3 ${isFilesLoading ? "animate-spin text-indigo-400" : ""}`} />
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="py-2">
              <div className="relative">
                <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar archivo..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-7 pr-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 text-xs font-mono text-white placeholder:text-slate-600 outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Files List */}
            <div className="flex-1 overflow-y-auto space-y-1 pr-0.5 max-h-[300px]">
              {isFilesLoading && files.length === 0 ? (
                <div className="flex items-center justify-center py-10 text-slate-500 text-xs gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Cargando...</span>
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">
                  <p>{searchQuery ? "Sin resultados" : "Carpeta vacía"}</p>
                </div>
              ) : (
                filteredFiles.map((file) => (
                  <div
                    key={file.id}
                    className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/60 hover:border-indigo-500/30 transition-colors flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="shrink-0">{getFileIcon(file.name, file.mimeType)}</div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-200 truncate" title={file.name}>
                          {file.name}
                        </p>
                        <p className="text-[10px] text-slate-500 font-mono">
                          {formatBytes(file.size)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => handleDownloadFileLocally(file)}
                        className="p-1 rounded text-slate-400 hover:text-emerald-300 hover:bg-slate-800 transition-colors cursor-pointer"
                        title="Descargar"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleRequestDelete(file)}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                        title="Eliminar"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Folder Footer Summary */}
            <div className="pt-2 border-t border-slate-800/80 mt-auto flex items-center justify-between text-[10px] font-mono text-slate-500">
              <span>{filteredFiles.length} archivos</span>
              <span>{(totalFolderBytes / (1024 * 1024)).toFixed(1)} MB</span>
            </div>
          </div>
        </div>
      )}

      {/* Mandatory User Confirmation Dialog for File Deletion */}
      <DriveDeleteModal
        file={fileToDelete}
        isOpen={isDeleteModalOpen}
        isDeleting={isDeleting}
        onConfirm={handleConfirmDelete}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setFileToDelete(null);
        }}
      />

      {/* Client-Side Cookie and Permanent Session Manager Modal */}
      <DriveCookieModal
        isOpen={isCookieModalOpen}
        onClose={() => setIsCookieModalOpen(false)}
        session={driveSession}
        accessToken={accessToken}
        onRenew={handleSignIn}
        onAddAnotherAccount={handleAddAnotherAccount}
        onSwitchAccount={handleSwitchAccount}
        onRemoveAccount={handleRemoveAccount}
        onSaveManualToken={handleSaveManualToken}
        onClearSession={handleClearAllAccounts}
      />
    </div>
  );
};
