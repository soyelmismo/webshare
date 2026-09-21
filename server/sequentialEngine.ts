import fs from "fs";
import path from "path";
import os from "os";
import { formatBytes } from "./streamManager.js";
import { SequentialStreamJob, SequentialEngineStatus } from "../src/types.js";
import {
  isMediafireUrl,
  isMediafireFolderUrl,
  resolveMediafireDirectDownloadLink,
  getOrResolveMediafireDirectLink,
} from "./mediafireResolver.js";

export interface SequentialEngineStartOptions {
  url: string;
  fileName?: string;
  chunkSizeMB?: number; // 4, 8, 16, 32, 64 MB
  pipelinePrefetch?: boolean;
  destination?: "drive" | "server" | "both";
  accessToken?: string;
  folderId?: string;
  accountEmail?: string;
  maxSpeed?: string;
}

export class SequentialChunkEngine {
  private jobs: Map<string, SequentialStreamJob> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private serverBaseDir: string;
  private registryFile: string;

  constructor() {
    this.serverBaseDir = path.join(os.tmpdir(), "server_downloads");
    try {
      if (!fs.existsSync(this.serverBaseDir)) {
        fs.mkdirSync(this.serverBaseDir, { recursive: true });
      }
    } catch (e) {
      console.error("Error creating server_downloads directory:", e);
    }
    this.registryFile = path.join(this.serverBaseDir, "sequential_jobs_registry.json");
    this.loadRegistry();
  }

  public getStatus(): SequentialEngineStatus {
    const activeJobs = Array.from(this.jobs.values()).filter(
      (j) => j.status === "streaming" || j.status === "downloading" || j.status === "starting"
    ).length;

    return {
      active: true,
      version: "2.4.0-sequential-pipeline",
      engineName: "Sequential Chunk Stream Pipeline",
      features: [
        "Real-Time Sequential HTTP Range Chunks",
        "Direct-to-Google-Drive Resumable Pipeline",
        "Concurrent RAM Prefetching (N+1 Double Buffering)",
        "Zero-Disk & Low-Disk Modes",
        "Resumable Upload Session Persistence",
        "WebTorrent & Magnet Window Streaming",
      ],
      activeJobsCount: activeJobs,
    };
  }

  public getAllJobs(folderId?: string, accountEmail?: string): SequentialStreamJob[] {
    const all = Array.from(this.jobs.values()).sort((a, b) => b.startedAt - a.startedAt);
    return all.filter((j) => {
      if (
        accountEmail &&
        accountEmail.trim() !== "" &&
        j.accountEmail &&
        j.accountEmail.trim() !== "" &&
        j.accountEmail.toLowerCase() !== accountEmail.trim().toLowerCase()
      ) {
        return false;
      }
      return true;
    });
  }

  public getJob(id: string): SequentialStreamJob | undefined {
    return this.jobs.get(id);
  }

  private saveRegistry() {
    try {
      const serializable = Array.from(this.jobs.values()).map((job) => ({
        ...job,
        chunksState: undefined, // compact save
      }));
      fs.writeFileSync(this.registryFile, JSON.stringify(serializable, null, 2), "utf8");
    } catch (e) {
      console.warn("Could not persist sequential jobs registry:", e);
    }
  }

