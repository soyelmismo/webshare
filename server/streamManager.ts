import fs from "fs";
import os from "os";
import path from "path";
import MemoryChunkStore from "memory-chunk-store";
import { StreamDriveTask, StreamManifestData, DriveSessionAuditResult } from "../src/types.js";
import {
  inspectAnySource,
  formatBytes,
  parseTorrentBuffer,
  findFastestWebSeedMirror,
  InspectedFileInfo,
} from "./torrentParser.js";

export { formatBytes };

async function fetchWithRetry(url: string | URL | globalThis.Request, options?: RequestInit, maxRetries = 3, initialDelay = 1000): Promise<Response> {
  let attempt = 0;
  while (attempt < maxRetries) {
    const res = await fetch(url, options);
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      attempt++;
      if (attempt >= maxRetries) return res;
      const delay = initialDelay * Math.pow(2, attempt - 1) + Math.random() * 500;
      console.warn(`[Drive API] HTTP ${res.status} for ${url}. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
    } else {
      return res;
    }
  }
  throw new Error("Unreachable");
}

const DEFAULT_TRACKERS = [
  // High-performance public UDP trackers (primary standard for global BitTorrent swarms)
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://p4p.arenabg.com:1337/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.cyberia.is:6969/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "udp://tracker.internetwarriors.net:1337/announce",
  "udp://tracker.leechers-paradise.org:6969/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://open.demonii.com:1337/announce",
  // HTTP/HTTPS fallbacks
  "http://tracker.opentrackr.org:1337/announce",
  "http://tracker.openbittorrent.com:80/announce",
  "http://nyaa.tracker.wf:7777/announce",
  "https://tracker.tamersunion.org:443/announce",
  // WebTorrent WebSocket trackers for WebRTC peers
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.fastcast.nz",
];

let webTorrentClientPromise: Promise<any> | null = null;
let activeWebTorrentClient: any = null;

async function getWebTorrentClient(): Promise<any> {
  if (activeWebTorrentClient) return activeWebTorrentClient;
  if (!webTorrentClientPromise) {
    webTorrentClientPromise = (async () => {
      try {
        const wtMod = await import("webtorrent");
        const WebTorrentClass = wtMod.default || wtMod;
        activeWebTorrentClient = new WebTorrentClass({
          maxConns: 200,
          dht: true,
          webSeeds: true,
        });
        return activeWebTorrentClient;
      } catch (err) {
        console.warn("Error al inicializar cliente WebTorrent:", err);
        throw err;
      }
    })();
  }
  return await webTorrentClientPromise;
}

/**
 * Safe event listener that works across all EventEmitter and Torrent implementations.
 */
function safeOnce(emitter: any, event: string, listener: (...args: any[]) => void) {
  if (!emitter) return;
  if (typeof emitter.once === "function") {
    emitter.once(event, listener);
    return;
  }
  let called = false;
  const wrapped = (...args: any[]) => {
    if (called) return;
    called = true;
    if (typeof emitter.removeListener === "function") {
      emitter.removeListener(event, wrapped);
    } else if (typeof emitter.off === "function") {
      emitter.off(event, wrapped);
    }
    listener(...args);
  };
  if (typeof emitter.on === "function") {
    emitter.on(event, wrapped);
  } else if (typeof emitter.addListener === "function") {
    emitter.addListener(event, wrapped);
  }
}

/**
 * Waits until a torrent has loaded its metadata and files array.
 * If already loaded, resolves immediately.
 */
function waitForTorrentReady(torrent: any, timeoutMs = 60000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (torrent.files && torrent.files.length > 0) {
      return resolve();
    }
    let finished = false;

    // Fast polling in case event already fired before listener attached
    const interval = setInterval(() => {
      if (finished) {
        clearInterval(interval);
        return;
      }
      if (torrent.files && torrent.files.length > 0) {
        finished = true;
        clearInterval(interval);
        clearTimeout(timeout);
        resolve();
      }
    }, 100);

    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      clearInterval(interval);
      if (torrent.files && torrent.files.length > 0) {
        return resolve();
      }
      reject(
        new Error(
          "Tiempo de espera agotado buscando metadatos del torrent. Verifica que el enlace tenga seeders/peers activos o utiliza un enlace directo HTTP/HTTPS."
        )
      );
    }, timeoutMs);

    const onDone = () => {
      if (finished) return;
      if (torrent.files && torrent.files.length > 0) {
        finished = true;
        clearInterval(interval);
        clearTimeout(timeout);
        resolve();
      }
    };

    safeOnce(torrent, "ready", onDone);
    safeOnce(torrent, "metadata", onDone);
    safeOnce(torrent, "error", (err: any) => {
      if (finished) return;
      finished = true;
      clearInterval(interval);
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Safely removes and destroys a torrent from the WebTorrent client.
 * Never throws "No torrent with id ...".
 */
async function safeRemoveTorrent(client: any, torrent: any): Promise<void> {
  if (!client || !torrent) return;
  try {
    if (Array.isArray(client.torrents)) {
      const idx = client.torrents.indexOf(torrent);
      if (idx !== -1) {
        client.torrents.splice(idx, 1);
      }
    }
    if (client.dht && client.dht._tables && torrent.infoHash) {
      try {
        client.dht._tables.remove(torrent.infoHash);
      } catch {}
    }
    if (typeof torrent.destroy === "function") {
      await new Promise<void>((resolve) => {
        try {
          torrent.destroy({ destroyStore: true }, () => resolve());
        } catch {
          resolve();
        }
      });
    }
    try {
      client.emit("remove", torrent);
    } catch {}
  } catch (e) {
    console.warn("safeRemoveTorrent warning:", e);
  }
}

const TASKS_CACHE_FILE = path.join(process.cwd(), ".stream_tasks_cache.json");

export class StreamTransferManager {
  private tasks: Map<string, StreamDriveTask> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private torrentsMap: Map<string, any> = new Map();
  private deletedTaskIds: Set<string> = new Set();
  private descargasFolderCache: Map<string, string> = new Map();

  constructor() {
    this.cleanupDiskCache();
    this.loadTasksFromDisk();
  }

  /**
   * Gets or creates the default 'Descargas Servidor' folder in Google Drive.
   * Centralizes all manifest files in 'Descargas Servidor' while the downloaded files
   * upload directly to any custom selected folder.
   */
  public async getOrCreateDescargasServidorFolder(accessToken: string): Promise<string> {
    if (!accessToken) return "";

    if (this.descargasFolderCache.has(accessToken)) {
      return this.descargasFolderCache.get(accessToken)!;
    }

    try {
      const query = `mimeType = 'application/vnd.google-apps.folder' and name = 'Descargas Servidor' and trashed = false`;
      const searchRes = await fetchWithRetry(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(5000),
        }
      );

      if (searchRes.ok) {
        const data = (await searchRes.json()) as { files?: Array<{ id: string }> };
        if (data.files && data.files.length > 0) {
          const id = data.files[0].id;
          this.descargasFolderCache.set(accessToken, id);
          return id;
        }
      }

      // Create 'Descargas Servidor' folder
      const createRes = await fetchWithRetry(
        "https://www.googleapis.com/drive/v3/files?fields=id",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Descargas Servidor",
            mimeType: "application/vnd.google-apps.folder",
          }),
        }
      );

      if (createRes.ok) {
        const created = (await createRes.json()) as { id: string };
        if (created.id) {
          this.descargasFolderCache.set(accessToken, created.id);
          return created.id;
        }
      }
    } catch (err) {
      console.warn("[StreamManager] Error al obtener/crear carpeta Descargas Servidor:", err);
    }

    return "";
  }

  /**
   * Cleans up stale /tmp/webtorrent directory to maintain absolute 0-disk footprint.
   */
  public cleanupDiskCache(): void {
    try {
      const tmpWebtorrentDir = path.join(os.tmpdir(), "webtorrent");
      if (fs.existsSync(tmpWebtorrentDir)) {
        fs.rmSync(tmpWebtorrentDir, { recursive: true, force: true });
        console.log("[StreamManager] 🧹 Limpiada la caché de disco /tmp/webtorrent.");
      }
    } catch (err) {
      console.warn("[StreamManager] Error no fatal limpiando /tmp/webtorrent:", err);
    }
  }

  /**
   * Loads persisted streaming tasks from local disk cache on startup.
   */
  private loadTasksFromDisk(): void {
    try {
      if (fs.existsSync(TASKS_CACHE_FILE)) {
        const raw = fs.readFileSync(TASKS_CACHE_FILE, "utf-8");
        const list = JSON.parse(raw) as StreamDriveTask[];
        if (Array.isArray(list)) {
          for (const t of list) {
            // Streaming tasks that were interrupted by a server reboot/crash are loaded as paused
            if (t.status === "streaming") {
              t.status = "paused";
              t.speedMBs = 0;
            }
            this.tasks.set(t.id, t);
          }
          console.log(`[StreamManager] ${list.length} tareas cargadas desde caché local persistente.`);
        }
      }
    } catch (e) {
      console.warn("No se pudo cargar la caché de tareas de disco:", e);
    }
  }

  /**
   * Persists active tasks to local disk cache to survive server restarts.
   */
  public saveTasksToDisk(): void {
    try {
      const list = Array.from(this.tasks.values());
      fs.writeFileSync(TASKS_CACHE_FILE, JSON.stringify(list, null, 2), "utf-8");
    } catch (e) {
      console.warn("No se pudo persistir caché de tareas en disco:", e);
    }
  }

  private async getOrCreateTorrent(torrentId: string, timeoutMs = 60000, torrentBase64?: string): Promise<any> {
    const client = await getWebTorrentClient();
    if (!client) {
      throw new Error("Cliente WebTorrent no activo.");
    }

    // 1. Check local instance cache
    if (this.torrentsMap.has(torrentId)) {
      const cached = this.torrentsMap.get(torrentId);
      if (cached && cached.files && cached.files.length > 0) {
        return cached;
      }
    }

    // 2. Extract infoHash if magnet
    let torrentIdStr = torrentId;
    let infoHashFromStr = "";
    if (torrentIdStr.startsWith("magnet:?")) {
      const match = torrentIdStr.match(/xt=urn:btih:([a-zA-Z0-9]+)/i);
      if (match && match[1]) {
        infoHashFromStr = match[1].toLowerCase();
      }
      for (const tr of DEFAULT_TRACKERS) {
        const enc = encodeURIComponent(tr);
        if (!torrentIdStr.includes(enc) && !torrentIdStr.includes(tr)) {
          torrentIdStr += `&tr=${enc}`;
        }
      }
    }

    // 3. Inspect existing torrent in client.torrents synchronously and safely
    let torrent: any = null;
    if (Array.isArray(client.torrents)) {
      for (const t of client.torrents) {
        if (!t) continue;
        if (infoHashFromStr && t.infoHash && t.infoHash.toLowerCase() === infoHashFromStr) {
          torrent = t;
          break;
        }
        if (t.magnetURI && t.magnetURI === torrentIdStr) {
          torrent = t;
          break;
        }
      }
    }

    // If torrent is stuck without metadata in client and we have a full .torrent base64 buffer,
    // safely destroy the empty torrent and recreate it from the buffer for instant metadata
    if (torrent && (!torrent.files || torrent.files.length === 0) && torrentBase64) {
      await safeRemoveTorrent(client, torrent);
      torrent = null;
    }

    // 4. Add to client if not present
    if (!torrent) {
      try {
        let addInput: string | Buffer = torrentIdStr;
        if (torrentBase64) {
          addInput = Buffer.from(torrentBase64, "base64");
        } else if (infoHashFromStr) {
          const caches = [
            `https://itorrents.org/torrent/${infoHashFromStr}.torrent`,
            `https://btcache.me/torrent/${infoHashFromStr}`,
          ];
          for (const url of caches) {
            try {
              const res = await fetchWithRetry(url, {
                headers: { "User-Agent": "Mozilla/5.0" },
                signal: AbortSignal.timeout(3500),
              });
              if (res.ok) {
                addInput = Buffer.from(await res.arrayBuffer());
                break;
              }
            } catch (e) {
              /* ignore */
            }
          }
        }

        torrent = client.add(addInput, {
          store: MemoryChunkStore,
          deselect: true,
          announce: DEFAULT_TRACKERS,
          maxWebConns: 16,
        });

        if (torrent) {
          try {
            torrent.maxConns = 150;
            for (const tr of DEFAULT_TRACKERS) {
              if (typeof torrent.addTracker === "function") {
                torrent.addTracker(tr);
              }
            }
          } catch {}
        }

        // Always attach a default error handler to prevent unhandled EventEmitter error crashes
        if (torrent && typeof torrent.on === "function") {
          torrent.on("error", (err: any) => {
            console.warn(
              `[WebTorrent] Torrent error (${infoHashFromStr || "unknown"}):`,
              err?.message || err
            );
          });
        }
      } catch (err: any) {
        // Fallback: check if it was already added to client.torrents
        if (Array.isArray(client.torrents)) {
          for (const t of client.torrents) {
            if (t && t.infoHash && infoHashFromStr && t.infoHash.toLowerCase() === infoHashFromStr) {
              torrent = t;
              break;
            }
          }
        }
        if (!torrent) throw err;
      }
    }

    if (torrent) {
      this.torrentsMap.set(torrentId, torrent);
      if (torrent.infoHash) this.torrentsMap.set(torrent.infoHash, torrent);
      if (torrent.magnetURI) this.torrentsMap.set(torrent.magnetURI, torrent);
    }

    // 4. Ensure metadata is ready
    if (!torrent.files || torrent.files.length === 0) {
      await waitForTorrentReady(torrent, timeoutMs);
    }

    if (torrent) {
      this.torrentsMap.set(torrentId, torrent);
      if (torrent.infoHash) this.torrentsMap.set(torrent.infoHash, torrent);
      if (torrent.magnetURI) this.torrentsMap.set(torrent.magnetURI, torrent);
    }

    return torrent;
  }

  public getTasks(folderId?: string, accountEmail?: string): StreamDriveTask[] {
    const all = Array.from(this.tasks.values()).sort((a, b) => b.startedAt - a.startedAt);
    return all.filter((t) => {
      if (
        accountEmail &&
        accountEmail.trim() !== "" &&
        t.accountEmail &&
        t.accountEmail.trim() !== "" &&
        t.accountEmail.toLowerCase() !== accountEmail.trim().toLowerCase()
      ) {
        return false;
      }
      if (
        folderId &&
        folderId.trim() !== "" &&
        folderId !== "root" &&
        t.driveFolderId &&
        t.driveFolderId.trim() !== "" &&
        t.driveFolderId !== "root" &&
        t.driveFolderId !== folderId
      ) {
        return false;
      }
      return true;
    });
  }

  public getTask(id: string): StreamDriveTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Inspects a direct URL, Magnet link, or .torrent file to get metadata before streaming.
   * Utilizes ultra-fast bencode parsing and reliable HEAD/Range checks with zero hanging.
   */
  public async inspectSource(sourceUrl: string, torrentBase64?: string): Promise<InspectedFileInfo> {
    return await inspectAnySource(sourceUrl, torrentBase64);
  }

  /**
   * Initializes a Google Drive Resumable Upload session.
   */
  public async initDriveResumableUpload(
    accessToken: string,
    folderId: string,
    fileName: string,
    fileSize: number
  ): Promise<string> {
    const metadata = {
      name: fileName,
      parents: folderId ? [folderId] : [],
      description: `Transmitido directamente a Google Drive por Server Specs Cloud Streamer.`,
    };

    const res = await fetchWithRetry(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": "application/octet-stream",
          "X-Upload-Content-Length": fileSize.toString(),
        },
        body: JSON.stringify(metadata),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 401 || errText.includes("authError") || errText.includes("Invalid Credentials")) {
        throw new Error("Tu sesión de Google Drive ha expirado (401). Reconecta tu cuenta de Google antes de iniciar una nueva transmisión.");
      }
      throw new Error(`Error al iniciar sesión reanudable en Google Drive: HTTP ${res.status}`);
    }

    const sessionUri = res.headers.get("Location");
    if (!sessionUri) {
      throw new Error("Google Drive no devolvió la cabecera Location de la sesión reanudable.");
    }

    return sessionUri;
  }

  /**
   * Saves or updates the streaming task manifest JSON in Google Drive.
   * If the user's OAuth token is missing or expired, gracefully skips Drive manifest update
   * since the upload to Google Drive capability URI continues uninterrupted.
   */
  public async saveManifestToDrive(
    accessToken: string,
    folderId: string,
    manifest: StreamManifestData,
    existingManifestFileId?: string
  ): Promise<string> {
    if (!accessToken) {
      return existingManifestFileId || "";
    }

    const manifestName = `stream_manifest_${manifest.taskId}.json`;
    const bodyStr = JSON.stringify(manifest, null, 2);

    let fileIdToUpdate = existingManifestFileId || this.tasks.get(manifest.taskId)?.manifestFileId;

    if (!fileIdToUpdate) {
      try {
        const queryUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          `name = '${manifestName}' and trashed = false`
        )}&fields=files(id,name)`;
        const searchRes = await fetchWithRetry(queryUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(4000),
        });
        if (searchRes.ok) {
          const searchData = (await searchRes.json()) as { files?: Array<{ id: string }> };
          if (searchData.files && searchData.files.length > 0) {
            fileIdToUpdate = searchData.files[0].id;
          }
        }
      } catch {}
    }

    if (fileIdToUpdate) {
      // Update existing file
      try {
        const updateRes = await fetchWithRetry(
          `https://www.googleapis.com/upload/drive/v3/files/${fileIdToUpdate}?uploadType=media`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: bodyStr,
          }
        );
        if (updateRes.ok) {
          const task = this.tasks.get(manifest.taskId);
          if (task) task.manifestFileId = fileIdToUpdate;
          return fileIdToUpdate;
        }
        if (updateRes.status === 401) {
          return fileIdToUpdate;
        }
      } catch {
        return fileIdToUpdate;
      }
    }

    // Create new manifest file in the 'Descargas Servidor' base folder
    try {
      const descargasFolderId = await this.getOrCreateDescargasServidorFolder(accessToken);
      const manifestParentFolder = descargasFolderId || folderId;

      const metadata = {
        name: manifestName,
        parents: manifestParentFolder && manifestParentFolder !== "root" ? [manifestParentFolder] : [],
        mimeType: "application/json",
        description: "Manifiesto de control de streaming para Server Specs Cloud Streamer",
      };

      const boundary = "-------streammanifest" + Date.now();
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const multipartBody =
        `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}` +
        `${delimiter}Content-Type: application/json\r\n\r\n${bodyStr}${closeDelimiter}`;

      const createRes = await fetchWithRetry(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
        }
      );

      if (!createRes.ok) {
        if (createRes.status === 401) {
          // Token expired, skip without logging raw error JSON
          return existingManifestFileId || "";
        }
        return existingManifestFileId || "";
      }

      const data = (await createRes.json()) as { id: string };
      return data.id;
    } catch {
      return existingManifestFileId || "";
    }
  }

  /**
   * Queries Google Drive to find how many bytes have actually been accepted for this session.
   */
  public async queryDriveSessionCommittedBytes(
    sessionUri: string,
    fileSize: number
  ): Promise<number> {
    try {
      const res = await fetchWithRetry(sessionUri, {
        method: "PUT",
        headers: {
          "Content-Length": "0",
          "Content-Range": `bytes */${fileSize}`,
        },
      });

      if (res.status === 308) {
        const range = res.headers.get("Range");
        if (range) {
          const parts = range.split("-");
          if (parts[1]) {
            return parseInt(parts[1], 10) + 1;
          }
        }
        return 0;
      } else if (res.status === 200 || res.status === 201) {
        return fileSize;
      }
    } catch (e) {
      console.warn("Error al consultar bytes confirmados en Drive:", e);
    }
    return 0;
  }

  /**
   * Starts a new continuous ISO streaming task directly to Google Drive.
   */
  public async startStreamTask(params: {
    sourceUrl: string;
    accessToken: string;
    folderId: string;
    accountEmail?: string;
    customChunkSizeMB?: number;
    customFileName?: string;
    torrentBase64?: string;
    selectedFilePath?: string;
    selectedFileSize?: number;
  }): Promise<StreamDriveTask> {
    const {
      sourceUrl,
      accessToken,
      folderId,
      accountEmail,
      customChunkSizeMB,
      customFileName,
      torrentBase64,
      selectedFilePath,
      selectedFileSize,
    } = params;

    // Deduplication check: if a task exists for exact same sourceUrl AND selectedFilePath/fileName
    const targetDedupeKey = selectedFilePath ? `${sourceUrl}_${selectedFilePath}` : sourceUrl;
    for (const existingTask of this.tasks.values()) {
      const existingKey = (existingTask as any).selectedFilePath
        ? `${existingTask.sourceUrl}_${(existingTask as any).selectedFilePath}`
        : existingTask.sourceUrl;
      if (
        (existingTask.status === "streaming" || existingTask.status === "paused") &&
        existingKey === targetDedupeKey
      ) {
        console.log(`[StreamManager] Retornando tarea existente (${existingTask.id}) para URL/archivo: ${targetDedupeKey}`);
        return existingTask;
      }
    }

    let inspected = await this.inspectSource(sourceUrl, torrentBase64);

    // If it is a torrent or magnet link and the size hasn't been determined yet,
    // resolve metadata dynamically from the swarm before starting the Drive session
    const isTorrentSource =
      inspected.sourceType === "torrent" ||
      sourceUrl.startsWith("magnet:") ||
      sourceUrl.toLowerCase().includes(".torrent") ||
      Boolean(torrentBase64) ||
      Boolean(inspected.infoHash);

    if (isTorrentSource && (!inspected.fileSize || inspected.fileSize <= 0)) {
      try {
        console.log("[StreamManager] Resolviendo metadatos del torrent/magnet en la red P2P...");
        const torrent = await this.getOrCreateTorrent(
          inspected.torrentBase64 || torrentBase64 || sourceUrl,
          35000,
          inspected.torrentBase64 || torrentBase64
        );
        await waitForTorrentReady(torrent, 35000);

        if (torrent && torrent.files && torrent.files.length > 0) {
          const largestFile = torrent.files.reduce(
            (a: any, b: any) => (b.length > a.length ? b : a),
            torrent.files[0]
          );
          inspected.fileName = customFileName || largestFile.name || torrent.name || inspected.fileName;
          inspected.fileSize = largestFile.length || torrent.length;
          inspected.fileSizeFormatted = formatBytes(inspected.fileSize);
          inspected.sourceType = "torrent";
          if (torrent.torrentFile) {
            inspected.torrentBase64 = torrent.torrentFile.toString("base64");
          }
        }
      } catch (err: any) {
        throw new Error(
          `No se pudieron obtener los metadatos del torrent desde la red P2P (${err.message}). Verifica que el torrent o magnet tenga seeders activos o sube el archivo .torrent directamente.`
        );
      }
    }

    if (selectedFileSize && selectedFileSize > 0) {
      inspected.fileSize = selectedFileSize;
      inspected.fileSizeFormatted = formatBytes(selectedFileSize);
    }

    if (!inspected.fileSize || inspected.fileSize <= 0) {
      throw new Error(
        "No se pudo determinar el tamaño del archivo de origen. Si es un enlace HTTP directo, el servidor remoto debe devolver la cabecera Content-Length. Si es un torrent, asegúrate de subir el archivo .torrent o usar un magnet con seeders activos."
      );
    }

    const fileName = customFileName || (selectedFilePath ? selectedFilePath.split("/").pop() : undefined) || inspected.fileName;
    // Chunk size: multiple of 256KB (262,144 bytes). Default: 16MB (fast for serverless & continuous servers).
    const chunkMB = Math.max(4, Math.min(customChunkSizeMB || 16, 64));
    const chunkSizeBytes = Math.floor((chunkMB * 1024 * 1024) / 262144) * 262144;

    const taskId = `stream_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 1. Initialize Google Drive resumable upload session
    const sessionUri = await this.initDriveResumableUpload(
      accessToken,
      folderId,
      fileName,
      inspected.fileSize
    );

    const totalChunks = Math.ceil(inspected.fileSize / chunkSizeBytes);

    const task: StreamDriveTask = {
      id: taskId,
      accountEmail: accountEmail || undefined,
      fileName,
      sourceUrl,
      sourceType: inspected.sourceType,
      torrentBase64: inspected.torrentBase64 || torrentBase64,
      webSeeds: inspected.webSeeds,
      activeMirrorUrl: inspected.activeMirrorUrl,
      fileSize: inspected.fileSize,
      fileSizeFormatted: formatBytes(inspected.fileSize),
      chunkSizeBytes,
      chunkSizeFormatted: `${chunkMB} MB`,
      resumableUploadUrl: sessionUri,
      driveFolderId: folderId,
      uploadedBytes: 0,
      uploadedBytesFormatted: "0 Bytes",
      currentChunkIndex: 0,
      totalChunks,
      progressPercent: 0,
      speedMBs: 0,
      status: "streaming",
      startedAt: Date.now(),
      selectedFilePath,
    } as any;

    this.tasks.set(taskId, task);
    this.saveTasksToDisk();

    // 2. Initial manifest write to Drive
    try {
      const manifestId = await this.saveManifestToDrive(accessToken, folderId, {
        version: 1,
        taskId,
        accountEmail: accountEmail || undefined,
        fileName,
        sourceUrl,
        sourceType: inspected.sourceType,
        torrentBase64: task.torrentBase64,
        webSeeds: task.webSeeds,
        fileSize: inspected.fileSize,
        chunkSizeBytes,
        resumableUploadUrl: sessionUri,
        driveFolderId: folderId,
        uploadedBytes: 0,
        currentChunkIndex: 0,
        totalChunks,
        status: "streaming",
        startedAt: task.startedAt,
        updatedAt: Date.now(),
      });
      task.manifestFileId = manifestId;
      this.saveTasksToDisk();
    } catch (e) {
      console.warn("Advertencia: No se pudo crear el archivo manifiesto en Drive:", e);
    }

    // 3. Launch background streaming process
    this.runStreamingLoop(taskId, accessToken);

    return task;
  }

  /**
   * Processes a single chunk for a task. Safe for both background loops and serverless polling triggers.
   */
  public async processNextChunk(
    taskId: string,
    accessToken: string,
    activeFolderId?: string,
    activeAccountEmail?: string
  ): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "streaming" || (task as any).isProcessingChunk) {
      return false;
    }

    // Work strictly on tasks belonging to the active account / folder
    if (activeFolderId && activeFolderId.trim() !== "" && task.driveFolderId && task.driveFolderId !== activeFolderId) {
      return false;
    }
    if (
      activeAccountEmail &&
      activeAccountEmail.trim() !== "" &&
      task.accountEmail &&
      task.accountEmail.toLowerCase() !== activeAccountEmail.toLowerCase()
    ) {
      return false;
    }

    if (task.uploadedBytes >= task.fileSize) {
      task.status = "completed";
      task.progressPercent = 100;
      task.speedMBs = 0;
      task.completedAt = Date.now();
      this.saveTasksToDisk();
      return false;
    }

    (task as any).isProcessingChunk = true;
    const now = Date.now();
    try {
      // Sync committed bytes directly from Google Drive before fetching from source.
      // This guarantees that multiple instances/tabs stay perfectly synchronized and
      // never download or upload redundant chunks.
      const committed = await this.queryDriveSessionCommittedBytes(task.resumableUploadUrl, task.fileSize);
      if (committed > task.uploadedBytes) {
        task.uploadedBytes = committed;
        task.uploadedBytesFormatted = formatBytes(committed);
        task.currentChunkIndex = Math.floor(committed / task.chunkSizeBytes);
        task.progressPercent = Math.min(99, Math.round((committed / task.fileSize) * 100));
        this.saveTasksToDisk();
      }

      if (task.uploadedBytes >= task.fileSize) {
        task.status = "completed";
        task.progressPercent = 100;
        task.speedMBs = 0;
        task.completedAt = Date.now();
        this.saveTasksToDisk();
        return true;
      }

      const start = task.uploadedBytes;
      const end = Math.min(start + task.chunkSizeBytes, task.fileSize);
      const chunkLen = end - start;

      // 1. Fetch chunk slice from source
      let buf = await this.fetchSourceChunkSlice({
        taskId: task.id,
        sourceUrl: task.sourceUrl,
        sourceType: task.sourceType,
        start,
        end,
        torrentBase64: task.torrentBase64,
        webSeeds: task.webSeeds,
        activeMirrorUrl: task.activeMirrorUrl,
      });

      if (buf.length !== chunkLen) {
        if (end === task.fileSize && buf.length < chunkLen) {
          const padded = Buffer.alloc(chunkLen);
          buf.copy(padded);
          buf = padded;
        } else {
          throw new Error(`Tamaño de chunk recibido (${buf.length} B) no coincide con el esperado (${chunkLen} B).`);
        }
      }

      // 2. Upload to Google Drive via PUT
      const putTimeout = AbortSignal.timeout(60000);
      const driveRes = await fetchWithRetry(task.resumableUploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": chunkLen.toString(),
          "Content-Range": `bytes ${start}-${end - 1}/${task.fileSize}`,
        },
        body: buf,
        signal: putTimeout,
      });

      if (driveRes.status === 308 || driveRes.status === 200 || driveRes.status === 201) {
        const lastTime = (task as any).lastChunkAt || task.startedAt || now;
        const timeDiffSec = Math.max(0.1, (now - lastTime) / 1000);
        const speedMBs = Math.round((chunkLen / (1024 * 1024) / timeDiffSec) * 10) / 10;

        task.uploadedBytes = end;
        task.uploadedBytesFormatted = formatBytes(end);
        task.currentChunkIndex = Math.floor(end / task.chunkSizeBytes);
        task.progressPercent = Math.min(100, Math.round((end / task.fileSize) * 100));
        task.speedMBs = speedMBs;
        (task as any).lastChunkAt = now;

        if (driveRes.status === 200 || driveRes.status === 201 || end >= task.fileSize) {
          const resultData = driveRes.status !== 308 ? await driveRes.json().catch(() => ({})) : {};
          task.status = "completed";
          task.progressPercent = 100;
          task.speedMBs = 0;
          task.completedAt = Date.now();
          if (resultData.id) task.finalDriveFileId = resultData.id;
          if (resultData.md5Checksum) task.md5Checksum = resultData.md5Checksum;
          if (resultData.webViewLink) task.webViewLink = resultData.webViewLink;
        }

        this.saveTasksToDisk();

        // Update manifest on Drive
        if (accessToken && task.manifestFileId && task.driveFolderId) {
          this.saveManifestToDrive(
            accessToken,
            task.driveFolderId,
            {
              version: 1,
              taskId: task.id,
              fileName: task.fileName,
              sourceUrl: task.sourceUrl,
              sourceType: task.sourceType,
              torrentBase64: task.torrentBase64,
              webSeeds: task.webSeeds,
              fileSize: task.fileSize,
              chunkSizeBytes: task.chunkSizeBytes,
              resumableUploadUrl: task.resumableUploadUrl,
              driveFolderId: task.driveFolderId,
              uploadedBytes: task.uploadedBytes,
              currentChunkIndex: task.currentChunkIndex,
              totalChunks: task.totalChunks,
              status: task.status,
              startedAt: task.startedAt,
              updatedAt: now,
              finalDriveFileId: task.finalDriveFileId,
              md5Checksum: task.md5Checksum,
            },
            task.manifestFileId
          ).catch(() => {});
        }

        return true;
      } else if (driveRes.status >= 500) {
        console.warn(`[StreamManager] Drive status ${driveRes.status} al subir chunk`);
        return false;
      } else {
        const errText = await driveRes.text();
        throw new Error(`Google Drive HTTP ${driveRes.status}: ${errText}`);
      }
    } catch (err: any) {
      console.warn(`[StreamManager] Error procesando chunk para ${taskId}:`, err?.message);
      task.error = err?.message;
      return false;
    } finally {
      (task as any).isProcessingChunk = false;
    }
  }

  /**
   * The core rolling-window streaming loop.
   */
  private async runStreamingLoop(taskId: string, accessToken: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const abortController = new AbortController();
    this.abortControllers.set(taskId, abortController);

    try {
      // Check current committed offset on Google Drive
      const committed = await this.queryDriveSessionCommittedBytes(
        task.resumableUploadUrl,
        task.fileSize
      );
      if (committed > task.uploadedBytes) {
        task.uploadedBytes = committed;
        task.uploadedBytesFormatted = formatBytes(committed);
        task.currentChunkIndex = Math.floor(committed / task.chunkSizeBytes);
        task.progressPercent = Math.min(100, Math.round((committed / task.fileSize) * 100));
      }

      while (task.uploadedBytes < task.fileSize && task.status === "streaming") {
        if (abortController.signal.aborted) break;
        const success = await this.processNextChunk(taskId, accessToken);
        if (!success) {
          if (task.status !== "streaming") break;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } catch (err: any) {
      if (!abortController.signal.aborted && task.status === "streaming") {
        task.status = "error";
        task.error = err?.message || "Error en transmisión de chunks";
        this.saveTasksToDisk();
      }
    } finally {
      this.abortControllers.delete(taskId);
      this.saveTasksToDisk();
    }
  }

  private async fetchDirectHttpChunk(
    url: string,
    start: number,
    end: number,
    signal?: AbortSignal
  ): Promise<Buffer> {
    const timeoutSignal = AbortSignal.timeout(15000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    const res = await fetchWithRetry(url, {
      headers: {
        Range: `bytes=${start}-${end - 1}`,
        "User-Agent": "Mozilla/5.0 (ServerSpecs Drive Streamer 1.0)",
      },
      signal: combinedSignal,
    });

    if (!res.ok && res.status !== 206) {
      throw new Error(
        `Servidor HTTP ${res.status} al pedir rango ${start}-${end - 1}.`
      );
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  /**
   * Fetches an exact byte slice from either Direct HTTP, WebSeed mirrors, or Torrent swarm.
   */
  private async fetchSourceChunkSlice(params: {
    taskId: string;
    sourceUrl: string;
    sourceType: "direct" | "torrent";
    start: number;
    end: number;
    signal?: AbortSignal;
    torrentBase64?: string;
    webSeeds?: string[];
    activeMirrorUrl?: string;
  }): Promise<Buffer> {
    const {
      taskId,
      sourceUrl,
      sourceType,
      start,
      end,
      signal,
      torrentBase64,
      webSeeds,
      activeMirrorUrl,
    } = params;
    const task = this.tasks.get(taskId);

    // 1. Direct HTTP source
    if (sourceType === "direct") {
      return await this.fetchDirectHttpChunk(sourceUrl, start, end, signal);
    }

    // 2. Torrent with WebSeeds (HTTP mirrors embedded in torrent)
    let mirrorCandidates: string[] = [];
    if (activeMirrorUrl) mirrorCandidates.push(activeMirrorUrl);
    if (webSeeds && webSeeds.length > 0) {
      for (const s of webSeeds) {
        if (!mirrorCandidates.includes(s)) mirrorCandidates.push(s);
      }
    }

    // Auto-discover WebSeeds from cache or base64 if not yet loaded on task
    if (mirrorCandidates.length === 0) {
      try {
        let b64 = torrentBase64;
        if (!b64 && sourceUrl.startsWith("magnet:")) {
          const match = sourceUrl.match(/xt=urn:btih:([a-zA-Z0-9]+)/i);
          if (match && match[1]) {
            const infoHash = match[1].toLowerCase();
            const caches = [
              `https://itorrents.org/torrent/${infoHash}.torrent`,
              `https://btcache.me/torrent/${infoHash}`,
            ];
            for (const c of caches) {
              try {
                const res = await fetchWithRetry(c, {
                  headers: { "User-Agent": "Mozilla/5.0" },
                  signal: AbortSignal.timeout(3500),
                });
                if (res.ok) {
                  const buf = Buffer.from(await res.arrayBuffer());
                  b64 = buf.toString("base64");
                  if (task) task.torrentBase64 = b64;
                  break;
                }
              } catch {}
            }
          }
        }

        if (b64) {
          const buf = Buffer.from(b64, "base64");
          const parsed = parseTorrentBuffer(buf);
          if (parsed.webSeeds && parsed.webSeeds.length > 0) {
            if (task) task.webSeeds = parsed.webSeeds;
            mirrorCandidates = parsed.webSeeds;
          }
        }
      } catch (e) {
        console.warn("No se pudieron auto-descubrir WebSeeds para el torrent:", e);
      }
    }

    // If WebSeed mirrors are available, stream chunk directly via HTTP Range!
    if (mirrorCandidates.length > 0) {
      const mirrorsToTry = mirrorCandidates.slice(0, 10);
      for (const mirror of mirrorsToTry) {
        try {
          const chunk = await this.fetchDirectHttpChunk(mirror, start, end, signal);
          if (task) task.activeMirrorUrl = mirror;
          return chunk;
        } catch (mirrorErr) {
          console.warn(`Mirror HTTP ${mirror} falló (${start}-${end}), probando siguiente espejo...`);
        }
      }
    }

    // 3. Fallback: WebTorrent P2P swarm streaming
    return await this.fetchTorrentChunkSlice(
      sourceUrl,
      start,
      end,
      task?.torrentBase64 || torrentBase64,
      signal,
      (task as any)?.selectedFilePath
    );
  }

  /**
   * Reads an exact byte slice from a WebTorrent file read stream.
   */
  private async fetchTorrentChunkSlice(
    torrentId: string,
    start: number,
    end: number,
    torrentBase64?: string,
    signal?: AbortSignal,
    selectedFilePath?: string
  ): Promise<Buffer> {
    const torrent = await this.getOrCreateTorrent(torrentId, 60000, torrentBase64);

    if (!torrent.files || torrent.files.length === 0) {
      throw new Error("No se encontraron archivos en el torrent.");
    }

    // Find target file (matching selectedFilePath or largest file)
    let targetFile = torrent.files[0];
    if (selectedFilePath) {
      targetFile =
        torrent.files.find((f: any) => f.path === selectedFilePath || f.name === selectedFilePath) ||
        targetFile;
    } else {
      for (const f of torrent.files) {
        if (f.length > (targetFile ? targetFile.length : 0)) {
          targetFile = f;
        }
      }
    }

    if (!targetFile) {
      throw new Error("No se encontró el archivo dentro del torrent.");
    }

    // Prioritize pieces for this exact slice across connected peers in the swarm
    if (torrent.pieceLength && typeof torrent.critical === "function") {
      const fileOffset = (targetFile as any).offset || 0;
      const globalStart = fileOffset + start;
      const globalEnd = fileOffset + end - 1;
      const startPiece = Math.floor(globalStart / torrent.pieceLength);
      const endPiece = Math.floor(globalEnd / torrent.pieceLength);
      try {
        torrent.critical(startPiece, endPiece);
      } catch {}
    }

    return new Promise((resolve, reject) => {
      const stream = targetFile.createReadStream({ start, end: end - 1 });
      const chunks: Buffer[] = [];
      let timer: NodeJS.Timeout | null = setTimeout(() => {
        if (typeof (stream as any).destroy === "function") {
          try {
            (stream as any).destroy();
          } catch {}
        }
        reject(
          new Error(
            `Tiempo de espera agotado descargando segmento del torrent (${formatBytes(start)} - ${formatBytes(end)}). Verifica que el torrent tenga seeders activos.`
          )
        );
      }, 90000);

      const onAbort = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (typeof (stream as any).destroy === "function") {
          try {
            (stream as any).destroy();
          } catch {}
        }
        reject(new Error("Transmisión cancelada o pausada."));
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        resolve(Buffer.concat(chunks));
      });
      stream.on("error", (err: any) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        reject(err);
      });
    });
  }

  /**
   * Pauses an active streaming task.
   */
  public async pauseTask(taskId: string, accessToken?: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.status = "paused";
    task.speedMBs = 0;
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(taskId);
    }

    // Query committed bytes in Drive to keep local task synchronized with Google's cloud
    try {
      const committed = await this.queryDriveSessionCommittedBytes(task.resumableUploadUrl, task.fileSize);
      if (committed > 0) {
        task.uploadedBytes = committed;
        task.uploadedBytesFormatted = formatBytes(committed);
        task.currentChunkIndex = Math.floor(committed / task.chunkSizeBytes);
        task.progressPercent = Math.min(99, Math.round((committed / task.fileSize) * 100));
      }
    } catch {}

    this.saveTasksToDisk();

    // Update manifest in Drive with paused state if accessToken provided
    if (accessToken && task.manifestFileId) {
      this.saveManifestToDrive(
        accessToken,
        task.driveFolderId,
        {
          version: 1,
          taskId: task.id,
          fileName: task.fileName,
          sourceUrl: task.sourceUrl,
          sourceType: task.sourceType,
          torrentBase64: task.torrentBase64,
          webSeeds: task.webSeeds,
          fileSize: task.fileSize,
          chunkSizeBytes: task.chunkSizeBytes,
          resumableUploadUrl: task.resumableUploadUrl,
          driveFolderId: task.driveFolderId,
          uploadedBytes: task.uploadedBytes,
          currentChunkIndex: task.currentChunkIndex,
          totalChunks: task.totalChunks,
          status: "paused",
          startedAt: task.startedAt,
          updatedAt: Date.now(),
        },
        task.manifestFileId
      ).catch(() => {});
    }

    return true;
  }

  /**
   * Audits a Google Drive resumable upload session in real-time.
   * Sends an atomic Range query to Google Drive's API to certify the exact bytes stored in the cloud.
   */
  public async auditDriveSession(taskId: string): Promise<DriveSessionAuditResult> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Tarea de streaming '${taskId}' no encontrada.`);
    }

    try {
      const res = await fetchWithRetry(task.resumableUploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": "0",
          "Content-Range": `bytes */${task.fileSize}`,
        },
      });

      const rangeHeader = res.headers.get("Range");
      const googleServer = res.headers.get("server") || "Google UploadServer / Cloud Storage";

      let uploadId = "";
      try {
        const parsed = new URL(task.resumableUploadUrl);
        uploadId = parsed.searchParams.get("upload_id") || "";
      } catch {}

      if (res.status === 308) {
        let committedBytes = 0;
        if (rangeHeader) {
          const parts = rangeHeader.split("-");
          if (parts[1]) {
            committedBytes = parseInt(parts[1], 10) + 1;
          }
        }

        // Update task if Drive has higher committed progress
        if (committedBytes > task.uploadedBytes) {
          task.uploadedBytes = committedBytes;
          task.uploadedBytesFormatted = formatBytes(committedBytes);
          task.currentChunkIndex = Math.floor(committedBytes / task.chunkSizeBytes);
          task.progressPercent = Math.min(99, Math.round((committedBytes / task.fileSize) * 100));
          this.saveTasksToDisk();
        }

        return {
          taskId,
          sessionUri: task.resumableUploadUrl,
          uploadId,
          status: 308,
          statusText: "Resume Incomplete (Confirmado por Google)",
          rangeHeader,
          committedBytes,
          committedBytesFormatted: formatBytes(committedBytes),
          totalBytes: task.fileSize,
          totalBytesFormatted: task.fileSizeFormatted,
          progressPercent: Math.min(99, Math.round((committedBytes / task.fileSize) * 100)),
          sessionAlive: true,
          googleServer,
          manifestFileId: task.manifestFileId,
          message: `Google Drive certifica formalmente ${formatBytes(committedBytes)} recibidos y almacenados en sus servidores.`,
          explanation: `Google Drive retiene todos los chunks en un búfer de sesión reanudable en la nube. El archivo no aparece en la lista de drive.google.com hasta completar el último byte (200 OK) para proteger tu unidad contra archivos truncados o corruptos de 0-bytes. Si reinicias el servidor o borras el disco local, la sesión en Google sigue viva (hasta 7 días) y puedes reanudar la subida sin repetir chunks.`,
        };
      } else if (res.status === 200 || res.status === 201) {
        task.uploadedBytes = task.fileSize;
        task.uploadedBytesFormatted = formatBytes(task.fileSize);
        task.currentChunkIndex = task.totalChunks;
        task.progressPercent = 100;
        task.status = "completed";
        this.saveTasksToDisk();

        return {
          taskId,
          sessionUri: task.resumableUploadUrl,
          uploadId,
          status: res.status,
          statusText: "OK / Created (Finalizado)",
          rangeHeader: `bytes=0-${task.fileSize - 1}`,
          committedBytes: task.fileSize,
          committedBytesFormatted: task.fileSizeFormatted,
          totalBytes: task.fileSize,
          totalBytesFormatted: task.fileSizeFormatted,
          progressPercent: 100,
          sessionAlive: true,
          googleServer,
          manifestFileId: task.manifestFileId,
          message: "El archivo ha finalizado exitosamente y ya está publicado en Google Drive.",
          explanation: "Todos los bytes fueron consolidados y el archivo ya está accesible en tu Google Drive.",
        };
      } else if (res.status === 404 || res.status === 410) {
        return {
          taskId,
          sessionUri: task.resumableUploadUrl,
          uploadId,
          status: res.status,
          statusText: res.statusText || "Sesión Expirada",
          rangeHeader: null,
          committedBytes: task.uploadedBytes,
          committedBytesFormatted: task.uploadedBytesFormatted,
          totalBytes: task.fileSize,
          totalBytesFormatted: task.fileSizeFormatted,
          progressPercent: task.progressPercent,
          sessionAlive: false,
          googleServer,
          manifestFileId: task.manifestFileId,
          message: "La sesión de subida en Google Drive ha expirado o ya no está disponible.",
          explanation: "Las sesiones reanudables de Google Drive expiran tras 7 días de inactividad.",
        };
      } else {
        return {
          taskId,
          sessionUri: task.resumableUploadUrl,
          uploadId,
          status: res.status,
          statusText: res.statusText || "Respuesta Inesperada",
          rangeHeader,
          committedBytes: task.uploadedBytes,
          committedBytesFormatted: task.uploadedBytesFormatted,
          totalBytes: task.fileSize,
          totalBytesFormatted: task.fileSizeFormatted,
          progressPercent: task.progressPercent,
          sessionAlive: false,
          googleServer,
          manifestFileId: task.manifestFileId,
          message: `Google Drive respondió con código ${res.status}: ${res.statusText}`,
          explanation: "Consulta la consola para más detalles sobre la respuesta de Google Drive.",
        };
      }
    } catch (e: any) {
      throw new Error(`Fallo al contactar con la API de Google Drive: ${e.message}`);
    }
  }

  /**
   * Resumes a paused streaming task.
   */
  public async resumeTask(taskId: string, accessToken: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // If already actively streaming, do not abort or restart
    if (task.status === "streaming" && this.abortControllers.has(taskId)) {
      console.log(`[StreamManager] Task ${taskId} is already actively streaming. No action needed.`);
      return true;
    }

    // Abort any existing controller/loop for this task
    const existingController = this.abortControllers.get(taskId);
    if (existingController) {
      existingController.abort();
      this.abortControllers.delete(taskId);
    }

    // Check confirmed bytes in Google Drive before resuming
    try {
      const committed = await this.queryDriveSessionCommittedBytes(task.resumableUploadUrl, task.fileSize);
      if (committed >= task.fileSize) {
        task.uploadedBytes = task.fileSize;
        task.uploadedBytesFormatted = formatBytes(task.fileSize);
        task.currentChunkIndex = task.totalChunks;
        task.progressPercent = 100;
        task.status = "completed";
        this.saveTasksToDisk();
        return true;
      } else if (committed > 0) {
        task.uploadedBytes = committed;
        task.uploadedBytesFormatted = formatBytes(committed);
        task.currentChunkIndex = Math.floor(committed / task.chunkSizeBytes);
        task.progressPercent = Math.min(99, Math.round((committed / task.fileSize) * 100));
      }
    } catch {}

    // If torrentBase64 or webSeeds are missing, attempt recovery before resuming
    if (task.sourceType === "torrent" && (!task.webSeeds || task.webSeeds.length === 0)) {
      try {
        const inspected = await this.inspectSource(task.sourceUrl, task.torrentBase64);
        if (inspected.torrentBase64) task.torrentBase64 = inspected.torrentBase64;
        if (inspected.webSeeds) task.webSeeds = inspected.webSeeds;
        if (inspected.activeMirrorUrl) task.activeMirrorUrl = inspected.activeMirrorUrl;
      } catch (e) {
        console.warn("No se pudo re-inspeccionar WebSeeds al reanudar:", e);
      }
    }

    task.status = "streaming";
    task.error = undefined;
    this.saveTasksToDisk();
    this.runStreamingLoop(taskId, accessToken);
    return true;
  }

  /**
   * Cancels and cleans up a streaming task.
   */
  public async cancelTask(taskId: string, accessToken?: string): Promise<boolean> {
    this.deletedTaskIds.add(taskId);
    const task = this.tasks.get(taskId);

    if (task) {
      task.status = "idle";
      const controller = this.abortControllers.get(taskId);
      if (controller) {
        controller.abort();
        this.abortControllers.delete(taskId);
      }
      this.tasks.delete(taskId);
      this.saveTasksToDisk();
      this.cleanupDiskCache();
    }

    // Attempt to delete manifest from Drive if we have access token
    if (accessToken) {
      try {
        if (task?.manifestFileId) {
          await fetchWithRetry(`https://www.googleapis.com/drive/v3/files/${task.manifestFileId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(5000),
          }).catch(() => {});
        }

        // Search for any manifest file matching stream_manifest_${taskId}.json
        const manifestName = `stream_manifest_${taskId}.json`;
        const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          `name = '${manifestName}' and trashed = false`
        )}&fields=files(id,name)`;
        const searchRes = await fetchWithRetry(searchUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(5000),
        });

        if (searchRes.ok) {
          const searchData = (await searchRes.json()) as { files?: Array<{ id: string }> };
          if (searchData.files && searchData.files.length > 0) {
            for (const file of searchData.files) {
              await fetchWithRetry(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(5000),
              }).catch(() => {});
            }
          }
        }
      } catch (e) {
        console.warn("Failed to delete manifest from Drive on cancel:", e);
      }
    }

    return true;
  }

  /**
   * Scans Google Drive for `stream_manifest_*.json` files to recover
   * active or interrupted streaming tasks after a container restart, app reload, or /tmp wipe!
   * Automatically re-verifies live byte progress with Google Cloud and resumes streaming.
   */
  public async recoverFromDriveFolder(
    accessToken: string,
    folderId?: string,
    accountEmail?: string
  ): Promise<StreamDriveTask[]> {
    const recoveredTasks: StreamDriveTask[] = [];
    const seenTaskIds = new Set<string>();

    // 1. Search for stream manifests in the 'Descargas Servidor' base folder and custom folderId (if specified)
    let manifestFiles: Array<{ id: string; name: string }> = [];

    const descargasFolderId = await this.getOrCreateDescargasServidorFolder(accessToken);
    const targetParents = new Set<string>();
    if (descargasFolderId) targetParents.add(descargasFolderId);
    if (folderId && folderId.trim() && folderId !== "root") targetParents.add(folderId.trim());

    for (const parentId of targetParents) {
      try {
        const folderQuery = `name contains 'stream_manifest_' and trashed = false and '${parentId}' in parents`;
        const folderUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          folderQuery
        )}&fields=files(id,name,modifiedTime)&pageSize=50`;

        const folderRes = await fetchWithRetry(folderUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (folderRes.ok) {
          const data = (await folderRes.json()) as { files?: Array<{ id: string; name: string }> };
          if (data.files && data.files.length > 0) {
            for (const f of data.files) {
              if (!manifestFiles.some((mf) => mf.id === f.id)) {
                manifestFiles.push(f);
              }
            }
          }
        }
      } catch (err) {
        console.warn("[StreamManager] Error al buscar manifiestos en carpeta de origen:", err);
      }
    }

    // 2. Also search globally across user's Drive if fewer than 5 found
    if (manifestFiles.length < 5) {
      try {
        const globalQuery = `name contains 'stream_manifest_' and trashed = false`;
        const globalUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          globalQuery
        )}&fields=files(id,name,modifiedTime)&pageSize=50`;

        const globalRes = await fetchWithRetry(globalUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (globalRes.ok) {
          const globalData = (await globalRes.json()) as { files?: Array<{ id: string; name: string }> };
          if (globalData.files) {
            for (const gf of globalData.files) {
              if (!manifestFiles.some((f) => f.id === gf.id)) {
                manifestFiles.push(gf);
              }
            }
          }
        }
      } catch (err) {
        console.warn("[StreamManager] Error al buscar manifiestos globales en Drive:", err);
      }
    }

    // 3. Process each manifest retrieved from Google Drive
    for (const file of manifestFiles) {
      try {
        const contentRes = await fetchWithRetry(
          `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (!contentRes.ok) continue;
        const manifest = (await contentRes.json()) as StreamManifestData;
        if (!manifest || !manifest.taskId || !manifest.resumableUploadUrl) continue;

        // Delete duplicate manifest files from Drive if seen before
        if (seenTaskIds.has(manifest.taskId)) {
          fetchWithRetry(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
          }).catch(() => {});
          continue;
        }

        // Un-mark task from deletedTaskIds since we are recovering it
        this.deletedTaskIds.delete(manifest.taskId);

        seenTaskIds.add(manifest.taskId);

        // If this task is ALREADY actively streaming in memory, do NOT pause or disturb it!
        const existingLiveTask = this.tasks.get(manifest.taskId);
        if (
          existingLiveTask &&
          (existingLiveTask.status === "streaming" || this.abortControllers.has(manifest.taskId))
        ) {
          console.log(
            `[StreamManager] Recover: task ${manifest.taskId} is already actively streaming. Preserving live transfer.`
          );
          recoveredTasks.push(existingLiveTask);
          continue;
        }

        // Query actual bytes saved on Google Drive for this session
        const actualCommitted = await this.queryDriveSessionCommittedBytes(
          manifest.resumableUploadUrl,
          manifest.fileSize
        );

        const currentChunkIndex = Math.floor(actualCommitted / manifest.chunkSizeBytes);
        const progressPercent = Math.min(100, Math.round((actualCommitted / manifest.fileSize) * 100));
        const isFinished = actualCommitted >= manifest.fileSize;

        const recoveredTask: StreamDriveTask = {
          id: manifest.taskId,
          accountEmail: manifest.accountEmail || accountEmail,
          fileName: manifest.fileName,
          sourceUrl: manifest.sourceUrl,
          sourceType: manifest.sourceType,
          torrentBase64: manifest.torrentBase64,
          webSeeds: manifest.webSeeds,
          fileSize: manifest.fileSize,
          fileSizeFormatted: formatBytes(manifest.fileSize),
          chunkSizeBytes: manifest.chunkSizeBytes,
          chunkSizeFormatted: `${Math.round(manifest.chunkSizeBytes / (1024 * 1024))} MB`,
          resumableUploadUrl: manifest.resumableUploadUrl,
          driveFolderId: manifest.driveFolderId || folderId,
          manifestFileId: file.id,
          uploadedBytes: actualCommitted,
          uploadedBytesFormatted: formatBytes(actualCommitted),
          currentChunkIndex,
          totalChunks: manifest.totalChunks,
          progressPercent,
          speedMBs: 0,
          status: isFinished ? "completed" : (manifest.status === "paused" ? "paused" : "streaming"),
          startedAt: manifest.startedAt,
          completedAt: isFinished ? manifest.updatedAt || Date.now() : undefined,
          finalDriveFileId: manifest.finalDriveFileId,
          md5Checksum: manifest.md5Checksum,
        };

        this.tasks.set(manifest.taskId, recoveredTask);
        recoveredTasks.push(recoveredTask);
      } catch (manifestErr) {
        console.warn("[StreamManager] No se pudo parsear manifiesto en Drive:", file.name, manifestErr);
      }
    }

    // 4. Also scan any existing tasks in memory/disk that weren't in manifests
    for (const [taskId, localTask] of this.tasks.entries()) {
      if (seenTaskIds.has(taskId)) continue;
      if (localTask.status === "completed") continue;

      // If already streaming in memory, do not pause or disturb it!
      if (localTask.status === "streaming" && this.abortControllers.has(taskId)) {
        recoveredTasks.push(localTask);
        continue;
      }

      if (localTask.resumableUploadUrl && localTask.fileSize > 0) {
        try {
          const committed = await this.queryDriveSessionCommittedBytes(
            localTask.resumableUploadUrl,
            localTask.fileSize
          );

          if (committed >= localTask.fileSize) {
            localTask.uploadedBytes = localTask.fileSize;
            localTask.uploadedBytesFormatted = formatBytes(localTask.fileSize);
            localTask.currentChunkIndex = localTask.totalChunks;
            localTask.progressPercent = 100;
            localTask.status = "completed";
          } else {
            localTask.uploadedBytes = committed;
            localTask.uploadedBytesFormatted = formatBytes(committed);
            localTask.currentChunkIndex = Math.floor(committed / localTask.chunkSizeBytes);
            localTask.progressPercent = Math.min(99, Math.round((committed / localTask.fileSize) * 100));
            localTask.status = "paused";
          }
          recoveredTasks.push(localTask);
        } catch (e) {
          console.warn(`[StreamManager] Error verificando sesión en Drive para tarea local ${taskId}:`, e);
        }
      }
    }

    this.saveTasksToDisk();

    // 5. Automatically resume only tasks that are NOT already active/streaming
    for (const task of recoveredTasks) {
      if (task.status !== "completed" && task.uploadedBytes < task.fileSize) {
        if (!this.abortControllers.has(task.id) && task.status !== "streaming") {
          this.resumeTask(task.id, accessToken).catch((err) => {
            console.warn(`[StreamManager] Auto-reanudación falló para tarea recuperada ${task.id}:`, err);
          });
        }
      }
    }

    return recoveredTasks;
  }
}

export const streamManager = new StreamTransferManager();
