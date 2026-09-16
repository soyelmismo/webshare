import express from "express";
import { Readable } from "stream";
import crypto from "crypto";

export interface ServerSpeedTestResult {
  source: string;
  fileSizeMB: number;
  downloadedBytes: number;
  elapsedSec: number;
  speedMbps: number;
  speedMBs: number;
  throttledLimitMbps?: number;
}

// Pre-allocated static 1MB buffer for zero-overhead streaming
const CHUNK_1MB = Buffer.alloc(1024 * 1024);
for (let i = 0; i < CHUNK_1MB.length; i += 4) {
  CHUNK_1MB.writeUInt32LE(0xa5c3f05a, i);
}

const CHUNK_64KB = CHUNK_1MB.subarray(0, 64 * 1024);
const CHUNK_256KB = CHUNK_1MB.subarray(0, 256 * 1024);

/**
 * Streams dummy bytes directly to an Express/HTTP Response object with smooth pacing and backpressure.
 */
export async function streamThrottledBytesToResponse(
  res: express.Response,
  req: express.Request,
  totalBytes: number = 50 * 1024 * 1024,
  limitMbps: number = 0,
  maxDurationSec: number = 15
): Promise<void> {
  const startTime = Date.now();
  const maxEndTime = startTime + maxDurationSec * 1000;
  const targetBytesPerSec = limitMbps > 0 ? (limitMbps * 1_000_000) / 8 : 0;

  // Chunk size: 32KB for low speeds, 64KB for medium, 128KB/256KB for high/unlimited
  let chunkSize = 64 * 1024;
  if (limitMbps > 0 && limitMbps <= 2) {
    chunkSize = 32 * 1024;
  } else if (limitMbps > 0 && limitMbps <= 10) {
    chunkSize = 64 * 1024;
  } else if (limitMbps === 0 || limitMbps > 100) {
    chunkSize = 256 * 1024;
  }

  const chunk = CHUNK_1MB.subarray(0, chunkSize);
  let bytesSent = 0;
  let aborted = false;

  const onReqClose = () => {
    aborted = true;
  };
  req.on("close", onReqClose);
  res.on("close", onReqClose);

  // Send first chunk immediately to start the client stream
  try {
    while (!aborted && Date.now() < maxEndTime && bytesSent < totalBytes) {
      const remaining = totalBytes - bytesSent;
      const toSend = Math.min(chunkSize, remaining);
      const slice = toSend === chunkSize ? chunk : chunk.subarray(0, toSend);

      const canContinue = res.write(slice);
      bytesSent += slice.length;

      // Force flush if compression or proxy buffering is active
      if (typeof (res as any).flush === "function") {
        (res as any).flush();
      }

      if (targetBytesPerSec > 0) {
        const elapsedSec = (Date.now() - startTime) / 1000;
        const expectedSec = bytesSent / targetBytesPerSec;
        if (expectedSec > elapsedSec) {
          const delayMs = (expectedSec - elapsedSec) * 1000;
          if (delayMs > 2) {
            await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 40)));
          }
        }
      } else {
        if (!canContinue) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 30);
            res.once("drain", () => {
              clearTimeout(timer);
              resolve();
            });
          });
        } else {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    }
  } catch (e) {
    // Client disconnected or write error
  } finally {
    req.off("close", onReqClose);
    res.off("close", onReqClose);
    if (!res.writableEnded) {
      try {
        res.end();
      } catch {}
    }
  }
}

/**
 * Creates a throttled readable stream generating dummy binary data.
 * @param totalBytes Total bytes to generate (0 for time-based infinite)
 * @param limitMbps Maximum bandwidth in Megabits per second (0 = unlimited)
 * @param maxDurationSec Maximum duration in seconds before closing stream
 */
