export type SpeedTestPhase = "idle" | "ping" | "download" | "upload" | "backbone" | "completed" | "error";

export interface SpeedTestConfig {
  mode: "full" | "download_only" | "upload_only" | "backbone";
  downloadLimitMbps: number; // 0 = unlimited
  uploadLimitMbps: number; // 0 = unlimited
  sizeMB: number;
  durationSec: number;
  parallelStreams?: number;
}

export interface SpeedPoint {
  time: number;
  speedMbps: number;
  phase: "download" | "upload" | "backbone";
}

export interface SpeedTestLiveState {
  phase: SpeedTestPhase;
  progressPercent: number;
  currentSpeedMbps: number;
  currentSpeedMBs: number;
  transferredBytes: number;
  totalTargetBytes: number;
  elapsedSec: number;
  pingMs: number | null;
  minPingMs: number | null;
  maxPingMs: number | null;
  jitterMs: number | null;
  avgDownloadMbps: number | null;
  peakDownloadMbps: number | null;
  avgUploadMbps: number | null;
  peakUploadMbps: number | null;
  backboneSpeedMbps: number | null;
  backboneSpeedMBs: number | null;
  chartPoints: SpeedPoint[];
  error?: string;
}

export interface SpeedTestResultRecord {
  id: string;
  timestamp: number;
  mode: "full" | "download_only" | "upload_only" | "backbone";
  downloadLimitMbps: number;
  uploadLimitMbps: number;
  avgDownloadMbps: number | null;
  peakDownloadMbps: number | null;
  avgUploadMbps: number | null;
  peakUploadMbps: number | null;
  pingMs: number | null;
  jitterMs: number | null;
  totalBytes: number;
  durationSec: number;
}

/**
 * Runs 10 multi-sample HTTP round-trip pings to measure latency and jitter.
 */
export async function measurePingAndJitter(
  samples: number = 10,
  onSample?: (currentPing: number, stats: { min: number; max: number; avg: number; jitter: number }) => void,
  signal?: AbortSignal
): Promise<{ minPing: number; maxPing: number; avgPing: number; jitter: number }> {
  const pings: number[] = [];

  for (let i = 0; i < samples; i++) {
    if (signal?.aborted) break;

    const t0 = performance.now();
    try {
      const res = await fetch(`/api/speedtest/ping?_t=${Date.now()}_${i}`, {
        cache: "no-store",
        signal,
      });
      await res.json();
      const t1 = performance.now();
      const ping = Math.round(t1 - t0);
      pings.push(ping);

      if (onSample) {
        const min = Math.min(...pings);
        const max = Math.max(...pings);
        const avg = Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
        let jitter = 0;
        if (pings.length > 1) {
          let diffSum = 0;
          for (let j = 1; j < pings.length; j++) {
            diffSum += Math.abs(pings[j] - pings[j - 1]);
          }
          jitter = Math.round(diffSum / (pings.length - 1));
        }
        onSample(ping, { min, max, avg, jitter });
      }
    } catch (e: any) {
      if (signal?.aborted) throw e;
    }

    // Small inter-ping gap
    if (i < samples - 1) {
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  if (pings.length === 0) {
    return { minPing: 0, maxPing: 0, avgPing: 0, jitter: 0 };
  }

  const minPing = Math.min(...pings);
  const maxPing = Math.max(...pings);
  const avgPing = Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);

  let jitter = 0;
  if (pings.length > 1) {
    let diffSum = 0;
    for (let j = 1; j < pings.length; j++) {
      diffSum += Math.abs(pings[j] - pings[j - 1]);
    }
    jitter = Math.round(diffSum / (pings.length - 1));
  }

  return { minPing, maxPing, avgPing, jitter };
}

/**
 * Executes a streaming raw download test with real-time throttling measurement.
 */
export async function runDownloadSpeedTest(
  config: { limitMbps: number; sizeMB: number; durationSec: number },
  onProgress: (metrics: {
    transferredBytes: number;
    currentSpeedMbps: number;
    currentSpeedMBs: number;
    avgSpeedMbps: number;
    peakSpeedMbps: number;
    elapsedSec: number;
    progressPercent: number;
  }) => void,
  signal?: AbortSignal
): Promise<{ totalBytes: number; elapsedSec: number; avgSpeedMbps: number; peakSpeedMbps: number }> {
  const url = `/api/speedtest/download?limitMbps=${encodeURIComponent(config.limitMbps)}&sizeMB=${encodeURIComponent(
    config.sizeMB
  )}&durationSec=${encodeURIComponent(config.durationSec)}&_t=${Date.now()}`;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Fallo al iniciar el stream de bajada: HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const startTime = performance.now();
    let totalBytes = 0;
    const targetBytes = config.sizeMB * 1024 * 1024;

    let lastSampleTime = startTime;
    let lastSampleBytes = 0;
    let peakSpeedMbps = 0;
    const maxDurationMs = config.durationSec * 1000;

    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done || !value) break;

      totalBytes += value.length;
      const now = performance.now();
      const elapsedSinceLastSample = (now - lastSampleTime) / 1000;

      if (elapsedSinceLastSample >= 0.1 || totalBytes >= targetBytes) {
        const bytesInSample = totalBytes - lastSampleBytes;
        const currentSpeedMBs = Number((bytesInSample / (1024 * 1024) / Math.max(0.001, elapsedSinceLastSample)).toFixed(2));
        const currentSpeedMbps = Number(((bytesInSample * 8) / 1_000_000 / Math.max(0.001, elapsedSinceLastSample)).toFixed(2));

        const totalElapsedSec = Math.max(0.001, (now - startTime) / 1000);
        const avgSpeedMbps = Number(((totalBytes * 8) / 1_000_000 / totalElapsedSec).toFixed(2));

        if (currentSpeedMbps > peakSpeedMbps) {
          peakSpeedMbps = currentSpeedMbps;
        }

        const progressPercent = Math.min(100, Math.round((totalBytes / targetBytes) * 100));

        onProgress({
          transferredBytes: totalBytes,
          currentSpeedMbps,
          currentSpeedMBs,
          avgSpeedMbps,
          peakSpeedMbps,
          elapsedSec: Number(totalElapsedSec.toFixed(2)),
          progressPercent,
        });

        lastSampleTime = now;
        lastSampleBytes = totalBytes;
      }

      if (now - startTime >= maxDurationMs || totalBytes >= targetBytes) {
        await reader.cancel();
        break;
      }
    }

    const totalElapsedSec = Math.max(0.001, (performance.now() - startTime) / 1000);
    const avgSpeedMbps = Number(((totalBytes * 8) / 1_000_000 / totalElapsedSec).toFixed(2));

    return {
      totalBytes,
      elapsedSec: Number(totalElapsedSec.toFixed(2)),
      avgSpeedMbps,
      peakSpeedMbps,
    };
  } catch (err: any) {
    if (signal?.aborted) {
      return { totalBytes: 0, elapsedSec: 0, avgSpeedMbps: 0, peakSpeedMbps: 0 };
    }
    // Fallback to streaming XHR if fetch stream fails
    return await runDownloadXHRFallback(config, onProgress, signal);
  }
}

