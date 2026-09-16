import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Gauge,
  Activity,
  Wifi,
  ArrowDown,
  ArrowUp,
  Sliders,
  Clock,
  Play,
  Square,
  RotateCcw,
  Copy,
  Check,
  Zap,
  Server,
  Globe,
  CheckCircle2,
  AlertCircle,
  BarChart3,
  HardDrive,
  Info,
  Trophy,
  Cpu,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  SpeedTestConfig,
  SpeedTestLiveState,
  SpeedTestResultRecord,
  measurePingAndJitter,
  runDownloadSpeedTest,
  runUploadSpeedTest,
  runServerBackboneTest,
  fetchBackboneServers,
  runBenchmarkAllServers,
  BackboneServerTarget,
  ServerBenchmarkResult,
} from "../utils/speedTestApi";
import { ServerSpecs } from "../types";

interface SpeedTestViewProps {
  serverSpecs?: ServerSpecs | null;
}

const PRESET_LIMITS = [
  { label: "Sin Límite", value: 0 },
  { label: "1 Mbps", value: 1 },
  { label: "5 Mbps", value: 5 },
  { label: "10 Mbps", value: 10 },
  { label: "25 Mbps", value: 25 },
  { label: "50 Mbps", value: 50 },
  { label: "100 Mbps", value: 100 },
  { label: "250 Mbps", value: 250 },
];

