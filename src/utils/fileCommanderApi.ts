import { ServerFsListResponse, TransferTask } from "../types";

async function parseJsonResponse<T>(res: Response, fallbackErrorMsg: string): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    if (contentType.includes("application/json")) {
      try {
        const err = await res.json();
        throw new Error(err.error || `${fallbackErrorMsg} (HTTP ${res.status})`);
      } catch (e: any) {
        throw new Error(e.message || `${fallbackErrorMsg} (HTTP ${res.status})`);
      }
    } else {
      throw new Error(`${fallbackErrorMsg} (HTTP ${res.status})`);
    }
  }

  if (!contentType.includes("application/json")) {
    throw new Error("El servidor devolvió una respuesta no JSON inesperada.");
  }

  return await res.json();
}

export async function fetchServerFiles(
  dir?: string,
  flatten: boolean = false
): Promise<ServerFsListResponse> {
  const params = new URLSearchParams();
  if (dir) params.set("dir", dir);
  if (flatten) params.set("flatten", "true");

  const res = await fetch(`/api/fs/server/list?${params.toString()}`);
  return await parseJsonResponse<ServerFsListResponse>(res, "Error al listar archivos del servidor");
}

export async function deleteServerFiles(
  paths: string[]
): Promise<{ success: boolean; deletedCount: number; deleted: string[]; errors: string[] }> {
  const res = await fetch("/api/fs/server/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  return await parseJsonResponse<{ success: boolean; deletedCount: number; deleted: string[]; errors: string[] }>(
    res,
    "Error al eliminar archivos del servidor"
  );
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
  return await parseJsonResponse<{ success: boolean; oldPath: string; newPath: string; newName: string }>(
    res,
    "Error al renombrar archivo en el servidor"
  );
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
  return await parseJsonResponse<{ success: boolean; transfer: TransferTask }>(
    res,
    "Error al iniciar transferencia a Google Drive"
  );
}

export async function fetchActiveTransfers(): Promise<TransferTask[]> {
  try {
    const res = await fetch("/api/fs/server/transfers");
    if (!res.ok) return [];
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return [];
    return await res.json();
  } catch {
    return [];
  }
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
  return await parseJsonResponse<{ success: boolean; transfer: TransferTask }>(
    res,
    "Error al copiar desde Google Drive al servidor"
  );
}
