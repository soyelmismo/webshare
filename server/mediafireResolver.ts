import { formatBytes, InspectedFileInfo } from "./torrentParser.js";

export interface MediafireItem {
  name: string;
  length: number;
  path: string;
  url: string;
  quickkey: string;
}

export interface MediafireFolderData {
  folderKey: string;
  folderName: string;
  files: MediafireItem[];
  totalSize: number;
}

interface CachedDirectLink {
  directUrl: string;
  fileName: string;
  fileSize: number;
  expiresAt: number;
}

// In-memory cache for resolved MediaFire direct download links (2 hour TTL)
const directLinkCache = new Map<string, CachedDirectLink>();

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Checks if a given URL is a MediaFire URL.
 */
export function isMediafireUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const clean = url.trim().toLowerCase();
  return clean.includes("mediafire.com");
}

/**
 * Checks if a given URL points to a MediaFire folder.
 */
export function isMediafireFolderUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const clean = url.trim();
  return (
    /(?:https?:\/\/)?(?:www\.)?mediafire\.com\/(?:folder\/|#)([a-zA-Z0-9]+)/i.test(clean) ||
    /(?:https?:\/\/)?(?:www\.)?mediafire\.com\/folder\/([a-zA-Z0-9]+)/i.test(clean) ||
    /^(?:folder\/)?([a-zA-Z0-9]{13,20})$/i.test(clean)
  );
}

/**
 * Checks if a given URL points to a MediaFire file download page.
 */
export function isMediafireFileUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const clean = url.trim();
  return (
    /(?:https?:\/\/)?(?:www\.)?mediafire\.com\/(?:file|file_premium|download)\/([a-zA-Z0-9]+)/i.test(clean) ||
    /(?:https?:\/\/)?(?:www\.)?mediafire\.com\/\?([a-zA-Z0-9]{10,20})$/i.test(clean)
  );
}

/**
 * Extracts the folder key from a MediaFire folder URL or identifier.
 */
