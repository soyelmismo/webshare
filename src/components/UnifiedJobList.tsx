import React, { useState, useEffect, useCallback } from "react";
import {
  CloudLightning,
  Zap,
  RefreshCw,
  Play,
  Pause,
  Square,
  Trash2,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ChevronDown,
  Search,
  Filter,
  Upload,
  HardDrive,
  UserPlus,
  Check,
  Activity,
  FileCode,
  Sparkles,
  HelpCircle,
  Clock,
  ArrowUpRight,
  Database,
  CloudDownload,
  Folder,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  Sliders,
  ListOrdered,
} from "lucide-react";
import { SequentialStreamJob, StreamDriveTask } from "../types";
import { StoredDriveSession, loadDriveSession, setActiveAccount, onDriveSessionChange } from "../utils/driveStorage";
import { googleSignIn } from "../utils/firebaseAuth";
import { getQueueConfig, updateQueueConfig, reorderStreamQueue } from "../utils/streamApi";

export interface UnifiedJobItem {
  id: string;
  filename: string;
  sourceUrl: string;
  engineType: "stream" | "sequential" | "proxy";
  status: "starting" | "streaming" | "downloading" | "paused" | "completed" | "failed" | "error" | "cancelled" | "queued";
  queueIndex?: number;
  totalInBatch?: number;
  progressPercent: number;
  downloadSpeedStr: string;
  uploadSpeedStr: string;
  downloadedBytes: number;
  totalBytes: number;
  destination: "drive" | "server" | "both";
  startedAt: number;
  completedAt?: number;
  error?: string;
  webViewLink?: string;
  filePath?: string;
  savedToDrive?: boolean;
  uploadStatus?: "idle" | "uploading" | "completed" | "error";
  uploadProgress?: number;
  sourceType?: "torrent" | "direct";
  peers?: number;
  rawStreamTask?: StreamDriveTask;
  rawSequentialJob?: SequentialStreamJob;
}

interface UnifiedJobListProps {
  session?: StoredDriveSession;
  accessToken?: string | null;
  folderId?: string;
  folderName?: string;
  onOpenConnectModal?: () => void;
  onRefreshFiles?: () => void;
  onJobSelect?: (job: UnifiedJobItem) => void;
}

const LOCAL_JOBS_CACHE_KEY = "gdrive_unified_jobs_cache";
const LOCAL_DELETED_JOBS_KEY = "gdrive_unified_deleted_jobs";

function getDeletedJobIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(LOCAL_DELETED_JOBS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function addDeletedJobId(jobId: string) {
  if (typeof window === "undefined") return;
  try {
    const set = getDeletedJobIds();
    set.add(jobId);
    localStorage.setItem(LOCAL_DELETED_JOBS_KEY, JSON.stringify(Array.from(set).slice(-100)));
  } catch {}
}

function getCachedJobs(): UnifiedJobItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_JOBS_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCachedJobs(jobs: UnifiedJobItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_JOBS_CACHE_KEY, JSON.stringify(jobs.slice(0, 50)));
  } catch {
    // Ignore storage quota errors
  }
}

