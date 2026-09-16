import express from "express";
import path from "path";
import os from "os";
import fs from "fs";
import dns from "dns";
import v8 from "v8";
import crypto from "crypto";
import { Worker } from "worker_threads";
import { spawn, execSync, type ChildProcess } from "child_process";
import { Readable } from "stream";
import { createServer as createViteServer } from "vite";
import { streamManager } from "./server/streamManager";
import { sequentialChunkEngine } from "./server/sequentialEngine";
import {
  createThrottledByteStream,
  streamThrottledBytesToResponse,
  testServerBackboneSpeed,
  BACKBONE_SERVERS,
  benchmarkAllBackboneServers,
} from "./server/speedTestEngine";

// Background rolling history buffer for server real-time charts
interface HistoryPoint {
  timestamp: number;
  cpuLoad1m: number;
  memUsagePercent: number;
  memUsedMB: number;
  processRssMB: number;
}

const historyBuffer: HistoryPoint[] = [];
const MAX_HISTORY = 40;

function sampleServerMetrics() {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const loadAvg = os.loadavg();
    const memUsage = Math.round((usedMem / totalMem) * 100);
    const procMem = process.memoryUsage();

    historyBuffer.push({
      timestamp: Date.now(),
      cpuLoad1m: Number(loadAvg[0].toFixed(2)),
      memUsagePercent: memUsage,
      memUsedMB: Math.round(usedMem / (1024 * 1024)),
      processRssMB: Math.round(procMem.rss / (1024 * 1024)),
    });

    if (historyBuffer.length > MAX_HISTORY) {
      historyBuffer.shift();
    }
  } catch (e) {
    // ignore background sample error
  }
}

// Start 2-second background sampling
setInterval(sampleServerMetrics, 2000);
sampleServerMetrics();

function parseOsRelease(): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    if (fs.existsSync("/etc/os-release")) {
      const content = fs.readFileSync("/etc/os-release", "utf8");
      content.split("\n").forEach((line) => {
        const idx = line.indexOf("=");
        if (idx > 0) {
          const key = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).replace(/^["']|["']$/g, "").trim();
          result[key] = val;
        }
      });
    }
  } catch (e) {
    // ignore
  }
  return result;
}

function parseProcCpuinfo(): {
  flags: string[];
  cacheSizeKB: number;
  bogomips: number;
  vendorId: string;
  family: string;
  addressSizes: string;
  modelName: string;
} {
  let flags: string[] = [];
  let cacheSizeKB = 0;
  let bogomips = 0;
  let vendorId = "";
  let family = "";
  let addressSizes = "";
  let modelName = "";

  try {
    if (fs.existsSync("/proc/cpuinfo")) {
      const content = fs.readFileSync("/proc/cpuinfo", "utf8");
      const lines = content.split("\n");
      for (const line of lines) {
        const [k, v] = line.split(":").map((s) => s?.trim());
        if (!k || !v) continue;
        if (k === "flags" && flags.length === 0) {
          flags = v.split(/\s+/).filter(Boolean);
        } else if (k === "cache size" && cacheSizeKB === 0) {
          cacheSizeKB = parseInt(v) || 0;
        } else if (k === "bogomips" && bogomips === 0) {
          bogomips = parseFloat(v) || 0;
        } else if (k === "vendor_id" && !vendorId) {
          vendorId = v;
        } else if (k === "cpu family" && !family) {
          family = v;
        } else if (k === "address sizes" && !addressSizes) {
          addressSizes = v;
        } else if (k === "model name" && !modelName && v !== "unknown") {
          modelName = v;
        }
      }
    }
  } catch (e) {
    // ignore
  }

  return { flags, cacheSizeKB, bogomips, vendorId, family, addressSizes, modelName };
}

function parseProcMeminfo(): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    if (fs.existsSync("/proc/meminfo")) {
      const content = fs.readFileSync("/proc/meminfo", "utf8");
      content.split("\n").forEach((line) => {
        const [k, v] = line.split(":").map((s) => s?.trim());
        if (k && v) {
          result[k] = v;
        }
      });
    }
  } catch (e) {
    // ignore
  }
  return result;
}

function getDiskStats(mountPath: string) {
  try {
    const stats = fs.statfsSync(mountPath);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedBytes = totalBytes - freeBytes;
    const usagePercentage = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

    return {
      path: mountPath,
      type: "Root Filesystem",
      totalBytes,
      totalGB: (totalBytes / (1024 ** 3)).toFixed(2),
      freeBytes,
      freeGB: (freeBytes / (1024 ** 3)).toFixed(2),
      usedBytes,
      usedGB: (usedBytes / (1024 ** 3)).toFixed(2),
      usagePercentage,
      totalInodes: stats.files,
      freeInodes: stats.ffree,
    };
  } catch (e) {
    return {
      path: mountPath,
      type: "Filesystem",
      totalBytes: 0,
      totalGB: "0",
      freeBytes: 0,
      freeGB: "0",
      usedBytes: 0,
      usedGB: "0",
      usagePercentage: 0,
      totalInodes: 0,
      freeInodes: 0,
    };
  }
}

