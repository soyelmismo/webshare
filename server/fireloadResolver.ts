import { formatBytes, InspectedFileInfo } from "./torrentParser.js";
import { isArchiveFileName } from "./archiveExtractor.js";

export interface FireloadItem {
  name: string;
  length: number;
  path: string;
  url: string;
  quickkey: string;
}

export interface FireloadFolderData {
  folderHash: string;
  folderName: string;
  files: FireloadItem[];
  totalSize: number;
}

interface CachedDirectLink {
  directUrl: string;
  fileName: string;
  fileSize: number;
  expiresAt: number;
}

const directLinkCache = new Map<string, CachedDirectLink>();

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Checks if a given URL belongs to Fireload.
 */
export function isFireloadUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const clean = url.trim().toLowerCase();
  return clean.includes("fireload.com");
}

/**
 * Checks if a given URL points to a Fireload folder.
 */
export function isFireloadFolderUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const clean = url.trim();
  return /(?:https?:\/\/)?(?:www\.)?fireload\.com\/folder\/([a-zA-Z0-9]+)/i.test(clean);
}

/**
 * Checks if a given URL points to a Fireload file page.
 */
export function isFireloadFileUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const clean = url.trim();
  // Fireload file links: https://www.fireload.com/<16-hex-chars>/<optional_filename>
  return (
    /(?:https?:\/\/)?(?:www\.)?fireload\.com\/([a-f0-9]{16})(?:\/|$)/i.test(clean) &&
    !clean.includes("/folder/")
  );
}

/**
 * Extracts the folder hash from a Fireload folder URL.
 */