export function createThrottledByteStream(
  totalBytes: number = 50 * 1024 * 1024,
  limitMbps: number = 0,
  maxDurationSec: number = 15
): Readable {
  let bytesSent = 0;
  const startTime = Date.now();
  const maxEndTime = startTime + maxDurationSec * 1000;
  const hasByteLimit = totalBytes > 0;

  // Calculate target bytes per second
  const targetBytesPerSec = limitMbps > 0 ? (limitMbps * 1_000_000) / 8 : 0;

  // Pick optimal chunk size based on speed
  let chunkSize = 128 * 1024;
  if (limitMbps > 0 && limitMbps <= 2) {
    chunkSize = 16 * 1024;
  } else if (limitMbps > 0 && limitMbps <= 10) {
    chunkSize = 32 * 1024;
  } else if (limitMbps > 0 && limitMbps <= 50) {
    chunkSize = 64 * 1024;
  }

  const chunkBuffer = CHUNK_1MB.subarray(0, chunkSize);
  let isDestroyed = false;
  let timer: NodeJS.Timeout | null = null;

  function pushNextChunk(stream: Readable) {
    if (isDestroyed) return;

    const now = Date.now();
    if (now >= maxEndTime || (hasByteLimit && bytesSent >= totalBytes)) {
      stream.push(null); // End of stream
      return;
    }

    // Unlimited bandwidth: push directly
    if (targetBytesPerSec <= 0) {
      const remaining = hasByteLimit ? totalBytes - bytesSent : chunkSize;
      const size = Math.min(chunkSize, remaining);
      const currentChunk = size === chunkSize ? chunkBuffer : chunkBuffer.subarray(0, size);
      bytesSent += currentChunk.length;
      if (!stream.push(currentChunk)) {
        // Backpressure from downstream consumer, will call read() when ready
        return;
      }
      setImmediate(() => pushNextChunk(stream));
      return;
    }

    // Paced rate limiting using time delta and token allowance
    const elapsedSec = (now - startTime) / 1000;
    const allowedBytes = Math.floor(elapsedSec * targetBytesPerSec);

    if (bytesSent <= allowedBytes) {
      const remaining = hasByteLimit ? totalBytes - bytesSent : chunkSize;
      const size = Math.min(chunkSize, remaining);
      const currentChunk = size === chunkSize ? chunkBuffer : chunkBuffer.subarray(0, size);
      bytesSent += currentChunk.length;
      const canContinue = stream.push(currentChunk);

      if (canContinue && !isDestroyed) {
        const nextNow = Date.now();
        const nextElapsedSec = (nextNow - startTime) / 1000;
        const nextAllowed = Math.floor(nextElapsedSec * targetBytesPerSec);
        if (bytesSent <= nextAllowed) {
          setImmediate(() => pushNextChunk(stream));
        } else {
          const deficit = bytesSent - nextAllowed;
          const waitMs = Math.max(5, Math.ceil((deficit / targetBytesPerSec) * 1000));
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => pushNextChunk(stream), Math.min(waitMs, 50));
        }
      }
    } else {
      const deficit = bytesSent - allowedBytes;
      const waitMs = Math.max(5, Math.ceil((deficit / targetBytesPerSec) * 1000));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => pushNextChunk(stream), Math.min(waitMs, 50));
    }
  }

  const stream = new Readable({
    read() {
      pushNextChunk(this);
    },
    destroy(err, callback) {
      isDestroyed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      callback(err);
    },
  });

  return stream;
}

export interface BackboneServerTarget {
  id: string;
  name: string;
  provider: string;
  region: string;
  url: string;
  pingUrl?: string;
  badge: string;
}

export const BACKBONE_SERVERS: BackboneServerTarget[] = [
  {
    id: "cloudflare-global",
    name: "Cloudflare Edge Anycast",
    provider: "Cloudflare 1.1.1.1 Network",
    region: "Global Edge (>300 PoPs)",
    url: "https://speed.cloudflare.com/__down?bytes=50000000",
    pingUrl: "https://speed.cloudflare.com/__down?bytes=0",
    badge: "Baja Latencia / Anycast",
  },
  {
    id: "ovh-ashburn",
    name: "OVHcloud US East (Ashburn)",
    provider: "OVHcloud Backbone",
    region: "EE. UU. Este (Ashburn, VA)",
    url: "https://ash.proof.ovh.net/files/50Mb.dat",
    pingUrl: "https://ash.proof.ovh.net/files/100Kb.dat",
    badge: "10 Gbps Backbone",
  },
  {
    id: "cachefly-cdn",
    name: "CacheFly Global CDN",
    provider: "CacheFly Anycast",
    region: "Global Anycast PoP",
    url: "https://cachefly.cachefly.net/50mb.test",
    badge: "CDN de Ultra-Baja Latencia",
  },
  {
    id: "hetzner-germany",
    name: "Hetzner Datacenter (Falkenstein)",
    provider: "Hetzner Online GmbH",
    region: "Europa (Alemania)",
    url: "https://speed.hetzner.de/100MB.bin",
    badge: "Tier-1 Europa",
  },
  {
    id: "tele2-sweden",
    name: "Tele2 Backbone (Kista)",
    provider: "Tele2 AB",
    region: "Europa Nórdica (Suecia)",
    url: "http://speedtest.tele2.net/100MB.zip",
    badge: "Gigabit Nórdico",
  },
];

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
 * Benchmarks all configured backbone servers from the Node.js backend
 */
