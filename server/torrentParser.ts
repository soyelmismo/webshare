import crypto from "crypto";

export interface InspectedFileInfo {
  fileName: string;
  fileSize: number;
  fileSizeFormatted: string;
  sourceType: "direct" | "torrent";
  acceptRanges: boolean;
  infoHash?: string;
  pieceLength?: number;
  piecesCount?: number;
  files?: Array<{ name: string; length: number; path: string }>;
  torrentBase64?: string;
  webSeeds?: string[];
  activeMirrorUrl?: string;
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (!bytes || bytes <= 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
  return `${val} ${sizes[i]}`;
}

/**
 * Robust, zero-dependency Bencode decoder for torrent files.
 * Extracts dictionary structure, info dictionary raw bytes, and SHA1 infoHash.
 */
export function decodeTorrentBencode(buf: Buffer): {
  data: any;
  infoHash: string;
  rawInfoBuffer: Buffer | null;
} {
  let pos = 0;
  let rawInfoBuffer: Buffer | null = null;

  function parseNext(): any {
    if (pos >= buf.length) {
      throw new Error("Formato de archivo .torrent inválido o incompleto.");
    }
    const byte = buf[pos];

    if (byte === 105) {
      // "i" -> Integer: i<digits>e
      pos++;
      const end = buf.indexOf(101, pos); // "e"
      if (end === -1) throw new Error("Entero bencode no terminado.");
      const numStr = buf.toString("ascii", pos, end);
      pos = end + 1;
      return parseInt(numStr, 10);
    } else if (byte === 108) {
      // "l" -> List: l<items>e
      pos++;
      const list: any[] = [];
      while (pos < buf.length && buf[pos] !== 101) {
        list.push(parseNext());
      }
      pos++; // skip "e"
      return list;
    } else if (byte === 100) {
      // "d" -> Dictionary: d<key><value>...e
      pos++;
      const dict: Record<string, any> = {};
      while (pos < buf.length && buf[pos] !== 101) {
        const keyVal = parseNext();
        const keyStr = Buffer.isBuffer(keyVal)
          ? keyVal.toString("utf8")
          : String(keyVal);
        const isInfoKey = keyStr === "info";
        const valStart = pos;
        const childVal = parseNext();
        if (isInfoKey && !rawInfoBuffer) {
          rawInfoBuffer = buf.subarray(valStart, pos);
        }
        dict[keyStr] = childVal;
      }
      pos++; // skip "e"
      return dict;
    } else if (byte >= 48 && byte <= 57) {
      // "0"-"9" -> String: <len>:<contents>
      const colon = buf.indexOf(58, pos); // ":"
      if (colon === -1) throw new Error("Falta ':' en longitud de cadena bencode.");
      const len = parseInt(buf.toString("ascii", pos, colon), 10);
      pos = colon + 1;
      const data = buf.subarray(pos, pos + len);
      pos += len;
      return data;
    }

    throw new Error(
      `Carácter bencode desconocido: ${String.fromCharCode(byte)} en posición ${pos}`
    );
  }

  const root = parseNext();
  const infoHash = rawInfoBuffer
    ? crypto.createHash("sha1").update(rawInfoBuffer).digest("hex")
    : "";

  return { data: root, infoHash, rawInfoBuffer };
}

/**
 * Parses a .torrent buffer and returns complete metadata.
 */
export function parseTorrentBuffer(buf: Buffer): InspectedFileInfo {
  const { data, infoHash } = decodeTorrentBencode(buf);
  const info = data.info || {};
  let fileName = "";
  let fileSize = 0;
  const files: Array<{ name: string; length: number; path: string }> = [];

  if (info.files && Array.isArray(info.files)) {
    let total = 0;
    let largest = { name: "", length: 0 };
    for (const f of info.files) {
      const len = typeof f.length === "number" ? f.length : 0;
      total += len;
      const pathParts = Array.isArray(f.path)
        ? f.path.map((p: any) => (Buffer.isBuffer(p) ? p.toString("utf8") : String(p)))
        : [];
      const fName = pathParts[pathParts.length - 1] || "file";
      const fullPath = pathParts.join("/");
      files.push({ name: fName, length: len, path: fullPath });
      if (len > largest.length) {
        largest = { name: fName, length: len };
      }
    }
    fileSize = total;
    const rootName = Buffer.isBuffer(info.name)
      ? info.name.toString("utf8")
      : String(info.name || "");
    fileName = largest.name || rootName || "archivo_torrent.iso";
  } else if (info.length !== undefined) {
    fileSize =
      typeof info.length === "number" ? info.length : parseInt(String(info.length), 10);
    fileName = Buffer.isBuffer(info.name)
      ? info.name.toString("utf8")
      : String(info.name || "archivo.iso");
    files.push({ name: fileName, length: fileSize, path: fileName });
  } else {
    fileName = Buffer.isBuffer(info.name)
      ? info.name.toString("utf8")
      : String(info.name || "archivo.iso");
  }

  // Ensure reasonable file extension
  if (!fileName.includes(".")) {
    fileName += ".iso";
  }

  const pieceLength =
    typeof info["piece length"] === "number" ? info["piece length"] : 262144;
  const piecesCount =
    info.pieces && Buffer.isBuffer(info.pieces)
      ? Math.floor(info.pieces.length / 20)
      : 0;

  // Extract WebSeeds from url-list and httpseeds dictionaries
  const rawWebSeeds: string[] = [];
  if (data["url-list"]) {
    const raw = data["url-list"];
    if (Array.isArray(raw)) {
      rawWebSeeds.push(...raw.map((b: any) => (Buffer.isBuffer(b) ? b.toString("utf8") : String(b))));
    } else if (Buffer.isBuffer(raw)) {
      rawWebSeeds.push(raw.toString("utf8"));
    } else if (typeof raw === "string") {
      rawWebSeeds.push(raw);
    }
  }
  if (data["httpseeds"]) {
    const raw = data["httpseeds"];
    if (Array.isArray(raw)) {
      rawWebSeeds.push(...raw.map((b: any) => (Buffer.isBuffer(b) ? b.toString("utf8") : String(b))));
    } else if (Buffer.isBuffer(raw)) {
      rawWebSeeds.push(raw.toString("utf8"));
    } else if (typeof raw === "string") {
      rawWebSeeds.push(raw);
    }
  }

  // Normalize webseeds: if it ends with "/", append the file name
  const webSeeds: string[] = [];
  for (const ws of rawWebSeeds) {
    if (!ws || typeof ws !== "string") continue;
    const clean = ws.trim();
    if (clean.startsWith("http://") || clean.startsWith("https://")) {
      if (clean.endsWith("/")) {
        webSeeds.push(clean + fileName);
      } else {
        webSeeds.push(clean);
      }
    }
  }

  return {
    fileName,
    fileSize,
    fileSizeFormatted: formatBytes(fileSize),
    sourceType: "torrent",
    acceptRanges: true,
    infoHash,
    pieceLength,
    piecesCount,
    files,
    torrentBase64: buf.toString("base64"),
    webSeeds: webSeeds.length > 0 ? webSeeds : undefined,
  };
}

/**
 * Concurrently tests a list of WebSeed mirrors and returns the fastest working HTTP mirror URL.
 */
export async function findFastestWebSeedMirror(
  seeds: string[],
  maxToTest = 15,
  timeoutMs = 2500
): Promise<string | null> {
  if (!seeds || seeds.length === 0) return null;
  const candidates = seeds.slice(0, maxToTest);
  const controller = new AbortController();

  const testSingleMirror = async (mirrorUrl: string): Promise<string> => {
    try {
      const res = await fetch(mirrorUrl, {
        headers: {
          Range: "bytes=0-1023",
          "User-Agent": "Mozilla/5.0 (ServerSpecs WebSeed Probe 1.0)",
        },
        signal: controller.signal,
      });
      if (res.status === 206 || res.status === 200) {
        controller.abort();
        return mirrorUrl;
      }
    } catch {
      // ignore
    }
    throw new Error("Mirror failed");
  };

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), timeoutMs)
    );
    const probePromise = Promise.any(candidates.map(testSingleMirror));
    return await Promise.race([probePromise, timeoutPromise]);
  } catch {
    return null;
  }
}

