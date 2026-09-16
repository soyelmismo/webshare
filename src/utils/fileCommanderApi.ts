import { ServerFsListResponse, TransferTask } from "../types";

export async function fetchServerFiles(
  dir?: string,
  flatten: boolean = false
): Promise<ServerFsListResponse> {
  const params = new URLSearchParams();
  if (dir) params.set("dir", dir);
  if (flatten) params.set("flatten", "true");

  const res = await fetch(`/api/fs/server/list?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Error ${res.status} al listar archivos del servidor`);
  }
  return await res.json();
}

export async function deleteServerFiles(
  paths: string[]
): Promise<{ success: boolean; deletedCount: number; deleted: string[]; errors: string[] }> {
  const res = await fetch("/api/fs/server/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Error ${res.status} al eliminar del servidor`);
  }
  return await res.json();
}

export async function renameServerFile(
  oldPath: string,
  newName: string
): Promise<{ success: boolean; oldPath: string; newPath: string; newName: string }> {
  const res = await fetch("/api/fs/server/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldPath, newName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Error ${res.status} al renombrar en el servidor`);
  }
  return await res.json();
}

export async function transferServerToDrive(
  filePath: string,
  fileName: string,
  accessToken: string,
  folderId: string,
  mode: "copy" | "move" = "copy"
): Promise<{ success: boolean; transfer: TransferTask }> {
  const res = await fetch("/api/fs/server/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filePath,
      fileName,
      accessToken,
      folderId,
      mode,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Error ${res.status} al iniciar transferencia`);
  }
  return await res.json();
}

export async function fetchActiveTransfers(): Promise<TransferTask[]> {
  const res = await fetch("/api/fs/server/transfers");
  if (!res.ok) return [];
  return await res.json();
}

export async function copyFromDriveToServer(
  driveFileId: string,
  fileName: string,
  accessToken: string,
  targetDir?: string
): Promise<{ success: boolean; transfer: TransferTask }> {
  const res = await fetch("/api/fs/server/copy-from-drive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      driveFileId,
      fileName,
      accessToken,
      targetDir,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Error ${res.status} al copiar de Google Drive al servidor`);
  }
  return await res.json();
}