  private loadRegistry() {
    try {
      if (fs.existsSync(this.registryFile)) {
        const raw = fs.readFileSync(this.registryFile, "utf8");
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            // If it was streaming when server died, set to paused
            if (item.status === "streaming" || item.status === "downloading" || item.status === "starting") {
              item.status = "paused";
              item.speed = "Interrumpido";
            }
            this.jobs.set(item.id, item as SequentialStreamJob);
          }
        }
      }
    } catch (e) {
      console.warn("Could not load sequential jobs registry:", e);
    }
  }

  /**
   * Inspect remote URL to retrieve filename, total size, MIME type
   */
  public async inspectSource(url: string): Promise<{
    fileName: string;
    fileSize: number;
    mimeType: string;
    acceptRanges: boolean;
    isMagnet: boolean;
    isTorrent: boolean;
  }> {
    const isMagnet = url.startsWith("magnet:");
    const isTorrent = url.toLowerCase().includes(".torrent") || url.startsWith("torrent:");

    if (isMagnet || isTorrent) {
      let fileName = "archivo_torrent.bin";
      const dnMatch = url.match(/[?&]dn=([^&]+)/);
      if (dnMatch && dnMatch[1]) {
        try {
          fileName = decodeURIComponent(dnMatch[1].replace(/\+/g, " "));
        } catch {
          fileName = dnMatch[1];
        }
      }
      return {
        fileName,
        fileSize: 0,
        mimeType: "application/x-bittorrent",
        acceptRanges: true,
        isMagnet,
        isTorrent,
      };
    }

    let inspectUrl = url;
    let mfFileName = "";

    if (isMediafireUrl(url) && !isMediafireFolderUrl(url)) {
      try {
        const resolved = await resolveMediafireDirectDownloadLink(url);
        inspectUrl = resolved.directUrl;
        mfFileName = resolved.fileName;
      } catch (err: any) {
        console.warn("[SequentialEngine] Error resolviendo enlace MediaFire:", err.message);
      }
    }

    try {
      // 1. Try HEAD request
      const headRes = await fetch(inspectUrl, {
        method: "HEAD",
        headers: { "User-Agent": "Mozilla/5.0 (SequentialStreamPipeline/2.0)" },
      });

      let contentLength = parseInt(headRes.headers.get("content-length") || "0", 10);
      let mimeType = headRes.headers.get("content-type") || "application/octet-stream";
      let acceptRanges = (headRes.headers.get("accept-ranges") || "").toLowerCase().includes("bytes");
      let fileName = "";

      const disposition = headRes.headers.get("content-disposition");
      if (disposition) {
        const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i);
        if (match && match[1]) {
          try {
            fileName = decodeURIComponent(match[1]);
          } catch {
            fileName = match[1];
          }
        }
      }

      if (!fileName) {
        try {
          const parsed = new URL(url);
          const base = path.basename(parsed.pathname);
          if (base && base.length > 1 && !base.startsWith("?")) {
            fileName = decodeURIComponent(base);
          }
        } catch {
          // ignore
        }
      }

      // 2. If HEAD didn't yield content-length, try a 0-1 byte range GET test
      if (contentLength <= 0) {
        const rangeRes = await fetch(url, {
          method: "GET",
          headers: {
            Range: "bytes=0-1",
            "User-Agent": "Mozilla/5.0 (SequentialStreamPipeline/2.0)",
          },
        });

        const cr = rangeRes.headers.get("content-range");
        if (cr) {
          const totalMatch = cr.match(/\/(\d+)/);
          if (totalMatch) {
            contentLength = parseInt(totalMatch[1], 10);
            acceptRanges = true;
          }
        }
        if (!mimeType || mimeType === "application/octet-stream") {
          mimeType = rangeRes.headers.get("content-type") || "application/octet-stream";
        }
      }

      if (!fileName) {
        fileName = `descarga_${Date.now()}.bin`;
      }

      return {
        fileName,
        fileSize: contentLength,
        mimeType: mimeType.split(";")[0].trim(),
        acceptRanges,
        isMagnet: false,
        isTorrent: false,
      };
    } catch (e: any) {
      throw new Error(`No se pudo inspeccionar el origen remoto: ${e.message}`);
    }
  }

  /**
   * Initializes a Google Drive Resumable Upload session
   */
  private async initDriveResumableUpload(
    accessToken: string,
    folderId: string,
    fileName: string,
    fileSize: number,
    mimeType: string
  ): Promise<string> {
    const metadata = {
      name: fileName,
      parents: [folderId],
      mimeType: mimeType || "application/octet-stream",
    };

    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType || "application/octet-stream",
          "X-Upload-Content-Length": String(fileSize),
        },
        body: JSON.stringify(metadata),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error al iniciar sesión resumible en Google Drive (${res.status}): ${errText}`);
    }

    const sessionUri = res.headers.get("Location");
    if (!sessionUri) {
      throw new Error("Google Drive no devolvió la URL de sesión resumible (cabecera Location vacía).");
    }

    return sessionUri;
  }

  /**
   * Query how many bytes have been confirmed by Google Drive for this session
   */
  private async queryDriveCommittedBytes(sessionUri: string, fileSize: number): Promise<number> {
    try {
      const res = await fetch(sessionUri, {
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
      console.warn("Could not query Drive committed bytes:", e);
    }
    return 0;
  }

  /**
   * Downloads a single byte range chunk from the source HTTP URL
   */
  private async fetchChunk(
    url: string,
    start: number,
    end: number,
    signal?: AbortSignal
  ): Promise<Buffer> {
    let effectiveUrl = url;
    if (isMediafireUrl(url) && !/^https?:\/\/download\d*\.mediafire\.com\//i.test(url)) {
      try {
        effectiveUrl = await getOrResolveMediafireDirectLink(url);
      } catch (err: any) {
        console.warn("[SequentialEngine] Error resolviendo direct link MediaFire:", err.message);
      }
    }

    const res = await fetch(effectiveUrl, {
      method: "GET",
      headers: {
        Range: `bytes=${start}-${end - 1}`,
        "User-Agent": "Mozilla/5.0 (SequentialStreamPipeline/2.0)",
      },
      signal,
    });

    if (!res.ok && res.status !== 206) {
      throw new Error(`Error descargando chunk [${start}-${end - 1}]: HTTP ${res.status}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  /**
   * Starts a new Sequential Chunk Stream Job
   */
  public async startJob(opts: SequentialEngineStartOptions): Promise<SequentialStreamJob> {
    const {
      url,
      fileName: customName,
      chunkSizeMB = 16,
      pipelinePrefetch = true,
      destination = "drive",
      accessToken,
      folderId,
      accountEmail,
    } = opts;

    if (!url || typeof url !== "string") {
      throw new Error("URL de origen requerida");
    }

    const inspected = await this.inspectSource(url);
    const finalFileName = customName?.trim() || inspected.fileName;

    // Edge device protection: Force zero-disk streaming to Google Drive
    const isDriveTarget = true;
    const isServerTarget = false;

    if (!accessToken || !folderId) {
      throw new Error("Para proteger la memoria física y disco en dispositivos edge, todo el streaming se realiza en memoria RAM directamente a Google Drive. Conecta tu cuenta de Google Drive para continuar.");
    }

    if (inspected.fileSize <= 0 && !inspected.isMagnet && !inspected.isTorrent) {
      throw new Error("No se pudo obtener el tamaño del archivo remoto. El servidor debe soportar Content-Length para streaming por chunks.");
    }

    // Google Drive requires chunks to be multiples of 256 KB (262,144 bytes)
    const normalizedMB = Math.max(2, Math.min(chunkSizeMB, 64));
    const chunkSizeBytes = Math.floor((normalizedMB * 1024 * 1024) / 262144) * 262144;
    const totalChunks = Math.max(1, Math.ceil(inspected.fileSize / chunkSizeBytes));

    const jobId = `seq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const initialChunksState: Array<"pending" | "downloading" | "uploading" | "done" | "error"> =
      Array(Math.min(totalChunks, 100)).fill("pending");

    const job: SequentialStreamJob = {
      id: jobId,
      url,
      fileName: finalFileName,
      customName: customName || undefined,
      status: "starting",
      progress: 0,
      speed: "Iniciando pipeline...",
      downloadSpeed: "0 MB/s",
      uploadSpeed: "0 MB/s",
      eta: "Calculando...",
      downloadedBytes: 0,
      totalBytes: inspected.fileSize,
      chunkSizeBytes,
      chunkSizeFormatted: `${normalizedMB} MB`,
      currentChunkIndex: 0,
      totalChunks,
      pipelinePrefetch,
      folderId,
      accountEmail,
      destination,
      logs: [
        `[${new Date().toLocaleTimeString()}] 🚀 Iniciando Motor de Streaming Secuencial por Chunks`,
        `[Origen] ${url.substring(0, 80)}${url.length > 80 ? "..." : ""}`,
        `[Archivo] "${finalFileName}" | Tamaño Total: ${formatBytes(inspected.fileSize)}`,
        `[Pipeline] Tamaño de Chunk: ${normalizedMB} MB (${chunkSizeBytes.toLocaleString()} bytes) | Chunks Totales: ${totalChunks}`,
        `[Destino] ${destination === "drive" ? "Google Drive (Zero-Disk en Tiempo Real)" : destination === "server" ? "Almacenamiento del Servidor" : "Google Drive + Almacenamiento Local"}`,
        `[Prefetching RAM] ${pipelinePrefetch ? "ACTIVADO (Descarga paralela del chunk N+1 en memoria mientras sube N)" : "Desactivado"}`,
      ],
      startedAt: Date.now(),
      filePath: undefined,
      fileSize: inspected.fileSize,
      savedToDrive: false,
      isMagnet: inspected.isMagnet,
      isTorrent: inspected.isTorrent,
      statusText: "Iniciando sesión resumible...",
      downloadedStr: "0 Bytes",
      totalStr: formatBytes(inspected.fileSize),
      chunksState: initialChunksState,
      autoUploadToDrive: isDriveTarget,
    };

    this.jobs.set(jobId, job);
    this.saveRegistry();

    // Start background execution
    this.executeJobPipeline(jobId, {
      accessToken,
      folderId,
      mimeType: inspected.mimeType,
    });

    return job;
  }

  /**
   * Main asynchronous pipeline loop: Sequential download -> Simultaneous upload / write
   */
  private async executeJobPipeline(
    jobId: string,
    context: {
      accessToken?: string;
      folderId?: string;
      mimeType?: string;
      sessionUri?: string;
    }
  ) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const abortController = new AbortController();
    this.abortControllers.set(jobId, abortController);

    const isDriveTarget = job.destination === "drive" || job.destination === "both";
    const isServerTarget = job.destination === "server" || job.destination === "both";

    try {
      job.status = "streaming";
      let sessionUri = context.sessionUri;

      // 1. Initialize Drive Session if needed
      if (isDriveTarget && !sessionUri && context.accessToken && context.folderId) {
        job.logs.push(`[Google Drive] Creando sesión Resumable Upload para "${job.fileName}"...`);
        sessionUri = await this.initDriveResumableUpload(
          context.accessToken,
          context.folderId,
          job.fileName,
          job.totalBytes,
          context.mimeType || "application/octet-stream"
        );
        job.logs.push(`[Google Drive] ✓ Sesión Resumable lista.`);
      }

      // Check committed bytes on Drive
      if (sessionUri) {
        const committed = await this.queryDriveCommittedBytes(sessionUri, job.totalBytes);
        if (committed > job.downloadedBytes) {
          job.downloadedBytes = committed;
          job.currentChunkIndex = Math.floor(committed / job.chunkSizeBytes);
          job.progress = Math.min(100, Math.round((committed / job.totalBytes) * 100));
          job.logs.push(`[Resume] Recuperando desde byte ${committed.toLocaleString()} (Chunk ${job.currentChunkIndex + 1}/${job.totalChunks})`);
        }
      }

      let prefetchPromise: Promise<Buffer> | null = null;
      let prefetchIndex = -1;
      let lastBytes = job.downloadedBytes;
      let lastTime = Date.now();

      while (job.downloadedBytes < job.totalBytes && job.status === "streaming") {
        if (abortController.signal.aborted) {
          job.logs.push(`[Pipeline] Transferencia pausada/cancelada.`);
          break;
        }

        const chunkIndex = Math.floor(job.downloadedBytes / job.chunkSizeBytes);
        job.currentChunkIndex = chunkIndex;
        const start = job.downloadedBytes;
        const end = Math.min(start + job.chunkSizeBytes, job.totalBytes);
        const chunkLen = end - start;

        // Visual chunk update
        if (job.chunksState && chunkIndex < job.chunksState.length) {
          job.chunksState[chunkIndex] = "downloading";
        }

        const chunkStartTime = Date.now();
        job.logs.push(`[Chunk ${chunkIndex + 1}/${job.totalChunks}] 📥 Descargando bytes ${start.toLocaleString()} - ${(end - 1).toLocaleString()} (${formatBytes(chunkLen)})...`);
        this.saveRegistry();

        // 1. Fetch current chunk buffer (either from prefetch or direct)
        let currentChunkBuffer: Buffer;
        if (prefetchPromise && prefetchIndex === chunkIndex) {
          currentChunkBuffer = await prefetchPromise;
          prefetchPromise = null;
          prefetchIndex = -1;
        } else {
          currentChunkBuffer = await this.fetchChunk(job.url, start, end, abortController.signal);
        }

        const dlDurationSec = Math.max(0.01, (Date.now() - chunkStartTime) / 1000);
        const dlSpeedMBs = (chunkLen / (1024 * 1024)) / dlDurationSec;
        job.downloadSpeed = `${dlSpeedMBs.toFixed(1)} MB/s`;

        // 2. Prefetch NEXT chunk concurrently while uploading current chunk if enabled
        const nextStart = end;
        const nextEnd = Math.min(nextStart + job.chunkSizeBytes, job.totalBytes);
        if (job.pipelinePrefetch && nextStart < job.totalBytes) {
          const nextIndex = chunkIndex + 1;
          if (job.chunksState && nextIndex < job.chunksState.length) {
            job.chunksState[nextIndex] = "downloading";
          }
          prefetchIndex = nextIndex;
          prefetchPromise = this.fetchChunk(job.url, nextStart, nextEnd, abortController.signal);
        }

        // 3. Write / Upload current chunk
        if (job.chunksState && chunkIndex < job.chunksState.length) {
          job.chunksState[chunkIndex] = "uploading";
        }

        const upStartTime = Date.now();

        // Zero-Disk edge protection: strictly stream from RAM to Drive without touching HDD
        if (isServerTarget) {
          job.logs.push(`[Zero-Disk] Almacenamiento HDD omitido para preservar disco físico en edge device.`);
        }

        // B. If target includes Google Drive:
        if (isDriveTarget && sessionUri) {
          const uploadRes = await fetch(sessionUri, {
            method: "PUT",
            headers: {
              "Content-Length": String(chunkLen),
              "Content-Range": `bytes ${start}-${end - 1}/${job.totalBytes}`,
            },
            body: currentChunkBuffer,
            signal: abortController.signal,
          });

          if (uploadRes.status === 308) {
            // Incomplete - chunk accepted successfully!
            const upDurationSec = Math.max(0.01, (Date.now() - upStartTime) / 1000);
            const upSpeedMBs = (chunkLen / (1024 * 1024)) / upDurationSec;
            job.uploadSpeed = `${upSpeedMBs.toFixed(1)} MB/s`;
            job.logs.push(`[Chunk ${chunkIndex + 1}/${job.totalChunks}] ✓ Confirmado en Drive (${upSpeedMBs.toFixed(1)} MB/s subida)`);
          } else if (uploadRes.status === 200 || uploadRes.status === 201) {
            // Completed final chunk!
            const driveData = (await uploadRes.json()) as any;
            job.driveFile = {
              id: driveData.id,
              name: driveData.name || job.fileName,
              webViewLink: driveData.webViewLink || `https://drive.google.com/file/d/${driveData.id}/view`,
              size: formatBytes(job.totalBytes),
            };
            job.savedToDrive = true;
            job.logs.push(`[Google Drive] 🎉 ¡Archivo subido con éxito! ID: ${driveData.id}`);
          } else {
            const errText = await uploadRes.text();
            throw new Error(`Google Drive rechazó chunk (${uploadRes.status}): ${errText}`);
          }
        }

        // Advance progress
        job.downloadedBytes = end;
        job.downloadedStr = formatBytes(job.downloadedBytes);
        job.progress = Math.min(100, Math.round((job.downloadedBytes / job.totalBytes) * 100));

        if (job.chunksState && chunkIndex < job.chunksState.length) {
          job.chunksState[chunkIndex] = "done";
        }

        // Compute overall speed and ETA
        const now = Date.now();
        const intervalSec = (now - lastTime) / 1000;
        if (intervalSec >= 1) {
          const bytesDiff = job.downloadedBytes - lastBytes;
          const currentSpeedBytesSec = bytesDiff / intervalSec;
          const currentSpeedMBs = currentSpeedBytesSec / (1024 * 1024);
          job.speed = `${currentSpeedMBs.toFixed(1)} MB/s`;

          const remainingBytes = job.totalBytes - job.downloadedBytes;
          if (currentSpeedBytesSec > 0) {
            const etaSec = Math.ceil(remainingBytes / currentSpeedBytesSec);
            const mins = Math.floor(etaSec / 60);
            const secs = etaSec % 60;
            job.eta = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
          }

          lastBytes = job.downloadedBytes;
          lastTime = now;
        }

        this.saveRegistry();
      }

      // Check if job completed
      if (job.downloadedBytes >= job.totalBytes) {
        job.status = "completed";
        job.progress = 100;
        job.speed = "Completado";
        job.downloadSpeed = "0 MB/s";
        job.uploadSpeed = "0 MB/s";
        job.eta = "Finalizado";
        job.completedAt = Date.now();
        job.logs.push(`[${new Date().toLocaleTimeString()}] ✨ Pipeline completado exitosamente.`);
        this.saveRegistry();
      }
    } catch (err: any) {
      if (abortController.signal.aborted) {
        job.status = "paused";
        job.speed = "En pausa";
        job.logs.push(`[Pausa] Tarea pausada.`);
      } else {
        console.error("Sequential Stream Pipeline Error:", err);
        job.status = "error";
        job.error = err.message || "Error en el pipeline secuencial";
        job.logs.push(`[ERROR] ${err.message}`);
      }
      this.saveRegistry();
    } finally {
      this.abortControllers.delete(jobId);
    }
  }

  public pauseJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    const controller = this.abortControllers.get(jobId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(jobId);
    }
    job.status = "paused";
    job.speed = "Pausado";
    job.logs.push(`[${new Date().toLocaleTimeString()}] Tarea pausada por el usuario.`);
    this.saveRegistry();
    return true;
  }

  public resumeJob(jobId: string, accessToken?: string, folderId?: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === "streaming" || job.status === "downloading") {
      return true;
    }

    job.status = "streaming";
    job.error = undefined;
    job.logs.push(`[${new Date().toLocaleTimeString()}] ⏵ Reanudando pipeline secuencial...`);
    this.saveRegistry();

    this.executeJobPipeline(jobId, {
      accessToken,
      folderId,
    });
    return true;
  }

  public cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    const controller = this.abortControllers.get(jobId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(jobId);
    }
    job.status = "cancelled";
    job.speed = "Cancelado";
    job.logs.push(`[${new Date().toLocaleTimeString()}] ⏹ Tarea cancelada.`);
    this.saveRegistry();
    return true;
  }

  public deleteJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    this.cancelJob(jobId);

    if (job.filePath && fs.existsSync(job.filePath)) {
      try {
        const parentDir = path.dirname(job.filePath);
        fs.rmSync(parentDir, { recursive: true, force: true });
      } catch (e) {
        console.warn("Could not delete job files from disk:", e);
      }
    }

    this.jobs.delete(jobId);
    this.saveRegistry();
    return true;
  }

  /**
   * Automatically resumes interrupted sequential streaming jobs when Google Drive session is available
   */
  public autoResumePendingJobs(accessToken?: string, folderId?: string, accountEmail?: string): SequentialStreamJob[] {
    const resumed: SequentialStreamJob[] = [];
    for (const job of this.jobs.values()) {
      if (
        accountEmail &&
        job.accountEmail &&
        job.accountEmail.trim() !== "" &&
        job.accountEmail.toLowerCase() !== accountEmail.trim().toLowerCase()
      ) {
        continue;
      }
      if (
        (job.status === "paused" || job.status === "starting" || job.status === "streaming" || job.status === "downloading") &&
        job.downloadedBytes < job.totalBytes &&
        !this.abortControllers.has(job.id)
      ) {
        try {
          const ok = this.resumeJob(job.id, accessToken, folderId);
          if (ok) {
            resumed.push(job);
          }
        } catch (e) {
          console.warn(`[SequentialEngine] Failed to auto-resume job ${job.id}:`, e);
        }
      }
    }
    return resumed;
  }
}

export const sequentialChunkEngine = new SequentialChunkEngine();