/**
 * Parses magnet link parameters.
 */
export function parseMagnetUri(uri: string): {
  infoHash: string;
  name: string;
  length: number;
  trackers: string[];
} {
  let infoHash = "";
  let name = "";
  let length = 0;
  const trackers: string[] = [];

  try {
    const rawParams = uri.replace(/^magnet:\?/, "").split("&");
    for (const p of rawParams) {
      const [k, ...vParts] = p.split("=");
      const v = vParts.join("=");
      if (!k) continue;

      if (k === "xt" && v.startsWith("urn:btih:")) {
        infoHash = v.replace("urn:btih:", "").toLowerCase().trim();
      } else if (k === "dn") {
        try {
          name = decodeURIComponent(v.replace(/\+/g, " "));
        } catch {
          name = v;
        }
      } else if (k === "xl") {
        length = parseInt(v, 10) || 0;
      } else if (k === "tr") {
        try {
          trackers.push(decodeURIComponent(v));
        } catch {
          trackers.push(v);
        }
      }
    }
  } catch (e) {
    console.warn("Error parseando magnet uri:", e);
  }

  if (!name && infoHash) {
    name = `torrent_${infoHash.substring(0, 10)}.iso`;
  } else if (name && !name.includes(".")) {
    name += ".iso";
  }

  return { infoHash, name, length, trackers };
}