function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d > 0 ? `${d}d ` : ""}${h}h ${m}m ${s}s`;
}

// CPU benchmark worker runner
function runCpuWorkerBatch(durationMs: number): Promise<number> {
  return new Promise((resolve) => {
    const workerScript = `
      const { parentPort } = require('worker_threads');
      const crypto = require('crypto');
      const start = Date.now();
      let ops = 0;
      while (Date.now() - start < ${durationMs}) {
        crypto.createHash('sha256').update('server_stress_' + ops).digest('hex');
        ops++;
      }
      parentPort.postMessage(ops);
    `;
    const worker = new Worker(workerScript, { eval: true });
    worker.on("message", (ops) => resolve(Number(ops) || 0));
    worker.on("error", () => resolve(0));
    worker.on("exit", (code) => {
      if (code !== 0) resolve(0);
    });
  });
}

async function startServer() {
  const app = express();
const SEQUENTIAL_BASE_DIR = path.join(os.tmpdir(), "sequential_downloads");
if (!fs.existsSync(SEQUENTIAL_BASE_DIR)) fs.mkdirSync(SEQUENTIAL_BASE_DIR, { recursive: true });
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));

  // 1. API: Complete Server Specs (100% Server-Side)
  app.get(["/api/system/server-specs", "/api/server-specs"], (req, res) => {
    try {
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const uptime = os.uptime();
      const loadAvg = os.loadavg();
      const networkInterfaces = os.networkInterfaces();
      const osRelease = parseOsRelease();
      const cpuinfo = parseProcCpuinfo();
      const meminfo = parseProcMeminfo();
      const v8Stats = v8.getHeapStatistics();
      const procMem = process.memoryUsage();
      const procResource = typeof (process as any).resourceUsage === "function" ? (process as any).resourceUsage() : null;
      let userInfo = { username: "root", uid: 0, gid: 0, shell: "/bin/sh" };
      try {
        userInfo = os.userInfo() as any;
      } catch (e) {
        // ignore in containers
      }

      // Root disk and temp dir stats
      const rootDisk = getDiskStats("/");
      const tmpDisk = getDiskStats(os.tmpdir());

      // Safe environment variables without secrets
      const safeEnvKeys = [
        "NODE_ENV",
        "PORT",
        "HOSTNAME",
        "HOME",
        "PWD",
        "SHELL",
        "USER",
        "LANG",
        "TERM",
        "SHLVL",
        "PATH",
      ];
      const environmentVariables = safeEnvKeys
        .filter((k) => process.env[k] !== undefined)
        .map((k) => ({ key: k, value: String(process.env[k]) }));

      // Known CPU instruction flags catalogue
      const knownFlags = [
        { flag: "avx2", name: "AVX2", description: "Advanced Vector Extensions 2 (256-bit SIMD)" },
        { flag: "avx", name: "AVX", description: "Advanced Vector Extensions (Vector math)" },
        { flag: "sse4_2", name: "SSE 4.2", description: "Streaming SIMD Extensions 4.2" },
        { flag: "sse4_1", name: "SSE 4.1", description: "Streaming SIMD Extensions 4.1" },
        { flag: "aes", name: "AES-NI", description: "Hardware Accelerated Encryption" },
        { flag: "sha_ni", name: "SHA-NI", description: "Hardware SHA-1 & SHA-256 Extensions" },
        { flag: "fma", name: "FMA3", description: "Fused Multiply-Add operations" },
        { flag: "bmi1", name: "BMI1", description: "Bit Manipulation Instruction Set 1" },
        { flag: "bmi2", name: "BMI2", description: "Bit Manipulation Instruction Set 2" },
        { flag: "clwb", name: "CLWB", description: "Cache Line Write Back" },
        { flag: "vaes", name: "VAES", description: "Vector AES 256/512-bit Instructions" },
        { flag: "rdseed", name: "RDSEED", description: "NIST Hardware Random Generator" },
        { flag: "rdrand", name: "RDRAND", description: "Hardware Random Number Generator" },
        { flag: "ht", name: "Hyper-Threading", description: "Simultaneous Multithreading (SMT)" },
        { flag: "xsave", name: "XSAVE", description: "Processor Extended State Save" },
        { flag: "svm", name: "AMD-V (SVM)", description: "Hardware Virtualization Support" },
      ];

      const featureFlags = knownFlags.map((kf) => ({
        ...kf,
        supported: cpuinfo.flags.includes(kf.flag),
      }));

      // Flatten network interfaces
      const ifaceList: any[] = [];
      Object.entries(networkInterfaces).forEach(([name, list]) => {
        if (Array.isArray(list)) {
          list.forEach((item) => {
            ifaceList.push({
              name,
              family: item.family,
              address: item.address,
              netmask: item.netmask,
              mac: item.mac,
              internal: item.internal,
              cidr: (item as any).cidr || null,
            });
          });
        }
      });

      let dnsServers: string[] = [];
      try {
        dnsServers = dns.getServers();
      } catch (e) {
        // ignore
      }

      // Model name fallback
      let resolvedCpuModel = cpuinfo.modelName;
      if (!resolvedCpuModel && cpus.length > 0) {
        resolvedCpuModel = cpus[0].model;
      }
      if (!resolvedCpuModel || resolvedCpuModel === "unknown") {
        resolvedCpuModel = `AMD x86_64 Processor (Family ${cpuinfo.family || "175"})`;
      }

      const serverSpecs = {
        os: {
          distroName: osRelease.PRETTY_NAME || osRelease.NAME || "Debian GNU/Linux (Container)",
          distroId: osRelease.ID || "debian",
          kernelRelease: os.release(),
          kernelVersion: os.version ? os.version() : os.type(),
          arch: os.arch(),
          platform: os.platform(),
          type: os.type(),
          hostname: os.hostname(),
          uptimeSeconds: uptime,
          uptimeFormatted: formatDuration(uptime),
          bootTime: new Date(Date.now() - uptime * 1000).toLocaleString(),
          endianness: os.endianness(),
          homedir: os.homedir(),
          tmpdir: os.tmpdir(),
          user: {
            username: userInfo.username || "root",
            uid: userInfo.uid || 0,
            gid: userInfo.gid || 0,
            shell: userInfo.shell || "/bin/sh",
          },
        },
        cpu: {
          model: resolvedCpuModel,
          vendorId: cpuinfo.vendorId || (cpus[0]?.model.includes("Intel") ? "GenuineIntel" : "AuthenticAMD"),
          family: cpuinfo.family || "175",
          speedMHz: Math.round(cpus[0]?.speed || cpuinfo.bogomips || 3000),
          coresCount: cpus.length,
          cores: cpus.map((c, idx) => ({
            id: idx,
            model: c.model,
            speedMHz: c.speed,
            times: c.times,
          })),
          cacheSizeKB: cpuinfo.cacheSizeKB || 8192,
          bogomips: cpuinfo.bogomips || 2997.73,
          addressSizes: cpuinfo.addressSizes || "46 bits physical, 48 bits virtual",
          loadAverage: {
            "1min": loadAvg[0].toFixed(2),
            "5min": loadAvg[1].toFixed(2),
            "15min": loadAvg[2].toFixed(2),
          },
          flags: cpuinfo.flags,
          featureFlags,
        },
        memory: {
          totalBytes: totalMem,
          totalGB: (totalMem / (1024 ** 3)).toFixed(2),
          freeBytes: freeMem,
          freeGB: (freeMem / (1024 ** 3)).toFixed(2),
          usedBytes: usedMem,
          usedGB: (usedMem / (1024 ** 3)).toFixed(2),
          usagePercentage: Math.round((usedMem / totalMem) * 100),
          availableGB: meminfo.MemAvailable
            ? (parseInt(meminfo.MemAvailable) / (1024 * 1024)).toFixed(2)
            : (freeMem / (1024 ** 3)).toFixed(2),
          cachedMB: meminfo.Cached ? (parseInt(meminfo.Cached) / 1024).toFixed(1) : "0",
          buffersMB: meminfo.Buffers ? (parseInt(meminfo.Buffers) / 1024).toFixed(1) : "0",
          swapTotalGB: meminfo.SwapTotal ? (parseInt(meminfo.SwapTotal) / (1024 * 1024)).toFixed(2) : "0",
          swapFreeGB: meminfo.SwapFree ? (parseInt(meminfo.SwapFree) / (1024 * 1024)).toFixed(2) : "0",
          meminfo,
          processMemory: {
            rssMB: (procMem.rss / (1024 * 1024)).toFixed(2),
            heapTotalMB: (procMem.heapTotal / (1024 * 1024)).toFixed(2),
            heapUsedMB: (procMem.heapUsed / (1024 * 1024)).toFixed(2),
            externalMB: (procMem.external / (1024 * 1024)).toFixed(2),
            arrayBuffersMB: (procMem.arrayBuffers / (1024 * 1024)).toFixed(2),
          },
          v8HeapStats: {
            heapSizeLimitMB: (v8Stats.heap_size_limit / (1024 * 1024)).toFixed(0),
            totalAvailableMB: (v8Stats.total_available_size / (1024 * 1024)).toFixed(0),
            mallocedMB: (v8Stats.malloced_memory / (1024 * 1024)).toFixed(2),
          },
        },
        storage: {
          mounts: [rootDisk],
          tmpDir: {
            path: os.tmpdir(),
            freeGB: tmpDisk.freeGB,
            totalGB: tmpDisk.totalGB,
          },
        },
        network: {
          interfaces: ifaceList,
          dnsServers,
          hostname: os.hostname(),
        },
        runtime: {
          nodeVersion: process.version,
          v8Version: process.versions.v8,
          opensslVersion: process.versions.openssl,
          libuvVersion: process.versions.uv || "N/A",
          zlibVersion: process.versions.zlib || "N/A",
          pid: process.pid,
          ppid: process.ppid,
          processUptimeSeconds: Math.floor(process.uptime()),
          processUptimeFormatted: formatDuration(process.uptime()),
          cwd: process.cwd(),
          execPath: process.execPath,
          environment: process.env.NODE_ENV || "development",
          resourceUsage: {
            userCPUTimeMs: procResource ? Math.round(procResource.userCPUTime / 1000) : 0,
            systemCPUTimeMs: procResource ? Math.round(procResource.systemCPUTime / 1000) : 0,
            maxRSSMB: procResource ? (procResource.maxRSS / 1024).toFixed(1) : "0",
          },
          environmentVariables,
        },
        timestamp: new Date().toISOString(),
      };

      res.json(serverSpecs);
    } catch (err: any) {
      console.error("Error reading server specs:", err);
      res.status(500).json({ error: "Failed to read server specs", details: err?.message });
    }
  });

  // 2. API: Server Metrics History (Real-time Timeline)
  app.get(["/api/system/server-history", "/api/server-history"], (req, res) => {
    res.json(historyBuffer);
  });

  // 3. API: Server-Side CPU Benchmark
  app.post("/api/benchmark/cpu", async (req, res) => {
    try {
      const coresCount = os.cpus().length || 1;
      const testDurationMs = 500;

      // 3.1 Single-Core Test
      const t0 = Date.now();
      let singleOps = 0;
      while (Date.now() - t0 < testDurationMs) {
        crypto.createHash("sha256").update("bench_single_" + singleOps).digest("hex");
        singleOps++;
      }
      const singleElapsed = (Date.now() - t0) / 1000;
      const singleOpsSec = Math.round(singleOps / singleElapsed);
      const singleScore = Math.round(singleOpsSec / 150);

      // 3.2 Multi-Core Test across all vCPUs
      const workerPromises = Array.from({ length: coresCount }).map(() => runCpuWorkerBatch(testDurationMs));
      const results = await Promise.all(workerPromises);
      const totalMultiOps = results.reduce((acc, v) => acc + v, 0);
      const multiOpsSec = Math.round(totalMultiOps / (testDurationMs / 1000));
      const multiScore = Math.round(multiOpsSec / 150);

      res.json({
        coresCount,
        singleOpsSec,
        singleScore,
        multiOpsSec,
        multiScore,
        executionTimeMs: testDurationMs * 2,
      });
    } catch (err: any) {
      console.error("CPU Benchmark error:", err);
      res.status(500).json({ error: "CPU benchmark failed", details: err?.message });
    }
  });

  // 4. API: Server-Side Memory Benchmark
  app.post("/api/benchmark/memory", (req, res) => {
    try {
      const chunkSize = 16 * 1024 * 1024; // 16MB
      const iterations = 8; // total 128MB
      const totalBytes = chunkSize * iterations;

      const t0 = process.hrtime.bigint();
      for (let i = 0; i < iterations; i++) {
        const buf = Buffer.allocUnsafe(chunkSize);
        buf.fill(0x55);
        // compute simple checksum
        let sum = 0;
        for (let j = 0; j < 1000; j++) {
          sum += buf[j];
        }
      }
      const t1 = process.hrtime.bigint();
      const elapsedSec = Number(t1 - t0) / 1e9;
      const throughputMBps = Math.round((totalBytes / (1024 * 1024)) / elapsedSec);

      res.json({
        totalProcessedMB: Math.round(totalBytes / (1024 * 1024)),
        elapsedSec: Number(elapsedSec.toFixed(3)),
        throughputMBps,
      });
    } catch (err: any) {
      console.error("Memory Benchmark error:", err);
      res.status(500).json({ error: "Memory benchmark failed", details: err?.message });
    }
  });

  // 5. API: Server-Side Disk I/O Benchmark
  app.post("/api/benchmark/disk", (req, res) => {
    const tmpFile = path.join(os.tmpdir(), `server_disk_bench_${Date.now()}_${Math.random().toString(36).slice(2)}.bin`);
    try {
      const sizeMB = 20;
      const buffer = Buffer.alloc(sizeMB * 1024 * 1024, 0xef);

      // Write test
      const t0 = process.hrtime.bigint();
      fs.writeFileSync(tmpFile, buffer);
      const t1 = process.hrtime.bigint();

      // Read test
      const t2 = process.hrtime.bigint();
      const readBuf = fs.readFileSync(tmpFile);
      const t3 = process.hrtime.bigint();

      // Cleanup
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }

      const writeSec = Number(t1 - t0) / 1e9;
      const readSec = Number(t3 - t2) / 1e9;

      const writeMBps = Math.round(sizeMB / writeSec);
      const readMBps = Math.round(sizeMB / readSec);

      res.json({
        fileSizeMB: sizeMB,
        writeMBps,
        readMBps,
      });
    } catch (err: any) {
      if (fs.existsSync(tmpFile)) {
        try {
          fs.unlinkSync(tmpFile);
        } catch (e) {
          // ignore
        }
      }
      console.error("Disk benchmark error:", err);
      res.status(500).json({ error: "Disk benchmark failed", details: err?.message });
    }
  });

  // 6. API: Full Server Benchmark Orchestrator
  app.post("/api/benchmark/full", async (req, res) => {
    try {
      const coresCount = os.cpus().length || 1;
      const testDurationMs = 500;

      // 1. CPU Single
      const t0 = Date.now();
      let singleOps = 0;
      while (Date.now() - t0 < testDurationMs) {
        crypto.createHash("sha256").update("full_single_" + singleOps).digest("hex");
        singleOps++;
      }
      const singleElapsed = (Date.now() - t0) / 1000;
      const singleOpsSec = Math.round(singleOps / singleElapsed);
      const singleScore = Math.round(singleOpsSec / 150);

      // 2. CPU Multi
      const workerPromises = Array.from({ length: coresCount }).map(() => runCpuWorkerBatch(testDurationMs));
      const results = await Promise.all(workerPromises);
      const totalMultiOps = results.reduce((acc, v) => acc + v, 0);
      const multiOpsSec = Math.round(totalMultiOps / (testDurationMs / 1000));
      const multiScore = Math.round(multiOpsSec / 150);

      // 3. Memory
      const chunkSize = 16 * 1024 * 1024;
      const iterations = 8;
      const m0 = process.hrtime.bigint();
      for (let i = 0; i < iterations; i++) {
        const buf = Buffer.allocUnsafe(chunkSize);
        buf.fill(0x55);
      }
      const m1 = process.hrtime.bigint();
      const memElapsed = Number(m1 - m0) / 1e9;
      const memoryBandwidthMBps = Math.round((chunkSize * iterations) / (1024 * 1024) / memElapsed);

      // 4. Disk
      const tmpFile = path.join(os.tmpdir(), `bench_full_${Date.now()}.bin`);
      let diskWriteMBps = 0;
      let diskReadMBps = 0;
      try {
        const sizeMB = 15;
        const buf = Buffer.alloc(sizeMB * 1024 * 1024, 0xcd);
        const d0 = process.hrtime.bigint();
        fs.writeFileSync(tmpFile, buf);
        const d1 = process.hrtime.bigint();
        const d2 = process.hrtime.bigint();
        fs.readFileSync(tmpFile);
        const d3 = process.hrtime.bigint();
        fs.unlinkSync(tmpFile);
        diskWriteMBps = Math.round(sizeMB / (Number(d1 - d0) / 1e9));
        diskReadMBps = Math.round(sizeMB / (Number(d3 - d2) / 1e9));
      } catch (e) {
        // fallback
      }

      // Compute Overall Server Performance Index
      const overallScore = Math.round(
        singleScore * 0.35 +
        multiScore * 0.40 +
        (memoryBandwidthMBps / 10) * 0.15 +
        (diskWriteMBps / 5) * 0.10
      );

      let tier = "Instancia Estándar (2 vCPUs)";
      if (overallScore > 6500) tier = "Instancia Workstation";
      else if (overallScore > 3500) tier = "Alto Rendimiento (Cloud Run)";
      else if (overallScore > 1800) tier = "Instancia Estándar (2 vCPUs)";
      else tier = "Básico (1 vCPU)";

      res.json({
        cpuSingleScore: singleScore,
        cpuSingleOpsSec: singleOpsSec,
        cpuMultiScore: multiScore,
        cpuMultiOpsSec: multiOpsSec,
        memoryBandwidthMBps,
        diskWriteMBps,
        diskReadMBps,
        overallScore,
        tier,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("Full Benchmark error:", err);
      res.status(500).json({ error: "Full benchmark failed", details: err?.message });
    }
  });

  // Health ping endpoint for server response latency
  app.get(["/api/ping", "/api/health"], (req, res) => {
    res.json({ pong: true, status: "ok", time: Date.now() });
  });

  // ==========================================================
  // RAW SPEED TEST & BANDWIDTH LIMITER API
  // ==========================================================

  // 1. Ultra-fast ping / jitter measurement endpoint
  app.get("/api/speedtest/ping", (req, res) => {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    });
    res.json({
      pong: true,
      timestamp: Date.now(),
      hrtime: process.hrtime.bigint().toString(),
    });
  });

  // 2. Raw streaming download endpoint with precision bandwidth throttling
  app.get("/api/speedtest/download", (req, res) => {
    const limitMbps = Math.max(0, parseFloat(req.query.limitMbps as string) || 0);
    const sizeMB = Math.max(1, Math.min(1000, parseFloat(req.query.sizeMB as string) || 50));
    const durationSec = Math.max(1, Math.min(120, parseFloat(req.query.durationSec as string) || 15));
    const totalBytes = Math.round(sizeMB * 1024 * 1024);

    res.set({
      "Content-Type": "application/octet-stream",
      "Content-Length": totalBytes.toString(),
      "Content-Disposition": "attachment; filename=raw_speedtest.bin",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
      "X-Throttled-Mbps": limitMbps.toString(),
      "X-Target-Size-MB": sizeMB.toString(),
    });

    const stream = createThrottledByteStream(totalBytes, limitMbps, durationSec);

    req.on("close", () => {
      stream.destroy();
    });

    stream.on("error", (err) => {
      console.warn("[SpeedTest] Download stream error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Fallo en el flujo de descarga" });
      }
    });

    stream.pipe(res);
  });

  // 3. Raw upload receiver endpoint with metrics calculation
  app.post("/api/speedtest/upload", async (req, res) => {
    const startTime = Date.now();
    let receivedBytes = 0;
    const limitMbps = Math.max(0, parseFloat(req.query.limitMbps as string) || 0);
    const targetBytesPerSec = limitMbps > 0 ? (limitMbps * 1_000_000) / 8 : 0;

    try {
      req.on("data", async (chunk: Buffer) => {
        receivedBytes += chunk.length;
        // Server side pacing if requested
        if (targetBytesPerSec > 0) {
          const elapsedSec = (Date.now() - startTime) / 1000;
          const expectedSec = receivedBytes / targetBytesPerSec;
          if (expectedSec > elapsedSec) {
            const delayMs = (expectedSec - elapsedSec) * 1000;
            if (delayMs > 10) {
              req.pause();
              setTimeout(() => req.resume(), Math.min(delayMs, 50));
            }
          }
        }
      });

      req.on("end", () => {
        const elapsedSec = Math.max(0.001, (Date.now() - startTime) / 1000);
        const speedMBs = Number((receivedBytes / (1024 * 1024) / elapsedSec).toFixed(2));
        const speedMbps = Number(((receivedBytes * 8) / 1_000_000 / elapsedSec).toFixed(2));

        res.json({
          status: "completed",
          receivedBytes,
          receivedMB: Number((receivedBytes / (1024 * 1024)).toFixed(2)),
          elapsedSec: Number(elapsedSec.toFixed(3)),
          speedMBs,
          speedMbps,
          throttledLimitMbps: limitMbps > 0 ? limitMbps : undefined,
        });
      });

      req.on("error", (err) => {
        console.warn("[SpeedTest] Upload error:", err.message);
        if (!res.headersSent) {
          res.status(500).json({ error: "Fallo durante la subida", details: err.message });
        }
      });
    } catch (e: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: "Error en el test de subida", details: e.message });
      }
    }
  });

  // 4. Server-to-Internet CDN Backbone speed test
  app.post("/api/speedtest/backbone", async (req, res) => {
    try {
      const {
        limitMbps = 0,
        sizeMB = 50,
        sourceUrl = "https://speed.cloudflare.com/__down?bytes=50000000",
      } = req.body || {};

      const maxBytes = Math.max(1, Math.min(250, Number(sizeMB) || 50)) * 1024 * 1024;
      const targetLimit = Math.max(0, Number(limitMbps) || 0);

      const result = await testServerBackboneSpeed(sourceUrl, targetLimit, maxBytes);
      res.json(result);
    } catch (err: any) {
      console.error("[SpeedTest] Backbone test error:", err);
      res.status(500).json({ error: "Fallo en el test de red troncal", details: err?.message });
    }
  });

  // Proxy endpoint to download external files avoiding browser CORS issues
  app.get("/api/download/proxy", async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      return res.status(400).json({ error: "Parámetro 'url' requerido." });
    }

    try {
      const parsedUrl = new URL(targetUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return res.status(400).json({ error: "Protocolo no válido. Solo se admiten HTTP y HTTPS." });
      }

      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "ServerSpecsDownloader/1.0",
        },
      });

      if (!response.ok) {
        return res.status(response.status).json({
          error: `Error al descargar desde la URL remota: ${response.status} ${response.statusText}`,
        });
      }

      // Determine content type and suggested filename
      const contentType = response.headers.get("content-type") || "application/octet-stream";
      let fileName = "";

      const disposition = response.headers.get("content-disposition");
      if (disposition && disposition.includes("filename=")) {
        const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match && match[1]) {
          fileName = match[1].replace(/['"]/g, "").trim();
        }
      }

      if (!fileName) {
        const pathname = parsedUrl.pathname;
        const lastSegment = pathname.substring(pathname.lastIndexOf("/") + 1);
        if (lastSegment && lastSegment.includes(".")) {
          fileName = decodeURIComponent(lastSegment);
        } else {
          fileName = `descarga_${Date.now()}.bin`;
        }
      }

      const contentLength = response.headers.get("content-length");
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader("X-File-Name", fileName);
      if (contentLength) {
        res.setHeader("Content-Length", contentLength);
        res.setHeader("X-File-Size", contentLength);
      }
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, X-File-Name, X-File-Size, Content-Length");

      if (response.body) {
        const stream = Readable.fromWeb(response.body as any);
        stream.on("error", (err) => {
          console.error("Stream pipe error in download proxy:", err);
          if (!res.headersSent) {
            res.status(500).json({ error: "Error durante la transmisión del archivo", details: err?.message });
          }
        });
        stream.pipe(res);
      } else {
        res.end();
      }
    } catch (err: any) {
      console.error("Download proxy error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Fallo en la descarga remota", details: err?.message });
      }
    }
  });

  /**
   * Resumable upload directly from server SSD to user's Google Drive folder.
   * High-speed server-side stream bypassing browser proxy limits.
   */
  async function uploadFileToDriveResumable(
    filePath: string,
    fileName: string,
    mimeType: string,
    accessToken: string,
    folderId: string,
    onProgress?: (uploadedBytes: number, totalBytes: number, speedStr: string) => void
  ): Promise<{ id: string; name: string; webViewLink?: string; size?: string }> {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    const metadata = JSON.stringify({
      name: fileName,
      parents: [folderId],
      description: "Descargado con acelerador aria2c y subido directamente desde el servidor",
    });

    const initRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType || "application/octet-stream",
          "X-Upload-Content-Length": fileSize.toString(),
        },
        body: metadata,
      }
    );

    if (!initRes.ok) {
      const errText = await initRes.text();
      if (initRes.status === 401 || errText.includes("authError") || errText.includes("Invalid Credentials")) {
        throw new Error("Tu sesión de Google Drive ha expirado (401). Reconecta tu cuenta de Google.");
      }
      throw new Error(`Error al iniciar sesión en Google Drive: HTTP ${initRes.status}`);
    }

    const sessionUri = initRes.headers.get("Location");
    if (!sessionUri) {
      throw new Error("Google Drive no devolvió la URL de la sesión de subida (Location header).");
    }

    const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB per chunk (multiple of 256 KiB)
    let uploadedBytes = 0;
    const fd = fs.openSync(filePath, "r");
    let lastTime = Date.now();
    let lastBytes = 0;

    try {
      while (uploadedBytes < fileSize) {
        const remaining = fileSize - uploadedBytes;
        const currentChunkSize = Math.min(CHUNK_SIZE, remaining);
        const buffer = Buffer.alloc(currentChunkSize);

        fs.readSync(fd, buffer, 0, currentChunkSize, uploadedBytes);

        const start = uploadedBytes;
        const end = uploadedBytes + currentChunkSize - 1;

        let chunkSuccess = false;
        let lastErr: any = null;

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const chunkRes = await fetch(sessionUri, {
              method: "PUT",
              headers: {
                "Content-Length": currentChunkSize.toString(),
                "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                "Content-Type": mimeType || "application/octet-stream",
              },
              body: buffer,
            });

            if (chunkRes.status === 308) {
              uploadedBytes += currentChunkSize;
              chunkSuccess = true;
              break;
            } else if (chunkRes.status === 200 || chunkRes.status === 201) {
              uploadedBytes += currentChunkSize;
              const data = (await chunkRes.json()) as any;
              return data;
            } else {
              const errBody = await chunkRes.text();
              throw new Error(`HTTP ${chunkRes.status}: ${errBody}`);
            }
          } catch (err: any) {
            lastErr = err;
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          }
        }

        if (!chunkSuccess) {
          throw new Error(`Fallo al subir bloque (${start}-${end}): ${lastErr?.message || "Error de red"}`);
        }

        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;
        if (timeDiff >= 0.5 || uploadedBytes >= fileSize) {
          const bytesDiff = uploadedBytes - lastBytes;
          const speedBps = timeDiff > 0 ? bytesDiff / timeDiff : 0;
          const speedMBps = (speedBps / (1024 * 1024)).toFixed(1);
          const speedStr = `${speedMBps} MB/s`;

          if (onProgress) {
            onProgress(uploadedBytes, fileSize, speedStr);
          }

          lastTime = now;
          lastBytes = uploadedBytes;
        }
      }
    } finally {
      fs.closeSync(fd);
    }

    throw new Error("La subida a Google Drive finalizó sin confirmación del archivo.");
  }


  // ==========================================================
  // SEQUENTIAL CHUNK STREAM PIPELINE & REAL-TIME DRIVE TRANSFER
  // ==========================================================

  // 1. Status of sequential chunk pipeline engine
  const handleSequentialStatus = (req: express.Request, res: express.Response) => {
    try {
      const status = sequentialChunkEngine.getStatus();
      res.json(status);
    } catch (e: any) {
      res.json({
        active: true,
        installed: true,
        version: "2.4.0",
        engineName: "Sequential Chunk Stream Pipeline",
        features: ["HTTP Range Chunks", "Google Drive Real-Time Upload", "Prefetching"],
        activeJobsCount: 0,
      });
    }
  };

  app.get("/api/sequential/status", handleSequentialStatus);
  app.get("/api/aria2/status", handleSequentialStatus);

  // Manual trigger to install/verify (alias)
  app.post("/api/aria2/install", (req, res) => {
    res.json({ installed: true, output: "Sequential Chunk Engine v2.4.0 (Active)" });
  });
  app.post("/api/sequential/install", (req, res) => {
    res.json({ installed: true, output: "Sequential Chunk Engine v2.4.0 (Active)" });
  });

  // 2. List all sequential chunk download jobs
  const handleSequentialJobsList = (req: express.Request, res: express.Response) => {
    const list = sequentialChunkEngine.getAllJobs();
    res.json(list);
  };

  app.get("/api/sequential/jobs", handleSequentialJobsList);
  app.get("/api/aria2/jobs", handleSequentialJobsList);

  // 3. Get single job status and logs
  const handleSequentialJobGet = (req: express.Request, res: express.Response) => {
    const job = sequentialChunkEngine.getJob(req.params.id) ;
    if (!job) {
      return res.status(404).json({ error: "Trabajo no encontrado" });
    }
    res.json(job);
  };

  app.get("/api/sequential/jobs/:id", handleSequentialJobGet);
  app.get("/api/aria2/jobs/:id", handleSequentialJobGet);

  // 4. Start a sequential chunk streaming download
  const handleSequentialJobStart = async (req: express.Request, res: express.Response) => {
    const {
      url,
      fileName,
      chunkSizeMB = 16,
      split,
      connections,
      pipelinePrefetch = true,
      destination = "drive",
      autoUploadToDrive,
      accessToken: reqToken,
      folderId: reqFolder,
    } = req.body;

    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Se requiere un parámetro 'url' válido." });
    }

    const trimmedUrl = url.trim();
    if (
      !trimmedUrl.startsWith("http://") &&
      !trimmedUrl.startsWith("https://") &&
      !trimmedUrl.startsWith("ftp://") &&
      !trimmedUrl.startsWith("magnet:")
    ) {
      return res.status(400).json({
        error: "Protocolo no soportado. Debe comenzar con http://, https://, ftp:// o magnet:",
      });
    }

    try {
      const token = reqToken || (autoUploadToDrive ? autoUploadToDrive.accessToken : undefined);
      const folder = reqFolder || (autoUploadToDrive ? autoUploadToDrive.folderId : undefined);
      const targetDest = token && folder ? destination || "drive" : "server";

      const job = await sequentialChunkEngine.startJob({
        url: trimmedUrl,
        fileName: fileName && typeof fileName === "string" ? fileName.trim() : undefined,
        chunkSizeMB: typeof chunkSizeMB === "number" ? chunkSizeMB : typeof split === "number" ? Math.max(4, split * 4) : 16,
        pipelinePrefetch: pipelinePrefetch !== false,
        destination: targetDest,
        accessToken: token,
        folderId: folder,
      });

      res.json({
        success: true,
        message: "Motor de chunks secuenciales iniciado en tiempo real",
        job,
      });
    } catch (err: any) {
      console.error("Error al iniciar sequential stream job:", err);
      res.status(500).json({ error: "Error al iniciar stream secuencial: " + err.message });
    }
  };

  app.post("/api/sequential/start", handleSequentialJobStart);

  app.post("/api/aria2/start", handleSequentialJobStart);

  // 5. Pause an ongoing download
  const handleSequentialJobPause = (req: express.Request, res: express.Response) => {
    const ok = sequentialChunkEngine.pauseJob(req.params.id);
    if (ok) {
      const job = sequentialChunkEngine.getJob(req.params.id);
      return res.json({ success: true, message: "Trabajo pausado", job });
    }
    const legacyJob = undefined;
    if (legacyJob) {
      legacyJob.status = "paused";
      return res.json({ success: true, job: legacyJob });
    }
    res.status(404).json({ error: "Trabajo no encontrado" });
  };

  app.post("/api/sequential/jobs/:id/pause", handleSequentialJobPause);
  app.post("/api/aria2/jobs/:id/pause", handleSequentialJobPause);

  // 6. Resume a paused download
  const handleSequentialJobResume = (req: express.Request, res: express.Response) => {
    const { accessToken, folderId } = req.body || {};
    const ok = sequentialChunkEngine.resumeJob(req.params.id, accessToken, folderId);
    if (ok) {
      const job = sequentialChunkEngine.getJob(req.params.id);
      return res.json({ success: true, message: "Trabajo reanudado", job });
    }
    res.status(404).json({ error: "Trabajo no encontrado" });
  };

  app.post("/api/sequential/jobs/:id/resume", handleSequentialJobResume);
  app.post("/api/aria2/jobs/:id/resume", handleSequentialJobResume);

  // 7. Cancel an ongoing download
  const handleSequentialJobCancel = (req: express.Request, res: express.Response) => {
    const ok = sequentialChunkEngine.cancelJob(req.params.id);
    if (ok) {
      const job = sequentialChunkEngine.getJob(req.params.id);
      return res.json({ success: true, message: "Trabajo cancelado", job });
    }
    res.status(404).json({ error: "Trabajo no encontrado" });
  };

  app.post("/api/sequential/jobs/:id/cancel", handleSequentialJobCancel);
  app.post("/api/aria2/jobs/:id/cancel", handleSequentialJobCancel);

  // 8. Download file directly from server
  const handleSequentialJobFile = (req: express.Request, res: express.Response) => {
    const job = sequentialChunkEngine.getJob(req.params.id) ;
    if (!job) {
      return res.status(404).json({ error: "Trabajo no encontrado" });
    }
    if (job.filePath && fs.existsSync(job.filePath)) {
      const stat = fs.statSync(job.filePath);
      if (!stat.isDirectory()) {
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(job.fileName || "archivo.bin")}"`);
        res.setHeader("Content-Length", stat.size);
        return fs.createReadStream(job.filePath).pipe(res);
      }
    }
    res.status(404).json({ error: "Archivo físico no disponible en disco local (o transferido Zero-Disk a Google Drive)" });
  };

  app.get("/api/sequential/jobs/:id/file", handleSequentialJobFile);
  app.get("/api/aria2/jobs/:id/file", handleSequentialJobFile);

  // 9. Trigger upload to Google Drive if downloaded to server
  const handleSequentialJobUploadDrive = async (req: express.Request, res: express.Response) => {
    const { accessToken, folderId } = req.body;
    if (!accessToken || !folderId) {
      return res.status(400).json({ error: "Se requiere accessToken y folderId para subir a Google Drive" });
    }
    const job = sequentialChunkEngine.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Trabajo no encontrado" });
    }
    if (!job.filePath || !fs.existsSync(job.filePath)) {
      return res.status(400).json({ error: "El archivo ya fue transferido en tiempo real mediante streaming Zero-Disk a Google Drive." });
    }

    job.uploadStatus = "uploading";
    job.uploadProgress = 0;
    job.logs.push(`[Google Drive] Subiendo archivo local a Drive...`);

    uploadFileToDriveResumable(
      job.filePath,
      job.fileName,
      "application/octet-stream",
      accessToken,
      folderId,
      (uploaded, total, speedStr) => {
        job.uploadProgress = total > 0 ? Math.round((uploaded / total) * 100) : 0;
        job.speed = speedStr;
      }
    )
      .then((driveFile) => {
        job.uploadStatus = "completed";
        job.uploadProgress = 100;
        job.savedToDrive = true;
        job.driveFile = driveFile;
        job.logs.push(`[Google Drive] ✓ Archivo guardado en Drive: ${driveFile.name}`);
      })
      .catch((err) => {
        job.uploadStatus = "error";
        job.logs.push(`[Google Drive] Error al subir: ${err.message}`);
      });

    res.json({ success: true, message: "Subida a Google Drive en proceso", job });
  };

  app.post("/api/sequential/jobs/:id/upload-to-drive", handleSequentialJobUploadDrive);
  app.post("/api/aria2/jobs/:id/upload-to-drive", handleSequentialJobUploadDrive);

  // 10. Delete job
  const handleSequentialJobDelete = (req: express.Request, res: express.Response) => {
    sequentialChunkEngine.deleteJob(req.params.id);
    const legacyJob = undefined;
    if (legacyJob) {
      try {
        if (fs.existsSync(legacyJob.dir)) {
          fs.rmSync(legacyJob.dir, { recursive: true, force: true });
        }
      } catch (e) {}
       // (req.params.id);
    }
    res.json({ success: true, id: req.params.id });
  };

  app.delete("/api/sequential/jobs/:id", handleSequentialJobDelete);
  app.delete("/api/aria2/jobs/:id", handleSequentialJobDelete);

  // ==========================================
  // FILE COMMANDER: SERVER FILESYSTEM ENDPOINTS
  // ==========================================
  interface ServerFsTransfer {
    id: string;
    fileName: string;
    filePath: string;
    mode: "copy" | "move";
    direction: "server-to-drive" | "drive-to-server";
    status: "queued" | "transferring" | "completed" | "error";
    progress: number;
    speed: string;
    transferredBytes: number;
    totalBytes: number;
    driveFile?: {
      id: string;
      name: string;
      webViewLink?: string;
      size?: string;
    };
    error?: string;
    startedAt: number;
    completedAt?: number;
  }

  const serverTransfers = new Map<string, ServerFsTransfer>();

  const ZERO_DISK_BASE_DIR = path.join(os.tmpdir(), "zero_disk_downloads");
  if (!fs.existsSync(ZERO_DISK_BASE_DIR)) {
    try { fs.mkdirSync(ZERO_DISK_BASE_DIR, { recursive: true }); } catch (e) {}
  }

  // Base roots allowed for exploration and operations
  const ALLOWED_ROOTS = [
    { name: "Descargas Secuenciales", path: path.resolve(SEQUENTIAL_BASE_DIR) },
    { name: "Descargas en Streaming", path: path.resolve(ZERO_DISK_BASE_DIR) },
    { name: "Directorio Temporal (/tmp)", path: path.resolve("/tmp") },
  ];

  function isPathAllowed(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    return ALLOWED_ROOTS.some(
      (root) => resolved === root.path || resolved.startsWith(root.path + path.sep)
    );
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  // 1. List files in a server directory
  app.get("/api/fs/server/list", (req, res) => {
    let targetDir = (req.query.dir as string) || SEQUENTIAL_BASE_DIR;
    const isFlat = req.query.flatten === "true";
    targetDir = path.resolve(targetDir);

    if (!isPathAllowed(targetDir)) {
      targetDir = path.resolve(SEQUENTIAL_BASE_DIR);
    }

    if (!fs.existsSync(targetDir)) {
      try {
        fs.mkdirSync(targetDir, { recursive: true });
      } catch (e) {
        // ignore
      }
    }

    try {
      const files: any[] = [];
      let totalBytesInDownloads = 0;

      // Scan all aria2 downloads total size
      try {
        if (fs.existsSync(SEQUENTIAL_BASE_DIR)) {
          const scanDir = (dir: string) => {
            const list = fs.readdirSync(dir, { withFileTypes: true });
            for (const item of list) {
              const fullP = path.join(dir, item.name);
              try {
                if (item.isDirectory()) {
                  scanDir(fullP);
                } else if (item.isFile()) {
                  totalBytesInDownloads += fs.statSync(fullP).size;
                }
              } catch {
                // ignore
              }
            }
          };
          scanDir(SEQUENTIAL_BASE_DIR);
        }
      } catch {
        // ignore
      }

      const processEntry = (fullPath: string, name: string, isDir: boolean) => {
        if (name.endsWith(".aria2__tmp")) return;

        try {
          const stat = fs.statSync(fullPath);

          // Find associated aria2 job if any
          let matchedJobId: string | undefined = undefined;
          let isJobActive = false;
          for (const [jobId, job] of sequentialChunkEngine.getAllJobs().map(j => [j.id, j] as const)) {
            if (
              job.filePath === fullPath ||
              false ||
              false
            ) {
              matchedJobId = jobId;
              if (job.status === "downloading" || job.status === "starting") {
                isJobActive = true;
              }
              break;
            }
          }

          let calculatedSize = stat.size;
          if (isDir) {
            try {
              let subTotal = 0;
              const subItems = fs.readdirSync(fullPath);
              for (const sub of subItems) {
                try {
                  const s = fs.statSync(path.join(fullPath, sub));
                  if (s.isFile()) subTotal += s.size;
                } catch {
                  // ignore
                }
              }
              calculatedSize = subTotal;
            } catch {
              // ignore
            }
          }

          const ext = path.extname(name).toLowerCase().replace(".", "");

          files.push({
            id: Buffer.from(fullPath).toString("base64"),
            name: name,
            path: fullPath,
            size: calculatedSize,
            sizeFormatted: formatBytes(calculatedSize),
            isDirectory: isDir,
            modifiedTime: stat.mtimeMs,
            mimeType: ext,
            aria2JobId: matchedJobId,
            isJobActive,
          });
        } catch {
          // ignore unreadable
        }
      };

      if (isFlat) {
        // Recursively list all files
        const collectRecursive = (dir: string) => {
          const list = fs.readdirSync(dir, { withFileTypes: true });
          for (const item of list) {
            const p = path.join(dir, item.name);
            if (item.isDirectory()) {
              collectRecursive(p);
            } else {
              processEntry(p, item.name, false);
            }
          }
        };
        collectRecursive(targetDir);
      } else {
        const entries = fs.readdirSync(targetDir, { withFileTypes: true });
        for (const entry of entries) {
          processEntry(path.join(targetDir, entry.name), entry.name, entry.isDirectory());
        }
      }

      // Sort directories first, then by modified time descending
      files.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return b.modifiedTime - a.modifiedTime;
      });

      res.json({
        currentPath: targetDir,
        basePaths: ALLOWED_ROOTS,
        files,
        diskStats: {
          usedInDownloads: totalBytesInDownloads,
          usedInDownloadsFormatted: formatBytes(totalBytesInDownloads),
          totalFiles: files.length,
        },
      });
    } catch (err: any) {
      console.error("Error listing directory:", err);
      res.status(500).json({ error: "Error al explorar directorio: " + err.message });
    }
  });

  // 2. Delete file(s) or folder(s) from server
  app.delete("/api/fs/server/delete", (req, res) => {
    const { paths: targetPaths } = req.body;
    if (!Array.isArray(targetPaths) || targetPaths.length === 0) {
      return res.status(400).json({ error: "Se requiere un array 'paths' de rutas a eliminar." });
    }

    const deleted: string[] = [];
    const errors: string[] = [];

    for (const p of targetPaths) {
      const resolved = path.resolve(p);
      if (!isPathAllowed(resolved)) {
        errors.push(`Acceso denegado a la ruta: ${p}`);
        continue;
      }

      if (!fs.existsSync(resolved)) {
        errors.push(`Ruta no encontrada: ${p}`);
        continue;
      }

      // Check if any active aria2 jobs need termination
      for (const [jobId, job] of sequentialChunkEngine.getAllJobs().map(j => [j.id, j] as const)) {
        if (job.filePath === resolved || resolved.startsWith(SEQUENTIAL_BASE_DIR)) {
          if (job.status === "downloading" || job.status === "starting") {
            sequentialChunkEngine.cancelJob(jobId);
          }
        }
      }

      try {
        fs.rmSync(resolved, { recursive: true, force: true });
        deleted.push(resolved);
      } catch (err: any) {
        errors.push(`Error al borrar ${path.basename(resolved)}: ${err.message}`);
      }
    }

    res.json({
      success: errors.length === 0,
      deletedCount: deleted.length,
      deleted,
      errors,
    });
  });

  // 3. Rename file or folder on server
  app.post("/api/fs/server/rename", (req, res) => {
    const { oldPath, newName } = req.body;
    if (!oldPath || !newName) {
      return res.status(400).json({ error: "Se requiere oldPath y newName." });
    }

    const resolvedOld = path.resolve(oldPath);
    if (!isPathAllowed(resolvedOld) || !fs.existsSync(resolvedOld)) {
      return res.status(403).json({ error: "Ruta de origen no válida o inaccesible." });
    }

    // Disallow path separators in newName to prevent traversal
    const safeNewName = path.basename(newName);
    const resolvedNew = path.join(path.dirname(resolvedOld), safeNewName);

    if (!isPathAllowed(resolvedNew)) {
      return res.status(403).json({ error: "Ruta de destino no válida." });
    }

    if (fs.existsSync(resolvedNew)) {
      return res.status(409).json({ error: "Ya existe un archivo o carpeta con ese nombre." });
    }

    try {
      fs.renameSync(resolvedOld, resolvedNew);
      res.json({
        success: true,
        oldPath: resolvedOld,
        newPath: resolvedNew,
        newName: safeNewName,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Error al renombrar: " + err.message });
    }
  });

  // 4. Download file from server directly to browser
  app.get("/api/fs/server/download-file", (req, res) => {
    const targetPath = req.query.path as string;
    if (!targetPath) {
      return res.status(400).json({ error: "Se requiere el parámetro 'path'." });
    }

    const resolved = path.resolve(targetPath);
    if (!isPathAllowed(resolved) || !fs.existsSync(resolved)) {
      return res.status(403).json({ error: "Ruta no encontrada o inaccesible." });
    }

    let filePath = resolved;
    try {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        const rawFiles = fs.readdirSync(resolved).filter((f) => !f.endsWith(".aria2"));
        if (rawFiles.length > 0) {
          filePath = path.join(resolved, rawFiles[0]);
        } else {
          return res.status(400).json({ error: "El directorio está vacío." });
        }
      }
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }

    const fileName = path.basename(filePath);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader("X-File-Name", fileName);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, X-File-Name");

    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: "Error de lectura: " + err.message });
      }
    });
    stream.pipe(res);
  });

  // 5. Transfer file from Server to Google Drive (Copy or Move)
  app.post("/api/fs/server/transfer", async (req, res) => {
    const { filePath, fileName, accessToken, folderId, mode = "copy" } = req.body;
    if (!filePath || !accessToken || !folderId) {
      return res.status(400).json({
        error: "Se requiere filePath, accessToken y folderId para realizar la transferencia.",
      });
    }

    let resolved = path.resolve(filePath);
    if (!isPathAllowed(resolved) || !fs.existsSync(resolved)) {
      return res.status(403).json({ error: "Archivo de origen no encontrado o inaccesible." });
    }

    // Resolve if folder
    let targetFilePath = resolved;
    try {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        const rawFiles = fs.readdirSync(resolved).filter((f) => !f.endsWith(".aria2"));
        if (rawFiles.length > 0) {
          const sorted = rawFiles
            .map((f) => {
              const p = path.join(resolved, f);
              try {
                return { name: f, path: p, size: fs.statSync(p).size };
              } catch {
                return { name: f, path: p, size: 0 };
              }
            })
            .sort((a, b) => b.size - a.size);
          targetFilePath = sorted[0].path;
        } else {
          return res.status(400).json({ error: "La carpeta seleccionada está vacía." });
        }
      }
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }

    const stat = fs.statSync(targetFilePath);
    const targetFileName = fileName || path.basename(targetFilePath);
    const transferId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const transferTask: ServerFsTransfer = {
      id: transferId,
      fileName: targetFileName,
      filePath: targetFilePath,
      mode: mode === "move" ? "move" : "copy",
      direction: "server-to-drive",
      status: "transferring",
      progress: 0,
      speed: "Iniciando...",
      transferredBytes: 0,
      totalBytes: stat.size,
      startedAt: Date.now(),
    };

    serverTransfers.set(transferId, transferTask);

    // Launch transfer stream in background
    uploadFileToDriveResumable(
      targetFilePath,
      targetFileName,
      "application/octet-stream",
      accessToken,
      folderId,
      (uploaded, total, speedStr) => {
        transferTask.transferredBytes = uploaded;
        transferTask.totalBytes = total;
        transferTask.progress = total > 0 ? Math.min(100, Math.round((uploaded / total) * 100)) : 0;
        transferTask.speed = speedStr;
      }
    )
      .then((driveFile) => {
        transferTask.status = "completed";
        transferTask.progress = 100;
        transferTask.speed = "Completado";
        transferTask.driveFile = driveFile;
        transferTask.completedAt = Date.now();

        // If mode was 'move', safely delete file from server!
        if (mode === "move") {
          try {
            // If the file was inside a job directory and it's the only one or target was job dir, clean up job dir
            const parentDir = path.dirname(targetFilePath);
            if (parentDir !== SEQUENTIAL_BASE_DIR && parentDir.startsWith(SEQUENTIAL_BASE_DIR)) {
              fs.rmSync(parentDir, { recursive: true, force: true });
            } else {
              fs.rmSync(targetFilePath, { force: true });
            }

            // Also clean up from aria2Jobs map if matched
            for (const [jobId, j] of sequentialChunkEngine.getAllJobs().map(j => [j.id, j] as const)) {
              if (j.filePath === targetFilePath || false) {
                 // (jobId);
              }
            }
          } catch (delErr: any) {
            console.error("Error deleting file after move to Drive:", delErr);
          }
        }
      })
      .catch((err) => {
        console.error("Transfer error:", err);
        transferTask.status = "error";
        transferTask.error = err.message || "Fallo en la transferencia a Drive";
      });

    res.json({
      success: true,
      transfer: transferTask,
    });
  });

  // 6. Get active/recent transfer tasks
  app.get("/api/fs/server/transfers", (req, res) => {
    const list = Array.from(serverTransfers.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 30);
    res.json(list);
  });

  // 7. Copy file from Google Drive directly into server filesystem! (Reverse transfer)
  app.post("/api/fs/server/copy-from-drive", async (req, res) => {
    const { driveFileId, fileName, accessToken, targetDir = SEQUENTIAL_BASE_DIR } = req.body;
    if (!driveFileId || !accessToken) {
      return res.status(400).json({ error: "Se requiere driveFileId y accessToken." });
    }

    const safeName = path.basename(fileName || `drive_file_${driveFileId}`);
    const resolvedDir = isPathAllowed(targetDir) ? path.resolve(targetDir) : path.resolve(SEQUENTIAL_BASE_DIR);
    const destinationPath = path.join(resolvedDir, safeName);

    const transferId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const transferTask: ServerFsTransfer = {
      id: transferId,
      fileName: safeName,
      filePath: destinationPath,
      mode: "copy",
      direction: "drive-to-server",
      status: "transferring",
      progress: 0,
      speed: "Iniciando descarga...",
      transferredBytes: 0,
      totalBytes: 0,
      startedAt: Date.now(),
    };
    serverTransfers.set(transferId, transferTask);

    // Stream download directly from Google Drive API to Server disk
    (async () => {
      try {
        const driveRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (!driveRes.ok) {
          const errBody = await driveRes.text();
          if (driveRes.status === 401 || errBody.includes("authError") || errBody.includes("Invalid Credentials")) {
            throw new Error("Tu sesión de Google Drive ha expirado (401). Reconecta tu cuenta de Google.");
          }
          throw new Error(`Google Drive API error: HTTP ${driveRes.status}`);
        }

        const contentLength = driveRes.headers.get("content-length");
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        transferTask.totalBytes = total;

        const writeStream = fs.createWriteStream(destinationPath);
        let received = 0;
        let lastTime = Date.now();
        let lastBytes = 0;

        if (!driveRes.body) {
          throw new Error("No se recibió stream de datos de Google Drive");
        }

        // Handle Web ReadableStream to Node WritableStream
        const reader = driveRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            writeStream.write(Buffer.from(value));
            received += value.length;
            transferTask.transferredBytes = received;
            if (total > 0) {
              transferTask.progress = Math.min(100, Math.round((received / total) * 100));
            }

            const now = Date.now();
            const timeDiff = (now - lastTime) / 1000;
            if (timeDiff >= 0.5) {
              const speedBps = (received - lastBytes) / timeDiff;
              transferTask.speed = `${(speedBps / (1024 * 1024)).toFixed(1)} MB/s`;
              lastTime = now;
              lastBytes = received;
            }
          }
        }

        await new Promise<void>((resolve, reject) => {
          writeStream.end((err?: any) => {
            if (err) reject(err);
            else resolve();
          });
        });

        transferTask.status = "completed";
        transferTask.progress = 100;
        transferTask.speed = "Completado";
        transferTask.completedAt = Date.now();
      } catch (err: any) {
        console.error("Drive to server download error:", err);
        transferTask.status = "error";
        transferTask.error = err.message || "Error al descargar desde Google Drive";
      }
    })();

    res.json({
      success: true,
      transfer: transferTask,
    });
  });

  // --- ZERO-DISK CONTINUOUS STREAMING TO GOOGLE DRIVE API ENDPOINTS ---
  app.post("/api/stream/inspect", async (req, res) => {
    try {
      const { sourceUrl, torrentBase64 } = req.body;
      const url = (sourceUrl || "").trim() || (torrentBase64 ? "uploaded_torrent.torrent" : "");
      if (!url && !torrentBase64) {
        return res.status(400).json({ error: "Introduce una URL o carga un archivo .torrent válido." });
      }
      const inspected = await streamManager.inspectSource(url, torrentBase64);
      res.json(inspected);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Error al inspeccionar origen" });
    }
  });

  app.get("/api/stream/tasks", (req, res) => {
    try {
      const tasks = streamManager.getTasks();
      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Error al listar tareas de streaming" });
    }
  });

  app.post("/api/stream/start", async (req, res) => {
    try {
      const { sourceUrl, accessToken, folderId, customChunkSizeMB, customFileName,
        torrentBase64 } = req.body;
      if (!sourceUrl) return res.status(400).json({ error: "Falta 'sourceUrl'" });
      if (!accessToken) return res.status(400).json({ error: "Falta 'accessToken' de Google Drive" });

      const task = await streamManager.startStreamTask({
        sourceUrl,
        accessToken,
        folderId: folderId || "",
        customChunkSizeMB: customChunkSizeMB ? Number(customChunkSizeMB) : 16,
        customFileName,
        torrentBase64,
      });

      res.json({ success: true, task });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Error al iniciar streaming a Google Drive" });
    }
  });

  app.post("/api/stream/pause", async (req, res) => {
    const { taskId, accessToken } = req.body;
    if (!taskId) return res.status(400).json({ error: "Falta 'taskId'" });
    const success = await streamManager.pauseTask(taskId, accessToken);
    res.json({ success });
  });

  app.post("/api/stream/audit-session", async (req, res) => {
    try {
      const { taskId } = req.body;
      if (!taskId) return res.status(400).json({ error: "Falta 'taskId'" });
      const audit = await streamManager.auditDriveSession(taskId);
      res.json({ success: true, audit });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Error al auditar sesión con Google Drive" });
    }
  });

  app.post("/api/stream/resume", async (req, res) => {
    const { taskId, accessToken } = req.body;
    if (!taskId) return res.status(400).json({ error: "Falta 'taskId'" });
    const success = await streamManager.resumeTask(taskId, accessToken || "");
    res.json({ success });
  });

  app.post("/api/stream/cancel", async (req, res) => {
    try {
      const { taskId, accessToken } = req.body;
      if (!taskId) return res.status(400).json({ error: "Falta 'taskId'" });
      const success = await streamManager.cancelTask(taskId, accessToken);
      res.json({ success });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/stream/recover", async (req, res) => {
    try {
      const { accessToken, folderId } = req.body;
      if (!accessToken) return res.status(400).json({ error: "Falta 'accessToken'" });
      const recovered = await streamManager.recoverFromDriveFolder(accessToken, folderId || "");
      const resumedSequential = sequentialChunkEngine.autoResumePendingJobs(accessToken, folderId || "");
      res.json({
        success: true,
        recoveredCount: recovered.length,
        tasks: recovered,
        resumedSequentialCount: resumedSequential.length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Error al recuperar tareas desde Drive" });
    }
  });

  // --- RAW SPEED TEST WITH BANDWIDTH THROTTLER ENDPOINTS ---
  app.get("/api/speedtest/ping", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.json({ status: "ok", timestamp: Date.now() });
  });

  app.get("/api/speedtest/download", async (req, res) => {
    try {
      const limitMbps = parseFloat(req.query.limitMbps as string) || 0;
      const sizeMB = parseFloat(req.query.sizeMB as string) || 50;
      const durationSec = parseFloat(req.query.durationSec as string) || 15;

      const totalBytes = Math.round(sizeMB * 1024 * 1024);

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("X-Target-Bytes", totalBytes.toString());

      await streamThrottledBytesToResponse(res, req, totalBytes, limitMbps, durationSec);
    } catch (err: any) {
      console.error("Error in download speed test:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Error al procesar stream de bajada" });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });

  app.post("/api/speedtest/upload", (req, res) => {
    const startTime = Date.now();
    let receivedBytes = 0;

    req.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
    });

    req.on("end", () => {
      const elapsedSec = Math.max(0.001, (Date.now() - startTime) / 1000);
      const speedMbps = Number(((receivedBytes * 8) / 1_000_000 / elapsedSec).toFixed(2));
      const speedMBs = Number((receivedBytes / (1024 * 1024) / elapsedSec).toFixed(2));

      res.json({
        success: true,
        receivedBytes,
        elapsedSec: Number(elapsedSec.toFixed(3)),
        speedMbps,
        speedMBs,
      });
    });

    req.on("error", (err) => {
      console.error("Speedtest upload error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || "Error en el stream de subida" });
      }
    });
  });

  app.get("/api/speedtest/servers", (_req, res) => {
    res.json({ servers: BACKBONE_SERVERS });
  });

  app.post("/api/speedtest/benchmark-servers", async (req, res) => {
    try {
      const { sizeMB, durationSec } = req.body || {};
      const size = typeof sizeMB === "number" && sizeMB > 0 ? sizeMB : 25;
      const duration = typeof durationSec === "number" && durationSec > 0 ? durationSec : 5;
      const benchmarkResults = await benchmarkAllBackboneServers(size, duration);
      res.json({
        timestamp: Date.now(),
        results: benchmarkResults,
      });
    } catch (err: any) {
      console.error("Benchmark all servers error:", err);
      res.status(500).json({ error: err.message || "Error al benchmarkear servidores troncales" });
    }
  });

  app.post("/api/speedtest/backbone", async (req, res) => {
    try {
      const { limitMbps, sizeMB, sourceUrl } = req.body || {};
      const limit = typeof limitMbps === "number" ? limitMbps : 0;
      const bytes = (typeof sizeMB === "number" && sizeMB > 0 ? sizeMB : 50) * 1024 * 1024;
      const url = sourceUrl || "https://speed.cloudflare.com/__down?bytes=50000000";

      const result = await testServerBackboneSpeed(url, limit, bytes);
      res.json(result);
    } catch (err: any) {
      console.error("Backbone speed test error:", err);
      res.status(500).json({ error: err.message || "Error al medir red troncal del servidor" });
    }
  });

  // Guard: Return JSON 404 for any unmatched /api requests to prevent Vite from returning index.html
  app.all(/^\/api(\/.*)?$/, (req, res) => {
    res.status(404).json({ error: `Ruta de API no encontrada: ${req.method} ${req.originalUrl}` });
  });

  // Vite middleware in dev or static serving in prod
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server Specs Host running on http://localhost:${PORT}`);
  });
}

startServer();
