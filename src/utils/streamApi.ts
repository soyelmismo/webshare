import { StreamDriveTask, DriveSessionAuditResult } from "../types";

export async function inspectStreamSource(sourceUrl: string, torrentBase64?: string): Promise<{
  fileName: string;
  fileSize: number;
  fileSizeFormatted: string;
  sourceType: "direct" | "torrent";
  acceptRanges: boolean;
  files?: Array<{ name: string; length: number; path: string }>;
  torrentBase64?: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch("/api/stream/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sourceUrl, torrentBase64 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || "Error al inspeccionar origen");
    }
    return await res.json();
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      throw new Error("Tiempo de espera agotado (12s) al inspeccionar el origen. Revisa el enlace o archivo.");
    }
    throw err;
  }
}

export async function fetchStreamTasks(): Promise<StreamDriveTask[]> {
  try {
    const res = await fetch("/api/stream/tasks", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function startStreamToDrive(params: {
  sourceUrl: string;
  accessToken: string;
  folderId: string;
  accountEmail?: string;
  customChunkSizeMB?: number;
  customFileName?: string;
  torrentBase64?: string;
  selectedFilePath?: string;
  selectedFileSize?: number;
}): Promise<{ success: boolean; task: StreamDriveTask }> {
  const res = await fetch("/api/stream/start", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || "Error al iniciar transmisión a Google Drive");
  }
  return await res.json();
}

export async function pauseStreamTask(taskId: string, accessToken?: string): Promise<boolean> {
  const res = await fetch("/api/stream/pause", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ taskId, accessToken }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.success;
}

export async function auditDriveSession(taskId: string): Promise<DriveSessionAuditResult> {
  const res = await fetch("/api/stream/audit-session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ taskId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || "Error al auditar sesión con Google Drive");
  }
  const data = await res.json();
  return data.audit;
}

export async function resumeStreamTask(taskId: string, accessToken: string): Promise<boolean> {
  const res = await fetch("/api/stream/resume", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ taskId, accessToken }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.success;
}

export async function cancelStreamTask(taskId: string, accessToken?: string): Promise<boolean> {
  const res = await fetch("/api/stream/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ taskId, accessToken }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.success;
}

export async function recoverStreamTasksFromDrive(
  accessToken: string,
  folderId?: string
): Promise<{
  success: boolean;
  recoveredCount: number;
  tasks: StreamDriveTask[];
  resumedSequentialCount?: number;
}> {
  const res = await fetch("/api/stream/recover", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ accessToken, folderId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || "Error al recuperar tareas desde Drive");
  }
  return await res.json();
}