/**
 * Inspects a source (HTTP/HTTPS, Magnet link, or uploaded .torrent Base64).
 * Always returns within a few seconds and NEVER hangs.
 */
export async function inspectAnySource(
  sourceUrl: string,
  torrentBase64?: string
): Promise<InspectedFileInfo> {
  // 1. If base64 of .torrent is provided, parse it immediately (<2ms)
  if (torrentBase64 && torrentBase64.trim().length > 0) {
    try {
      const buf = Buffer.from(torrentBase64.trim(), "base64");
      const parsed = parseTorrentBuffer(buf);
      if (parsed.webSeeds && parsed.webSeeds.length > 0) {
        parsed.activeMirrorUrl = (await findFastestWebSeedMirror(parsed.webSeeds)) || undefined;
      }
      return parsed;
    } catch (err: any) {
      console.warn("Fallo al parsear torrentBase64 con bencode:", err);
      // If parsing failed, fallback to clean name from sourceUrl if available
      let fallbackName = "archivo_descargado.iso";
      if (sourceUrl) {
        fallbackName = sourceUrl.replace(/^torrent_file_/, "").replace(/\.torrent$/i, "");
      }
      return {
        fileName: fallbackName,
        fileSize: 0,
        fileSizeFormatted: "Desconocido",
        sourceType: "torrent",
        acceptRanges: true,
      };
    }
  }

  const trimmed = (sourceUrl || "").trim();

  // 2. If it's a magnet link
  if (trimmed.startsWith("magnet:")) {
    const mag = parseMagnetUri(trimmed);

    // Try fast cache lookups with a 3-second timeout
    if (mag.infoHash) {
      const caches = [
        `https://itorrents.org/torrent/${mag.infoHash}.torrent`,
        `https://btcache.me/torrent/${mag.infoHash}`,
      ];

      for (const cacheUrl of caches) {
        try {
          const res = await fetch(cacheUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (ServerSpecs Torrent Inspector 1.0)" },
            signal: AbortSignal.timeout(3500),
          });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const parsed = parseTorrentBuffer(buf);
            if (parsed.webSeeds && parsed.webSeeds.length > 0) {
              parsed.activeMirrorUrl = (await findFastestWebSeedMirror(parsed.webSeeds)) || undefined;
            }
            return parsed;
          }
        } catch {
          // Continue to next cache
        }
      }
    }

    // Return magnet metadata immediately without waiting 2 minutes for peers
    return {
      fileName: mag.name || (mag.infoHash ? `torrent_${mag.infoHash.substring(0, 10)}.iso` : "archivo_magnet.iso"),
      fileSize: mag.length,
      fileSizeFormatted: mag.length > 0 ? formatBytes(mag.length) : "Calculando al conectar...",
      sourceType: "torrent",
      acceptRanges: true,
      infoHash: mag.infoHash,
    };
  }

  // 3. If it's a remote .torrent file URL
  if (
    trimmed.toLowerCase().includes(".torrent") ||
    trimmed.startsWith("torrent:") ||
    trimmed.startsWith("torrent_file_")
  ) {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      try {
        const res = await fetch(trimmed, {
          headers: { "User-Agent": "Mozilla/5.0 (ServerSpecs Torrent Inspector 1.0)" },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const parsed = parseTorrentBuffer(buf);
          parsed.torrentBase64 = buf.toString("base64");
          if (parsed.webSeeds && parsed.webSeeds.length > 0) {
            parsed.activeMirrorUrl = (await findFastestWebSeedMirror(parsed.webSeeds)) || undefined;
          }
          return parsed;
        }
      } catch (e) {
        console.warn("No se pudo descargar .torrent remoto para inspección rápida:", e);
      }
    }

    // Fallback: extract name from path
    let fileName = "archivo_torrent.iso";
    try {
      const u = new URL(trimmed);
      fileName = u.pathname.split("/").pop() || fileName;
    } catch {
      fileName = trimmed.replace(/^torrent_file_/, "");
    }
    fileName = fileName.replace(/\.torrent$/i, "");
    if (!fileName.includes(".")) fileName += ".iso";

    return {
      fileName,
      fileSize: 0,
      fileSizeFormatted: "Se determinará en descarga",
      sourceType: "torrent",
      acceptRanges: true,
    };
  }

  // 4. Direct HTTP/HTTPS URL
  return await inspectDirectHttpUrl(trimmed);
}

/**
 * Inspects a direct HTTP/HTTPS URL with strict timeout guards.
 * Automatically identifies if the URL returns a .torrent file or binary download.
 */