export function extractFireloadFolderHash(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(/(?:fireload\.com\/folder\/|^folder\/)([a-zA-Z0-9]+)/i);
  if (match) return match[1];

  if (/^[a-zA-Z0-9]{20,40}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Extracts the 16-hex file key from a Fireload file URL.
 */
export function extractFireloadFileKey(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(/(?:fireload\.com\/|^)([a-f0-9]{16})(?:\/|$)/i);
  if (match) return match[1];
  return null;
}

/**
 * Fetches all files from a Fireload folder using its AJAX file listing endpoint with pagination.
 */
export async function fetchFireloadFolderContents(folderHash: string): Promise<FireloadFolderData> {
  console.log(`[Fireload] Obteniendo contenido de la carpeta: ${folderHash}...`);

  // First fetch the folder page to get folder name / title and cookies
  let folderName = `Fireload_${folderHash.substring(0, 8)}`;
  try {
    const pageRes = await fetch(`https://www.fireload.com/folder/${folderHash}`, {
      headers: { "User-Agent": DEFAULT_USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
    if (pageRes.ok) {
      const pageHtml = await pageRes.text();
      const matchTitle = pageHtml.match(/<title>([^<]+)<\/title>/i);
      if (matchTitle && matchTitle[1]) {
        let title = matchTitle[1].replace(/-?\s*Fireload.*$/i, "").trim();
        title = title.replace(/shared by.*$/i, "").trim();
        if (title && title !== "1" && title.length > 1) {
          folderName = title;
        }
      }
    }
  } catch (err: any) {
    console.warn("[Fireload] No se pudo obtener el título de la página:", err?.message);
  }

  const collectedFiles: FireloadItem[] = [];
  let pageStart = 0;
  const perPage = 100;
  let totalResults = 1;
  const maxPages = 50; // Guard against infinite pagination

  let pageNum = 0;
  while (pageStart < totalResults && pageNum < maxPages) {
    pageNum++;
    const params = new URLSearchParams({
      url_hash: folderHash,
      nodeId: "-1",
      pageStart: String(pageStart),
      perPage: String(perPage),
    });

    const res = await fetch("https://www.fireload.com/ajax/_view_folder_v2_file_listing.ajax.php", {
      method: "POST",
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      console.warn(`[Fireload] Error HTTP ${res.status} al consultar archivos de la carpeta.`);
      break;
    }

    const html = await res.text();

    // Check total results in response
    const matchTotal =
      html.match(/id=["']rspTotalResults["'][^>]*value=["']([^"']*)["']/i) ||
      html.match(/value=["']([^"']*)["'][^>]*id=["']rspTotalResults["']/i);
    if (matchTotal && matchTotal[1]) {
      const parsedTotal = parseInt(matchTotal[1], 10);
      if (!isNaN(parsedTotal) && parsedTotal > 0) {
        totalResults = parsedTotal;
      }
    }

    // Parse files from <li> items: dttitle, dtsizeraw, dtfullurl, dturlkey
    const itemRegex =
      /<li[^>]*dttitle="([^"]*)"[^>]*dtsizeraw="([^"]*)"[^>]*dtfullurl="([^"]*)"[^>]*(?:dturlkey="([^"]*)")?/gi;
    let match: RegExpExecArray | null;
    let foundInPage = 0;

    while ((match = itemRegex.exec(html)) !== null) {
      const name = match[1];
      const length = parseInt(match[2], 10) || 0;
      const url = match[3];
      const quickkey = match[4] || extractFireloadFileKey(url) || "";

      collectedFiles.push({
        name,
        length,
        path: name,
        url,
        quickkey,
      });
      foundInPage++;
    }

    if (foundInPage === 0) break;
    pageStart += perPage;
  }

  const totalSize = collectedFiles.reduce((acc, f) => acc + f.length, 0);

  return {
    folderHash,
    folderName,
    files: collectedFiles,
    totalSize,
  };
}

/**
 * Resolves a Fireload folder URL into InspectedFileInfo.
 */
export async function resolveFireloadFolder(urlOrHash: string): Promise<InspectedFileInfo> {
  const folderHash = extractFireloadFolderHash(urlOrHash);
  if (!folderHash) {
    throw new Error(`Enlace de carpeta de Fireload no válido: ${urlOrHash}`);
  }

  const folderData = await fetchFireloadFolderContents(folderHash);
  if (folderData.files.length === 0) {
    throw new Error(
      `La carpeta de Fireload '${folderData.folderName}' está vacía o no tiene archivos públicos disponibles.`
    );
  }

  const hasArchives = folderData.files.some((f) => isArchiveFileName(f.name));

  console.log(
    `[Fireload] Carpeta '${folderData.folderName}' resuelta con éxito: ${folderData.files.length} archivos, tamaño total: ${formatBytes(
      folderData.totalSize
    )} (¿Contiene archivos comprimidos?: ${hasArchives})`
  );

  return {
    fileName: folderData.folderName,
    fileSize: folderData.totalSize,
    fileSizeFormatted: formatBytes(folderData.totalSize),
    sourceType: "direct",
    acceptRanges: true,
    files: folderData.files.map((f) => ({
      name: f.name,
      length: f.length,
      path: f.path,
      url: f.url,
      quickkey: f.quickkey,
    })),
    isFireload: true,
    hasArchives,
  };
}

/**
 * Resolves the direct download URL (e.g. https://srv*.fireload.com/...) from a Fireload file page.
 */
export async function resolveFireloadDirectDownloadLink(
  fileUrlOrKey: string,
  forceFresh = false
): Promise<CachedDirectLink> {
  const fileKey = extractFireloadFileKey(fileUrlOrKey);
  const cacheKey = fileKey || fileUrlOrKey.trim();

  if (!forceFresh && directLinkCache.has(cacheKey)) {
    const cached = directLinkCache.get(cacheKey)!;
    if (Date.now() < cached.expiresAt) {
      return cached;
    }
  }

  const targetUrl = fileUrlOrKey.startsWith("http")
    ? fileUrlOrKey.trim()
    : `https://www.fireload.com/${fileKey}`;

  // If already a direct server download URL
  if (/^https?:\/\/srv\d*\.fireload\.com\//i.test(targetUrl)) {
    return {
      directUrl: targetUrl,
      fileName: decodeURIComponent(targetUrl.split("/").pop()?.split("?")[0] || "archivo_fireload"),
      fileSize: 0,
      expiresAt: Date.now() + 2 * 3600 * 1000,
    };
  }

  // 1. Fetch file page to retrieve session cookie and dlink
  const pageRes = await fetch(targetUrl, {
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!pageRes.ok) {
    throw new Error(`Fireload respondió con HTTP ${pageRes.status} al solicitar la página del archivo.`);
  }

  const cookie = pageRes.headers.get("set-cookie") || "";
  const pageHtml = await pageRes.text();

  // Extract dlink from window.Fl = {"dlink": "..."}
  const dlinkMatch = pageHtml.match(/window\.Fl\s*=\s*\{"dlink":\s*"([^"]+)"/i);
  if (!dlinkMatch || !dlinkMatch[1]) {
    throw new Error(
      "No se pudo extraer el enlace de descarga de Fireload. El archivo podría haber sido eliminado o requerir autenticación."
    );
  }

  const dlink = dlinkMatch[1];

  // 2. Request dlink with Referer and Cookie to follow 302 redirect to srv*.fireload.com
  const dlRes = await fetch(dlink, {
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      Referer: targetUrl,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(12000),
  });

  let directUrl = dlRes.headers.get("location") || dlink;
  if (!directUrl.startsWith("http")) {
    try {
      directUrl = new URL(directUrl, dlink).toString();
    } catch {}
  }

  // Extract file name
  let fileName = "";
  try {
    const urlObj = new URL(directUrl);
    const lastSeg = urlObj.pathname.split("/").filter(Boolean).pop();
    if (lastSeg) {
      fileName = decodeURIComponent(lastSeg);
    }
  } catch {}

  if (!fileName) {
    const matchName =
      pageHtml.match(/<h2[^>]*class=["'][^"']*file-name[^"']*["'][^>]*>([^<]+)<\/h2>/i) ||
      pageHtml.match(/<title>([^<]+)\s*-\s*Fireload<\/title>/i);
    if (matchName) {
      fileName = matchName[1].trim();
    }
  }

  if (!fileName) {
    fileName = `fireload_${fileKey || Date.now()}.bin`;
  }

  const result: CachedDirectLink = {
    directUrl,
    fileName,
    fileSize: 0,
    expiresAt: Date.now() + 2 * 3600 * 1000, // 2 hours
  };

  directLinkCache.set(cacheKey, result);
  if (fileKey) directLinkCache.set(fileKey, result);
  directLinkCache.set(directUrl, result);

  return result;
}

/**
 * Returns a valid direct download link for a Fireload URL, utilizing cache.
 */
export async function getOrResolveFireloadDirectLink(
  urlOrKey: string,
  forceFresh = false
): Promise<string> {
  const clean = urlOrKey.trim();
  if (!forceFresh && /^https?:\/\/srv\d*\.fireload\.com\//i.test(clean)) {
    return clean;
  }
  const resolved = await resolveFireloadDirectDownloadLink(clean, forceFresh);
  return resolved.directUrl;
}

/**
 * Invalidates the cached direct link for a Fireload URL.
 */
export function invalidateFireloadDirectLinkCache(urlOrKey: string): void {
  const fileKey = extractFireloadFileKey(urlOrKey);
  if (fileKey) directLinkCache.delete(fileKey);
  directLinkCache.delete(urlOrKey.trim());
}

/**
 * Inspects a single Fireload file and returns InspectedFileInfo.
 */
export async function inspectFireloadFile(urlOrKey: string): Promise<InspectedFileInfo> {
  const { directUrl, fileName } = await resolveFireloadDirectDownloadLink(urlOrKey);

  let fileSize = 0;
  let acceptRanges = true;

  try {
    const probeRes = await fetch(directUrl, {
      method: "GET",
      headers: {
        Range: "bytes=0-0",
        "User-Agent": DEFAULT_USER_AGENT,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (probeRes.status === 206) {
      acceptRanges = true;
      const cr = probeRes.headers.get("content-range");
      if (cr) {
        const match = cr.match(/\/(\d+)/);
        if (match && match[1]) {
          fileSize = parseInt(match[1], 10);
        }
      }
    } else if (probeRes.ok) {
      const cl = probeRes.headers.get("content-length");
      if (cl) fileSize = parseInt(cl, 10);
    }
  } catch (err: any) {
    console.warn("[Fireload] Error comprobando tamaño con Range:", err?.message);
  }

  const hasArchives = isArchiveFileName(fileName);

  return {
    fileName,
    fileSize,
    fileSizeFormatted: fileSize > 0 ? formatBytes(fileSize) : "Desconocido",
    sourceType: "direct",
    acceptRanges,
    files: [
      {
        name: fileName,
        length: fileSize,
        path: fileName,
        url: directUrl,
      },
    ],
    isFireload: true,
    hasArchives,
  };
}