export const UnifiedJobList: React.FC<UnifiedJobListProps> = ({
  session: propSession,
  accessToken,
  folderId: propFolderId,
  folderName: _folderName = "Descargas Servidor",
  onOpenConnectModal,
  onRefreshFiles,
  onJobSelect,
}) => {
  const [driveSession, setDriveSession] = useState<StoredDriveSession>(() => propSession || loadDriveSession());
  const [unifiedJobs, setUnifiedJobs] = useState<UnifiedJobItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filterType, setFilterType] = useState<"all" | "active" | "stream" | "sequential" | "completed">("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // Recovery state
  const [isRecovering, setIsRecovering] = useState<boolean>(false);
  const [recoveryNotice, setRecoveryNotice] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // Audit modal state
  const [auditingJob, setAuditingJob] = useState<UnifiedJobItem | null>(null);
  const [auditResult, setAuditResult] = useState<any | null>(null);
  const [isAuditing, setIsAuditing] = useState<boolean>(false);

  // Action loading states
  const [actionJobId, setActionJobId] = useState<string | null>(null);

  // Account dropdown state
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState<boolean>(false);

  // BitTorrent Queue configuration state
  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState<number>(2);
  const [isUpdatingQueue, setIsUpdatingQueue] = useState<boolean>(false);

  useEffect(() => {
    getQueueConfig()
      .then((cfg) => {
        if (cfg?.maxConcurrentDownloads) {
          setMaxConcurrentDownloads(cfg.maxConcurrentDownloads);
        }
      })
      .catch(() => {});
  }, []);

  const activeToken = accessToken || driveSession?.token || null;
  const activeAccountEmail = driveSession?.activeAccount?.email || driveSession?.user?.email || "";
  const activeFolderId = propFolderId || driveSession?.folder?.id || driveSession?.activeAccount?.folder?.id || "";

  // Poll tasks from backend APIs every 1.5 seconds
  const fetchAllJobs = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (activeToken) {
        headers["Authorization"] = `Bearer ${activeToken}`;
      }

      // 1. Fetch Stream Tasks for active account
      const streamUrl = `/api/stream/tasks?folderId=${encodeURIComponent(activeFolderId)}&accountEmail=${encodeURIComponent(activeAccountEmail)}`;
      const streamRes = await fetch(streamUrl, { headers }).catch(() => null);
      let streamTasks: StreamDriveTask[] = [];
      if (streamRes && streamRes.ok) {
        streamTasks = await streamRes.json().catch(() => []);
      }

      // 2. Fetch Sequential Jobs for active account
      const seqUrl = `/api/sequential/jobs?folderId=${encodeURIComponent(activeFolderId)}&accountEmail=${encodeURIComponent(activeAccountEmail)}`;
      const seqRes = await fetch(seqUrl, { headers }).catch(() => null);
      let seqJobs: SequentialStreamJob[] = [];
      if (seqRes && seqRes.ok) {
        seqJobs = await seqRes.json().catch(() => []);
      }

      // 3. Normalize Stream Tasks
      const normalizedStream: UnifiedJobItem[] = (Array.isArray(streamTasks) ? streamTasks : []).map((st) => ({
        id: st.id,
        filename: st.fileName || "Sin nombre",
        sourceUrl: st.sourceUrl || "",
        engineType: "stream",
        status:
          st.status === "streaming"
            ? "streaming"
            : st.status === "completed"
            ? "completed"
            : st.status === "paused"
            ? "paused"
            : st.status === "queued"
            ? "queued"
            : st.status === "error"
            ? "failed"
            : "starting",
        queueIndex: st.queueIndex,
        totalInBatch: st.totalInBatch,
        progressPercent: Math.round(st.progressPercent || 0),
        downloadSpeedStr:
          st.sourceType === "torrent" && typeof st.torrentSpeedMBs === "number" && st.torrentSpeedMBs > 0
            ? `${st.torrentSpeedMBs.toFixed(1)} MB/s`
            : st.speedMBs
            ? `${st.speedMBs.toFixed(1)} MB/s`
            : "0 MB/s",
        uploadSpeedStr: st.speedMBs ? `${st.speedMBs.toFixed(1)} MB/s` : "0 MB/s",
        downloadedBytes: st.uploadedBytes || 0,
        totalBytes: st.fileSize || 0,
        destination: "drive",
        startedAt: st.startedAt || Date.now(),
        completedAt: st.completedAt,
        error: st.error,
        webViewLink: st.webViewLink,
        savedToDrive: st.status === "completed",
        filePath: st.selectedFilePath,
        rawStreamTask: st,
        peers: st.peers,
        sourceType: st.sourceType,
      }));

      // 4. Normalize Sequential Jobs
      const normalizedSeq: UnifiedJobItem[] = (Array.isArray(seqJobs) ? seqJobs : []).map((sj) => ({
        id: sj.id,
        filename: sj.customName || sj.fileName || "Sin nombre",
        sourceUrl: sj.url || "",
        engineType: "sequential",
        status: sj.status === "cancelled" ? "cancelled" : sj.status,
        progressPercent: Math.round(sj.progress || 0),
        downloadSpeedStr: sj.speed || sj.downloadSpeed || "0 MB/s",
        uploadSpeedStr: sj.uploadSpeed || (sj.uploadProgress ? `${sj.uploadProgress}%` : "0 MB/s"),
        downloadedBytes: sj.downloadedBytes || 0,
        totalBytes: sj.totalBytes || sj.fileSize || 0,
        destination: sj.destination || "drive",
        startedAt: sj.startedAt || Date.now(),
        completedAt: sj.completedAt,
        error: sj.error,
        webViewLink: sj.driveFile?.webViewLink,
        filePath: sj.filePath,
        savedToDrive: sj.savedToDrive || sj.uploadStatus === "completed",
        uploadStatus: sj.uploadStatus,
        uploadProgress: sj.uploadProgress,
        rawSequentialJob: sj,
      }));

      // 5. Combine and merge with local cache to survive serverless instance switching
      const freshCombined = [...normalizedStream, ...normalizedSeq];
      const cached = getCachedJobs();
      const deletedIds = getDeletedJobIds();

      const jobsMap = new Map<string, UnifiedJobItem>();

      // Populate from cache first (excluding deleted and other accounts)
      for (const cj of cached) {
        if (!deletedIds.has(cj.id)) {
          const cjEmail = cj.rawStreamTask?.accountEmail || cj.rawSequentialJob?.accountEmail;
          if (activeAccountEmail && cjEmail && cjEmail.toLowerCase() !== activeAccountEmail.toLowerCase()) continue;
          jobsMap.set(cj.id, cj);
        }
      }

      // Overwrite/update with fresh server tasks with monotonic protection
      for (const fj of freshCombined) {
        if (!deletedIds.has(fj.id)) {
          const existing = jobsMap.get(fj.id);
          if (existing && (existing.status === "streaming" || existing.status === "downloading" || existing.status === "starting")) {
            // Prevent progress from bouncing backwards if a serverless instance returns a stale progress value
            fj.downloadedBytes = Math.max(existing.downloadedBytes || 0, fj.downloadedBytes || 0);
            fj.progressPercent = Math.max(existing.progressPercent || 0, fj.progressPercent || 0);
            if (fj.status === "paused" && existing.status === "streaming" && fj.progressPercent < 100) {
              fj.status = "streaming";
            }
          }
          jobsMap.set(fj.id, fj);
        }
      }

      const merged = Array.from(jobsMap.values()).sort((a, b) => {
        const getPriority = (status: string) => {
          if (status === "streaming" || status === "downloading" || status === "starting") return 1;
          if (status === "queued") return 2;
          if (status === "paused") return 3;
          return 4; // completed, failed, cancelled
        };

        const prioA = getPriority(a.status);
        const prioB = getPriority(b.status);

        if (prioA !== prioB) {
          return prioA - prioB;
        }

        // Within queued jobs, sort by queueIndex ascending (1, 2, 3...)
        if (a.status === "queued" && b.status === "queued") {
          const qA = typeof a.queueIndex === "number" ? a.queueIndex : 9999;
          const qB = typeof b.queueIndex === "number" ? b.queueIndex : 9999;
          if (qA !== qB) return qA - qB;
          return a.startedAt - b.startedAt;
        }

        return b.startedAt - a.startedAt;
      });
      saveCachedJobs(merged);

      setUnifiedJobs((prev) => {
        const isDifferent =
          prev.length !== merged.length ||
          prev.some((p, i) => {
            const m = merged[i];
            return (
              !m ||
              p.id !== m.id ||
              p.status !== m.status ||
              p.queueIndex !== m.queueIndex ||
              p.progressPercent !== m.progressPercent ||
              p.downloadedBytes !== m.downloadedBytes ||
              p.downloadSpeedStr !== m.downloadSpeedStr ||
              p.peers !== m.peers ||
              p.error !== m.error
            );
          });
        return isDifferent ? merged : prev;
      });

      if (!selectedJobId && merged.length > 0) {
        setSelectedJobId(merged[0].id);
      }
    } catch (e) {
      console.warn("Error fetching unified jobs:", e);
    } finally {
      setIsLoading(false);
    }
  }, [selectedJobId, activeToken, activeFolderId]);

  useEffect(() => {
    fetchAllJobs();
    const hasActiveTasks = unifiedJobs.some(
      (j) => j.status === "streaming" || j.status === "downloading" || j.status === "starting" || j.status === "queued"
    );
    const intervalMs = hasActiveTasks ? 800 : 3000;
    const timer = setInterval(fetchAllJobs, intervalMs);
    return () => clearInterval(timer);
  }, [fetchAllJobs, unifiedJobs]);

  // Keep local drive session updated
  useEffect(() => {
    const session = propSession || loadDriveSession();
    setDriveSession(session);
  }, [propSession]);

  useEffect(() => {
    const unsubscribe = onDriveSessionChange((updated) => {
      setDriveSession(updated);
    });
    return () => unsubscribe();
  }, []);

  // Handle Recover Jobs from Google Drive
  const handleRecoverJobsFromDrive = async () => {
    if (!activeToken) {
      setRecoveryNotice({
        type: "error",
        message: "Conecta una cuenta de Google Drive para buscar y recuperar tareas en la nube.",
      });
      return;
    }

    setIsRecovering(true);
    setRecoveryNotice(null);

    try {
      // Clear deleted jobs cache so recovered tasks are not filtered out locally
      if (typeof window !== "undefined") {
        try {
          localStorage.removeItem(LOCAL_DELETED_JOBS_KEY);
        } catch {}
      }

      const res = await fetch("/api/stream/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: activeToken,
          folderId: activeFolderId,
          accountEmail: activeAccountEmail,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Fallo al consultar Google Drive.");
      }

      const recoveredStream = data.recoveredCount || 0;
      const resumedSeq = data.resumedSequentialCount || 0;
      const totalRecovered = recoveredStream + resumedSeq;

      if (totalRecovered > 0) {
        setRecoveryNotice({
          type: "success",
          message: `¡Recuperación completada! Se restauraron ${recoveredStream} tareas de streaming directo y ${resumedSeq} descargas secuenciales desde los manifiestos en Google Drive.`,
        });
      } else {
        setRecoveryNotice({
          type: "info",
          message: "No se encontraron manifiestos de tareas pendientes o interrumpidas en tu carpeta de Google Drive.",
        });
      }

      await fetchAllJobs();
      if (onRefreshFiles) onRefreshFiles();
    } catch (err: any) {
      setRecoveryNotice({
        type: "error",
        message: err.message || "Error al intentar recuperar tareas desde Google Drive.",
      });
    } finally {
      setIsRecovering(false);
    }
  };

  // Job Action Handlers
  const handlePauseJob = async (job: UnifiedJobItem) => {
    setActionJobId(job.id);
    try {
      if (job.engineType === "stream") {
        await fetch("/api/stream/pause", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: job.id, accessToken: activeToken }),
        });
      } else {
        await fetch(`/api/sequential/jobs/${job.id}/pause`, { method: "POST" });
      }
      await fetchAllJobs();
    } catch (e) {
      console.error("Error pausing job:", e);
    } finally {
      setActionJobId(null);
    }
  };

  const handleResumeJob = async (job: UnifiedJobItem) => {
    setActionJobId(job.id);
    try {
      if (job.engineType === "stream") {
        await fetch("/api/stream/resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: job.id, accessToken: activeToken }),
        });
      } else {
        await fetch(`/api/sequential/jobs/${job.id}/resume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: activeToken, folderId: activeFolderId }),
        });
      }
      await fetchAllJobs();
    } catch (e) {
      console.error("Error resuming job:", e);
    } finally {
      setActionJobId(null);
    }
  };

  const removeJobFromCacheAndState = (jobId: string) => {
    addDeletedJobId(jobId);
    setUnifiedJobs((prev) => {
      const updated = prev.filter((j) => j.id !== jobId);
      saveCachedJobs(updated);
      return updated;
    });
  };

  const handleCancelJob = async (job: UnifiedJobItem) => {
    setActionJobId(job.id);
    try {
      if (job.engineType === "stream") {
        await fetch("/api/stream/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: job.id, accessToken: activeToken }),
        });
      } else {
        await fetch(`/api/sequential/jobs/${job.id}/cancel`, { method: "POST" });
      }
      removeJobFromCacheAndState(job.id);
      await fetchAllJobs();
    } catch (e) {
      console.error("Error canceling job:", e);
    } finally {
      setActionJobId(null);
    }
  };

  const handleDeleteJob = async (job: UnifiedJobItem) => {
    setActionJobId(job.id);
    try {
      if (job.engineType === "sequential") {
        await fetch(`/api/sequential/jobs/${job.id}`, { method: "DELETE" });
      } else {
        await fetch("/api/stream/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: job.id, accessToken: activeToken }),
        });
      }
      removeJobFromCacheAndState(job.id);
      await fetchAllJobs();
    } catch (e) {
      console.error("Error deleting job:", e);
    } finally {
      setActionJobId(null);
    }
  };

  const handleUploadToDrive = async (job: UnifiedJobItem) => {
    if (!activeToken || !activeFolderId) {
      setRecoveryNotice({
        type: "error",
        message: "Inicia sesión con Google Drive para subir este archivo local a tu nube.",
      });
      return;
    }

    setActionJobId(job.id);
    try {
      const res = await fetch(`/api/sequential/jobs/${job.id}/upload-to-drive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: activeToken, folderId: activeFolderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al iniciar subida.");
      setRecoveryNotice({
        type: "success",
        message: `Subida iniciada para "${job.filename}".`,
      });
      await fetchAllJobs();
    } catch (err: any) {
      setRecoveryNotice({ type: "error", message: err.message });
    } finally {
      setActionJobId(null);
    }
  };

  const handleAuditStreamSession = async (job: UnifiedJobItem) => {
    setAuditingJob(job);
    setIsAuditing(true);
    setAuditResult(null);

    try {
      const res = await fetch("/api/stream/audit-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: job.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setAuditResult(data.audit);
      } else {
        setAuditResult({ error: data.error || "Error al auditar sesión" });
      }
    } catch (e: any) {
      setAuditResult({ error: e.message });
    } finally {
      setIsAuditing(false);
    }
  };

  // Switch Drive account inline
  const handleSwitchDriveAccount = (accId: string) => {
    setIsAccountDropdownOpen(false);
    const switched = setActiveAccount(accId);
    if (switched) {
      setSelectedJobId(null);
      setUnifiedJobs([]);
      setDriveSession(loadDriveSession());
      setRecoveryNotice({
        type: "success",
        message: `Cuenta de Drive cambiada a: ${switched.email || switched.displayName}`,
      });
    }
  };

  const handleAddDriveAccount = async () => {
    setIsAccountDropdownOpen(false);
    try {
      const res = await googleSignIn(true);
      if (res) {
        setDriveSession(loadDriveSession());
        setRecoveryNotice({
          type: "success",
          message: `¡Cuenta agregada y activada: ${res.account.email || res.user.displayName}!`,
        });
      }
    } catch (e: any) {
      if (!e?.message?.includes("popup-closed")) {
        setRecoveryNotice({ type: "error", message: e.message || "Error al agregar cuenta." });
      }
    }
  };

  // BitTorrent Queue Handlers
  const handleUpdateConcurrency = async (newLimit: number) => {
    if (newLimit < 1 || newLimit > 10) return;
    setIsUpdatingQueue(true);
    try {
      const res = await updateQueueConfig(newLimit);
      if (res.success) {
        setMaxConcurrentDownloads(res.maxConcurrentDownloads);
        await fetchAllJobs();
      }
    } catch (err) {
      console.warn("Error updating queue config:", err);
    } finally {
      setIsUpdatingQueue(false);
    }
  };

  const handleReorderQueue = async (taskId: string, action: "up" | "down" | "top" | "bottom") => {
    setActionJobId(taskId);
    try {
      const success = await reorderStreamQueue(
        taskId,
        action,
        activeToken || undefined,
        activeAccountEmail || undefined
      );
      if (success) {
        await fetchAllJobs();
      }
    } catch (err) {
      console.warn("Error reordering queue:", err);
    } finally {
      setActionJobId(null);
    }
  };

  // Filter jobs
  const filteredJobs = unifiedJobs.filter((job) => {
    // Filter by type/status
    if (filterType === "active") {
      if (job.status !== "streaming" && job.status !== "downloading" && job.status !== "starting" && job.status !== "queued") return false;
    } else if (filterType === "stream") {
      if (job.engineType !== "stream") return false;
    } else if (filterType === "sequential") {
      if (job.engineType !== "sequential") return false;
    } else if (filterType === "completed") {
      if (job.status !== "completed") return false;
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      return job.filename.toLowerCase().includes(query) || job.sourceUrl.toLowerCase().includes(query);
    }

    return true;
  });

  const selectedJob = unifiedJobs.find((j) => j.id === selectedJobId) || filteredJobs[0];

  // Helper stats
  const streamingCount = unifiedJobs.filter(
    (j) => j.status === "streaming" || j.status === "downloading" || j.status === "starting"
  ).length;
  const queuedCount = unifiedJobs.filter((j) => j.status === "queued").length;
  const activeCount = streamingCount + queuedCount;
  const completedCount = unifiedJobs.filter((j) => j.status === "completed").length;

  return (
    <div className="space-y-4">
      {/* Top Bar: Controls, Drive Account Selector & Recover Button */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-[#1f242c] border border-[#3b424d] text-[#10b981] shrink-0">
            <Activity className="w-5 h-5 text-[#10b981]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-[#f3f4f6]">Listado Unificado de Jobs</h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#161a1f] text-[#10b981] border border-[#262b32]">
                {activeCount} Activos / {unifiedJobs.length} Total
              </span>
            </div>
            <p className="text-xs text-[#9ca3af]">
              Gestiona todas tus transferencias (Streaming Zero-Disk y Descargas Secuenciales) en un solo panel centralizado.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap self-end md:self-auto">
          {/* Button: Recover Jobs from Drive */}
          <button
            onClick={handleRecoverJobsFromDrive}
            disabled={isRecovering || !activeToken}
            title="Sincroniza y recupera trabajos guardados en los manifiestos de tu Google Drive"
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold bg-[#1f242c] hover:bg-[#262b32] text-[#34d399] border border-[#059669]/60 hover:border-[#10b981] transition-all cursor-pointer disabled:opacity-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#10b981] ${isRecovering ? "animate-spin" : ""}`} />
            <span>{isRecovering ? "Buscando en Drive..." : "Recuperar Jobs de Drive"}</span>
          </button>

          {/* Drive Account Selector Dropdown */}
          <div className="relative">
            {activeToken ? (
              <button
                onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
                className="flex items-center gap-2 bg-[#1a1e24] hover:bg-[#222831] border border-[#262b32] rounded-lg px-3 py-1.5 transition-colors cursor-pointer text-xs font-medium text-[#f3f4f6]"
              >
                <div className="w-2 h-2 rounded-full bg-[#10b981]" />
                <span className="font-mono text-xs truncate max-w-[130px]">
                  {driveSession.activeAccount?.email || driveSession.user?.email || "Google Drive"}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-[#9ca3af]" />
              </button>
            ) : (
              <button
                onClick={onOpenConnectModal || handleAddDriveAccount}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e] transition-colors cursor-pointer shadow-sm"
              >
                <CloudDownload className="w-3.5 h-3.5" />
                <span>Conectar Drive</span>
              </button>
            )}

            {/* Account Selector Menu */}
            {isAccountDropdownOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl bg-[#14171a] border border-[#22272e] shadow-2xl z-50 overflow-hidden">
                <div className="p-2.5 border-b border-[#22272e] bg-[#101317] flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#f3f4f6]">Seleccionar Cuenta Drive</span>
                  <button
                    onClick={handleAddDriveAccount}
                    className="text-[11px] text-[#10b981] font-semibold hover:underline cursor-pointer"
                  >
                    + Agregar
                  </button>
                </div>

                <div className="max-h-48 overflow-y-auto p-1 space-y-1">
                  {driveSession.accounts.map((acc) => {
                    const isActive =
                      acc.id === driveSession.activeAccount?.id || acc.email === driveSession.user?.email;

                    return (
                      <div
                        key={acc.id}
                        onClick={() => handleSwitchDriveAccount(acc.id)}
                        className={`p-2 rounded-lg flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
                          isActive
                            ? "bg-[#1a1e24] border border-[#10b981]/50 text-[#f3f4f6]"
                            : "hover:bg-[#1a1e24] text-[#9ca3af]"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-[#f3f4f6] truncate">{acc.displayName || "Usuario"}</p>
                          <p className="text-[10px] text-[#6b7280] truncate font-mono">{acc.email}</p>
                        </div>
                        {isActive && <Check className="w-3.5 h-3.5 text-[#10b981] shrink-0" />}
                      </div>
                    );
                  })}
                </div>

                <div className="p-2 border-t border-[#22272e] bg-[#101317]">
                  <button
                    onClick={handleAddDriveAccount}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[#1a1e24] text-xs text-[#10b981] font-medium transition-colors cursor-pointer text-left"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Conectar otra cuenta de Google</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* BitTorrent Queue Manager & Concurrency Control Bar */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm font-sans text-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#1f242c] border border-[#3b424d] text-[#f59e0b] shrink-0">
            <ListOrdered className="w-4 h-4 text-[#f59e0b]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#f3f4f6]">Cola de Descarga BitTorrent</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#161a1f] text-[#60a5fa] border border-[#262b32]">
                {streamingCount}/{maxConcurrentDownloads} slots activos
              </span>
              {queuedCount > 0 && (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#78350f]/30 text-[#f59e0b] border border-[#f59e0b]/40 font-semibold">
                  {queuedCount} en espera
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#9ca3af]">
              Despacho autónomo: promueve automáticamente los torrents en cola cuando se libera un slot.
            </p>
          </div>
        </div>

        {/* Concurrency Selector */}
        <div className="flex items-center gap-2 bg-[#101317] p-1.5 rounded-lg border border-[#22272e] self-end sm:self-auto">
          <div className="flex items-center gap-1.5 text-[11px] text-[#9ca3af] px-1 font-mono">
            <Sliders className="w-3.5 h-3.5 text-[#10b981]" />
            <span>Simultáneos:</span>
          </div>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 5].map((num) => (
              <button
                key={num}
                onClick={() => handleUpdateConcurrency(num)}
                disabled={isUpdatingQueue}
                className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-all cursor-pointer ${
                  maxConcurrentDownloads === num
                    ? "bg-[#10b981] text-[#0b0d0e] shadow-sm"
                    : "text-[#9ca3af] hover:text-[#f3f4f6] hover:bg-[#1f242c]"
                }`}
                title={`Limitar a máximo ${num} transferencias simultáneas activas`}
              >
                {num}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Recovery / Action Notice Banner */}
      {recoveryNotice && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-2 shadow-sm ${
            recoveryNotice.type === "success"
              ? "bg-[#064e3b]/30 border-[#059669]/60 text-[#34d399]"
              : recoveryNotice.type === "error"
              ? "bg-[#7f1d1d]/30 border-[#ef4444]/40 text-[#f87171]"
              : "bg-[#1f242c] border-[#3b424d] text-[#60a5fa]"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {recoveryNotice.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-[#10b981] shrink-0" />
            ) : recoveryNotice.type === "error" ? (
              <AlertCircle className="w-4 h-4 text-[#ef4444] shrink-0" />
            ) : (
              <Sparkles className="w-4 h-4 text-[#60a5fa] shrink-0" />
            )}
            <span className="truncate">{recoveryNotice.message}</span>
          </div>
          <button
            onClick={() => setRecoveryNotice(null)}
            className="text-xs font-bold px-1.5 py-0.5 hover:text-[#f3f4f6] cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filters & Search Bar */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Sub-filter tabs */}
        <div className="flex items-center gap-1 bg-[#101317] p-1 rounded-lg border border-[#22272e] w-full sm:w-auto">
          <button
            onClick={() => setFilterType("all")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              filterType === "all"
                ? "bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d]"
                : "text-[#9ca3af] hover:text-[#f3f4f6]"
            }`}
          >
            Todos ({unifiedJobs.length})
          </button>
          <button
            onClick={() => setFilterType("active")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              filterType === "active"
                ? "bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d]"
                : "text-[#9ca3af] hover:text-[#f3f4f6]"
            }`}
          >
            En Curso ({activeCount})
          </button>
          <button
            onClick={() => setFilterType("stream")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
              filterType === "stream"
                ? "bg-[#1f242c] text-[#10b981] border border-[#3b424d]"
                : "text-[#9ca3af] hover:text-[#f3f4f6]"
            }`}
          >
            <CloudLightning className="w-3 h-3" />
            Streaming
          </button>
          <button
            onClick={() => setFilterType("sequential")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
              filterType === "sequential"
                ? "bg-[#1f242c] text-[#3b82f6] border border-[#3b424d]"
                : "text-[#9ca3af] hover:text-[#f3f4f6]"
            }`}
          >
            <Zap className="w-3 h-3" />
            Secuencial
          </button>
          <button
            onClick={() => setFilterType("completed")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              filterType === "completed"
                ? "bg-[#1f242c] text-[#34d399] border border-[#3b424d]"
                : "text-[#9ca3af] hover:text-[#f3f4f6]"
            }`}
          >
            Completados ({completedCount})
          </button>
        </div>

        {/* Search input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-[#9ca3af] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por nombre o URL..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#101317] border border-[#22272e] text-xs font-mono text-[#f3f4f6] placeholder-[#6b7280] outline-none focus:border-[#10b981]"
          />
        </div>
      </div>

      {/* Main Container: Active Job Inspector (Top) + Unified Table (Bottom) */}
      <div className="space-y-4">
        {/* Selected / Active Job Detail View */}
        {selectedJob && (
          <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-3 font-mono text-xs shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-[#f3f4f6] text-sm truncate">
                    {selectedJob.filename}
                  </span>
                  {selectedJob.filePath && selectedJob.filePath !== selectedJob.filename && (
                    <span className="text-[10px] font-mono text-[#9ca3af] flex items-center gap-1 bg-[#101317] px-2 py-0.5 rounded border border-[#22272e]">
                      <Folder className="w-3 h-3 text-[#10b981]" />
                      <span className="truncate">{selectedJob.filePath}</span>
                    </span>
                  )}

                  {/* Engine Badge */}
                  {selectedJob.engineType === "stream" ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#064e3b] text-[#34d399] border border-[#059669]/60 flex items-center gap-1">
                      <CloudLightning className="w-3 h-3" />
                      ⚡ Direct Streaming Zero-Disk
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#1e3a8a]/40 text-[#60a5fa] border border-[#3b82f6]/40 flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      🚀 Sequential Chunk Engine
                    </span>
                  )}

                  {/* Status Badge */}
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                      selectedJob.status === "completed"
                        ? "bg-[#064e3b] text-[#34d399] border border-[#059669]/60"
                        : selectedJob.status === "streaming" || selectedJob.status === "downloading"
                        ? "bg-[#1e3a8a]/40 text-[#60a5fa] border border-[#3b82f6]/40 animate-pulse"
                        : selectedJob.status === "queued"
                        ? "bg-[#78350f]/30 text-[#f59e0b] border border-[#f59e0b]/40 font-semibold"
                        : selectedJob.status === "paused"
                        ? "bg-[#78350f]/40 text-[#f59e0b] border border-[#f59e0b]/40"
                        : selectedJob.status === "failed" || selectedJob.status === "error"
                        ? "bg-[#7f1d1d]/40 text-[#f87171] border border-[#ef4444]/40"
                        : "bg-[#1f242c] text-[#9ca3af] border border-[#3b424d]"
                    }`}
                  >
                    {selectedJob.status === "queued"
                      ? `En cola ${selectedJob.queueIndex ? `#${selectedJob.queueIndex}${selectedJob.totalInBatch ? `/${selectedJob.totalInBatch}` : ""}` : ""}`
                      : selectedJob.status}
                  </span>
                </div>

                <p className="text-[11px] text-[#9ca3af] truncate mt-1">
                  URL Origen: {selectedJob.sourceUrl}
                </p>
              </div>

              {/* Individual Controls */}
              <div className="flex items-center gap-2 shrink-0">
                {selectedJob.status === "queued" && selectedJob.engineType === "stream" && (
                  <div className="flex items-center gap-1 bg-[#101317] p-1 rounded-lg border border-[#22272e]">
                    <span className="text-[10px] text-[#f59e0b] px-1.5 font-bold font-mono">
                      Prioridad Cola:
                    </span>
                    <button
                      onClick={() => handleReorderQueue(selectedJob.id, "top")}
                      disabled={actionJobId === selectedJob.id || selectedJob.queueIndex === 1}
                      className="p-1.5 rounded text-[#9ca3af] hover:text-[#34d399] hover:bg-[#1f242c] disabled:opacity-30 transition-colors cursor-pointer"
                      title="Mover al inicio de la cola (Top)"
                    >
                      <ChevronsUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleReorderQueue(selectedJob.id, "up")}
                      disabled={actionJobId === selectedJob.id || selectedJob.queueIndex === 1}
                      className="p-1.5 rounded text-[#9ca3af] hover:text-[#34d399] hover:bg-[#1f242c] disabled:opacity-30 transition-colors cursor-pointer"
                      title="Subir prioridad (▲)"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleReorderQueue(selectedJob.id, "down")}
                      disabled={actionJobId === selectedJob.id}
                      className="p-1.5 rounded text-[#9ca3af] hover:text-[#34d399] hover:bg-[#1f242c] disabled:opacity-30 transition-colors cursor-pointer"
                      title="Bajar prioridad (▼)"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleReorderQueue(selectedJob.id, "bottom")}
                      disabled={actionJobId === selectedJob.id}
                      className="p-1.5 rounded text-[#9ca3af] hover:text-[#34d399] hover:bg-[#1f242c] disabled:opacity-30 transition-colors cursor-pointer"
                      title="Mover al final de la cola (Bottom)"
                    >
                      <ChevronsDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {(selectedJob.status === "streaming" || selectedJob.status === "downloading") && (
                  <button
                    onClick={() => handlePauseJob(selectedJob)}
                    disabled={actionJobId === selectedJob.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#78350f]/30 text-[#f59e0b] border border-[#f59e0b]/40 hover:bg-[#78350f]/60 font-semibold cursor-pointer text-xs"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pausar</span>
                  </button>
                )}

                {selectedJob.status === "paused" && (
                  <button
                    onClick={() => handleResumeJob(selectedJob)}
                    disabled={actionJobId === selectedJob.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#064e3b]/40 text-[#34d399] border border-[#059669]/60 hover:bg-[#064e3b]/70 font-semibold cursor-pointer text-xs"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Reanudar</span>
                  </button>
                )}

                {selectedJob.engineType === "stream" && selectedJob.status !== "completed" && (
                  <button
                    onClick={() => handleAuditStreamSession(selectedJob)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d] hover:bg-[#262b32] font-semibold cursor-pointer text-xs"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-[#10b981]" />
                    <span>Auditar Sesión</span>
                  </button>
                )}

                {selectedJob.engineType === "sequential" &&
                  selectedJob.destination !== "drive" &&
                  !selectedJob.savedToDrive &&
                  selectedJob.filePath && (
                    <button
                      onClick={() => handleUploadToDrive(selectedJob)}
                      disabled={actionJobId === selectedJob.id}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#10b981] text-[#0b0d0e] font-bold hover:bg-[#059669] cursor-pointer text-xs"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Subir a Drive</span>
                    </button>
                  )}

                {selectedJob.webViewLink && (
                  <a
                    href={selectedJob.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#101317] text-[#10b981] border border-[#059669]/60 hover:bg-[#161a1f] font-semibold text-xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Ver en Drive</span>
                  </a>
                )}

                <button
                  onClick={() => handleDeleteJob(selectedJob)}
                  disabled={actionJobId === selectedJob.id}
                  className="p-1.5 rounded-lg bg-[#7f1d1d]/20 text-[#f87171] border border-[#ef4444]/30 hover:bg-[#7f1d1d]/50 cursor-pointer"
                  title="Eliminar de la lista"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1">
              <div className="w-full bg-[#101317] h-3 rounded-full overflow-hidden flex border border-[#22272e]">
                <div
                  style={{ width: `${Math.max(1, selectedJob.progressPercent || 0)}%` }}
                  className={`h-full transition-all duration-300 ${
                    selectedJob.status === "completed"
                      ? "bg-[#10b981]"
                      : selectedJob.status === "failed" || selectedJob.status === "error"
                      ? "bg-[#ef4444]"
                      : "bg-[#10b981]"
                  }`}
                />
              </div>

              <div className="flex justify-between items-center text-[11px] text-[#9ca3af]">
                <span>
                  Progreso: <strong className="text-[#34d399]">{selectedJob.progressPercent}%</strong>
                </span>
                <span>
                  {(selectedJob.downloadedBytes / (1024 * 1024)).toFixed(1)} MB /{" "}
                  {selectedJob.totalBytes > 0
                    ? `${(selectedJob.totalBytes / (1024 * 1024)).toFixed(1)} MB`
                    : "Desconocido"}
                </span>
              </div>
            </div>

            {/* Metrics Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-sans">
              <div className="p-2.5 bg-[#101317] rounded-lg border border-[#22272e]">
                <span className="text-[10px] text-[#9ca3af] block">
                  {selectedJob.sourceType === "torrent" ? "Velocidad Swarm" : "Velocidad Bajada"}
                </span>
                <span className="text-sm font-bold font-mono text-[#f3f4f6]">
                  {selectedJob.downloadSpeedStr}
                </span>
                {selectedJob.peers !== undefined && selectedJob.sourceType === "torrent" && (
                  <span className="text-[10px] text-[#10b981] block mt-0.5 font-mono">
                    {selectedJob.peers} peers
                  </span>
                )}
              </div>
              <div className="p-2.5 bg-[#101317] rounded-lg border border-[#22272e]">
                <span className="text-[10px] text-[#9ca3af] block">Subida a Google Drive</span>
                <span className="text-sm font-bold font-mono text-[#f3f4f6]">
                  {selectedJob.uploadSpeedStr}
                </span>
              </div>
              <div className="p-2.5 bg-[#101317] rounded-lg border border-[#22272e]">
                <span className="text-[10px] text-[#9ca3af] block">Destino Final</span>
                <span className="text-xs font-bold font-mono text-[#10b981] capitalize">
                  {selectedJob.destination === "drive"
                    ? "📁 Google Drive"
                    : selectedJob.destination === "server"
                    ? "🖥️ Servidor Local"
                    : "🔄 Drive & Servidor"}
                </span>
              </div>
              <div className="p-2.5 bg-[#101317] rounded-lg border border-[#22272e]">
                <span className="text-[10px] text-[#9ca3af] block">Inicio</span>
                <span className="text-xs font-bold font-mono text-[#f3f4f6]">
                  {new Date(selectedJob.startedAt).toLocaleTimeString()}
                </span>
              </div>
            </div>

            {selectedJob.error && (
              <div className="p-2.5 rounded-lg bg-[#7f1d1d]/30 border border-[#ef4444]/40 text-[#f87171] text-xs">
                <strong>Error:</strong> {selectedJob.error}
              </div>
            )}
          </div>
        )}

        {/* Unified Jobs Table */}
        <div className="bg-[#14171a] border border-[#22272e] rounded-xl overflow-hidden shadow-sm">
          {isLoading ? (
            <div className="p-8 text-center text-xs text-[#9ca3af] flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#10b981]" />
              <span>Cargando listado unificado de trabajos...</span>
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#9ca3af] space-y-2">
              <Database className="w-8 h-8 text-[#3b424d] mx-auto" />
              <p className="font-semibold text-[#f3f4f6]">No hay trabajos registrados en la lista</p>
              <p className="text-[11px] text-[#6b7280]">
                Inicia una transferencia desde "Streaming Directo" o utiliza la opción "Recuperar Jobs de Drive".
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#1f242c] text-[#9ca3af] uppercase tracking-wider font-sans border-b border-[#22272e]">
                  <tr>
                    <th className="p-3 font-bold">Tipo / Motor</th>
                    <th className="p-3 font-bold">Archivo</th>
                    <th className="p-3 font-bold">Estado</th>
                    <th className="p-3 font-bold">Progreso</th>
                    <th className="p-3 font-bold">Velocidad</th>
                    <th className="p-3 font-bold">Destino</th>
                    <th className="p-3 font-bold text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#22272e] bg-[#101317]">
                  {filteredJobs.map((job) => {
                    const isSelected = selectedJob?.id === job.id;

                    return (
                      <tr
                        key={job.id}
                        onClick={() => {
                          setSelectedJobId(job.id);
                          if (onJobSelect) onJobSelect(job);
                        }}
                        className={`hover:bg-[#161a1f] cursor-pointer transition-colors ${
                          isSelected ? "bg-[#1f242c]/90 font-semibold border-l-2 border-l-[#10b981]" : ""
                        }`}
                      >
                        {/* Engine */}
                        <td className="p-3">
                          {job.engineType === "stream" ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#064e3b] text-[#34d399] border border-[#059669]/50 flex items-center gap-1 w-fit">
                              <CloudLightning className="w-3 h-3 text-[#10b981]" />
                              Stream Zero-Disk
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#1e3a8a]/30 text-[#60a5fa] border border-[#3b82f6]/40 flex items-center gap-1 w-fit">
                              <Zap className="w-3 h-3 text-[#3b82f6]" />
                              Secuencial
                            </span>
                          )}
                        </td>

                        {/* Filename */}
                        <td className="p-3 text-[#f3f4f6] max-w-xs truncate" title={job.filePath || job.filename}>
                          <div className="truncate font-medium">{job.filename}</div>
                          {job.filePath && job.filePath !== job.filename && job.filePath.includes("/") && (
                            <div className="text-[10px] text-[#9ca3af] font-mono truncate flex items-center gap-1">
                              <Folder className="w-2.5 h-2.5 text-[#10b981] shrink-0" />
                              <span className="truncate">{job.filePath.substring(0, job.filePath.lastIndexOf("/"))}</span>
                            </div>
                          )}
                        </td>

                        {/* Status */}
                        <td className="p-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold flex items-center gap-1 w-fit ${
                              job.status === "completed"
                                ? "text-[#34d399]"
                                : job.status === "streaming" || job.status === "downloading"
                                ? "text-[#60a5fa] animate-pulse"
                                : job.status === "queued"
                                ? "bg-[#78350f]/30 text-[#f59e0b] border border-[#f59e0b]/40 font-semibold"
                                : job.status === "paused"
                                ? "text-[#f59e0b]"
                                : job.status === "failed" || job.status === "error"
                                ? "text-[#f87171]"
                                : "text-[#9ca3af]"
                            }`}
                          >
                            {job.status === "queued" ? (
                              <>
                                <ListOrdered className="w-3 h-3 text-[#f59e0b]" />
                                <span>Cola #{job.queueIndex || 1}</span>
                              </>
                            ) : (
                              job.status
                            )}
                          </span>
                        </td>

                        {/* Progress */}
                        <td className="p-3 text-[#f3f4f6]">
                          <div className="flex items-center gap-2">
                            <div className="w-16 bg-[#14171a] h-2 rounded-full overflow-hidden border border-[#22272e]">
                              <div
                                style={{ width: `${job.progressPercent}%` }}
                                className={`h-full ${
                                  job.status === "completed"
                                    ? "bg-[#10b981]"
                                    : job.status === "failed"
                                    ? "bg-[#ef4444]"
                                    : "bg-[#10b981]"
                                }`}
                              />
                            </div>
                            <span className="text-[11px]">{job.progressPercent}%</span>
                          </div>
                        </td>

                        {/* Speed */}
                        <td className="p-3 text-[#9ca3af]">
                          <div className="font-mono text-xs text-[#f3f4f6]">{job.downloadSpeedStr}</div>
                          {job.peers !== undefined && job.sourceType === "torrent" && (
                            <div className="text-[10px] text-[#10b981] font-mono">
                              {job.peers} peers
                            </div>
                          )}
                        </td>

                        {/* Destination */}
                        <td className="p-3 text-[#9ca3af]">
                          {job.destination === "drive" ? "Drive 📁" : "Servidor 🖥️"}
                        </td>

                        {/* Actions */}
                        <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {job.status === "queued" && job.engineType === "stream" && (
                              <div className="flex items-center gap-0.5 mr-1 bg-[#14171a] p-0.5 rounded border border-[#22272e]">
                                <button
                                  onClick={() => handleReorderQueue(job.id, "top")}
                                  disabled={actionJobId === job.id || job.queueIndex === 1}
                                  className="p-1 rounded text-[#9ca3af] hover:text-[#34d399] hover:bg-[#1f242c] disabled:opacity-30 transition-colors cursor-pointer"
                                  title="Mover al inicio de la cola (Top)"
                                >
                                  <ChevronsUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleReorderQueue(job.id, "up")}
                                  disabled={actionJobId === job.id || job.queueIndex === 1}
                                  className="p-1 rounded text-[#9ca3af] hover:text-[#34d399] hover:bg-[#1f242c] disabled:opacity-30 transition-colors cursor-pointer"
                                  title="Subir prioridad (▲)"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleReorderQueue(job.id, "down")}
                                  disabled={actionJobId === job.id}
                                  className="p-1 rounded text-[#9ca3af] hover:text-[#34d399] hover:bg-[#1f242c] disabled:opacity-30 transition-colors cursor-pointer"
                                  title="Bajar prioridad (▼)"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleReorderQueue(job.id, "bottom")}
                                  disabled={actionJobId === job.id}
                                  className="p-1 rounded text-[#9ca3af] hover:text-[#34d399] hover:bg-[#1f242c] disabled:opacity-30 transition-colors cursor-pointer"
                                  title="Mover al final de la cola (Bottom)"
                                >
                                  <ChevronsDown className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}

                            {(job.status === "streaming" || job.status === "downloading") && (
                              <button
                                onClick={() => handlePauseJob(job)}
                                className="p-1 rounded text-[#f59e0b] hover:bg-[#78350f]/30 transition-colors"
                                title="Pausar"
                              >
                                <Pause className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {job.status === "paused" && (
                              <button
                                onClick={() => handleResumeJob(job)}
                                className="p-1 rounded text-[#34d399] hover:bg-[#064e3b]/30 transition-colors"
                                title="Reanudar"
                              >
                                <Play className="w-3.5 h-3.5 fill-current" />
                              </button>
                            )}

                            {job.webViewLink && (
                              <a
                                href={job.webViewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 rounded text-[#10b981] hover:bg-[#161a1f] transition-colors"
                                title="Ver en Drive"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}

                            <button
                              onClick={() => handleDeleteJob(job)}
                              className="p-1 rounded text-[#9ca3af] hover:text-[#f87171] hover:bg-[#7f1d1d]/30 transition-colors"
                              title="Eliminar"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Audit Modal for Streaming Sessions */}
      {auditingJob && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#14171a] border border-[#22272e] rounded-xl max-w-lg w-full p-4 space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-[#22272e] pb-2">
              <h3 className="font-bold text-[#f3f4f6] flex items-center gap-1.5 font-sans">
                <ShieldCheck className="w-4 h-4 text-[#10b981]" />
                Auditoría de Sesión con Google Drive
              </h3>
              <button
                onClick={() => setAuditingJob(null)}
                className="text-[#9ca3af] hover:text-[#f3f4f6] text-xs font-bold"
              >
                ✕
              </button>
            </div>

            {isAuditing ? (
              <div className="py-8 text-center text-[#9ca3af] space-y-2">
                <Loader2 className="w-6 h-6 animate-spin text-[#10b981] mx-auto" />
                <p>Consultando servidores de Google Drive...</p>
              </div>
            ) : auditResult ? (
              auditResult.error ? (
                <div className="p-3 rounded-lg bg-[#7f1d1d]/30 border border-[#ef4444]/40 text-[#f87171]">
                  <strong>Error:</strong> {auditResult.error}
                </div>
              ) : (
                <div className="space-y-2 bg-[#101317] p-3 rounded-lg border border-[#22272e]">
                  <div className="flex justify-between">
                    <span className="text-[#9ca3af]">Estado HTTP:</span>
                    <span className="text-[#34d399] font-bold">
                      {auditResult.status} ({auditResult.statusText})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#9ca3af]">Bytes Confirmados:</span>
                    <span className="text-[#f3f4f6] font-bold">
                      {auditResult.committedBytesFormatted} / {auditResult.totalBytesFormatted}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#9ca3af]">Sesión Activa en Google:</span>
                    <span className={auditResult.sessionAlive ? "text-[#34d399]" : "text-[#f87171]"}>
                      {auditResult.sessionAlive ? "Sí (Activa)" : "No (Expirada / Cerrada)"}
                    </span>
                  </div>
                  <div className="p-2 rounded bg-[#14171a] text-[11px] text-[#9ca3af] mt-2">
                    {auditResult.message}
                  </div>
                </div>
              )
            ) : null}

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setAuditingJob(null)}
                className="px-4 py-1.5 rounded-lg bg-[#1f242c] hover:bg-[#262b32] text-[#f3f4f6] text-xs font-semibold cursor-pointer border border-[#3b424d]"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
