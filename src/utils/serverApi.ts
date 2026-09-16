import { ServerSpecs, ServerHistoryPoint, ServerBenchmarkStats } from "../types";

const SPECS_CACHE_KEY = "server_specs_cache_v1";

export function getCachedServerSpecs(): ServerSpecs | null {
  try {
    const cached = localStorage.getItem(SPECS_CACHE_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (parsed && parsed.cpu && parsed.memory && parsed.os) {
      return parsed;
    }
  } catch (e) {
    // Ignore cache error
  }
  return null;
}

export function saveCachedServerSpecs(specs: ServerSpecs): void {
  try {
    localStorage.setItem(SPECS_CACHE_KEY, JSON.stringify(specs));
  } catch (e) {
    // Ignore cache error
  }
}

/**
 * Safely parses response to JSON, guarding against HTML error pages (<!doctype ...),
 * cold-start gateway timeouts, and proxy fallbacks.
 */
async function parseSafeJson<T>(res: Response, endpointLabel: string): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  const rawText = await res.text();

  if (contentType.includes("text/html") || rawText.trim().startsWith("<")) {
    throw new Error(`El servidor backend está arrancando o respondió con HTML (${endpointLabel}). Reintentando...`);
  }

  if (!res.ok) {
    let errMsg = `Servidor HTTP ${res.status}`;
    try {
      const errObj = JSON.parse(rawText);
      if (errObj?.error) errMsg = errObj.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  try {
    return JSON.parse(rawText) as T;
  } catch (err: any) {
    throw new Error(`Respuesta con formato no válido del servidor (${endpointLabel})`);
  }
}

export async function fetchServerSpecs(retries = 5, delayMs = 700): Promise<ServerSpecs> {
  let lastError: any = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch("/api/system/server-specs", {
        signal: controller.signal,
        headers: {
          "Accept": "application/json",
          "Cache-Control": "no-cache",
        },
      });
      clearTimeout(timeoutId);

      const data = await parseSafeJson<ServerSpecs>(res, "server-specs");
      if (data && data.cpu && data.memory) {
        saveCachedServerSpecs(data);
        return data;
      }
      throw new Error("Datos de especificaciones incompletos recibidos del servidor");
    } catch (err: any) {
      lastError = err;
      // If we have retries left and it's a network/fetch failure, wait and retry
      if (attempt < retries) {
        const sleepTime = Math.min(2500, delayMs * Math.pow(1.3, attempt - 1));
        await new Promise((resolve) => setTimeout(resolve, sleepTime));
      }
    }
  }

  // Fallback to cached specs if available before throwing
  const cached = getCachedServerSpecs();
  if (cached) {
    console.warn("fetchServerSpecs agotó reintentos, utilizando caché local:", lastError?.message || lastError);
    return cached;
  }

  throw lastError || new Error("No se pudo conectar con el servidor host");
}

export async function fetchServerHistory(): Promise<ServerHistoryPoint[]> {
  try {
    const res = await fetch("/api/system/server-history", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    return await parseSafeJson<ServerHistoryPoint[]>(res, "server-history");
  } catch (e) {
    return [];
  }
}

export async function measureServerPing(): Promise<number> {
  const start = performance.now();
  try {
    const res = await fetch("/api/ping?t=" + Date.now(), {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return 0;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/html")) return 0;
    const end = performance.now();
    return Math.round(end - start);
  } catch (e) {
    return 0;
  }
}

export async function runServerFullBenchmark(
  onProgress?: (percent: number, step: string) => void
): Promise<ServerBenchmarkStats> {
  if (onProgress) onProgress(15, "Enviando carga de trabajo al servidor host...");

  try {
    if (onProgress) onProgress(35, "Ejecutando pruebas de CPU Monohilo y Multihilo...");
    const res = await fetch("/api/benchmark/full", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    const data = await parseSafeJson<any>(res, "benchmark-full");

    if (onProgress) onProgress(80, "Calculando rendimiento de memoria y disco...");
    if (onProgress) onProgress(95, "Midiendo latencia de respuesta de API...");
    const ping = await measureServerPing();

    if (onProgress) onProgress(100, "Benchmark de servidor completado");

    return {
      status: "completed",
      cpuSingleScore: data.cpuSingleScore,
      cpuSingleOpsSec: data.cpuSingleOpsSec,
      cpuMultiScore: data.cpuMultiScore,
      cpuMultiOpsSec: data.cpuMultiOpsSec,
      memoryBandwidthMBps: data.memoryBandwidthMBps,
      diskWriteMBps: data.diskWriteMBps,
      diskReadMBps: data.diskReadMBps,
      apiLatencyMs: ping,
      overallScore: data.overallScore,
      tier: data.tier,
      progressPercent: 100,
      currentStep: "Pruebas finalizadas con éxito",
      timestamp: data.timestamp || new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      status: "error",
      cpuSingleScore: null,
      cpuSingleOpsSec: null,
      cpuMultiScore: null,
      cpuMultiOpsSec: null,
      memoryBandwidthMBps: null,
      diskWriteMBps: null,
      diskReadMBps: null,
      apiLatencyMs: null,
      overallScore: null,
      tier: null,
      progressPercent: 100,
      currentStep: err?.message || "Error al ejecutar benchmark",
      timestamp: null,
    };
  }
}
