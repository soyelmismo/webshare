import { DriveFile, DriveFolderInfo } from "../types";
import { notifyDriveSessionExpired } from "./driveStorage";

export const DEFAULT_FOLDER_NAME = "Descargas Servidor";

export class GoogleDriveApiError extends Error {
  public statusCode: number;
  public isAuthError: boolean;

  constructor(message: string, statusCode: number, isAuthError: boolean = false) {
    super(message);
    this.name = "GoogleDriveApiError";
    this.statusCode = statusCode;
    this.isAuthError = isAuthError;
  }
}

/**
 * Parses Google Drive API errors, detecting auth expirations (HTTP 401, "authError", "Invalid Credentials")
 * and notifying registered listeners while throwing a human-readable error.
 */
export function handleGoogleDriveApiError(
  status: number,
  errText: string,
  context: string
): never {
  let isAuth = status === 401;
  let parsedMsg = "";

  try {
    const json = JSON.parse(errText);
    const apiError = json?.error;
    if (
      status === 401 ||
      apiError?.code === 401 ||
      apiError?.status === "UNAUTHENTICATED" ||
      (Array.isArray(apiError?.errors) &&
        apiError.errors.some((e: any) => e.reason === "authError")) ||
      (typeof apiError?.message === "string" &&
        apiError.message.toLowerCase().includes("invalid credentials"))
    ) {
      isAuth = true;
    }
    parsedMsg = apiError?.message || "";
  } catch {
    // raw text
  }

  if (isAuth || errText.includes("authError") || errText.includes("Invalid Credentials")) {
    notifyDriveSessionExpired("Tu sesión de Google Drive ha expirado.");
    throw new GoogleDriveApiError(
      "Tu sesión de Google Drive ha expirado tras cumplir el tiempo reglamentario de seguridad de Google (1 hora). Haz clic en 'Reconectar con Google' para renovar tu acceso.",
      401,
      true
    );
  }

  throw new GoogleDriveApiError(
    `${context}: ${parsedMsg || errText || `HTTP ${status}`}`,
    status,
    false
  );
}

/**
 * Ensures a dedicated folder exists in the user's Google Drive.
 * If not found, creates one.
 */
export async function getOrCreateDedicatedFolder(
  accessToken: string,
  folderName: string = DEFAULT_FOLDER_NAME
): Promise<DriveFolderInfo> {
  const query = `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName.replace(/'/g, "\\'")}' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name,webViewLink)&pageSize=1`;

  const searchRes = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    handleGoogleDriveApiError(searchRes.status, errText, "Error al buscar carpeta en Drive");
  }

  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    const existing = searchData.files[0];
    return {
      id: existing.id,
      name: existing.name,
      webViewLink: existing.webViewLink,
    };
  }

  // Create folder if it doesn't exist
  const createRes = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        description: "Carpeta dedicada para descargas de la aplicación de especificaciones del servidor",
      }),
    }
  );

  if (!createRes.ok) {
    const errText = await createRes.text();
    handleGoogleDriveApiError(createRes.status, errText, "Error al crear carpeta en Drive");
  }

  const createdData = await createRes.json();
  return {
    id: createdData.id,
    name: createdData.name,
    webViewLink: createdData.webViewLink,
  };
}

/**
 * List files inside the dedicated folder
 */
export async function listFilesInFolder(
  accessToken: string,
  folderId: string
): Promise<DriveFile[]> {
  const query = `'${folderId}' in parents and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,thumbnailLink,iconLink)&orderBy=createdTime desc&pageSize=100`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    handleGoogleDriveApiError(res.status, errText, "Error al listar archivos");
  }

  const data = await res.json();
  return data.files || [];
}

/**
 * Upload a Blob or File to the dedicated folder
 * Uses multipart for <= 5MB, and Google Drive Resumable Upload protocol for > 5MB
 */