/**
 * XHR streaming fallback for download test
 */
function runDownloadXHRFallback(
  config: { limitMbps: number; sizeMB: number; durationSec: number },
  onProgress: (metrics: any) => void,
  signal?: AbortSignal
): Promise<{ totalBytes: number; elapsedSec: number; avgSpeedMbps: number; peakSpeedMbps: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `/api/speedtest/download?limitMbps=${encodeURIComponent(config.limitMbps)}&sizeMB=${encodeURIComponent(
      config.sizeMB
    )}&durationSec=${encodeURIComponent(config.durationSec)}&_t=${Date.now()}`;

    const startTime = performance.now();
    let peakSpeedMbps = 0;
    let lastTime = startTime;
    let lastLoaded = 0;
    const targetBytes = config.sizeMB * 1024 * 1024;

    xhr.onprogress = (event) => {
      const loaded = event.loaded;
      const now = performance.now();
      const elapsedSinceLast = (now - lastTime) / 1000;

      if (elapsedSinceLast >= 0.1 || loaded >= targetBytes) {
        const deltaBytes = loaded - lastLoaded;
        const currentSpeedMBs = Number((deltaBytes / (1024 * 1024) / Math.max(0.001, elapsedSinceLast)).toFixed(2));
        const currentSpeedMbps = Number(((deltaBytes * 8) / 1_000_000 / Math.max(0.001, elapsedSinceLast)).toFixed(2));
        const totalElapsed = (now - startTime) / 1000;
        const avgSpeedMbps = Number(((loaded * 8) / 1_000_000 / Math.max(0.001, totalElapsed)).toFixed(2));

        if (currentSpeedMbps > peakSpeedMbps) peakSpeedMbps = currentSpeedMbps;

        const progressPercent = Math.min(100, Math.round((loaded / targetBytes) * 100));

        onProgress({
          transferredBytes: loaded,
          currentSpeedMbps,
          currentSpeedMBs,
          avgSpeedMbps,
          peakSpeedMbps,
          elapsedSec: Number(totalElapsed.toFixed(2)),
          progressPercent,
        });

        lastTime = now;
        lastLoaded = loaded;
      }
    };

    xhr.onload = () => {
      const loaded = xhr.response ? xhr.response.byteLength || lastLoaded : lastLoaded;
      const totalElapsed = Math.max(0.001, (performance.now() - startTime) / 1000);
      const avgSpeedMbps = Number(((loaded * 8) / 1_000_000 / totalElapsed).toFixed(2));
      resolve({
        totalBytes: loaded,
        elapsedSec: Number(totalElapsed.toFixed(2)),
        avgSpeedMbps,
        peakSpeedMbps,
      });
    };

    xhr.onerror = () => reject(new Error("Error en la descarga durante el test de velocidad"));

    if (signal) {
      signal.addEventListener("abort", () => xhr.abort());
    }

    xhr.open("GET", url);
    xhr.responseType = "arraybuffer";
    xhr.send();
  });
}