export async function inspectDirectHttpUrl(url: string): Promise<InspectedFileInfo> {
  let fileSize = 0;
  let acceptRanges = false;
  let fileName = "";
  let isTorrentResponse = false;
  let torrentBuf: Buffer | null = null;

  // Extract fallback name from URL first
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length > 0) {
      fileName = decodeURIComponent(segments[segments.length - 1]);
    }
  } catch {
    fileName = "archivo_descargado.iso";
  }

  // 1. Try HEAD request with 6s timeout
  try {
    const headRes = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "Mozilla/5.0 (ServerSpecs Drive Streamer 1.0)" },
      signal: AbortSignal.timeout(6000),
    });

    const cType = (headRes.headers.get("content-type") || "").toLowerCase();
    if (
      cType.includes("application/x-bittorrent") ||
      cType.includes("application/x-torrent") ||
      cType.includes("torrent")
    ) {
      isTorrentResponse = true;
    }

    // Content disposition header
    const cd = headRes.headers.get("content-disposition");
    if (cd) {
      const match = cd.match(/filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']*)['"]?/i);
      if (match && match[1]) {
        try {
          fileName = decodeURIComponent(match[1].trim());
        } catch {
          fileName = match[1].trim();
        }
      }
      if (fileName.toLowerCase().endsWith(".torrent")) {
        isTorrentResponse = true;
      }
    }

    // Content length
    const cl = headRes.headers.get("content-length");
    if (cl) {
      fileSize = parseInt(cl, 10) || 0;
    }

    const ar = headRes.headers.get("accept-ranges");
    if (ar && ar.toLowerCase().includes("bytes")) {
      acceptRanges = true;
    }
  } catch (err) {
    // HEAD failed, will try Range/GET
  }

  // If detected as torrent or fileSize is very small (< 2MB) or not found, try quick GET
  if (isTorrentResponse || fileSize === 0 || (fileSize > 0 && fileSize < 2 * 1024 * 1024)) {
    try {
      const getRes = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (ServerSpecs Drive Streamer 1.0)",
        },
        signal: AbortSignal.timeout(7000),
      });

      const cType = (getRes.headers.get("content-type") || "").toLowerCase();
      const cd = getRes.headers.get("content-disposition");
      if (cd && !fileName) {
        const match = cd.match(/filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']*)['"]?/i);
        if (match && match[1]) {
          try {
            fileName = decodeURIComponent(match[1].trim());
          } catch {
            fileName = match[1].trim();
          }
        }
      }

      if (getRes.ok) {
        const arrayBuf = await getRes.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        // Check if buffer starts with bencode dict "d" (ASCII 100) and contains bencode keys
        if (
          buf.length > 20 &&
          buf[0] === 100 &&
          (buf.includes("8:announce") || buf.includes("4:info") || buf.includes("13:announce-list"))
        ) {
          try {
            const parsed = parseTorrentBuffer(buf);
            parsed.torrentBase64 = buf.toString("base64");
            if (parsed.webSeeds && parsed.webSeeds.length > 0) {
              parsed.activeMirrorUrl = (await findFastestWebSeedMirror(parsed.webSeeds)) || undefined;
            }
            return parsed;
          } catch {
            // Not a valid torrent bencode, continue normal HTTP
          }
        }

        if (!fileSize) {
          fileSize = buf.length;
        }
      }
    } catch {
      // Ignore
    }
  }

  // 2. If fileSize still not found, try Range GET of 1 byte with 6s timeout
  if (fileSize <= 0) {
    try {
      const rangeRes = await fetch(url, {
        method: "GET",
        headers: {
          Range: "bytes=0-0",
          "User-Agent": "Mozilla/5.0 (ServerSpecs Drive Streamer 1.0)",
        },
        signal: AbortSignal.timeout(6000),
      });

      if (rangeRes.status === 206) {
        acceptRanges = true;
      }

      const cr = rangeRes.headers.get("content-range");
      if (cr) {
        const match = cr.match(/\/(\d+)/);
        if (match && match[1]) {
          fileSize = parseInt(match[1], 10);
        }
      }

      if (!fileSize) {
        const cl = rangeRes.headers.get("content-length");
        if (cl && rangeRes.status === 200) {
          fileSize = parseInt(cl, 10);
        }
      }
    } catch {
      // Ignore network failure
    }
  }

  if (!fileName || fileName.trim().length === 0) {
    fileName = "archivo_descargado.iso";
  }
  if (!fileName.includes(".")) {
    fileName += ".iso";
  }

  return {
    fileName,
    fileSize,
    fileSizeFormatted: fileSize > 0 ? formatBytes(fileSize) : "No especificado",
    sourceType: "direct",
    acceptRanges: acceptRanges || fileSize > 0,
  };
}