export function extractMediafireFolderKey(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  const matchFolder = trimmed.match(/(?:mediafire\.com\/folder\/|^folder\/)([a-zA-Z0-9]+)/i);
  if (matchFolder) return matchFolder[1];

  const matchHash = trimmed.match(/mediafire\.com\/.*#([a-zA-Z0-9]+)/i);
  if (matchHash) return matchHash[1];

  const matchQuery = trimmed.match(/mediafire\.com\/\?([a-zA-Z0-9]+)/i);
  if (matchQuery) return matchQuery[1];

  if (/^[a-zA-Z0-9]{10,20}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Extracts the quickkey from a MediaFire file URL or identifier.
 */
export function extractMediafireQuickKey(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  const matchFile = trimmed.match(
    /(?:mediafire\.com\/(?:file|file_premium|download)\/|^file\/)([a-zA-Z0-9]+)/i
  );
  if (matchFile) return matchFile[1];

  const matchQuery = trimmed.match(/mediafire\.com\/\?([a-zA-Z0-9]+)/i);
  if (matchQuery) return matchQuery[1];

  if (/^[a-zA-Z0-9]{10,20}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Recursively fetches all files and subfolders in a MediaFire folder using the MediaFire API.
 */
export async function fetchMediafireFolderHierarchy(
  folderKey: string,
  basePath = "",
  visitedKeys = new Set<string>(),
  depth = 0,
  maxDepth = 5
): Promise<MediafireFolderData> {
  if (visitedKeys.has(folderKey)) {
    console.warn(`[MediaFire] Carpeta circular detectada (${folderKey}), omitiendo.`);
    return { folderKey, folderName: "", files: [], totalSize: 0 };
  }
  visitedKeys.add(folderKey);

  // 1. Get folder metadata (name, file count, etc.)
  let folderName = folderKey;
  try {
    const infoRes = await fetch(
      `https://www.mediafire.com/api/1.4/folder/get_info.php?folder_key=${encodeURIComponent(
        folderKey
      )}&response_format=json`,
      {
        headers: { "User-Agent": DEFAULT_USER_AGENT },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (infoRes.ok) {
      const infoData = await infoRes.json();
      if (infoData?.response?.folder_info?.name) {
        folderName = infoData.response.folder_info.name;
      }
    }
  } catch (err: any) {
    console.warn(`[MediaFire] No se pudo obtener metadatos para folder_key ${folderKey}:`, err?.message);
  }

  const currentFolderBasePath = basePath ? `${basePath}/${folderName}` : "";
  const collectedFiles: MediafireItem[] = [];

  // 2. Fetch files in this folder (handle pagination chunk=1, 2, ...)
  let chunk = 1;
  let moreChunks = true;
  const maxChunks = 50; // Guard against huge endless folders (50 chunks * 100 files = 5000 files)

  while (moreChunks && chunk <= maxChunks) {
    try {
      const filesRes = await fetch(
        `https://www.mediafire.com/api/1.4/folder/get_content.php?folder_key=${encodeURIComponent(
          folderKey
        )}&content_type=files&chunk=${chunk}&response_format=json`,
        {
          headers: { "User-Agent": DEFAULT_USER_AGENT },
          signal: AbortSignal.timeout(12000),
        }
      );

      if (!filesRes.ok) {
        console.warn(`[MediaFire] Error HTTP ${filesRes.status} al pedir chunk ${chunk} de archivos.`);
        break;
      }

      const filesData = await filesRes.json();
      const content = filesData?.response?.folder_content;
      const rawFiles = content?.files || [];

      for (const f of rawFiles) {
        const fileName = f.filename || `archivo_${f.quickkey}`;
        const fileSize = parseInt(f.size, 10) || 0;
        const quickkey = f.quickkey;
        const normalDownload =
          f.links?.normal_download ||
          `https://www.mediafire.com/file/${quickkey}/${encodeURIComponent(fileName)}/file`;

        const relPath = currentFolderBasePath
          ? `${currentFolderBasePath}/${fileName}`
          : fileName;

        collectedFiles.push({
          name: fileName,
          length: fileSize,
          path: relPath,
          url: normalDownload,
          quickkey,
        });
      }

      moreChunks = content?.more_chunks === "yes";
      chunk++;
    } catch (err: any) {
      console.warn(`[MediaFire] Error al obtener archivos chunk ${chunk}:`, err?.message);
      break;
    }
  }

  // 3. Fetch subfolders in this folder if depth limit not reached
  if (depth < maxDepth) {
    let subChunk = 1;
    let moreSubChunks = true;

    while (moreSubChunks && subChunk <= maxChunks) {
      try {
        const subRes = await fetch(
          `https://www.mediafire.com/api/1.4/folder/get_content.php?folder_key=${encodeURIComponent(
            folderKey
          )}&content_type=folders&chunk=${subChunk}&response_format=json`,
          {
            headers: { "User-Agent": DEFAULT_USER_AGENT },
            signal: AbortSignal.timeout(12000),
          }
        );

        if (!subRes.ok) break;

        const subData = await subRes.json();
        const subContent = subData?.response?.folder_content;
        const rawFolders = subContent?.folders || [];

        for (const sub of rawFolders) {
          const subKey = sub.folderkey;
          if (subKey && !visitedKeys.has(subKey)) {
            const subResult = await fetchMediafireFolderHierarchy(
              subKey,
              currentFolderBasePath,
              visitedKeys,
              depth + 1,
              maxDepth
            );
            collectedFiles.push(...subResult.files);
          }
        }

        moreSubChunks = subContent?.more_chunks === "yes";
        subChunk++;
      } catch (err: any) {
        console.warn(`[MediaFire] Error al obtener subcarpetas chunk ${subChunk}:`, err?.message);
        break;
      }
    }
  }

  const totalSize = collectedFiles.reduce((acc, f) => acc + f.length, 0);

  return {
    folderKey,
    folderName,
    files: collectedFiles,
    totalSize,
  };
}

/**
 * Resolves a MediaFire folder URL into an InspectedFileInfo structure compatible with streamManager and Drive.
 */
export async function resolveMediafireFolder(urlOrKey: string): Promise<InspectedFileInfo> {
  const folderKey = extractMediafireFolderKey(urlOrKey);
  if (!folderKey) {
    throw new Error(`Enlace de carpeta de MediaFire inválido: ${urlOrKey}`);
  }

  console.log(`[MediaFire] Resolviendo carpeta con clave: ${folderKey}...`);
  const folderData = await fetchMediafireFolderHierarchy(folderKey);

  if (folderData.files.length === 0) {
    throw new Error(
      `La carpeta de MediaFire '${folderData.folderName || folderKey}' está vacía o no es de acceso público.`
    );
  }

  console.log(
    `[MediaFire] Carpeta '${folderData.folderName}' resuelta con éxito: ${folderData.files.length} archivos, tamaño total: ${formatBytes(
      folderData.totalSize
    )}`
  );

  return {
    fileName: folderData.folderName || `MediaFire_${folderKey}`,
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
    isMediafire: true,
  };
}

/**
 * Resolves the actual direct binary download link (e.g. https://download1234.mediafire.com/...) from a MediaFire file page.
 */
export async function resolveMediafireDirectDownloadLink(
  fileUrlOrQuickKey: string,
  forceFresh = false
): Promise<{ directUrl: string; fileName: string; fileSize: number }> {
  const quickKey = extractMediafireQuickKey(fileUrlOrQuickKey);
  const cacheKey = quickKey || fileUrlOrQuickKey.trim();

  if (!forceFresh && directLinkCache.has(cacheKey)) {
    const cached = directLinkCache.get(cacheKey)!;
    if (Date.now() < cached.expiresAt) {
      return cached;
    }
  }

  const targetUrl = fileUrlOrQuickKey.startsWith("http")
    ? fileUrlOrQuickKey.trim()
    : `https://www.mediafire.com/file/${quickKey}/file`;

  // If already a direct download URL, return it
  if (/^https?:\/\/download\d*\.mediafire\.com\//i.test(targetUrl)) {
    return {
      directUrl: targetUrl,
      fileName: decodeURIComponent(targetUrl.split("/").pop() || "archivo_mediafire"),
      fileSize: 0,
    };
  }

  const res = await fetch(targetUrl, {
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    throw new Error(`MediaFire respondió con HTTP ${res.status} al solicitar la página de descarga.`);
  }

  const html = await res.text();

  // Pattern 1: Download button with id="downloadButton" or aria-label="Download file"
  const matchBtn =
    html.match(/id=["']downloadButton["'][^>]*href=["'](https?:\/\/[^"']+)["']/i) ||
    html.match(/href=["'](https?:\/\/[^"']+)["'][^>]*id=["']downloadButton["']/i) ||
    html.match(/aria-label=["']Download file["'][^>]*href=["'](https?:\/\/[^"']+)["']/i) ||
    html.match(/href=["'](https?:\/\/[^"']+)["'][^>]*aria-label=["']Download file["']/i);

  let directUrl = matchBtn ? matchBtn[1] : "";

  // Pattern 2: Regex for download*.mediafire.com URL in HTML
  if (!directUrl) {
    const matchDirect = html.match(/https?:\/\/download\d*\.mediafire\.com\/[^\s"'<>]+/i);
    if (matchDirect) {
      directUrl = matchDirect[0];
    }
  }

  if (!directUrl) {
    throw new Error(
      "No se pudo extraer el enlace directo de descarga de MediaFire. Es posible que el archivo requiera contraseña, captcha o haya sido eliminado."
    );
  }

  // Extract filename
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
      html.match(/<div class="filename">([^<]+)<\/div>/i) ||
      html.match(/<title>([^<]+)\s*-\s*MediaFire<\/title>/i);
    if (matchName) {
      fileName = matchName[1].trim();
    }
  }

  if (!fileName) {
    fileName = `mediafire_${quickKey || Date.now()}.bin`;
  }

  // Extract file size if available from page
  let fileSize = 0;
  const matchSize = html.match(/Download\s*\(([0-9.]+\s*[KMGT]?B)\)/i);
  if (matchSize) {
    const sizeStr = matchSize[1];
    // Will be confirmed via range request / content-length
  }

  const result: CachedDirectLink = {
    directUrl,
    fileName,
    fileSize,
    expiresAt: Date.now() + 2 * 3600 * 1000, // 2 hours TTL
  };

  directLinkCache.set(cacheKey, result);
  if (quickKey) directLinkCache.set(quickKey, result);
  directLinkCache.set(directUrl, result);

  return result;
}

/**
 * Returns a valid direct download link for a MediaFire URL, utilizing cache and refreshing if expired.
 */
export async function getOrResolveMediafireDirectLink(
  urlOrQuickKey: string,
  forceFresh = false
): Promise<string> {
  const clean = urlOrQuickKey.trim();
  // If it's already a download*.mediafire.com link and not forcing fresh, return as is
  if (!forceFresh && /^https?:\/\/download\d*\.mediafire\.com\//i.test(clean)) {
    return clean;
  }
  const resolved = await resolveMediafireDirectDownloadLink(clean, forceFresh);
  return resolved.directUrl;
}

/**
 * Invalidates the cached direct link for a MediaFire URL (e.g. after a 403 or 410 error).
 */
export function invalidateMediafireDirectLinkCache(urlOrQuickKey: string): void {
  const quickKey = extractMediafireQuickKey(urlOrQuickKey);
  if (quickKey) directLinkCache.delete(quickKey);
  directLinkCache.delete(urlOrQuickKey.trim());
}

/**
 * Inspects a single MediaFire file and returns InspectedFileInfo.
 */
export async function inspectMediafireFile(urlOrQuickKey: string): Promise<InspectedFileInfo> {
  const { directUrl, fileName } = await resolveMediafireDirectDownloadLink(urlOrQuickKey);

  // Probe direct download link with a 0-byte range request to determine exact size
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
    console.warn("[MediaFire] No se pudo comprobar tamaño exacto con Range:", err?.message);
  }

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
    isMediafire: true,
  };
}