export async function uploadBlobToDrive(
  accessToken: string,
  folderId: string,
  blob: Blob,
  fileName: string,
  contentType: string = "application/octet-stream",
  onProgress?: (percent: number) => void
): Promise<DriveFile> {
  const metadata = {
    name: fileName,
    parents: [folderId],
    description: `Descargado y guardado desde el cliente del servidor el ${new Date().toLocaleString()}`,
  };

  // For small files (<= 5MB), multipart upload is fast and simple
  if (blob.size <= 5 * 1024 * 1024) {
    const boundary = "-------314159265358979323846" + Date.now();
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadataPart = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
      metadata
    )}`;
    const mediaPartHeader = `${delimiter}Content-Type: ${contentType || "application/octet-stream"}\r\n\r\n`;

    const multipartBody = new Blob([metadataPart, mediaPartHeader, blob, closeDelimiter], {
      type: `multipart/related; boundary=${boundary}`,
    });

    const uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      handleGoogleDriveApiError(uploadRes.status, errText, "Error al subir a Google Drive");
    }

    return await uploadRes.json();
  }

  // For files > 5MB, use official Google Drive Resumable Upload protocol
  const initRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": contentType || "application/octet-stream",
        "X-Upload-Content-Length": blob.size.toString(),
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initRes.ok) {
    const errText = await initRes.text();
    handleGoogleDriveApiError(initRes.status, errText, "Error al iniciar subida en Google Drive");
  }

  const sessionUri = initRes.headers.get("Location");
  if (!sessionUri) {
    throw new Error("No se pudo obtener la URL de sesión de subida de Google Drive.");
  }

  // Upload in 4MB chunks (must be multiple of 256KB)
  const CHUNK_SIZE = 4 * 1024 * 1024;
  let start = 0;
  const total = blob.size;

  while (start < total) {
    const end = Math.min(start + CHUNK_SIZE, total);
    const chunk = blob.slice(start, end);

    const chunkRes = await fetch(sessionUri, {
      method: "PUT",
      headers: {
        "Content-Range": `bytes ${start}-${end - 1}/${total}`,
      },
      body: chunk,
    });

    if (chunkRes.status === 200 || chunkRes.status === 201) {
      return await chunkRes.json();
    } else if (chunkRes.status === 308) {
      start = end;
      if (onProgress) {
        onProgress(Math.round((start / total) * 100));
      }
    } else {
      const errText = await chunkRes.text();
      handleGoogleDriveApiError(chunkRes.status, errText, "Error en bloque de subida a Google Drive");
    }
  }

  throw new Error("La subida finalizó sin confirmación de Google Drive.");
}

/**
 * Delete a file from Google Drive (MUST be preceded by user confirmation dialog per Workspace guidelines)
 */
export async function deleteFileFromDrive(
  accessToken: string,
  fileId: string
): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    handleGoogleDriveApiError(res.status, errText, "Error al eliminar archivo");
  }
}

/**
 * Download file directly from Drive as a Blob
 */
export async function downloadFileFromDrive(
  accessToken: string,
  fileId: string
): Promise<Blob> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    handleGoogleDriveApiError(res.status, errText, "Error al descargar de Google Drive");
  }

  return await res.blob();
}

/**
 * List top-level or accessible folders in user's Google Drive
 */
export async function listUserFolders(
  accessToken: string
): Promise<DriveFolderInfo[]> {
  const query = `mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name,webViewLink)&orderBy=name asc&pageSize=50`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    handleGoogleDriveApiError(res.status, errText, "Error al listar carpetas");
  }

  const data = await res.json();
  return (data.files || []).map((f: any) => ({
    id: f.id,
    name: f.name,
    webViewLink: f.webViewLink,
  }));
}

/**
 * Create a new custom folder in Google Drive
 */
export async function createDriveFolder(
  accessToken: string,
  folderName: string,
  parentId?: string
): Promise<DriveFolderInfo> {
  const metadata: any = {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const res = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    handleGoogleDriveApiError(res.status, errText, "Error al crear carpeta");
  }

  const data = await res.json();
  return {
    id: data.id,
    name: data.name,
    webViewLink: data.webViewLink,
  };
}

export const listFilesInDedicatedFolder = listFilesInFolder;
export const deleteDriveFile = deleteFileFromDrive;