/**
 * Executes a chunk-pipelined raw upload test with client-side bandwidth throttling pacing.
 * Sends small 1MB-2MB binary chunks in a continuous stream loop so reverse proxies never reject with HTTP 413.
 */
export async function runUploadSpeedTest(
  config: { limitMbps: number; sizeMB: number; durationSec: number },
  onProgress: (metrics: {
    transferredBytes: number;
    currentSpeedMbps: number;
    currentSpeedMBs: number;
    avgSpeedMbps: number;
    peakSpeedMbps: number;
    elapsedSec: number;
    progressPercent: number;
  }) => void,
  signal?: AbortSignal
): Promise<{ totalBytes: number; elapsedSec: number; avgSpeedMbps: number; peakSpeedMbps: number }> {
  const targetBytes = config.sizeMB * 1024 * 1024;
  const targetBytesPerSec = config.limitMbps > 0 ? (config.limitMbps * 1_000_000) / 8 : 0;
  const maxDurationMs = config.durationSec * 1000;

  // Chunk size: 256KB for <=5Mbps, 512KB for <=25Mbps, 1MB for <=100Mbps, 2MB for unlimited/high
  let chunkSize = 1024 * 1024; // 1MB
  if (config.limitMbps > 0 && config.limitMbps <= 5) {
    chunkSize = 256 * 1024;
  } else if (config.limitMbps > 0 && config.limitMbps <= 25) {
    chunkSize = 512 * 1024;
  } else if (config.limitMbps === 0 || config.limitMbps > 100) {
    chunkSize = 2 * 1024 * 1024; // 2MB
  }

  // Pre-generate reusable chunk buffer
  const chunkBuffer = new Uint8Array(chunkSize);
  for (let i = 0; i < chunkBuffer.length; i += 4) {
    chunkBuffer[i] = 0xfa;
    chunkBuffer[i + 1] = 0x12;
    chunkBuffer[i + 2] = 0x7c;
    chunkBuffer[i + 3] = 0x9b;
  }

  let totalUploadedBytes = 0;
  const startTime = performance.now();
  let lastSampleTime = startTime;
  let lastSampleBytes = 0;
  let peakSpeedMbps = 0;

  const emitProgress = (uploaded: number) => {
    const now = performance.now();
    const elapsedSinceLast = (now - lastSampleTime) / 1000;
    if (elapsedSinceLast >= 0.08 || uploaded >= targetBytes) {
      const deltaBytes = uploaded - lastSampleBytes;
      const currentSpeedMBs = Number((deltaBytes / (1024 * 1024) / Math.max(0.001, elapsedSinceLast)).toFixed(2));
      const currentSpeedMbps = Number(((deltaBytes * 8) / 1_000_000 / Math.max(0.001, elapsedSinceLast)).toFixed(2));
      const totalElapsed = (now - startTime) / 1000;
      const avgSpeedMbps = Number(((uploaded * 8) / 1_000_000 / Math.max(0.001, totalElapsed)).toFixed(2));

      if (currentSpeedMbps > peakSpeedMbps) peakSpeedMbps = currentSpeedMbps;

      const progressPercent = Math.min(100, Math.round((uploaded / targetBytes) * 100));

      onProgress({
        transferredBytes: uploaded,
        currentSpeedMbps,
        currentSpeedMBs,
        avgSpeedMbps,
        peakSpeedMbps,
        elapsedSec: Number(totalElapsed.toFixed(2)),
        progressPercent,
      });

      lastSampleTime = now;
      lastSampleBytes = uploaded;
    }
  };

  const uploadSingleChunk = (bytesToSend: number): Promise<number> => {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return resolve(0);
      }

      const xhr = new XMLHttpRequest();
      const slice = bytesToSend === chunkSize ? chunkBuffer : chunkBuffer.subarray(0, bytesToSend);
      let chunkPrevLoaded = 0;

      xhr.upload.onprogress = (e) => {
        if (signal?.aborted) {
          xhr.abort();
          return;
        }
        if (e.lengthComputable) {
          const delta = e.loaded - chunkPrevLoaded;
          if (delta > 0) {
            totalUploadedBytes += delta;
            chunkPrevLoaded = e.loaded;
            emitProgress(totalUploadedBytes);
          }
        }
      };

      xhr.onload = () => {
        const remaining = slice.length - chunkPrevLoaded;
        if (remaining > 0) {
          totalUploadedBytes += remaining;
          emitProgress(totalUploadedBytes);
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(slice.length);
        } else {
          reject(new Error(`Error en el servidor durante la subida: HTTP ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error("Error de red durante la subida"));

      const abortHandler = () => {
        xhr.abort();
        resolve(0);
      };
      if (signal) {
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      xhr.open("POST", `/api/speedtest/upload?limitMbps=${config.limitMbps}&_t=${Date.now()}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.send(slice);
    });
  };

  while (
    !signal?.aborted &&
    performance.now() - startTime < maxDurationMs &&
    totalUploadedBytes < targetBytes
  ) {
    const remaining = targetBytes - totalUploadedBytes;
    const sendSize = Math.min(chunkSize, remaining);

    // Apply pacing calculation for throttled upload
    if (targetBytesPerSec > 0) {
      const now = performance.now();
      const elapsedSec = (now - startTime) / 1000;
      const expectedSec = totalUploadedBytes / targetBytesPerSec;
      if (expectedSec > elapsedSec) {
        const delayMs = (expectedSec - elapsedSec) * 1000;
        if (delayMs > 3) {
          await new Promise((r) => setTimeout(r, Math.min(delayMs, 50)));
        }
      }
    }

    if (signal?.aborted) break;

    try {
      await uploadSingleChunk(sendSize);
    } catch (err: any) {
      if (signal?.aborted) break;
      throw err;
    }
  }

  const totalElapsedSec = Math.max(0.001, (performance.now() - startTime) / 1000);
  const avgSpeedMbps = Number(((totalUploadedBytes * 8) / 1_000_000 / totalElapsedSec).toFixed(2));

  return {
    totalBytes: totalUploadedBytes,
    elapsedSec: Number(totalElapsedSec.toFixed(2)),
    avgSpeedMbps,
    peakSpeedMbps,
  };
}

export interface BackboneServerTarget {
  id: string;
  name: string;
  provider: string;
  region: string;
  url: string;
  badge: string;
}

export interface ServerBenchmarkResult {
  id: string;
  name: string;
  provider: string;
  region: string;
  badge: string;
  pingMs: number;
  speedMbps: number;
  speedMBs: number;
  downloadedMB: number;
  elapsedSec: number;
  status: "success" | "error";
  error?: string;
}

/**
 * Fetches available backbone CDN mirror targets
 */
export async function fetchBackboneServers(): Promise<BackboneServerTarget[]> {
  try {
    const res = await fetch("/api/speedtest/servers");
    if (!res.ok) return [];
    const data = await res.json();
    return data.servers || [];
  } catch {
    return [];
  }
}

/**
 * Runs a multi-server benchmark across all backbone servers
 */
export async function runBenchmarkAllServers(
  sizeMB: number = 25,
  durationSec: number = 5,
  signal?: AbortSignal
): Promise<ServerBenchmarkResult[]> {
  const res = await fetch("/api/speedtest/benchmark-servers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sizeMB, durationSec }),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error durante el benchmark de servidores: HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.results || [];
}

/**
 * Executes a server-to-external CDN backbone speed test
 */
export async function runServerBackboneTest(
  config: { limitMbps: number; sizeMB: number; sourceUrl?: string },
  signal?: AbortSignal
): Promise<{
  source: string;
  fileSizeMB: number;
  downloadedBytes: number;
  elapsedSec: number;
  speedMbps: number;
  speedMBs: number;
  throttledLimitMbps?: number;
}> {
  const res = await fetch("/api/speedtest/backbone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      limitMbps: config.limitMbps,
      sizeMB: config.sizeMB,
      sourceUrl: config.sourceUrl,
    }),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error en el test de red troncal: HTTP ${res.status}`);
  }

  return await res.json();
}
