import fs from "fs";
import os from "os";
import path from "path";
import { BoundedMemoryChunkStore } from "./memoryStore.js";
import { rcloneAuthManager } from "./rcloneAuth.js";
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
          maxConns: 50,
          dht: true,
          webSeeds: true,
          utp: false, // TCP is far more efficient on edge device CPUs
        });
        activeWebTorrentClient.on("error", (err: any) => {
          console.warn("[WebTorrent Client] Error global no fatal:", err?.message || err);
        });
        return activeWebTorrentClient;
      } catch (err) {
        console.warn("Error al inicializar cliente WebTorrent:", err);
        webTorrentClientPromise = null;
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
 * Safely removes and destroys a torrent from the WebTorrent client without throwing.
 */
async function safeRemoveTorrent(client: any, torrent: any): Promise<void> {
  if (!client || !torrent) return;
  try {
    if (torrent.store) {
      if (typeof torrent.store.destroy === "function") {
        try { torrent.store.destroy(() => {}); } catch {}
      } else if (typeof torrent.store.close === "function") {
        try { torrent.store.close(() => {}); } catch {}
      }
    }
    if (typeof client.remove === "function") {
      await new Promise<void>((resolve) => {
        try {
          client.remove(torrent, { destroyStore: true }, () => resolve());
        } catch {
          if (typeof torrent.destroy === "function") {
            try {
              torrent.destroy({ destroyStore: true }, () => resolve());
            } catch {
              resolve();
            }
          } else {
            resolve();
          }
        }
      });
    } else if (typeof torrent.destroy === "function") {
      await new Promise<void>((resolve) => {
        try {
          torrent.destroy({ destroyStore: true }, () => resolve());
        } catch {
          resolve();
        }
      });
    }
  } catch (e) {
    console.warn("[StreamManager] safeRemoveTorrent warning:", e);
  }
}

const TASKS_CACHE_FILE = path.join(process.cwd(), ".stream_tasks_cache.json");

export class StreamTransferManager {
  private tasks: Map<string, StreamDriveTask> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private torrentsMap: Map<string, any> = new Map();
  private deletedTaskIds: Set<string> = new Set();
  private descargasFolderCache: Map<string, string> = new Map();
  private driveFolderCache: Map<string, string> = new Map();
  private driveFolderInFlight: Map<string, Promise<string>> = new Map();

  private sharedTorrentBase64: Map<string, string> = new Map();

  // BitTorrent-style Queue Scheduler
  private maxConcurrentDownloads: number = 2;
  private activeAccountTokens: Map<string, string> = new Map();
  private isDispatchingQueue: boolean = false;
  private queueWatchdogTimer: NodeJS.Timeout | null = null;
  private saveTasksDebounceTimer: NodeJS.Timeout | null = null;

  /**
   * Retrieves the raw torrent base64 string associated with a task without duplicating it in memory.
   */
  public getTorrentBase64ForTask(task?: StreamDriveTask | null): string | undefined {
    if (!task) return undefined;
    if (task.torrentBase64) return task.torrentBase64;
    if (task.batchId && this.sharedTorrentBase64.has(task.batchId)) {
      return this.sharedTorrentBase64.get(task.batchId);
    }
    if (task.sourceUrl && this.sharedTorrentBase64.has(task.sourceUrl)) {
      return this.sharedTorrentBase64.get(task.sourceUrl);
    }
    if (this.sharedTorrentBase64.has(task.id)) {
      return this.sharedTorrentBase64.get(task.id);
    }
    return undefined;
  }

  /**
   * Sets or updates the raw torrent base64 string in shared memory.
   */
  public setTorrentBase64ForTask(key: string, base64: string): void {
    if (!key || !base64) return;
    this.sharedTorrentBase64.set(key, base64);
  }

  constructor() {
    this.cleanupDiskCache();
    this.loadTasksFromDisk();
    this.startQueueWatchdog();
  }

  /**
   * Registers or updates an active OAuth access token in RAM for background queue dispatching.
   */
  public recordAccountToken(accessToken: string, accountEmail?: string): void {
    if (!accessToken || typeof accessToken !== "string") return;
    const cleanToken = accessToken.replace(/^Bearer\s+/i, "").trim();
    if (!cleanToken) return;

    if (accountEmail && accountEmail.trim()) {
      this.activeAccountTokens.set(accountEmail.trim().toLowerCase(), cleanToken);
    }
    this.activeAccountTokens.set("__default__", cleanToken);
  }

  /**
   * Retrieves the most relevant OAuth token for a given account.
   */
  public getAccountToken(accountEmail?: string): string | undefined {
    if (accountEmail && accountEmail.trim()) {
      const email = accountEmail.trim().toLowerCase();
      if (this.activeAccountTokens.has(email)) {
        return this.activeAccountTokens.get(email);
      }
    }
    return this.activeAccountTokens.get("__default__");
  }

  /**
   * Asynchronously resolves a fresh, auto-refreshed access token via Rclone/OAuth manager.
   */
  public async getAccountTokenAsync(accountEmail?: string): Promise<string | undefined> {
    try {
      const rcloneToken = await rcloneAuthManager.getValidAccessToken(accountEmail);
      if (rcloneToken) {
        this.recordAccountToken(rcloneToken, accountEmail);
        return rcloneToken;
      }
    } catch {}
    return this.getAccountToken(accountEmail);
  }

  public getMaxConcurrentDownloads(): number {
    return this.maxConcurrentDownloads;
  }

  public setMaxConcurrentDownloads(limit: number): void {
    const val = Number(limit);
    if (!isNaN(val) && val >= 1 && val <= 10) {
      this.maxConcurrentDownloads = val;
      this.dispatchQueue();
    }
  }

  /**
   * Autonomous BitTorrent-style Queue Dispatcher.
   * Promotes queued tasks to streaming whenever an active slot becomes available,
   * respecting maxConcurrentDownloads and queue positions.
   */
  public async dispatchQueue(): Promise<void> {
    if (this.isDispatchingQueue) return;
    this.isDispatchingQueue = true;

    try {
      // 1. Count currently active streaming tasks
      const activeTasks = Array.from(this.tasks.values()).filter(
        (t) => t.status === "streaming"
      );

      const availableSlots = this.maxConcurrentDownloads - activeTasks.length;
      if (availableSlots <= 0) {
        return;
      }

      // 2. Find and sort all queued tasks by queueIndex ascending, then startedAt
      const queuedTasks = Array.from(this.tasks.values())
        .filter((t) => t.status === "queued")
        .sort((a, b) => {
          const qA = typeof a.queueIndex === "number" ? a.queueIndex : Infinity;
          const qB = typeof b.queueIndex === "number" ? b.queueIndex : Infinity;
          if (qA !== qB) return qA - qB;
          return a.startedAt - b.startedAt;
        });

      if (queuedTasks.length === 0) {
        return;
      }

      // 3. Promote queued tasks up to availableSlots
      let promotedCount = 0;
      for (const task of queuedTasks) {
        if (promotedCount >= availableSlots) break;
        const token = (await this.getAccountTokenAsync(task.accountEmail)) || this.getAccountToken(task.accountEmail);
        if (!token) {
          continue;
        }

        console.log(`[QueueScheduler] Promoviendo tarea de cola a streaming: #${task.queueIndex || 1} "${task.fileName}"`);
        task.status = "streaming";
        this.saveTasksToDisk();

        // Launch the autonomous streaming loop for this task
        this.runStreamingLoop(task.id, token);
        promotedCount++;
      }
    } catch (err: any) {
      console.warn("[QueueScheduler] Error en dispatchQueue:", err?.message);
    } finally {
      this.isDispatchingQueue = false;
    }
  }

  /**
   * Reorders a queued task within the queue (up, down, top, bottom), exactly like a torrent client.
   */
  public reorderQueueTask(taskId: string, action: "up" | "down" | "top" | "bottom"): boolean {
    const targetTask = this.tasks.get(taskId);
    if (!targetTask || targetTask.status !== "queued") {
      return false;
    }

    const targetEmail = (targetTask.accountEmail || "").toLowerCase();
    // Get all queued tasks for this account sorted by current queueIndex / startedAt
    const queuedTasks = Array.from(this.tasks.values())
      .filter((t) => t.status === "queued" && (!targetEmail || !t.accountEmail || t.accountEmail.toLowerCase() === targetEmail))
      .sort((a, b) => {
        const qA = typeof a.queueIndex === "number" ? a.queueIndex : Infinity;
        const qB = typeof b.queueIndex === "number" ? b.queueIndex : Infinity;
        if (qA !== qB) return qA - qB;
        return a.startedAt - b.startedAt;
      });

    const currentIndex = queuedTasks.findIndex((t) => t.id === taskId);
    if (currentIndex === -1) return false;

    if (action === "up") {
      if (currentIndex > 0) {
        const temp = queuedTasks[currentIndex];
        queuedTasks[currentIndex] = queuedTasks[currentIndex - 1];
        queuedTasks[currentIndex - 1] = temp;
      }
    } else if (action === "down") {
      if (currentIndex < queuedTasks.length - 1) {
        const temp = queuedTasks[currentIndex];
        queuedTasks[currentIndex] = queuedTasks[currentIndex + 1];
        queuedTasks[currentIndex + 1] = temp;
      }
    } else if (action === "top") {
      const [item] = queuedTasks.splice(currentIndex, 1);
      queuedTasks.unshift(item);
    } else if (action === "bottom") {
      const [item] = queuedTasks.splice(currentIndex, 1);
      queuedTasks.push(item);
    }

    // Renumber sequentially 1..N
    queuedTasks.forEach((t, idx) => {
      t.queueIndex = idx + 1;
      t.totalInBatch = queuedTasks.length;
    });

    this.saveTasksToDisk();
    this.dispatchQueue();
    return true;
  }

  private startQueueWatchdog(): void {
    if (this.queueWatchdogTimer) clearInterval(this.queueWatchdogTimer);
    this.queueWatchdogTimer = setInterval(() => {
      this.dispatchQueue();
    }, 2500);
    if (this.queueWatchdogTimer && typeof this.queueWatchdogTimer.unref === "function") {
      this.queueWatchdogTimer.unref();
    }
  }

  /**
   * Ensures that a nested folder hierarchy exists in Google Drive (e.g. "TorrentName/Season 1/Disc 1").
   * Searches for existing folders or creates them level-by-level, returning the Google Drive Folder ID
   * of the deepest leaf directory. Thread-safe with in-memory caching and in-flight promise deduplication.
   */
  public async ensureDriveFolderHierarchy(
    accessToken: string,
    rootFolderId: string,
    relativeDirPath: string
  ): Promise<string> {
    if (!accessToken) return rootFolderId || "root";
    const baseId = rootFolderId && rootFolderId.trim() !== "" ? rootFolderId.trim() : "root";

    const segments = relativeDirPath
      .replace(/\\/g, "/")
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== "." && s !== "..");

    if (segments.length === 0) {
      return baseId;
    }

    let currentParentId = baseId;
    let accumulatedPath = "";

    for (const segment of segments) {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${segment}` : segment;
      const cacheKey = `${baseId}:${accumulatedPath}`;

      if (this.driveFolderCache.has(cacheKey)) {
        currentParentId = this.driveFolderCache.get(cacheKey)!;
        continue;
      }

      if (this.driveFolderInFlight.has(cacheKey)) {
        currentParentId = await this.driveFolderInFlight.get(cacheKey)!;
        continue;
      }

      const folderCreationPromise = (async () => {
        // 1. Search if folder already exists in Google Drive under currentParentId
        const escapedName = segment.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapedName}' and '${currentParentId}' in parents and trashed = false`;

        try {
          const searchRes = await fetchWithRetry(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: AbortSignal.timeout(10000),
            }
          );

          if (searchRes.ok) {
            const data = (await searchRes.json().catch(() => ({}))) as { files?: Array<{ id: string }> };
            if (data.files && data.files.length > 0 && data.files[0].id) {
              const existingId = data.files[0].id;
              this.driveFolderCache.set(cacheKey, existingId);
              return existingId;
            }
          }
        } catch (searchErr: any) {
          console.warn(`[StreamManager] Error buscando carpeta '${segment}' en Drive:`, searchErr.message);
        }

        // 2. Create missing folder in Google Drive under currentParentId
        const createRes = await fetchWithRetry(
          "https://www.googleapis.com/drive/v3/files?fields=id,name",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: segment,
              mimeType: "application/vnd.google-apps.folder",
              parents: currentParentId && currentParentId !== "root" ? [currentParentId] : ["root"],
            }),
            signal: AbortSignal.timeout(15000),
          }
        );

        if (!createRes.ok) {
          const errBody = await createRes.text().catch(() => "");
          throw new Error(`Error al crear carpeta '${segment}' en Google Drive (${createRes.status}): ${errBody}`);
        }

        const created = (await createRes.json()) as { id?: string };
        if (!created.id) {
          throw new Error(`Google Drive no devolvió ID para la carpeta creada '${segment}'.`);
        }

        this.driveFolderCache.set(cacheKey, created.id);
        return created.id;
      })();

      this.driveFolderInFlight.set(cacheKey, folderCreationPromise);
      try {
        currentParentId = await folderCreationPromise;
      } finally {
        this.driveFolderInFlight.delete(cacheKey);
      }
    }

    return currentParentId;
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
        const parsed = JSON.parse(raw);

        let list: StreamDriveTask[] = [];

        // Check if file is version 2 format with shared torrents
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.version === 2) {
          if (parsed.torrents && typeof parsed.torrents === "object") {
            for (const [k, v] of Object.entries(parsed.torrents)) {
              if (typeof v === "string" && v) {
                this.sharedTorrentBase64.set(k, v);
              }
            }
          }
          list = Array.isArray(parsed.tasks) ? parsed.tasks : [];
        } else if (Array.isArray(parsed)) {
          // Version 1 legacy format: migrate and deduplicate
          list = parsed;
          for (const t of list) {
            if (t.torrentBase64) {
              const dedupeKey = t.batchId || t.sourceUrl || t.id;
              if (!this.sharedTorrentBase64.has(dedupeKey)) {
                this.sharedTorrentBase64.set(dedupeKey, t.torrentBase64);
              }
              t.torrentBase64 = undefined;
            }
          }
        }

        if (Array.isArray(list)) {
          for (const t of list) {
            // Streaming tasks that were interrupted by a server reboot/crash are loaded as paused
            if (t.status === "streaming") {
              t.status = "paused";
              t.speedMBs = 0;
            }
            // Ensure torrentBase64 is never duplicated in memory on individual tasks
            if (t.torrentBase64) {
              const dedupeKey = t.batchId || t.sourceUrl || t.id;
              if (!this.sharedTorrentBase64.has(dedupeKey)) {
                this.sharedTorrentBase64.set(dedupeKey, t.torrentBase64);
              }
              t.torrentBase64 = undefined;
            }
            this.tasks.set(t.id, t);
          }
          console.log(`[StreamManager] ${list.length} tareas cargadas desde caché local persistente (formato optimizado).`);
        }
      }
    } catch (e) {
      console.warn("No se pudo cargar la caché de tareas de disco:", e);
    }
  }

  /**
   * Persists active tasks to local disk cache to survive server restarts.
   * Debounced to 1.5 seconds and non-blocking to prevent CPU/SD-card stall on edge devices.
   */
  public saveTasksToDisk(immediate: boolean = false): void {
    const serializeData = () => {
      const activeSharedTorrents: Record<string, string> = {};
      const strippedTasks: StreamDriveTask[] = [];

      for (const t of this.tasks.values()) {
        const b64 = this.getTorrentBase64ForTask(t);
        if (b64) {
          const key = t.batchId || t.sourceUrl || t.id;
          activeSharedTorrents[key] = b64;
        }

        if (t.torrentBase64) {
          const { torrentBase64, ...rest } = t;
          strippedTasks.push(rest as StreamDriveTask);
        } else {
          strippedTasks.push(t);
        }
      }

      // Prune dead torrents from memory
      this.sharedTorrentBase64.clear();
      for (const [k, v] of Object.entries(activeSharedTorrents)) {
        this.sharedTorrentBase64.set(k, v);
      }

      return JSON.stringify(
        {
          version: 2,
          torrents: activeSharedTorrents,
          tasks: strippedTasks,
        },
        null,
        2
      );
    };

    if (immediate) {
      if (this.saveTasksDebounceTimer) {
        clearTimeout(this.saveTasksDebounceTimer);
        this.saveTasksDebounceTimer = null;
      }
      try {
        fs.writeFileSync(TASKS_CACHE_FILE, serializeData(), "utf-8");
      } catch (e) {
        console.warn("No se pudo persistir caché de tareas en disco:", e);
      }
      return;
    }

    if (this.saveTasksDebounceTimer) return;
    this.saveTasksDebounceTimer = setTimeout(() => {
      this.saveTasksDebounceTimer = null;
      try {
        const content = serializeData();
        fs.promises.writeFile(TASKS_CACHE_FILE, content, "utf-8").catch(() => {});
      } catch {}
    }, 1500);

    if (this.saveTasksDebounceTimer && typeof this.saveTasksDebounceTimer.unref === "function") {
      this.saveTasksDebounceTimer.unref();
    }
  }

  /**
   * Safely destroys and unregisters any active WebTorrent instance associated with a task
   * to immediately release swarm connections, sockets, and in-memory piece buffers.
   * If other tasks in a multi-file batch are still streaming or queued, deselects the finished file
   * while keeping the swarm connection alive so subsequent files start instantaneously.
   */
  public async destroyTorrentForTask(task: StreamDriveTask): Promise<void> {
    (task as any).prefetchedChunk = undefined;
    const client = await getWebTorrentClient().catch(() => null);
    const b64 = this.getTorrentBase64ForTask(task);
    const candidates = [
      task.id,
      task.batchId,
      task.sourceUrl,
      b64,
      (task as any).infoHash,
    ].filter(Boolean) as string[];

    // Check if there are other tasks (active or queued) that share this torrent/batch
    const hasOtherPendingTasks = Array.from(this.tasks.values()).some((other) => {
      if (other.id === task.id) return false;
      if (other.status !== "streaming" && other.status !== "queued") return false;
      if (task.batchId && other.batchId && task.batchId === other.batchId) return true;
      if (task.sourceUrl && other.sourceUrl && task.sourceUrl === other.sourceUrl) return true;
      const otherB64 = this.getTorrentBase64ForTask(other);
      if (b64 && otherB64 && b64 === otherB64) return true;
      return false;
    });

    if (hasOtherPendingTasks) {
      // Other files from this torrent are still streaming or queued in the batch!
      // Deselect this finished file to stop downloading its pieces and release RAM,
      // but KEEP the swarm connection and metadata alive for the remaining files.
      try {
        const activeTorrent =
          this.torrentsMap.get(task.id) ||
          (task.batchId ? this.torrentsMap.get(task.batchId) : null) ||
          this.torrentsMap.get(task.sourceUrl) ||
          (b64 ? this.torrentsMap.get(b64) : null);
        if (activeTorrent && activeTorrent.files) {
          const file = activeTorrent.files.find((f: any) => {
            const cleanPath = (f.path || "").replace(/\\/g, "/");
            const taskPath = (task.selectedFilePath || "").replace(/\\/g, "/");
            return cleanPath === taskPath || f.name === task.fileName;
          });
          if (file && typeof file.deselect === "function") {
            file.deselect();
          }
        }
      } catch {}
      return;
    }

    const destroyed = new Set<any>();

    for (const key of candidates) {
      if (this.torrentsMap.has(key)) {
        const t = this.torrentsMap.get(key);
        this.torrentsMap.delete(key);
        if (t && !destroyed.has(t)) {
          destroyed.add(t);
          if (t.infoHash) this.torrentsMap.delete(t.infoHash);
          if (t.magnetURI) this.torrentsMap.delete(t.magnetURI);
          if (client) {
            await safeRemoveTorrent(client, t);
          }
        }
      }
    }

    if (task.batchId) this.sharedTorrentBase64.delete(task.batchId);
    this.sharedTorrentBase64.delete(task.id);
  }

  /**
   * Edge-device RAM defense: Evicts pieces that have already been confirmed by Google Drive.
   */
  public evictConfirmedPieces(task: StreamDriveTask, committedBytes: number): void {
    if (task.sourceType !== "torrent") return;
    try {
      const b64 = this.getTorrentBase64ForTask(task);
      const activeTorrent =
        this.torrentsMap.get(task.id) ||
        (task.batchId ? this.torrentsMap.get(task.batchId) : null) ||
        this.torrentsMap.get(task.sourceUrl) ||
        (b64 ? this.torrentsMap.get(b64) : null);
      if (!activeTorrent || !activeTorrent.store || !activeTorrent.pieceLength) return;

      let targetFile: any = null;
      if (task.selectedFilePath && Array.isArray(activeTorrent.files)) {
        const cleanTarget = task.selectedFilePath.replace(/\\/g, "/").trim();
        targetFile = activeTorrent.files.find((f: any) => {
          const fPath = (f.path || "").replace(/\\/g, "/").trim();
          return fPath === cleanTarget || fPath.endsWith("/" + cleanTarget) || cleanTarget.endsWith("/" + fPath);
        });
      }
      if (!targetFile && Array.isArray(activeTorrent.files) && activeTorrent.files.length > 0) {
        targetFile = activeTorrent.files[0];
      }

      const fileOffset = (targetFile as any)?.offset || 0;
      const fileLength = Number(targetFile?.length) || task.fileSize || 0;
      const rawStore = (activeTorrent.store as any).store || activeTorrent.store;

      if (rawStore && typeof rawStore.setProtectedRange === "function") {
        if (committedBytes >= fileLength) {
          rawStore.removeProtectedRange(task.id);
        } else {
          const startPiece = Math.max(0, Math.floor((fileOffset + committedBytes) / activeTorrent.pieceLength) - 1);
          const endPiece = Math.floor((fileOffset + Math.min(fileLength, committedBytes + task.chunkSizeBytes * 3)) / activeTorrent.pieceLength) + 1;
          rawStore.setProtectedRange(task.id, startPiece, endPiece);
        }
      }

      if (rawStore && typeof rawStore.evictUnprotected === "function") {
        rawStore.evictUnprotected(activeTorrent);
      }
    } catch {}
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
          store: BoundedMemoryChunkStore,
          deselect: true,
          announce: DEFAULT_TRACKERS,
          maxWebConns: 8,
          uploads: false,
          strategy: "sequential",
        });

        if (torrent) {
          try {
            torrent.maxConns = 50;
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

    // 5. Ensure metadata is ready
    if (!torrent.files || torrent.files.length === 0) {
      try {
        await waitForTorrentReady(torrent, timeoutMs);
      } catch (err) {
        await safeRemoveTorrent(client, torrent);
        this.torrentsMap.delete(torrentId);
        if (torrent.infoHash) this.torrentsMap.delete(torrent.infoHash);
        if (torrent.magnetURI) this.torrentsMap.delete(torrent.magnetURI);
        throw err;
      }
    }

    if (torrent) {
      this.torrentsMap.set(torrentId, torrent);
      if (torrent.infoHash) this.torrentsMap.set(torrent.infoHash, torrent);
      if (torrent.magnetURI) this.torrentsMap.set(torrent.magnetURI, torrent);

      if (torrent.store) {
        if (torrent.length) {
          torrent.store.length = torrent.length;
          if (torrent.store.store) {
            torrent.store.store.length = torrent.length;
            if (torrent.pieceLength) {
              torrent.store.store.lastChunkLength = (torrent.length % torrent.pieceLength) || torrent.pieceLength;
              torrent.store.store.lastChunkIndex = Math.ceil(torrent.length / torrent.pieceLength) - 1;
            }
          }
        }
      }
    }

    return torrent;
  }

  public getTasks(folderId?: string, accountEmail?: string): StreamDriveTask[] {
    const all = Array.from(this.tasks.values()).sort((a, b) => b.startedAt - a.startedAt);
    return all
      .filter((t) => {
        if (
          accountEmail &&
          accountEmail.trim() !== "" &&
          t.accountEmail &&
          t.accountEmail.trim() !== "" &&
          t.accountEmail.toLowerCase() !== accountEmail.trim().toLowerCase()
        ) {
          return false;
        }
        return true;
      })
      .map((t) => {
        if (t.torrentBase64) {
          const { torrentBase64, ...rest } = t;
          return rest as StreamDriveTask;
        }
        return t;
      });
  }

  public getTask(id: string): StreamDriveTask | undefined {
    const t = this.tasks.get(id);
    if (!t) return undefined;
    if (t.torrentBase64) {
      const { torrentBase64, ...rest } = t;
      return rest as StreamDriveTask;
    }
    return t;
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

    if (fileIdToUpdate) {
      // Update existing file directly
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

    // Create new manifest directly without redundant search query
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
        return existingManifestFileId || "";
      }

      const data = (await createRes.json().catch(() => ({}))) as { id: string };
      const newId = data.id || "";
      const task = this.tasks.get(manifest.taskId);
      if (task && newId) task.manifestFileId = newId;
      return newId;
    } catch {
      return existingManifestFileId || "";
    }
  }

  /**
   * Saves a single consolidated batch manifest in Google Drive for an entire torrent package (+300 files),
   * preventing the creation of hundreds of individual manifest JSON files.
   */
  public async saveBatchManifestToDrive(
    accessToken: string,
    rootFolderId: string,
    batchId: string,
    sourceUrl: string,
    totalFiles: number,
    torrentBase64?: string,
    accountEmail?: string
  ): Promise<string> {
    if (!accessToken) return "";

    const manifestName = `stream_manifest_batch_${batchId}.json`;
    const batchData = {
      version: 2,
      type: "batch",
      batchId,
      sourceUrl,
      accountEmail: accountEmail || undefined,
      torrentBase64: torrentBase64 || undefined,
      totalFiles,
      rootFolderId: rootFolderId || "root",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const bodyStr = JSON.stringify(batchData, null, 2);

    try {
      const descargasFolderId = await this.getOrCreateDescargasServidorFolder(accessToken);
      const manifestParentFolder = descargasFolderId || rootFolderId;

      const metadata = {
        name: manifestName,
        parents: manifestParentFolder && manifestParentFolder !== "root" ? [manifestParentFolder] : [],
        mimeType: "application/json",
        description: `Manifiesto consolidado de lote para ${totalFiles} archivos en Server Specs Cloud Streamer`,
      };

      const boundary = "-------streambatchmanifest" + Date.now();
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

      if (createRes.ok) {
        const created = (await createRes.json().catch(() => ({}))) as { id: string };
        return created.id || "";
      }
    } catch (err: any) {
      console.warn("[StreamManager] No se pudo guardar manifiesto de lote en Drive:", err?.message);
    }
    return "";
  }

  /**
   * Deletes the single consolidated batch manifest from Google Drive.
   */
  public async deleteBatchManifestFromDrive(accessToken: string, batchId: string): Promise<void> {
    if (!accessToken || !batchId) return;
    try {
      const manifestName = `stream_manifest_batch_${batchId}.json`;
      const query = `name = '${manifestName}' and trashed = false`;
      const res = await fetchWithRetry(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(4000) }
      );
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { files?: Array<{ id: string }> };
        if (data.files && data.files.length > 0) {
          for (const f of data.files) {
            fetchWithRetry(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: AbortSignal.timeout(4000),
            }).catch(() => {});
          }
        }
      }
    } catch {}
  }

  /**
   * Queries Google Drive to find how many bytes have actually been accepted for this session.
   */
  public async queryDriveSessionCommittedBytes(
    sessionUri: string,
    fileSize: number
  ): Promise<number> {
    if (!sessionUri) return 0;
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
      } else if (res.status === 404 || res.status === 410) {
        // Session expired or cancelled on Google Drive
        console.warn(`[StreamManager] Sesión resumable de Google Drive expirada/inválida (HTTP ${res.status}).`);
        return -1;
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
    queueIndex?: number;
    totalInBatch?: number;
    batchId?: string;
    skipSessionInit?: boolean;
    initialStatus?: "streaming" | "queued";
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
      queueIndex,
      totalInBatch,
      batchId,
      skipSessionInit = false,
      initialStatus,
    } = params;

    // Deduplication check: if a task exists for exact same sourceUrl AND selectedFilePath/fileName
    const targetDedupeKey = selectedFilePath ? `${sourceUrl}_${selectedFilePath}` : sourceUrl;
    for (const existingTask of this.tasks.values()) {
      const existingKey = (existingTask as any).selectedFilePath
        ? `${existingTask.sourceUrl}_${(existingTask as any).selectedFilePath}`
        : existingTask.sourceUrl;
      if (
        (existingTask.status === "streaming" || existingTask.status === "paused" || existingTask.status === "queued") &&
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

    // If it's a multi-file torrent and no specific file was selected, automatically queue as batch
    if (inspected.files && inspected.files.length > 1 && !selectedFilePath) {
      console.log(`[StreamManager] Multi-file torrent (${inspected.files.length} archivos) recibido en startStreamTask sin selectedFilePath. Delegando automáticamente a startBatchStreamTasks.`);
      const batchResult = await this.startBatchStreamTasks({
        sourceUrl,
        accessToken,
        folderId,
        accountEmail,
        customChunkSizeMB,
        torrentBase64: inspected.torrentBase64 || torrentBase64,
        files: inspected.files,
      });
      return batchResult.tasks[0];
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

    const cleanSelectedPath = selectedFilePath ? selectedFilePath.replace(/\\/g, "/") : "";
    const fileName =
      customFileName ||
      (cleanSelectedPath ? cleanSelectedPath.split("/").pop() : undefined) ||
      inspected.fileName;
    // Chunk size: multiple of 256KB (262,144 bytes). Default: 16MB (fast for serverless & continuous servers).
    const chunkMB = Math.max(4, Math.min(customChunkSizeMB || 16, 64));
    const chunkSizeBytes = Math.floor((chunkMB * 1024 * 1024) / 262144) * 262144;

    const taskId = `stream_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Resolve destination folder hierarchy in Google Drive if selectedFilePath has subdirectories
    let targetFolderId = folderId && folderId.trim() !== "" ? folderId.trim() : "root";
    if (!skipSessionInit && cleanSelectedPath && accessToken) {
      const pathParts = cleanSelectedPath.split("/").filter(Boolean);
      if (pathParts.length > 1) {
        const dirHierarchy = pathParts.slice(0, -1).join("/");
        try {
          targetFolderId = await this.ensureDriveFolderHierarchy(
            accessToken,
            targetFolderId,
            dirHierarchy
          );
        } catch (dirErr: any) {
          console.warn("[StreamManager] Error asegurando jerarquía de carpetas en Drive:", dirErr.message);
        }
      }
    }

    if (accessToken) {
      this.recordAccountToken(accessToken, accountEmail);
    }

    // 1. Queue vs Streaming Slot Assignment
    const activeStreaming = Array.from(this.tasks.values()).filter((t) => t.status === "streaming").length;
    const shouldQueue = !initialStatus && activeStreaming >= this.maxConcurrentDownloads;
    const taskStatus = initialStatus || (shouldQueue || skipSessionInit ? "queued" : "streaming");

    let sessionUri = "";
    if (!skipSessionInit && taskStatus === "streaming") {
      try {
        sessionUri = await this.initDriveResumableUpload(
          accessToken,
          targetFolderId,
          fileName,
          inspected.fileSize
        );
      } catch (err: any) {
        console.warn("[StreamManager] No se pudo crear sesión de Drive de inmediato, dejando en cola:", err.message);
      }
    }

    const totalChunks = Math.ceil(inspected.fileSize / chunkSizeBytes);

    let assignedQueueIndex = queueIndex;
    if (taskStatus === "queued" && typeof assignedQueueIndex !== "number") {
      const currentQueued = Array.from(this.tasks.values()).filter((t) => t.status === "queued").length;
      assignedQueueIndex = currentQueued + 1;
    }

    const b64 = inspected.torrentBase64 || torrentBase64;
    if (b64) {
      this.setTorrentBase64ForTask(taskId, b64);
      if (batchId) this.setTorrentBase64ForTask(batchId, b64);
      if (sourceUrl) this.setTorrentBase64ForTask(sourceUrl, b64);
    }

    const task: StreamDriveTask = {
      id: taskId,
      accountEmail: accountEmail || undefined,
      fileName,
      sourceUrl,
      sourceType: inspected.sourceType,
      torrentBase64: undefined, // Deduplicated: cached in sharedTorrentBase64
      webSeeds: inspected.webSeeds,
      activeMirrorUrl: inspected.activeMirrorUrl,
      fileSize: inspected.fileSize,
      fileSizeFormatted: formatBytes(inspected.fileSize),
      chunkSizeBytes,
      chunkSizeFormatted: `${chunkMB} MB`,
      resumableUploadUrl: sessionUri,
      driveFolderId: targetFolderId,
      rootFolderId: folderId && folderId.trim() !== "" ? folderId.trim() : "root",
      uploadedBytes: 0,
      uploadedBytesFormatted: "0 Bytes",
      currentChunkIndex: 0,
      totalChunks,
      progressPercent: 0,
      speedMBs: 0,
      status: taskStatus,
      startedAt: Date.now(),
      selectedFilePath: cleanSelectedPath || undefined,
      queueIndex: assignedQueueIndex,
      totalInBatch,
      batchId,
    };

    this.tasks.set(taskId, task);
    this.saveTasksToDisk();

    // 2. Initial manifest write to Drive if session was initialized
    if (sessionUri) {
      try {
        const manifestId = await this.saveManifestToDrive(accessToken, targetFolderId, {
          version: 1,
          taskId,
          accountEmail: accountEmail || undefined,
          fileName,
          sourceUrl,
          sourceType: inspected.sourceType,
          torrentBase64: this.getTorrentBase64ForTask(task),
          webSeeds: task.webSeeds,
          fileSize: inspected.fileSize,
          chunkSizeBytes,
          resumableUploadUrl: sessionUri,
          driveFolderId: targetFolderId,
          rootFolderId: task.rootFolderId,
          uploadedBytes: 0,
          currentChunkIndex: 0,
          totalChunks,
          status: taskStatus,
          startedAt: task.startedAt,
          updatedAt: Date.now(),
          selectedFilePath: task.selectedFilePath,
          queueIndex: task.queueIndex,
          totalInBatch,
          batchId,
        });
        task.manifestFileId = manifestId;
        this.saveTasksToDisk();
      } catch (e) {
        console.warn("Advertencia: No se pudo crear el archivo manifiesto en Drive:", e);
      }
    }

    // 3. Launch background streaming process if active, otherwise dispatch queue
    if (task.status === "streaming") {
      this.runStreamingLoop(taskId, accessToken);
    } else {
      this.dispatchQueue();
    }

    return task;
  }

  /**
   * Starts a batch of files in queue, avoiding rate limits by deferring Drive session initialization.
   */
  public async startBatchStreamTasks(params: {
    sourceUrl: string;
    accessToken: string;
    folderId: string;
    accountEmail?: string;
    customChunkSizeMB?: number;
    torrentBase64?: string;
    files: Array<{ path: string; length: number; name?: string }>;
  }): Promise<{ batchId: string; tasks: StreamDriveTask[] }> {
    const {
      sourceUrl,
      accessToken,
      folderId,
      accountEmail,
      customChunkSizeMB,
      torrentBase64,
      files,
    } = params;

    if (accessToken) {
      this.recordAccountToken(accessToken, accountEmail);
    }

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const createdTasks: StreamDriveTask[] = [];

    // 1. Inspect source ONCE for all files in the batch (avoids 300 redundant inspect/parse operations)
    let inspected: InspectedFileInfo;
    try {
      inspected = await this.inspectSource(sourceUrl, torrentBase64);
    } catch {
      inspected = {
        fileName: "torrent_batch",
        fileSize: 0,
        fileSizeFormatted: "0 Bytes",
        sourceType: "torrent",
        acceptRanges: true,
      };
    }

    const chunkMB = Math.max(4, Math.min(customChunkSizeMB || 16, 64));
    const chunkSizeBytes = Math.floor((chunkMB * 1024 * 1024) / 262144) * 262144;

    const activeCount = Array.from(this.tasks.values()).filter(
      (t) =>
        t.status === "streaming" &&
        (!accountEmail || !t.accountEmail || t.accountEmail.toLowerCase() === accountEmail.toLowerCase())
    ).length;

    let availableSlots = Math.max(0, this.maxConcurrentDownloads - activeCount);
    const baseTargetFolder = folderId && folderId.trim() !== "" ? folderId.trim() : "root";

    const b64 = inspected.torrentBase64 || torrentBase64;
    if (b64) {
      this.setTorrentBase64ForTask(batchId, b64);
      if (sourceUrl) this.setTorrentBase64ForTask(sourceUrl, b64);
    }

    // 2. Pure in-memory synchronous loop: creates 300+ tasks in <2ms!
    const now = Date.now();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const cleanPath = (file.path || "").replace(/\\/g, "/");
      const fileName = file.name || cleanPath.split("/").pop() || `archivo_${i + 1}`;
      const fileSize = file.length || 0;
      const totalChunks = Math.max(1, Math.ceil(fileSize / chunkSizeBytes));

      const isStreaming = availableSlots > 0;
      if (isStreaming) {
        availableSlots--;
      }

      const taskId = `stream_${now}_${i}_${Math.random().toString(36).substring(2, 6)}`;
      const task: StreamDriveTask = {
        id: taskId,
        accountEmail: accountEmail || undefined,
        fileName,
        sourceUrl,
        sourceType: inspected.sourceType || "torrent",
        torrentBase64: undefined, // Deduplicated: cached once in sharedTorrentBase64 for batchId
        webSeeds: inspected.webSeeds,
        activeMirrorUrl: inspected.activeMirrorUrl,
        fileSize,
        fileSizeFormatted: formatBytes(fileSize),
        chunkSizeBytes,
        chunkSizeFormatted: `${chunkMB} MB`,
        resumableUploadUrl: "", // initialized on-demand when streaming starts
        driveFolderId: baseTargetFolder,
        rootFolderId: baseTargetFolder,
        uploadedBytes: 0,
        uploadedBytesFormatted: "0 Bytes",
        currentChunkIndex: 0,
        totalChunks,
        progressPercent: 0,
        speedMBs: 0,
        status: isStreaming ? "streaming" : "queued",
        startedAt: now + i,
        selectedFilePath: cleanPath || undefined,
        queueIndex: i + 1,
        totalInBatch: files.length,
        batchId,
      };

      this.tasks.set(taskId, task);
      createdTasks.push(task);
    }

    // 3. Persist all tasks to RAM/disk cache ONCE
    this.saveTasksToDisk();

    // 4. Save ONE single batch manifest to Google Drive asynchronously (not 300 separate files!)
    if (accessToken) {
      this.saveBatchManifestToDrive(
        accessToken,
        baseTargetFolder,
        batchId,
        sourceUrl,
        files.length,
        inspected.torrentBase64 || torrentBase64,
        accountEmail
      ).catch(() => {});
    }

    // 5. Trigger streaming loops for the active tasks asynchronously in background
    for (const t of createdTasks) {
      if (t.status === "streaming" && accessToken) {
        this.runStreamingLoop(t.id, accessToken);
      }
    }

    // 6. Return immediately to the client! All 300 tasks are delivered in <50ms!
    return { batchId, tasks: createdTasks };
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
    if (!task || (task.status !== "streaming" && task.status !== "queued") || (task as any).isProcessingChunk) {
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

    // 1. Queue Promotion Check
    if (task.status === "queued") {
      const activeStreamingCount = Array.from(this.tasks.values()).filter(
        (t) =>
          t.status === "streaming" &&
          (!task.accountEmail || !t.accountEmail || t.accountEmail.toLowerCase() === task.accountEmail.toLowerCase())
      ).length;

      if (activeStreamingCount >= this.maxConcurrentDownloads) {
        // Limit of concurrent active streams reached; remain queued
        return false;
      }

      task.status = "streaming";
      this.saveTasksToDisk();
    }

    // 2. On-demand Google Drive Resumable Session Initialization
    if (!task.resumableUploadUrl) {
      let effectiveToken = accessToken;
      try {
        const fresh = await rcloneAuthManager.getValidAccessToken(task.accountEmail);
        if (fresh) {
          effectiveToken = fresh;
          this.recordAccountToken(fresh, task.accountEmail);
        }
      } catch {}

      try {
        console.log(`[StreamManager] Inicializando sesión de Google Drive bajo demanda para tarea en cola: ${task.fileName}`);

        // Ensure nested folder hierarchy exists in Drive if not yet resolved
        if (task.selectedFilePath && effectiveToken) {
          const cleanPath = task.selectedFilePath.replace(/\\/g, "/");
          const pathParts = cleanPath.split("/").filter(Boolean);
          if (pathParts.length > 1) {
            const dirHierarchy = pathParts.slice(0, -1).join("/");
            const baseFolder = task.rootFolderId || activeFolderId || "root";
            try {
              const targetFolderId = await this.ensureDriveFolderHierarchy(
                effectiveToken,
                baseFolder,
                dirHierarchy
              );
              task.driveFolderId = targetFolderId;
            } catch (dirErr: any) {
              console.warn("[StreamManager] Error asegurando jerarquía en processNextChunk:", dirErr.message);
            }
          }
        }

        const sessionUri = await this.initDriveResumableUpload(
          effectiveToken,
          task.driveFolderId,
          task.fileName,
          task.fileSize
        );
        task.resumableUploadUrl = sessionUri;

        // Create manifest on Drive (only for standalone single-file tasks; batches have a single consolidated manifest)
        if (!task.batchId) {
          const manifestId = await this.saveManifestToDrive(effectiveToken, task.driveFolderId, {
            version: 1,
            taskId: task.id,
            accountEmail: task.accountEmail,
            fileName: task.fileName,
            sourceUrl: task.sourceUrl,
            sourceType: task.sourceType,
            torrentBase64: this.getTorrentBase64ForTask(task),
            webSeeds: task.webSeeds,
            fileSize: task.fileSize,
            chunkSizeBytes: task.chunkSizeBytes,
            resumableUploadUrl: sessionUri,
            driveFolderId: task.driveFolderId,
            rootFolderId: task.rootFolderId,
            uploadedBytes: task.uploadedBytes,
            currentChunkIndex: task.currentChunkIndex,
            totalChunks: task.totalChunks,
            status: "streaming",
            startedAt: task.startedAt,
            updatedAt: Date.now(),
            selectedFilePath: task.selectedFilePath,
            queueIndex: task.queueIndex,
            totalInBatch: task.totalInBatch,
          });
          task.manifestFileId = manifestId;
        }
        this.saveTasksToDisk();
      } catch (err: any) {
        console.warn(`[StreamManager] Error iniciando sesión de Drive para ${task.id}:`, err.message);
        if (err.message?.includes("429")) {
          console.warn("[StreamManager] Rate limit 429 de Google Drive en cola. Reintentando en el siguiente ciclo.");
          task.status = "queued";
          return false;
        }
        if (err.message?.includes("401") || err.message?.includes("expirado") || err.message?.includes("Invalid Credentials")) {
          try {
            const refreshed = await rcloneAuthManager.forceRefreshToken(task.accountEmail);
            if (refreshed) {
              console.log(`[StreamManager] Token auto-renovado con éxito tras 401 para ${task.fileName}. Reintentando sesión de Drive.`);
              this.recordAccountToken(refreshed, task.accountEmail);
              return await this.processNextChunk(taskId, refreshed, activeFolderId, activeAccountEmail);
            }
          } catch {}

          console.warn(`[StreamManager] Token de Google Drive expirado (401) para tarea "${task.fileName}". Permanece en cola esperando reconexión.`);
          task.status = "queued";
          task.error = "Sesión de Google Drive expirada (401). Reconecta tu cuenta en el panel para continuar la cola.";
          this.saveTasksToDisk();
          return false;
        }
        task.status = "error";
        task.error = err.message || "Error al iniciar sesión en Google Drive";
        this.saveTasksToDisk();
        return false;
      }
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
      // Sync committed bytes from Google Drive ONLY on initial chunk or after an error/interruption,
      // avoiding redundant queryDriveSessionCommittedBytes HTTP calls on every single chunk upload.
      // Normal sequential chunk transfers receive the confirmed byte offset directly from Google's HTTP 308 response.
      if (((task as any).needsCommittedSync || task.uploadedBytes === 0) && task.resumableUploadUrl) {
        (task as any).needsCommittedSync = false;
        const committed = await this.queryDriveSessionCommittedBytes(task.resumableUploadUrl, task.fileSize);
        if (committed === -1) {
          task.resumableUploadUrl = "";
          task.uploadedBytes = 0;
          task.uploadedBytesFormatted = "0 B";
          task.currentChunkIndex = 0;
          task.progressPercent = 0;
          this.saveTasksToDisk();
          return false;
        } else if (committed > task.uploadedBytes) {
          task.uploadedBytes = committed;
          task.uploadedBytesFormatted = formatBytes(committed);
          task.currentChunkIndex = Math.floor(committed / task.chunkSizeBytes);
          task.progressPercent = Math.min(99, Math.round((committed / task.fileSize) * 100));
          this.saveTasksToDisk();
        }
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

      const abortSignal = this.abortControllers.get(task.id)?.signal;

      // 1. Fetch chunk slice from source (consume prefetched buffer if available)
      let buf: Buffer;
      const prefetched = (task as any).prefetchedChunk;
      if (prefetched && prefetched.start === start && prefetched.end === end) {
        (task as any).prefetchedChunk = undefined;
        buf = await prefetched.promise;
      } else {
        (task as any).prefetchedChunk = undefined;
        buf = await this.fetchSourceChunkSlice({
          taskId: task.id,
          sourceUrl: task.sourceUrl,
          sourceType: task.sourceType,
          start,
          end,
          signal: abortSignal,
          torrentBase64: this.getTorrentBase64ForTask(task),
          webSeeds: task.webSeeds,
          activeMirrorUrl: task.activeMirrorUrl,
        });
      }

      if (buf.length !== chunkLen) {
        if (end === task.fileSize && buf.length < chunkLen) {
          const padded = Buffer.alloc(chunkLen);
          buf.copy(padded);
          buf = padded;
        } else {
          throw new Error(`Tamaño de chunk recibido (${buf.length} B) no coincide con el esperado (${chunkLen} B).`);
        }
      }

      // 2. High-Performance Double Buffering: While chunk [start, end] uploads to Google Drive,
      // concurrently download next chunk [nextStart, nextEnd] from swarm/source into RAM!
      const nextStart = end;
      const nextEnd = Math.min(nextStart + task.chunkSizeBytes, task.fileSize);
      if (nextStart < task.fileSize && !abortSignal?.aborted && task.status === "streaming") {
        const nextPromise = this.fetchSourceChunkSlice({
          taskId: task.id,
          sourceUrl: task.sourceUrl,
          sourceType: task.sourceType,
          start: nextStart,
          end: nextEnd,
          signal: abortSignal,
          torrentBase64: this.getTorrentBase64ForTask(task),
          webSeeds: task.webSeeds,
          activeMirrorUrl: task.activeMirrorUrl,
        }).catch((err) => {
          (task as any).prefetchedChunk = undefined;
          throw err;
        });
        (task as any).prefetchedChunk = { start: nextStart, end: nextEnd, promise: nextPromise };
      }

      // 3. Upload to Google Drive via PUT
      const putTimeout = AbortSignal.timeout(60000);
      const combinedPutSignal = abortSignal ? AbortSignal.any([abortSignal, putTimeout]) : putTimeout;
      const driveRes = await fetchWithRetry(task.resumableUploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": chunkLen.toString(),
          "Content-Range": `bytes ${start}-${end - 1}/${task.fileSize}`,
        },
        body: buf,
        signal: combinedPutSignal,
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

        // Immediate RAM optimization for edge devices: evict confirmed pieces
        this.evictConfirmedPieces(task, end);

        // Update live torrent swarm telemetry if applicable
        if (task.sourceType === "torrent") {
          const b64 = this.getTorrentBase64ForTask(task);
          const activeTorrent =
            this.torrentsMap.get(task.id) ||
            (task.batchId ? this.torrentsMap.get(task.batchId) : null) ||
            this.torrentsMap.get(task.sourceUrl) ||
            (b64 ? this.torrentsMap.get(b64) : null);
          if (activeTorrent) {
            task.torrentSpeedMBs = Number(((activeTorrent.downloadSpeed || 0) / (1024 * 1024)).toFixed(1));
            task.peers = typeof activeTorrent.numPeers === "number" ? activeTorrent.numPeers : 0;
          }
        }

        if (driveRes.status === 200 || driveRes.status === 201 || end >= task.fileSize) {
          const resultData = driveRes.status !== 308 ? await driveRes.json().catch(() => ({})) : {};
          task.status = "completed";
          task.progressPercent = 100;
          task.speedMBs = 0;
          task.torrentSpeedMBs = 0;
          task.completedAt = Date.now();
          if (resultData.id) task.finalDriveFileId = resultData.id;
          if (resultData.md5Checksum) task.md5Checksum = resultData.md5Checksum;
          if (resultData.webViewLink) task.webViewLink = resultData.webViewLink;

          // Free all swarm sockets, wires, and chunk memory immediately upon completion
          await this.destroyTorrentForTask(task);

          // Clean up individual manifest file from Drive if present
          if (accessToken && task.manifestFileId) {
            fetchWithRetry(`https://www.googleapis.com/drive/v3/files/${task.manifestFileId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: AbortSignal.timeout(4000),
            }).catch(() => {});
          }
        }

        this.saveTasksToDisk();
        return true;
      } else if (driveRes.status >= 500) {
        console.warn(`[StreamManager] Drive status ${driveRes.status} al subir chunk`);
        (task as any).needsCommittedSync = true;
        return false;
      } else {
        const errText = await driveRes.text();
        (task as any).needsCommittedSync = true;
        throw new Error(`Google Drive HTTP ${driveRes.status}: ${errText}`);
      }
    } catch (err: any) {
      console.warn(`[StreamManager] Error procesando chunk para ${taskId}:`, err?.message);
      (task as any).needsCommittedSync = true;

      // Handle 401 token expiration during chunk upload or sync
      if (err?.message?.includes("401") || err?.message?.includes("expirado") || err?.message?.includes("Invalid Credentials")) {
        try {
          const refreshed = await rcloneAuthManager.forceRefreshToken(task.accountEmail);
          if (refreshed) {
            console.log(`[StreamManager] Token auto-renovado tras error 401 en chunk para ${task.fileName}. Reintentando chunk.`);
            this.recordAccountToken(refreshed, task.accountEmail);
            return await this.processNextChunk(taskId, refreshed, activeFolderId, activeAccountEmail);
          }
        } catch {}
      }

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

    // Periodic telemetry ticker for torrent swarm speeds and peers
    let statsTimer: NodeJS.Timeout | null = null;
    if (task.sourceType === "torrent") {
      statsTimer = setInterval(async () => {
        try {
          const client = activeWebTorrentClient;
          if (client) {
            const b64 = this.getTorrentBase64ForTask(task);
            const torrent =
              this.torrentsMap.get(taskId) ||
              (task.batchId ? this.torrentsMap.get(task.batchId) : null) ||
              this.torrentsMap.get(task.sourceUrl) ||
              (b64 ? this.torrentsMap.get(b64) : null);
            if (torrent) {
              task.torrentSpeedMBs = Number(((torrent.downloadSpeed || 0) / (1024 * 1024)).toFixed(1));
              task.peers = typeof torrent.numPeers === "number" ? torrent.numPeers : 0;
            }
          }
        } catch {}
      }, 1000);
    }

    try {
      // Check current committed offset on Google Drive if session exists
      if (task.resumableUploadUrl) {
        const committed = await this.queryDriveSessionCommittedBytes(
          task.resumableUploadUrl,
          task.fileSize
        );
        if (committed === -1) {
          task.resumableUploadUrl = "";
          task.uploadedBytes = 0;
          task.uploadedBytesFormatted = "0 B";
          task.currentChunkIndex = 0;
          task.progressPercent = 0;
        } else if (committed > task.uploadedBytes) {
          task.uploadedBytes = committed;
          task.uploadedBytesFormatted = formatBytes(committed);
          task.currentChunkIndex = Math.floor(committed / task.chunkSizeBytes);
          task.progressPercent = Math.min(100, Math.round((committed / task.fileSize) * 100));
          this.evictConfirmedPieces(task, committed);
        }
      }

      const MAX_AUTO_RETRIES = 5;
      let consecutiveErrors = 0;

      while (task.uploadedBytes < task.fileSize && task.status === "streaming") {
        if (abortController.signal.aborted) break;
        const success = await this.processNextChunk(taskId, accessToken);
        if (success) {
          consecutiveErrors = 0;
          task.retries = 0;
          if (task.statusText?.includes("Reintentando")) {
            task.statusText = undefined;
          }
        } else {
          if (task.status !== "streaming") break;
          consecutiveErrors++;
          task.retries = consecutiveErrors;

          if (consecutiveErrors >= MAX_AUTO_RETRIES) {
            console.warn(`[StreamManager] Tarea ${task.fileName} falló tras ${consecutiveErrors} reintentos consecutivos. Marcando como error para dar paso a la cola.`);
            task.status = "error";
            task.statusText = `Fallo tras ${consecutiveErrors} reintentos`;
            task.error = task.error || `Error en transmisión tras ${consecutiveErrors} reintentos`;
            this.saveTasksToDisk();
            break;
          }

          const backoffMs = Math.min(30000, 1000 * Math.pow(2, consecutiveErrors - 1));
          task.statusText = `Reintento automático (${consecutiveErrors}/${MAX_AUTO_RETRIES}) en ${Math.round(backoffMs / 1000)}s...`;
          console.log(`[StreamManager] ${task.fileName}: Reintento automático (${consecutiveErrors}/${MAX_AUTO_RETRIES}) en ${backoffMs}ms tras error: ${task.error}`);
          this.saveTasksToDisk();
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }
    } catch (err: any) {
      if (!abortController.signal.aborted && task.status === "streaming") {
        task.status = "error";
        task.error = err?.message || "Error en transmisión de chunks";
        task.statusText = "Error en transmisión";
        this.saveTasksToDisk();
      }
    } finally {
      if (statsTimer) clearInterval(statsTimer);
      (task as any).prefetchedChunk = undefined;
      this.abortControllers.delete(taskId);
      this.saveTasksToDisk();
      if (task.status === "completed" || task.status === "error" || task.status === "paused") {
        await this.destroyTorrentForTask(task);
      }
      this.dispatchQueue();
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
        let b64 = torrentBase64 || this.getTorrentBase64ForTask(task);
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
                  if (task) {
                    this.setTorrentBase64ForTask(task.batchId || task.sourceUrl || task.id, b64);
                  }
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
      this.getTorrentBase64ForTask(task) || torrentBase64,
      signal,
      (task as any)?.selectedFilePath,
      task?.fileSize
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
    selectedFilePath?: string,
    selectedFileSize?: number
  ): Promise<Buffer> {
    const torrent = await this.getOrCreateTorrent(torrentId, 60000, torrentBase64);

    if (!torrent.files || torrent.files.length === 0) {
      throw new Error("No se encontraron archivos en el torrent.");
    }

    // Find target file (matching selectedFilePath with high precision)
    let targetFile: any = null;
    if (selectedFilePath) {
      const cleanTarget = selectedFilePath.replace(/\\/g, "/").trim();

      // 1. Exact full path match
      targetFile = torrent.files.find((f: any) => {
        const fPath = (f.path || "").replace(/\\/g, "/").trim();
        return fPath === cleanTarget;
      });

      // 2. Exact path suffix match (e.g. without root directory prefix)
      if (!targetFile) {
        targetFile = torrent.files.find((f: any) => {
          const fPath = (f.path || "").replace(/\\/g, "/").trim();
          return fPath.endsWith("/" + cleanTarget) || cleanTarget.endsWith("/" + fPath);
        });
      }

      // 3. Name and exact size match (safely prevents collision between same filenames in different folders)
      if (!targetFile && typeof selectedFileSize === "number" && selectedFileSize > 0) {
        const targetName = cleanTarget.split("/").pop();
        targetFile = torrent.files.find((f: any) => {
          const fName = (f.name || "").replace(/\\/g, "/").trim();
          return fName === targetName && f.length === selectedFileSize;
        });
      }

      // 4. Fallback to unique name if only one file has that name in the entire torrent
      if (!targetFile) {
        const targetName = cleanTarget.split("/").pop();
        const matches = torrent.files.filter((f: any) => f.name === targetName);
        if (matches.length === 1) {
          targetFile = matches[0];
        }
      }
    }

    // Default to largest file if no specific file found or specified
    if (!targetFile) {
      for (const f of torrent.files) {
        if (f.length > (targetFile ? targetFile.length : 0)) {
          targetFile = f;
        }
      }
    }

    if (!targetFile) {
      throw new Error("No se encontró el archivo dentro del torrent.");
    }

    const fileLength = Number(targetFile.length) || Number(selectedFileSize) || 0;
    const clampedEnd = fileLength > 0 ? Math.min(end, fileLength) : end;
    const totalNeeded = clampedEnd - start;
    if (totalNeeded <= 0) return Buffer.alloc(0);

    // Prioritize pieces for this exact slice across connected peers in the swarm
    if (torrent.pieceLength && typeof torrent.critical === "function") {
      const fileOffset = (targetFile as any).offset || 0;
      const globalStart = fileOffset + start;
      const globalEnd = fileOffset + clampedEnd - 1;
      const startPiece = Math.floor(globalStart / torrent.pieceLength);
      const endPiece = Math.floor(globalEnd / torrent.pieceLength);
      try {
        torrent.critical(startPiece, endPiece);
      } catch {}
    }

    // Inform bounded memory store of the protected active piece range for this task
    const rawStore = (torrent.store as any)?.store || torrent.store;
    if (rawStore && typeof rawStore.setProtectedRange === "function") {
      const fileOffset = (targetFile as any).offset || 0;
      const startPiece = Math.max(0, Math.floor((fileOffset + start) / torrent.pieceLength) - 1);
      const endPiece = Math.floor((fileOffset + clampedEnd) / torrent.pieceLength) + 1;
      rawStore.setProtectedRange(selectedFilePath || targetFile.path || torrentId, startPiece, endPiece);
    }

    const collectedChunks: Buffer[] = [];
    let currentByteOffset = start;
    let idleAttempts = 0;
    const MAX_IDLE_ATTEMPTS = 40; // 40 * 500ms = 20s of total silence before failing

    while (currentByteOffset < clampedEnd && idleAttempts < MAX_IDLE_ATTEMPTS) {
      if (signal?.aborted) {
        throw new Error("Transmisión cancelada o pausada.");
      }

      const subBuf = await this.readTorrentStreamSegment(
        torrent,
        targetFile,
        currentByteOffset,
        clampedEnd,
        signal
      );

      if (subBuf.length > 0) {
        collectedChunks.push(subBuf);
        currentByteOffset += subBuf.length;
        idleAttempts = 0; // Reset idle counter because we are receiving real data!
      } else {
        idleAttempts++;
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    const finalBuf = Buffer.concat(collectedChunks);
    if (finalBuf.length < totalNeeded) {
      throw new Error(
        `Segmento incompleto descargado del torrent (${finalBuf.length} B recibidos de ${totalNeeded} B esperados tras ${idleAttempts} intentos). Verifica que el torrent tenga peers activos.`
      );
    }
    return finalBuf;
  }

  /**
   * Reads a single contiguous slice segment from WebTorrent file read stream.
   */
  private readTorrentStreamSegment(
    torrent: any,
    targetFile: any,
    start: number,
    end: number,
    signal?: AbortSignal
  ): Promise<Buffer> {
    const fileLength = Number(targetFile.length) || 0;
    const clampedEnd = fileLength > 0 ? Math.min(end, fileLength) : end;
    if (start >= clampedEnd) {
      return Promise.resolve(Buffer.alloc(0));
    }

    if (torrent.store) {
      if (!torrent.store.length && torrent.length) torrent.store.length = torrent.length;
      if (torrent.store.store && !torrent.store.store.length) torrent.store.store.length = torrent.length;
    }

    if (torrent.pieceLength && typeof torrent.critical === "function") {
      const fileOffset = (targetFile as any).offset || 0;
      const globalStart = fileOffset + start;
      const globalEnd = fileOffset + clampedEnd - 1;
      const startPiece = Math.floor(globalStart / torrent.pieceLength);
      const endPiece = Math.floor(globalEnd / torrent.pieceLength);
      try {
        torrent.critical(startPiece, endPiece);
      } catch {}
    }

    return new Promise((resolve, reject) => {
      const stream = targetFile.createReadStream({ start, end: clampedEnd - 1 });
      const chunks: Buffer[] = [];
      let timer: NodeJS.Timeout | null = setTimeout(() => {
        if (typeof (stream as any).destroy === "function") {
          try {
            (stream as any).destroy();
          } catch {}
        }
        reject(
          new Error(
            `Tiempo de espera agotado descargando segmento del torrent (${formatBytes(start)} - ${formatBytes(clampedEnd)}). Verifica que el torrent tenga seeders activos.`
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
        const resultBuf = Buffer.concat(chunks);
        chunks.length = 0;
        resolve(resultBuf);
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
    task.torrentSpeedMBs = 0;
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(taskId);
    }
    await this.destroyTorrentForTask(task);

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
    this.dispatchQueue();

    // Update manifest in Drive with paused state if accessToken provided
    if (accessToken && task.manifestFileId) {
      this.recordAccountToken(accessToken, task.accountEmail);
      this.saveManifestToDrive(
        accessToken,
        task.driveFolderId,
        {
          version: 1,
          taskId: task.id,
          fileName: task.fileName,
          sourceUrl: task.sourceUrl,
          sourceType: task.sourceType,
          torrentBase64: this.getTorrentBase64ForTask(task),
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

    // Reset error state and retry counters
    task.error = undefined;
    task.statusText = undefined;
    task.retries = 0;
    (task as any).isProcessingChunk = false;
    (task as any).needsCommittedSync = true;

    // Check confirmed bytes in Google Drive before resuming
    try {
      if (task.resumableUploadUrl) {
        const committed = await this.queryDriveSessionCommittedBytes(task.resumableUploadUrl, task.fileSize);
        if (committed === -1) {
          task.resumableUploadUrl = "";
          task.uploadedBytes = 0;
          task.uploadedBytesFormatted = "0 B";
          task.currentChunkIndex = 0;
          task.progressPercent = 0;
        } else if (committed >= task.fileSize) {
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
      }
    } catch {}

    // If torrentBase64 or webSeeds are missing, attempt recovery before resuming
    if (task.sourceType === "torrent" && (!task.webSeeds || task.webSeeds.length === 0)) {
      try {
        const inspected = await this.inspectSource(task.sourceUrl, this.getTorrentBase64ForTask(task));
        if (inspected.torrentBase64) {
          this.setTorrentBase64ForTask(task.batchId || task.sourceUrl || task.id, inspected.torrentBase64);
        }
        if (inspected.webSeeds) task.webSeeds = inspected.webSeeds;
        if (inspected.activeMirrorUrl) task.activeMirrorUrl = inspected.activeMirrorUrl;
      } catch (e) {
        console.warn("No se pudo re-inspeccionar WebSeeds al reanudar:", e);
      }
    }

    if (accessToken) {
      this.recordAccountToken(accessToken, task.accountEmail);
    }

    const activeCount = Array.from(this.tasks.values()).filter(
      (t) => t.status === "streaming"
    ).length;

    if (activeCount >= this.maxConcurrentDownloads) {
      task.status = "queued";
      task.error = undefined;
      const currentQueued = Array.from(this.tasks.values()).filter(
        (t) => t.status === "queued" && t.id !== taskId
      ).length;
      task.queueIndex = currentQueued + 1;
      this.saveTasksToDisk();
      return true;
    }

    task.status = "streaming";
    task.error = undefined;
    this.saveTasksToDisk();
    this.runStreamingLoop(taskId, accessToken);
    return true;
  }

  /**
   * Explicitly retries a failed or stalled streaming task.
   */
  public async retryTask(taskId: string, accessToken?: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.error = undefined;
    task.statusText = undefined;
    task.retries = 0;
    (task as any).isProcessingChunk = false;
    (task as any).needsCommittedSync = true;

    // Check if Drive session is dead
    if (task.resumableUploadUrl) {
      try {
        const committed = await this.queryDriveSessionCommittedBytes(task.resumableUploadUrl, task.fileSize);
        if (committed === -1) {
          task.resumableUploadUrl = "";
          task.uploadedBytes = 0;
          task.uploadedBytesFormatted = "0 B";
          task.currentChunkIndex = 0;
          task.progressPercent = 0;
        }
      } catch {}
    }

    const tokenToUse =
      accessToken ||
      (await this.getAccountTokenAsync(task.accountEmail)) ||
      this.getAccountToken(task.accountEmail) ||
      "";

    return await this.resumeTask(taskId, tokenToUse);
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
      await this.destroyTorrentForTask(task);
      this.tasks.delete(taskId);
      this.saveTasksToDisk();
      this.cleanupDiskCache();
    }

    if (accessToken) {
      this.recordAccountToken(accessToken, task?.accountEmail);
    }
    this.dispatchQueue();

    // Attempt to delete manifest from Drive if we have access token and a recorded manifest ID
    if (accessToken && task?.manifestFileId) {
      fetchWithRetry(`https://www.googleapis.com/drive/v3/files/${task.manifestFileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(4000),
      }).catch(() => {});
    }

    return true;
  }

  /**
   * Cancels an entire batch of tasks or list of task IDs in a single atomic memory operation,
   * avoiding hundreds of separate parallel HTTP requests and API round-trips.
   */
  public async cancelBatchTasks(batchIdOrTaskIds: string | string[], accessToken?: string): Promise<{ cancelledCount: number }> {
    let taskIdsToCancel: string[] = [];
    let targetBatchId = typeof batchIdOrTaskIds === "string" ? batchIdOrTaskIds : undefined;

    if (typeof batchIdOrTaskIds === "string") {
      taskIdsToCancel = Array.from(this.tasks.values())
        .filter((t) => t.batchId === batchIdOrTaskIds)
        .map((t) => t.id);
    } else {
      taskIdsToCancel = batchIdOrTaskIds;
      if (taskIdsToCancel.length > 0) {
        targetBatchId = this.tasks.get(taskIdsToCancel[0])?.batchId;
      }
    }

    let count = 0;
    for (const taskId of taskIdsToCancel) {
      this.deletedTaskIds.add(taskId);
      const task = this.tasks.get(taskId);
      if (task) {
        task.status = "idle";
        const controller = this.abortControllers.get(taskId);
        if (controller) {
          controller.abort();
          this.abortControllers.delete(taskId);
        }
        await this.destroyTorrentForTask(task);
        this.tasks.delete(taskId);
        count++;
      }
    }

    this.saveTasksToDisk();
    this.cleanupDiskCache();
    this.dispatchQueue();

    if (accessToken && targetBatchId) {
      this.deleteBatchManifestFromDrive(accessToken, targetBatchId).catch(() => {});
    }

    return { cancelledCount: count };
  }

  /**
   * Pauses all tasks belonging to a batch in a single operation.
   */
  public async pauseBatchTasks(batchIdOrTaskIds: string | string[]): Promise<void> {
    const taskIds = typeof batchIdOrTaskIds === "string"
      ? Array.from(this.tasks.values()).filter((t) => t.batchId === batchIdOrTaskIds).map((t) => t.id)
      : batchIdOrTaskIds;

    for (const id of taskIds) {
      const task = this.tasks.get(id);
      if (task && (task.status === "streaming" || task.status === "queued")) {
        task.status = "paused";
        const controller = this.abortControllers.get(id);
        if (controller) {
          controller.abort();
          this.abortControllers.delete(id);
        }
      }
    }
    this.saveTasksToDisk();
  }

  /**
   * Resumes all paused tasks belonging to a batch in a single operation.
   */
  public async resumeBatchTasks(batchIdOrTaskIds: string | string[], accessToken?: string): Promise<void> {
    if (accessToken) {
      this.recordAccountToken(accessToken);
    }
    const taskIds = typeof batchIdOrTaskIds === "string"
      ? Array.from(this.tasks.values()).filter((t) => t.batchId === batchIdOrTaskIds).map((t) => t.id)
      : batchIdOrTaskIds;

    for (const id of taskIds) {
      const task = this.tasks.get(id);
      if (task && (task.status === "paused" || task.status === "error")) {
        task.status = "queued";
        task.error = undefined;
        task.statusText = undefined;
        task.retries = 0;
        (task as any).isProcessingChunk = false;
        (task as any).needsCommittedSync = true;
      }
    }
    this.saveTasksToDisk();
    this.dispatchQueue();
  }

  /**
   * Explicitly retries all failed or stalled tasks belonging to a batch or task ID list.
   */
  public async retryBatchTasks(
    batchIdOrTaskIds: string | string[],
    accessToken?: string
  ): Promise<{ retriedCount: number }> {
    if (accessToken) {
      this.recordAccountToken(accessToken);
    }
    const taskIds = typeof batchIdOrTaskIds === "string"
      ? Array.from(this.tasks.values()).filter((t) => t.batchId === batchIdOrTaskIds).map((t) => t.id)
      : batchIdOrTaskIds;

    let count = 0;
    for (const id of taskIds) {
      const task = this.tasks.get(id);
      if (task && (task.status === "error" || task.status === "paused")) {
        task.status = "queued";
        task.error = undefined;
        task.statusText = undefined;
        task.retries = 0;
        (task as any).isProcessingChunk = false;
        (task as any).needsCommittedSync = true;

        // Reset resumable session if dead
        if (task.resumableUploadUrl) {
          try {
            const committed = await this.queryDriveSessionCommittedBytes(task.resumableUploadUrl, task.fileSize);
            if (committed === -1) {
              task.resumableUploadUrl = "";
              task.uploadedBytes = 0;
              task.uploadedBytesFormatted = "0 B";
              task.currentChunkIndex = 0;
              task.progressPercent = 0;
            }
          } catch {}
        }
        count++;
      }
    }
    this.saveTasksToDisk();
    this.dispatchQueue();
    return { retriedCount: count };
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
        const manifest = (await contentRes.json()) as any;
        if (!manifest) continue;

        // If batch manifest, cache its torrentBase64 in memory
        if (manifest.type === "batch") {
          if (manifest.batchId && manifest.torrentBase64) {
            this.setTorrentBase64ForTask(manifest.batchId, manifest.torrentBase64);
            if (manifest.sourceUrl) {
              this.setTorrentBase64ForTask(manifest.sourceUrl, manifest.torrentBase64);
            }
          }
          continue;
        }

        if (!manifest.taskId || !manifest.resumableUploadUrl) continue;

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

        if (manifest.torrentBase64) {
          this.setTorrentBase64ForTask(manifest.taskId, manifest.torrentBase64);
          if (manifest.batchId) this.setTorrentBase64ForTask(manifest.batchId, manifest.torrentBase64);
          if (manifest.sourceUrl) this.setTorrentBase64ForTask(manifest.sourceUrl, manifest.torrentBase64);
        }

        const recoveredTask: StreamDriveTask = {
          id: manifest.taskId,
          accountEmail: manifest.accountEmail || accountEmail,
          fileName: manifest.fileName,
          sourceUrl: manifest.sourceUrl,
          sourceType: manifest.sourceType,
          torrentBase64: undefined, // Deduplicated: cached in sharedTorrentBase64
          webSeeds: manifest.webSeeds,
          fileSize: manifest.fileSize,
          fileSizeFormatted: formatBytes(manifest.fileSize),
          chunkSizeBytes: manifest.chunkSizeBytes,
          chunkSizeFormatted: `${Math.round(manifest.chunkSizeBytes / (1024 * 1024))} MB`,
          resumableUploadUrl: manifest.resumableUploadUrl,
          driveFolderId: manifest.driveFolderId || folderId || "root",
          rootFolderId: manifest.rootFolderId || folderId || "root",
          manifestFileId: file.id,
          uploadedBytes: actualCommitted,
          uploadedBytesFormatted: formatBytes(actualCommitted),
          currentChunkIndex,
          totalChunks: manifest.totalChunks,
          progressPercent,
          speedMBs: 0,
          status: isFinished ? "completed" : (manifest.status === "paused" ? "paused" : (manifest.status === "queued" ? "queued" : "streaming")),
          startedAt: manifest.startedAt,
          completedAt: isFinished ? manifest.updatedAt || Date.now() : undefined,
          finalDriveFileId: manifest.finalDriveFileId,
          md5Checksum: manifest.md5Checksum,
          selectedFilePath: manifest.selectedFilePath,
          queueIndex: manifest.queueIndex,
          totalInBatch: manifest.totalInBatch,
          batchId: manifest.batchId,
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
      if (
        accountEmail &&
        localTask.accountEmail &&
        localTask.accountEmail.trim() !== "" &&
        localTask.accountEmail.toLowerCase() !== accountEmail.trim().toLowerCase()
      ) {
        continue;
      }

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