export const SpeedTestView: React.FC<SpeedTestViewProps> = ({ serverSpecs }) => {
  const [config, setConfig] = useState<SpeedTestConfig>({
    mode: "full",
    downloadLimitMbps: 0,
    uploadLimitMbps: 0,
    sizeMB: 50,
    durationSec: 15,
  });

  const [customDownloadLimit, setCustomDownloadLimit] = useState<string>("");
  const [customUploadLimit, setCustomUploadLimit] = useState<string>("");

  const [backboneServers, setBackboneServers] = useState<BackboneServerTarget[]>([]);
  const [selectedServerUrl, setSelectedServerUrl] = useState<string>("");
  const [benchmarkResults, setBenchmarkResults] = useState<ServerBenchmarkResult[]>([]);
  const [isBenchmarkingServers, setIsBenchmarkingServers] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);

  const [liveState, setLiveState] = useState<SpeedTestLiveState>({
    phase: "idle",
    progressPercent: 0,
    currentSpeedMbps: 0,
    currentSpeedMBs: 0,
    transferredBytes: 0,
    totalTargetBytes: 0,
    elapsedSec: 0,
    pingMs: null,
    minPingMs: null,
    maxPingMs: null,
    jitterMs: null,
    avgDownloadMbps: null,
    peakDownloadMbps: null,
    avgUploadMbps: null,
    peakUploadMbps: null,
    backboneSpeedMbps: null,
    backboneSpeedMBs: null,
    chartPoints: [],
  });

  const [history, setHistory] = useState<SpeedTestResultRecord[]>(() => {
    try {
      const saved = localStorage.getItem("speedtest_history_records");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [copiedNotice, setCopiedNotice] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isRunning = liveState.phase !== "idle" && liveState.phase !== "completed" && liveState.phase !== "error";

  // Load backbone servers on mount
  useEffect(() => {
    fetchBackboneServers().then((servers) => {
      if (servers && servers.length > 0) {
        setBackboneServers(servers);
        setSelectedServerUrl((prev) => prev || servers[0].url);
      }
    });
  }, []);

  // Save history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("speedtest_history_records", JSON.stringify(history.slice(0, 20)));
    } catch {}
  }, [history]);

  // Run multi-server comparison benchmark
  const handleRunMultiServerBenchmark = async () => {
    if (isBenchmarkingServers || isRunning) return;
    setIsBenchmarkingServers(true);
    setBenchmarkError(null);
    try {
      const results = await runBenchmarkAllServers(25, 5);
      setBenchmarkResults(results);
      if (results.length > 0 && results[0].status === "success") {
        const best = backboneServers.find((s) => s.id === results[0].id);
        if (best) {
          setSelectedServerUrl(best.url);
        }
      }
    } catch (err: any) {
      setBenchmarkError(err.message || "Error al benchmarkear servidores");
    } finally {
      setIsBenchmarkingServers(false);
    }
  };

  // Stop / cancel test
  const handleStopTest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLiveState((prev) => ({
      ...prev,
      phase: "idle",
      currentSpeedMbps: 0,
      currentSpeedMBs: 0,
      error: "Test cancelado por el usuario.",
    }));
  };

  // Run the Speed Test
  const handleStartTest = async () => {
    if (isRunning) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLiveState({
      phase: config.mode === "backbone" ? "backbone" : "ping",
      progressPercent: 0,
      currentSpeedMbps: 0,
      currentSpeedMBs: 0,
      transferredBytes: 0,
      totalTargetBytes: config.sizeMB * 1024 * 1024,
      elapsedSec: 0,
      pingMs: null,
      minPingMs: null,
      maxPingMs: null,
      jitterMs: null,
      avgDownloadMbps: null,
      peakDownloadMbps: null,
      avgUploadMbps: null,
      peakUploadMbps: null,
      backboneSpeedMbps: null,
      backboneSpeedMBs: null,
      chartPoints: [],
      error: undefined,
    });

    const startTime = Date.now();
    let finalPing: number | null = null;
    let finalMinPing: number | null = null;
    let finalMaxPing: number | null = null;
    let finalJitter: number | null = null;
    let finalAvgDown: number | null = null;
    let finalPeakDown: number | null = null;
    let finalAvgUp: number | null = null;
    let finalPeakUp: number | null = null;
    let totalBytesSum = 0;

    try {
      // 1. LATENCY & JITTER PHASE (for full, download, or upload modes)
      if (config.mode !== "backbone") {
        setLiveState((prev) => ({ ...prev, phase: "ping", progressPercent: 10 }));
        const pingStats = await measurePingAndJitter(
          8,
          (current, stats) => {
            setLiveState((prev) => ({
              ...prev,
              pingMs: current,
              minPingMs: stats.min,
              maxPingMs: stats.max,
              jitterMs: stats.jitter,
            }));
          },
          controller.signal
        );

        finalPing = pingStats.avgPing;
        finalMinPing = pingStats.minPing;
        finalMaxPing = pingStats.maxPing;
        finalJitter = pingStats.jitter;

        setLiveState((prev) => ({
          ...prev,
          pingMs: pingStats.avgPing,
          minPingMs: pingStats.minPing,
          maxPingMs: pingStats.maxPing,
          jitterMs: pingStats.jitter,
        }));
      }

      // 2. DOWNLOAD PHASE
      if (config.mode === "full" || config.mode === "download_only") {
        if (controller.signal.aborted) return;
        setLiveState((prev) => ({
          ...prev,
          phase: "download",
          progressPercent: 0,
          currentSpeedMbps: 0,
        }));

        const downResult = await runDownloadSpeedTest(
          {
            limitMbps: config.downloadLimitMbps,
            sizeMB: config.sizeMB,
            durationSec: config.durationSec,
          },
          (progress) => {
            setLiveState((prev) => ({
              ...prev,
              phase: "download",
              progressPercent: progress.progressPercent,
              currentSpeedMbps: progress.currentSpeedMbps,
              currentSpeedMBs: progress.currentSpeedMBs,
              avgDownloadMbps: progress.avgSpeedMbps,
              peakDownloadMbps: progress.peakSpeedMbps,
              transferredBytes: progress.transferredBytes,
              elapsedSec: progress.elapsedSec,
              chartPoints: [
                ...prev.chartPoints.slice(-40),
                {
                  time: progress.elapsedSec,
                  speedMbps: progress.currentSpeedMbps,
                  phase: "download",
                },
              ],
            }));
          },
          controller.signal
        );

        finalAvgDown = downResult.avgSpeedMbps;
        finalPeakDown = downResult.peakSpeedMbps;
        totalBytesSum += downResult.totalBytes;

        setLiveState((prev) => ({
          ...prev,
          avgDownloadMbps: finalAvgDown,
          peakDownloadMbps: finalPeakDown,
          transferredBytes: totalBytesSum,
        }));
      }

      // 3. UPLOAD PHASE
      if (config.mode === "full" || config.mode === "upload_only") {
        if (controller.signal.aborted) return;
        setLiveState((prev) => ({
          ...prev,
          phase: "upload",
          progressPercent: 0,
          currentSpeedMbps: 0,
        }));

        const upResult = await runUploadSpeedTest(
          {
            limitMbps: config.uploadLimitMbps,
            sizeMB: Math.min(config.sizeMB, 35),
            durationSec: config.durationSec,
          },
          (progress) => {
            setLiveState((prev) => ({
              ...prev,
              phase: "upload",
              progressPercent: progress.progressPercent,
              currentSpeedMbps: progress.currentSpeedMbps,
              currentSpeedMBs: progress.currentSpeedMBs,
              avgUploadMbps: progress.avgSpeedMbps,
              peakUploadMbps: progress.peakSpeedMbps,
              transferredBytes: progress.transferredBytes,
              elapsedSec: progress.elapsedSec,
              chartPoints: [
                ...prev.chartPoints.slice(-40),
                {
                  time: progress.elapsedSec,
                  speedMbps: progress.currentSpeedMbps,
                  phase: "upload",
                },
              ],
            }));
          },
          controller.signal
        );

        finalAvgUp = upResult.avgSpeedMbps;
        finalPeakUp = upResult.peakSpeedMbps;
        totalBytesSum += upResult.totalBytes;

        setLiveState((prev) => ({
          ...prev,
          avgUploadMbps: finalAvgUp,
          peakUploadMbps: finalPeakUp,
          transferredBytes: totalBytesSum,
        }));
      }

      // 4. BACKBONE PHASE (Server to CDN)
      if (config.mode === "backbone") {
        if (controller.signal.aborted) return;
        setLiveState((prev) => ({
          ...prev,
          phase: "backbone",
          progressPercent: 50,
          currentSpeedMbps: 0,
        }));

        const bbResult = await runServerBackboneTest(
          {
            limitMbps: config.downloadLimitMbps,
            sizeMB: config.sizeMB,
            sourceUrl: selectedServerUrl || undefined,
          },
          controller.signal
        );

        finalAvgDown = bbResult.speedMbps;
        finalPeakDown = bbResult.speedMbps;
        totalBytesSum = bbResult.downloadedBytes;

        setLiveState((prev) => ({
          ...prev,
          backboneSpeedMbps: bbResult.speedMbps,
          backboneSpeedMBs: bbResult.speedMBs,
          avgDownloadMbps: bbResult.speedMbps,
          peakDownloadMbps: bbResult.speedMbps,
          transferredBytes: bbResult.downloadedBytes,
          progressPercent: 100,
        }));
      }

      // Complete
      setLiveState((prev) => ({
        ...prev,
        phase: "completed",
        progressPercent: 100,
        currentSpeedMbps: 0,
        currentSpeedMBs: 0,
      }));

      // Add to session history
      const totalSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
      const record: SpeedTestResultRecord = {
        id: `run_${Date.now()}`,
        timestamp: Date.now(),
        mode: config.mode,
        downloadLimitMbps: config.downloadLimitMbps,
        uploadLimitMbps: config.uploadLimitMbps,
        avgDownloadMbps: finalAvgDown,
        peakDownloadMbps: finalPeakDown,
        avgUploadMbps: finalAvgUp,
        peakUploadMbps: finalPeakUp,
        pingMs: finalPing,
        jitterMs: finalJitter,
        totalBytes: totalBytesSum,
        durationSec: totalSec,
      };

      setHistory((prev) => [record, ...prev]);
    } catch (err: any) {
      if (controller.signal.aborted) {
        setLiveState((prev) => ({
          ...prev,
          phase: "idle",
          currentSpeedMbps: 0,
          error: "Test detenido por el usuario.",
        }));
      } else {
        setLiveState((prev) => ({
          ...prev,
          phase: "error",
          currentSpeedMbps: 0,
          error: err.message || "Fallo inesperado durante el test de velocidad.",
        }));
      }
    } finally {
      abortControllerRef.current = null;
    }
  };

  // Copy result card
  const handleCopyResults = () => {
    const text = `📊 Speed Test Crudo - Cloud Run Server Specs
Fecha: ${new Date().toLocaleString()}
Modo: ${config.mode.toUpperCase()}
Límite Bajada: ${config.downloadLimitMbps > 0 ? `${config.downloadLimitMbps} Mbps` : "Sin Límite"}
Límite Subida: ${config.uploadLimitMbps > 0 ? `${config.uploadLimitMbps} Mbps` : "Sin Límite"}
----------------------------------------
📶 Latencia: ${liveState.pingMs ?? "--"} ms (Mín: ${liveState.minPingMs ?? "--"} ms, Máx: ${liveState.maxPingMs ?? "--"} ms)
⚡ Jitter: ${liveState.jitterMs ?? "--"} ms
⬇️ Bajada Promedio: ${liveState.avgDownloadMbps ? `${liveState.avgDownloadMbps} Mbps` : "--"} (Pico: ${liveState.peakDownloadMbps ?? "--"} Mbps)
⬆️ Subida Promedio: ${liveState.avgUploadMbps ? `${liveState.avgUploadMbps} Mbps` : "--"} (Pico: ${liveState.peakUploadMbps ?? "--"} Mbps)
📦 Datos Transferidos: ${(liveState.transferredBytes / (1024 * 1024)).toFixed(2)} MB
`;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedNotice(true);
      setTimeout(() => setCopiedNotice(false), 2500);
    });
  };

  // Speedometer needle angle calculation (0 to 180 degrees)
  const maxDisplaySpeed = 500;
  const clampedSpeed = Math.min(liveState.currentSpeedMbps || liveState.avgDownloadMbps || liveState.avgUploadMbps || 0, maxDisplaySpeed);
  const needleAngle = -90 + (clampedSpeed / maxDisplaySpeed) * 180;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Header Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-md">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 rounded-xl text-cyan-400">
                <Gauge className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  Speed Test Crudo con Limitador de Ancho de Banda
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                    High-Precision
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Mide el rendimiento de transferencia binaria sin compresión con limitadores de velocidad independientes para subida y bajada.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-stretch sm:self-auto">
            {isRunning ? (
              <button
                onClick={handleStopTest}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs transition-all shadow-lg shadow-rose-950/50 cursor-pointer"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>Detener Test</span>
              </button>
            ) : (
              <button
                onClick={handleStartTest}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-lg shadow-cyan-950/50 cursor-pointer active:scale-98"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Iniciar Speed Test</span>
              </button>
            )}

            {liveState.phase === "completed" && (
              <button
                onClick={handleCopyResults}
                className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs border border-slate-700 font-medium transition cursor-pointer"
                title="Copiar informe"
              >
                {copiedNotice ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                <span className="hidden sm:inline">{copiedNotice ? "Copiado" : "Copiar"}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Control Panel: Limiters & Test Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 1. Download Limiter */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4.5 space-y-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs uppercase tracking-wider">
                <ArrowDown className="w-4 h-4" />
                <span>Limitador de Bajada</span>
              </div>
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded-md border font-semibold ${
                  config.downloadLimitMbps === 0
                    ? "bg-slate-800 text-slate-300 border-slate-700"
                    : "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
                }`}
              >
                {config.downloadLimitMbps === 0 ? "Ilimitado" : `${config.downloadLimitMbps} Mbps`}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Velocidad máxima autorizada de descarga desde el servidor.
            </p>

            {/* Presets */}
            <div className="grid grid-cols-4 gap-1.5 mt-3">
              {PRESET_LIMITS.map((preset) => {
                const active = config.downloadLimitMbps === preset.value && customDownloadLimit === "";
                return (
                  <button
                    key={preset.label}
                    disabled={isRunning}
                    onClick={() => {
                      setConfig((c) => ({ ...c, downloadLimitMbps: preset.value }));
                      setCustomDownloadLimit("");
                    }}
                    className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition cursor-pointer border ${
                      active
                        ? "bg-cyan-500 text-slate-950 font-bold border-cyan-400 shadow-sm"
                        : "bg-slate-950/60 text-slate-400 hover:text-slate-200 border-slate-800 hover:border-slate-700 disabled:opacity-50"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Input */}
          <div className="pt-2 border-t border-slate-800/60 flex items-center gap-2">
            <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap">Personalizado:</span>
            <div className="relative flex-1">
              <input
                type="number"
                min="0.5"
                max="2000"
                step="1"
                placeholder="Ej. 30"
                disabled={isRunning}
                value={customDownloadLimit}
                onChange={(e) => {
                  const val = e.target.value;
                  setCustomDownloadLimit(val);
                  const num = parseFloat(val);
                  if (!isNaN(num) && num > 0) {
                    setConfig((c) => ({ ...c, downloadLimitMbps: num }));
                  } else if (val === "") {
                    setConfig((c) => ({ ...c, downloadLimitMbps: 0 }));
                  }
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono disabled:opacity-50"
              />
              <span className="absolute right-2.5 top-1 text-[10px] text-slate-500 font-mono">Mbps</span>
            </div>
          </div>
        </div>

        {/* 2. Upload Limiter */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4.5 space-y-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider">
                <ArrowUp className="w-4 h-4" />
                <span>Limitador de Subida</span>
              </div>
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded-md border font-semibold ${
                  config.uploadLimitMbps === 0
                    ? "bg-slate-800 text-slate-300 border-slate-700"
                    : "bg-indigo-500/10 text-indigo-300 border-indigo-500/30"
                }`}
              >
                {config.uploadLimitMbps === 0 ? "Ilimitado" : `${config.uploadLimitMbps} Mbps`}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Control de tasa de subida con pacing de paquetes del cliente.
            </p>

            {/* Presets */}
            <div className="grid grid-cols-4 gap-1.5 mt-3">
              {PRESET_LIMITS.map((preset) => {
                const active = config.uploadLimitMbps === preset.value && customUploadLimit === "";
                return (
                  <button
                    key={preset.label}
                    disabled={isRunning}
                    onClick={() => {
                      setConfig((c) => ({ ...c, uploadLimitMbps: preset.value }));
                      setCustomUploadLimit("");
                    }}
                    className={`px-2 py-1.5 rounded-lg text-[11px] font-medium transition cursor-pointer border ${
                      active
                        ? "bg-indigo-500 text-white font-bold border-indigo-400 shadow-sm"
                        : "bg-slate-950/60 text-slate-400 hover:text-slate-200 border-slate-800 hover:border-slate-700 disabled:opacity-50"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Input */}
          <div className="pt-2 border-t border-slate-800/60 flex items-center gap-2">
            <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap">Personalizado:</span>
            <div className="relative flex-1">
              <input
                type="number"
                min="0.5"
                max="1000"
                step="1"
                placeholder="Ej. 15"
                disabled={isRunning}
                value={customUploadLimit}
                onChange={(e) => {
                  const val = e.target.value;
                  setCustomUploadLimit(val);
                  const num = parseFloat(val);
                  if (!isNaN(num) && num > 0) {
                    setConfig((c) => ({ ...c, uploadLimitMbps: num }));
                  } else if (val === "") {
                    setConfig((c) => ({ ...c, uploadLimitMbps: 0 }));
                  }
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono disabled:opacity-50"
              />
              <span className="absolute right-2.5 top-1 text-[10px] text-slate-500 font-mono">Mbps</span>
            </div>
          </div>
        </div>

        {/* 3. Test Mode & Payload Configuration */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4.5 space-y-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs uppercase tracking-wider">
              <Sliders className="w-4 h-4" />
              <span>Modalidad y Parámetros</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Selecciona el alcance de la prueba de rendimiento.
            </p>

            {/* Mode selector */}
            <div className="grid grid-cols-2 gap-1.5 mt-3">
              {[
                { id: "full", label: "Completo (Down+Up)" },
                { id: "download_only", label: "Solo Bajada" },
                { id: "upload_only", label: "Solo Subida" },
                { id: "backbone", label: "Servidor ⇄ CDN" },
              ].map((m) => (
                <button
                  key={m.id}
                  disabled={isRunning}
                  onClick={() => setConfig((c) => ({ ...c, mode: m.id as any }))}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer text-left ${
                    config.mode === m.id
                      ? "bg-slate-800 text-emerald-300 border-emerald-500/50 font-semibold"
                      : "bg-slate-950/60 text-slate-400 hover:text-slate-200 border-slate-800 disabled:opacity-50"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-slate-400">
              <span>Carga:</span>
              <select
                disabled={isRunning}
                value={config.sizeMB}
                onChange={(e) => setConfig((c) => ({ ...c, sizeMB: parseInt(e.target.value) }))}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono disabled:opacity-50"
              >
                <option value={25}>25 MB</option>
                <option value={50}>50 MB</option>
                <option value={100}>100 MB</option>
                <option value={200}>200 MB</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 text-slate-400">
              <span>Duración:</span>
              <select
                disabled={isRunning}
                value={config.durationSec}
                onChange={(e) => setConfig((c) => ({ ...c, durationSec: parseInt(e.target.value) }))}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono disabled:opacity-50"
              >
                <option value={10}>10 seg</option>
                <option value={15}>15 seg</option>
                <option value={30}>30 seg</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Backbone Server Target Selector & Multi-Server Benchmark Trigger */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-purple-500/10 border border-purple-500/30 rounded-xl text-purple-400">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                Servidores Troncales y CDNs de Prueba
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/30">
                  Gigabit Backbone
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Evalúa qué centro de datos o CDN entrega el mayor ancho de banda neto y menor latencia desde el servidor.
              </p>
            </div>
          </div>

          <button
            onClick={handleRunMultiServerBenchmark}
            disabled={isBenchmarkingServers || isRunning}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-xs transition shadow-lg shadow-purple-950/50 cursor-pointer disabled:opacity-50"
          >
            {isBenchmarkingServers ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Midiendo Servidores...</span>
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>Testear y Comparar Todos</span>
              </>
            )}
          </button>
        </div>

        {/* Server Target Selector Pills */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-2">
          {backboneServers.map((server) => {
            const isSelected = selectedServerUrl === server.url;
            const benchResult = benchmarkResults.find((b) => b.id === server.id);
            const rankIndex = benchmarkResults.findIndex((b) => b.id === server.id);

            return (
              <div
                key={server.id}
                onClick={() => !isRunning && setSelectedServerUrl(server.url)}
                className={`p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between gap-2 relative ${
                  isSelected
                    ? "bg-purple-950/40 border-purple-500 text-white shadow-sm ring-1 ring-purple-500/50"
                    : "bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-300"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-xs text-white flex items-center gap-1.5">
                      {server.name}
                      {isSelected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400">{server.region}</div>
                  </div>
                  {rankIndex >= 0 && benchResult?.status === "success" && (
                    <span
                      className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                        rankIndex === 0
                          ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                          : rankIndex === 1
                          ? "bg-slate-400/20 text-slate-200 border-slate-400/40"
                          : "bg-slate-800 text-slate-400 border-slate-700"
                      }`}
                    >
                      #{rankIndex + 1} {rankIndex === 0 ? "🏆 Top" : ""}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono pt-1.5 border-t border-slate-800/80">
                  <span className="text-slate-500">{server.provider}</span>
                  {benchResult?.status === "success" ? (
                    <span className="font-bold text-emerald-400">
                      {benchResult.speedMbps.toFixed(0)} Mbps • {benchResult.pingMs}ms
                    </span>
                  ) : (
                    <span className="text-purple-400/80 text-[10px]">{server.badge}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Benchmark Comparative Ranking Table (when benchmarkResults exist) */}
        {benchmarkResults.length > 0 && (
          <div className="pt-3 border-t border-slate-800/80 space-y-2.5 animate-fade-in">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5 text-amber-400" />
                Ranking de Servidores por Velocidad Neta
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                Top servidor activo para el test
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {benchmarkResults.map((b, idx) => (
                <div
                  key={b.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl border text-xs gap-2 ${
                    idx === 0
                      ? "bg-amber-950/20 border-amber-500/40"
                      : "bg-slate-950/40 border-slate-800"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center font-mono font-bold text-xs ${
                        idx === 0
                          ? "bg-amber-500 text-slate-950 shadow-sm"
                          : idx === 1
                          ? "bg-slate-300 text-slate-950"
                          : idx === 2
                          ? "bg-amber-800 text-amber-100"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {idx + 1}
                    </div>
                    <div>
                      <div className="font-bold text-white flex items-center gap-1.5">
                        {b.name}
                        <span className="text-[10px] font-normal text-slate-400">({b.region})</span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        Proveedor: {b.provider}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 self-end sm:self-auto font-mono text-xs">
                    <div className="text-right">
                      <div className="text-slate-400 text-[10px]">Latencia Ping</div>
                      <div className="font-bold text-slate-200">{b.pingMs} ms</div>
                    </div>
                    <div className="text-right">
                      <div className="text-slate-400 text-[10px]">Velocidad Neta</div>
                      <div
                        className={`font-bold text-sm ${
                          idx === 0 ? "text-emerald-400" : "text-cyan-300"
                        }`}
                      >
                        {b.speedMbps.toFixed(1)} Mbps
                      </div>
                    </div>
                    <div className="text-right hidden sm:block">
                      <div className="text-slate-400 text-[10px]">Rendimiento</div>
                      <div className="text-slate-300">{(b.speedMbps / 8).toFixed(1)} MB/s</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {benchmarkError && (
          <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{benchmarkError}</span>
          </div>
        )}
      </div>

      {/* Main Gauge & Live State Centerpiece */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Speedometer Gauge */}
        <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center relative overflow-hidden shadow-xl">
          {/* Subtle Background radial glow */}
          <div
            className={`absolute inset-0 opacity-20 pointer-events-none transition-all duration-700 ${
              liveState.phase === "download"
                ? "bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-500 via-transparent to-transparent"
                : liveState.phase === "upload"
                ? "bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-500 via-transparent to-transparent"
                : "bg-transparent"
            }`}
          />

          <div className="w-full max-w-[280px] relative flex flex-col items-center">
            {/* SVG Speedometer */}
            <svg viewBox="0 0 200 120" className="w-full h-auto overflow-visible">
              <defs>
                <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#06b6d4" />
                  <stop offset="50%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>

              {/* Background Arc */}
              <path
                d="M 20 110 A 80 80 0 0 1 180 110"
                fill="none"
                stroke="#1e293b"
                strokeWidth="14"
                strokeLinecap="round"
              />

              {/* Active Value Arc */}
              <path
                d="M 20 110 A 80 80 0 0 1 180 110"
                fill="none"
                stroke="url(#gaugeGradient)"
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray="251.3"
                strokeDashoffset={251.3 - (251.3 * (clampedSpeed / maxDisplaySpeed))}
                className="transition-all duration-150 ease-out"
              />

              {/* Scale Ticks */}
              <text x="20" y="125" fill="#64748b" fontSize="8" textAnchor="middle" fontFamily="monospace">0</text>
              <text x="60" y="55" fill="#64748b" fontSize="8" textAnchor="middle" fontFamily="monospace">100</text>
              <text x="100" y="32" fill="#64748b" fontSize="8" textAnchor="middle" fontFamily="monospace">250</text>
              <text x="140" y="55" fill="#64748b" fontSize="8" textAnchor="middle" fontFamily="monospace">400</text>
              <text x="180" y="125" fill="#64748b" fontSize="8" textAnchor="middle" fontFamily="monospace">500+</text>

              {/* Center Pivot & Needle */}
              <circle cx="100" cy="110" r="7" fill="#0f172a" stroke="#06b6d4" strokeWidth="3" />
              <g transform={`rotate(${needleAngle}, 100, 110)`} className="transition-transform duration-100 ease-out">
                <line x1="100" y1="110" x2="100" y2="40" stroke="#f8fafc" strokeWidth="2.5" strokeLinecap="round" />
                <polygon points="97,55 103,55 100,36" fill="#38bdf8" />
              </g>
            </svg>

            {/* Gauge Numeric Readout */}
            <div className="mt-2 text-center">
              <div className="text-4xl font-extrabold font-mono text-white tracking-tight">
                {liveState.currentSpeedMbps > 0
                  ? liveState.currentSpeedMbps.toFixed(1)
                  : liveState.avgDownloadMbps
                  ? liveState.avgDownloadMbps.toFixed(1)
                  : "0.0"}
                <span className="text-base text-cyan-400 font-sans ml-1.5 font-bold">Mbps</span>
              </div>
              <div className="text-xs font-mono text-slate-400 mt-0.5">
                {liveState.currentSpeedMBs > 0
                  ? `≈ ${liveState.currentSpeedMBs.toFixed(2)} MB/s`
                  : liveState.avgDownloadMbps
                  ? `≈ ${(liveState.avgDownloadMbps / 8).toFixed(2)} MB/s`
                  : "Listo para medir"}
              </div>
            </div>
          </div>

          {/* Current Phase Badge */}
          <div className="mt-4 flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950 border border-slate-800 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                liveState.phase === "download"
                  ? "bg-cyan-400 animate-ping"
                  : liveState.phase === "upload"
                  ? "bg-indigo-400 animate-ping"
                  : liveState.phase === "ping"
                  ? "bg-amber-400 animate-ping"
                  : liveState.phase === "completed"
                  ? "bg-emerald-400"
                  : "bg-slate-600"
              }`}
            />
            <span className="font-medium text-slate-300 capitalize">
              {liveState.phase === "idle" && "En Espera"}
              {liveState.phase === "ping" && "Midiendo Latencia y Jitter..."}
              {liveState.phase === "download" && `Descarga en curso (${liveState.progressPercent}%)`}
              {liveState.phase === "upload" && `Subida en curso (${liveState.progressPercent}%)`}
              {liveState.phase === "backbone" && "Descargando vía Red Troncal CDN..."}
              {liveState.phase === "completed" && "Prueba Completada con Éxito"}
              {liveState.phase === "error" && "Error en la Ejecución"}
            </span>
          </div>

          {liveState.error && (
            <div className="mt-3 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/40 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-center">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{liveState.error}</span>
            </div>
          )}
        </div>

        {/* Right: Real-time Live Metrics Cards */}
        <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-2 gap-4">
          {/* Latency / Ping Card */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-1.5 font-medium text-amber-400">
                <Wifi className="w-4 h-4" />
                <span>Latencia (Ping)</span>
              </div>
              <span className="text-[10px] font-mono text-slate-500">ICMP/HTTP</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white">
                {liveState.pingMs !== null ? liveState.pingMs : "--"}
              </span>
              <span className="text-xs text-slate-400 font-mono">ms</span>
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/60">
              <span>Mín: {liveState.minPingMs !== null ? `${liveState.minPingMs}ms` : "--"}</span>
              <span>Máx: {liveState.maxPingMs !== null ? `${liveState.maxPingMs}ms` : "--"}</span>
            </div>
          </div>

          {/* Jitter Card */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-1.5 font-medium text-emerald-400">
                <Activity className="w-4 h-4" />
                <span>Jitter (Variación)</span>
              </div>
              <span className="text-[10px] font-mono text-slate-500">Estabilidad</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white">
                {liveState.jitterMs !== null ? liveState.jitterMs : "--"}
              </span>
              <span className="text-xs text-slate-400 font-mono">ms</span>
            </div>
            <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-800/60 font-mono truncate">
              {liveState.jitterMs !== null
                ? liveState.jitterMs <= 5
                  ? "Conexión Muy Estable"
                  : liveState.jitterMs <= 20
                  ? "Estabilidad Normal"
                  : "Variación Alta"
                : "--"}
            </div>
          </div>

          {/* Download Measured Speed Card */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-1.5 font-medium text-cyan-400">
                <ArrowDown className="w-4 h-4" />
                <span>Velocidad de Bajada</span>
              </div>
              {config.downloadLimitMbps > 0 && (
                <span className="text-[10px] font-mono bg-cyan-500/10 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/30">
                  Lim: {config.downloadLimitMbps}M
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-cyan-300">
                {liveState.avgDownloadMbps !== null ? liveState.avgDownloadMbps.toFixed(1) : "--"}
              </span>
              <span className="text-xs text-slate-400 font-mono">Mbps</span>
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/60">
              <span>Pico: {liveState.peakDownloadMbps !== null ? `${liveState.peakDownloadMbps.toFixed(1)}M` : "--"}</span>
              <span>
                {liveState.avgDownloadMbps !== null ? `≈ ${(liveState.avgDownloadMbps / 8).toFixed(1)} MB/s` : "--"}
              </span>
            </div>
          </div>

          {/* Upload Measured Speed Card */}
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-1.5 font-medium text-indigo-400">
                <ArrowUp className="w-4 h-4" />
                <span>Velocidad de Subida</span>
              </div>
              {config.uploadLimitMbps > 0 && (
                <span className="text-[10px] font-mono bg-indigo-500/10 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/30">
                  Lim: {config.uploadLimitMbps}M
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-indigo-300">
                {liveState.avgUploadMbps !== null ? liveState.avgUploadMbps.toFixed(1) : "--"}
              </span>
              <span className="text-xs text-slate-400 font-mono">Mbps</span>
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/60">
              <span>Pico: {liveState.peakUploadMbps !== null ? `${liveState.peakUploadMbps.toFixed(1)}M` : "--"}</span>
              <span>
                {liveState.avgUploadMbps !== null ? `≈ ${(liveState.avgUploadMbps / 8).toFixed(1)} MB/s` : "--"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Real-time throughput timeline waveform */}
      {liveState.chartPoints.length > 0 && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
            <div className="flex items-center gap-2 text-white">
              <BarChart3 className="w-4 h-4 text-cyan-400" />
              <span>Gráfico de Rendimiento en Tiempo Real (Mbps vs Tiempo)</span>
            </div>
            <span className="font-mono text-[11px] text-slate-400">
              Transferidos: {(liveState.transferredBytes / (1024 * 1024)).toFixed(1)} MB
            </span>
          </div>

          <div className="h-28 w-full flex items-end gap-1 pt-4 pb-1 px-2 bg-slate-950/80 rounded-xl border border-slate-800/60 overflow-hidden">
            {liveState.chartPoints.map((pt, idx) => {
              const heightPercent = Math.max(8, Math.min(100, (pt.speedMbps / (maxDisplaySpeed / 2)) * 100));
              const isDown = pt.phase === "download";
              return (
                <div
                  key={idx}
                  className="flex-1 flex flex-col justify-end items-center h-full group relative"
                >
                  <div
                    style={{ height: `${heightPercent}%` }}
                    className={`w-full rounded-t transition-all duration-100 ${
                      isDown
                        ? "bg-gradient-to-t from-cyan-600 to-cyan-400"
                        : "bg-gradient-to-t from-indigo-600 to-indigo-400"
                    }`}
                  />
                  {/* Hover tooltip */}
                  <div className="opacity-0 group-hover:opacity-100 transition absolute bottom-full mb-1 bg-slate-800 text-[9px] font-mono text-white px-1.5 py-0.5 rounded shadow pointer-events-none whitespace-nowrap z-10">
                    {pt.speedMbps} Mbps ({pt.time}s)
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* History of Previous Test Runs */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-bold text-white">Historial de Speed Tests Realizados</h3>
            <span className="text-[11px] font-mono text-slate-500">({history.length} pruebas)</span>
          </div>
          {history.length > 0 && (
            <button
              onClick={() => setHistory([])}
              className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Limpiar Historial</span>
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
            Aún no has ejecutado ningún Speed Test en esta sesión. Selecciona tus limitadores y presiona "Iniciar Speed Test".
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500 text-[11px]">
                  <th className="pb-2 font-medium">Hora</th>
                  <th className="pb-2 font-medium">Modo</th>
                  <th className="pb-2 font-medium">Límite Configurado</th>
                  <th className="pb-2 font-medium text-cyan-400">Bajada</th>
                  <th className="pb-2 font-medium text-indigo-400">Subida</th>
                  <th className="pb-2 font-medium text-amber-400">Ping / Jitter</th>
                  <th className="pb-2 font-medium">Transferido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {history.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-800/30 transition">
                    <td className="py-2.5 text-slate-400">
                      {new Date(rec.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </td>
                    <td className="py-2.5 uppercase font-semibold text-slate-300">{rec.mode}</td>
                    <td className="py-2.5 text-slate-400">
                      {rec.downloadLimitMbps > 0 ? `⬇ ${rec.downloadLimitMbps}M` : "⬇ Full"} •{" "}
                      {rec.uploadLimitMbps > 0 ? `⬆ ${rec.uploadLimitMbps}M` : "⬆ Full"}
                    </td>
                    <td className="py-2.5 font-bold text-cyan-300">
                      {rec.avgDownloadMbps ? `${rec.avgDownloadMbps.toFixed(1)} Mbps` : "--"}
                    </td>
                    <td className="py-2.5 font-bold text-indigo-300">
                      {rec.avgUploadMbps ? `${rec.avgUploadMbps.toFixed(1)} Mbps` : "--"}
                    </td>
                    <td className="py-2.5 text-amber-300">
                      {rec.pingMs !== null ? `${rec.pingMs}ms` : "--"} {rec.jitterMs !== null ? `(±${rec.jitterMs}ms)` : ""}
                    </td>
                    <td className="py-2.5 text-slate-400">
                      {(rec.totalBytes / (1024 * 1024)).toFixed(1)} MB ({rec.durationSec}s)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