export async function benchmarkAllBackboneServers(
  testSizeMB: number = 25,
  maxDurationSecPerServer: number = 5
): Promise<ServerBenchmarkResult[]> {
  const results: ServerBenchmarkResult[] = [];
  const targetBytes = testSizeMB * 1024 * 1024;

  for (const server of BACKBONE_SERVERS) {
    const startPing = Date.now();
    let pingMs = 0;
    try {
      const pingTarget = server.pingUrl || server.url;
      const headRes = await fetch(pingTarget, {
        method: "HEAD",
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(3000),
      }).catch(async () => {
        return await fetch(pingTarget, {
          method: "GET",
          headers: { Range: "bytes=0-100", "Cache-Control": "no-cache" },
          signal: AbortSignal.timeout(3000),
        });
      });
      pingMs = Math.max(1, Date.now() - startPing);
    } catch {
      pingMs = Math.max(1, Date.now() - startPing);
    }

    try {
      const startDownload = Date.now();
      const maxEndTime = startDownload + maxDurationSecPerServer * 1000;

      const res = await fetch(server.url, {
        headers: {
          "User-Agent": "SpeedTestBenchmark/2.0",
          "Cache-Control": "no-cache",
        },
        signal: AbortSignal.timeout((maxDurationSecPerServer + 3) * 1000),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      let downloaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        downloaded += value.length;
        if (downloaded >= targetBytes || Date.now() >= maxEndTime) {
          await reader.cancel();
          break;
        }
      }

      const elapsedSec = Math.max(0.001, (Date.now() - startDownload) / 1000);
      const speedMbps = Number(((downloaded * 8) / 1_000_000 / elapsedSec).toFixed(2));
      const speedMBs = Number((downloaded / (1024 * 1024) / elapsedSec).toFixed(2));

      results.push({
        id: server.id,
        name: server.name,
        provider: server.provider,
        region: server.region,
        badge: server.badge,
        pingMs,
        speedMbps,
        speedMBs,
        downloadedMB: Number((downloaded / (1024 * 1024)).toFixed(2)),
        elapsedSec: Number(elapsedSec.toFixed(2)),
        status: "success",
      });
    } catch (err: any) {
      results.push({
        id: server.id,
        name: server.name,
        provider: server.provider,
        region: server.region,
        badge: server.badge,
        pingMs,
        speedMbps: 0,
        speedMBs: 0,
        downloadedMB: 0,
        elapsedSec: 0,
        status: "error",
        error: err.message || "Fallo de conexión",
      });
    }
  }

  // Sort descending by speedMbps
  results.sort((a, b) => b.speedMbps - a.speedMbps);
  return results;
}

/**
 * Performs a server-to-external CDN speed test with optional rate limiting
 */
export async function testServerBackboneSpeed(
  targetUrl: string = "https://speed.cloudflare.com/__down?bytes=50000000",
  limitMbps: number = 0,
  maxBytes: number = 50 * 1024 * 1024
): Promise<ServerSpeedTestResult> {
  const startTime = Date.now();
  const response = await fetch(targetUrl, {
    headers: {
      "User-Agent": "SpeedTestServer/2.0",
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Fallo al conectar con el servidor CDN: HTTP ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  let downloadedBytes = 0;
  const targetBytesPerSec = limitMbps > 0 ? (limitMbps * 1_000_000) / 8 : 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done || !value) break;

    downloadedBytes += value.length;

    // Rate limiting pacing if requested
    if (targetBytesPerSec > 0) {
      const elapsedSec = (Date.now() - startTime) / 1000;
      const expectedElapsedSec = downloadedBytes / targetBytesPerSec;
      if (expectedElapsedSec > elapsedSec) {
        const delayMs = (expectedElapsedSec - elapsedSec) * 1000;
        if (delayMs > 5) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 50)));
        }
      }
    }

    if (downloadedBytes >= maxBytes) {
      await reader.cancel();
      break;
    }
  }

  const totalElapsedSec = Math.max(0.001, (Date.now() - startTime) / 1000);
  const speedMBs = Number((downloadedBytes / (1024 * 1024) / totalElapsedSec).toFixed(2));
  const speedMbps = Number(((downloadedBytes * 8) / 1_000_000 / totalElapsedSec).toFixed(2));

  let sourceName = "Public CDN Backbone";
  const matched = BACKBONE_SERVERS.find((s) => s.url === targetUrl || targetUrl.includes(s.id));
  if (matched) {
    sourceName = `${matched.name} (${matched.region})`;
  } else if (targetUrl.includes("cloudflare")) {
    sourceName = "Cloudflare Global CDN Backbone";
  }

  return {
    source: sourceName,
    fileSizeMB: Math.round(downloadedBytes / (1024 * 1024)),
    downloadedBytes,
    elapsedSec: Number(totalElapsedSec.toFixed(3)),
    speedMbps,
    speedMBs,
    throttledLimitMbps: limitMbps > 0 ? limitMbps : undefined,
  };
}
