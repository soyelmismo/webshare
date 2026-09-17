import React, { useState, useEffect } from "react";
import {
  Gauge,
  Play,
  Square,
  ArrowDown,
  ArrowUp,
  Activity,
  Sliders,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Globe,
  Loader2,
  Server,
  Zap,
} from "lucide-react";
import {
  SpeedTestResult,
  SpeedTestState,
  BandwidthLimitConfig,
  startSpeedTest,
  stopSpeedTest,
  getSpeedTestStatus,
  setBandwidthLimits,
  getBandwidthLimits,
  pingSpeedTargets,
} from "../utils/speedTestClient";

export const SpeedTestView: React.FC = () => {
  const [state, setState] = useState<SpeedTestState>({
    isRunning: false,
    stage: "idle",
    currentSpeedMbps: 0,
    progressPercentage: 0,
    history: [],
  });

  const [limits, setLimits] = useState<BandwidthLimitConfig>({
    enabled: false,
    downloadLimitMbps: 0,
    uploadLimitMbps: 0,
  });

  const [targets, setTargets] = useState<Array<{ name: string; host: string; rtt: number | null; status: "ok" | "slow" | "error" }>>([]);
  const [isPingingTargets, setIsPingingTargets] = useState(false);
  const [limitSavedMsg, setLimitSavedMsg] = useState(false);
  const [customDlLimit, setCustomDlLimit] = useState(0);
  const [customUlLimit, setCustomUlLimit] = useState(0);

  // Poll speed test status
  useEffect(() => {
    let interval: any;
    const fetchStatus = async () => {
      try {
        const s = await getSpeedTestStatus();
        setState(s);
      } catch (e) {
        // silent
      }
    };

    fetchStatus();
    interval = setInterval(fetchStatus, 800);
    return () => clearInterval(interval);
  }, []);

  // Fetch initial limits and ping targets
  useEffect(() => {
    const init = async () => {
      try {
        const l = await getBandwidthLimits();
        setLimits(l);
        setCustomDlLimit(l.downloadLimitMbps);
        setCustomUlLimit(l.uploadLimitMbps);

        setIsPingingTargets(true);
        const t = await pingSpeedTargets();
        setTargets(t);
      } catch (e) {
        // silent
      } finally {
        setIsPingingTargets(false);
      }
    };
    init();
  }, []);

  const handleStartTest = async () => {
    try {
      await startSpeedTest();
    } catch (e) {
      console.error(e);
    }
  };

  const handleStopTest = async () => {
    try {
      await stopSpeedTest();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveLimits = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const updated = await setBandwidthLimits({
        enabled: limits.enabled,
        downloadLimitMbps: Number(customDlLimit),
        uploadLimitMbps: Number(customUlLimit),
      });
      setLimits(updated);
      setLimitSavedMsg(true);
      setTimeout(() => setLimitSavedMsg(false), 2500);
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleLimiter = async () => {
    try {
      const updated = await setBandwidthLimits({
        ...limits,
        enabled: !limits.enabled,
      });
      setLimits(updated);
    } catch (e) {
      console.error(e);
    }
  };

  const handleRefreshTargets = async () => {
    setIsPingingTargets(true);
    try {
      const t = await pingSpeedTargets();
      setTargets(t);
    } finally {
      setIsPingingTargets(false);
    }
  };

  const lastResult = state.lastResult || (state.history.length > 0 ? state.history[state.history.length - 1] : null);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-[#1f242c] border border-[#3b424d] text-[#10b981] shrink-0">
            <Gauge className="w-5 h-5 text-[#10b981]" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#f3f4f6]">
              Speed Test Crudo & Limitador de Ancho de Banda
            </h2>
            <p className="text-xs text-[#9ca3af]">
              Prueba la velocidad real de conexión a Internet del servidor host (throughput directo en Mbps) y aplica límites de tráfico.
            </p>
          </div>
        </div>

        <button
          onClick={state.isRunning ? handleStopTest : handleStartTest}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0 ${
            state.isRunning
              ? "bg-[#7f1d1d]/30 text-[#f87171] border border-[#ef4444]/40 hover:bg-[#7f1d1d]/60"
              : "bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e]"
          }`}
        >
          {state.isRunning ? (
            <>
              <Square className="w-4 h-4 fill-current" />
              <span>Detener Test</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Iniciar Speed Test</span>
            </>
          )}
        </button>
      </div>

      {/* Main Gauge & Live Stage Overview */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-5 space-y-4">
        <div className="flex flex-col items-center justify-center py-4 space-y-3">
          {/* Visual Dial / Speed Value */}
          <div className="text-center font-mono space-y-1">
            <div className="flex items-center justify-center gap-2 text-xs font-semibold text-[#9ca3af] uppercase tracking-wider font-sans">
              {state.stage === "download" && (
                <span className="flex items-center gap-1 text-[#34d399]">
                  <ArrowDown className="w-4 h-4" /> Probando Velocidad de Bajada...
                </span>
              )}
              {state.stage === "upload" && (
                <span className="flex items-center gap-1 text-[#60a5fa]">
                  <ArrowUp className="w-4 h-4" /> Probando Velocidad de Subida...
                </span>
              )}
              {state.stage === "ping" && (
                <span className="flex items-center gap-1 text-[#fbbf24]">
                  <Activity className="w-4 h-4 animate-spin" /> Midiendo Latencia & Jitter...
                </span>
              )}
              {state.stage === "idle" && <span>Velocidad de Conexión</span>}
              {state.stage === "complete" && <span className="text-[#34d399]">[TEST COMPLETADO]</span>}
            </div>

            <div className="flex items-baseline justify-center gap-2">
              <span className="text-5xl font-extrabold text-[#f3f4f6]">
                {state.isRunning
                  ? state.currentSpeedMbps
                  : lastResult
                  ? lastResult.downloadMbps
                  : "0"}
              </span>
              <span className="text-sm font-bold text-[#9ca3af]">Mbps</span>
            </div>

            {state.isRunning && (
              <div className="w-64 mx-auto bg-[#101317] h-2 rounded-full overflow-hidden border border-[#22272e] mt-2">
                <div
                  style={{ width: `${state.progressPercentage}%` }}
                  className="bg-[#10b981] h-full transition-all"
                />
              </div>
            )}
          </div>

          {/* Results Summary Grid */}
          {lastResult && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-2xl pt-4 font-mono text-xs border-t border-[#22272e]">
              <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] text-center">
                <span className="text-[10px] text-[#9ca3af] font-sans font-semibold uppercase block">Bajada (Download)</span>
                <span className="text-lg font-bold text-[#34d399]">{lastResult.downloadMbps} Mbps</span>
              </div>
              <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] text-center">
                <span className="text-[10px] text-[#9ca3af] font-sans font-semibold uppercase block">Subida (Upload)</span>
                <span className="text-lg font-bold text-[#60a5fa]">{lastResult.uploadMbps} Mbps</span>
              </div>
              <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] text-center">
                <span className="text-[10px] text-[#9ca3af] font-sans font-semibold uppercase block">Latencia (Ping)</span>
                <span className="text-lg font-bold text-[#f3f4f6]">{lastResult.pingMs} ms</span>
              </div>
              <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] text-center">
                <span className="text-[10px] text-[#9ca3af] font-sans font-semibold uppercase block">Jitter</span>
                <span className="text-lg font-bold text-[#f3f4f6]">{lastResult.jitterMs} ms</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bandwidth Limiter Card */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#f3f4f6] flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#10b981]" />
              Limitador de Ancho de Banda (Bandwidth Throttling)
            </h3>
            <p className="text-xs text-[#9ca3af]">
              Aplica restricciones de velocidad en Mbps para simular conexiones lentas o evitar saturación de red.
            </p>
          </div>

          <button
            onClick={handleToggleLimiter}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition-colors cursor-pointer border ${
              limits.enabled
                ? "bg-[#064e3b] text-[#34d399] border-[#059669]/60"
                : "bg-[#1f242c] text-[#9ca3af] border-[#3b424d]"
            }`}
          >
            {limits.enabled ? "[LIMITADOR ACTIVO]" : "[LIMITADOR DESACTIVADO]"}
          </button>
        </div>

        <form onSubmit={handleSaveLimits} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
            <div className="space-y-1">
              <label className="text-[#9ca3af] font-sans font-semibold block">
                Límite de Bajada (Mbps) - 0 = Ilimitado:
              </label>
              <input
                type="number"
                min="0"
                max="10000"
                value={customDlLimit}
                onChange={(e) => setCustomDlLimit(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[#101317] border border-[#22272e] rounded-lg text-[#f3f4f6] focus:outline-none focus:border-[#10b981]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[#9ca3af] font-sans font-semibold block">
                Límite de Subida (Mbps) - 0 = Ilimitado:
              </label>
              <input
                type="number"
                min="0"
                max="10000"
                value={customUlLimit}
                onChange={(e) => setCustomUlLimit(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[#101317] border border-[#22272e] rounded-lg text-[#f3f4f6] focus:outline-none focus:border-[#10b981]"
              />
            </div>
          </div>

          {/* Quick preset limits */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[#9ca3af]">Perfiles rápidos:</span>
            <button
              type="button"
              onClick={() => {
                setCustomDlLimit(10);
                setCustomUlLimit(5);
              }}
              className="px-2.5 py-1 rounded-md bg-[#1f242c] hover:bg-[#262b32] text-[#34d399] border border-[#3b424d] text-[11px] font-mono cursor-pointer transition-colors"
            >
              10M / 5M (ADSL)
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomDlLimit(50);
                setCustomUlLimit(20);
              }}
              className="px-2.5 py-1 rounded-md bg-[#1f242c] hover:bg-[#262b32] text-[#34d399] border border-[#3b424d] text-[11px] font-mono cursor-pointer transition-colors"
            >
              50M / 20M (4G)
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomDlLimit(100);
                setCustomUlLimit(100);
              }}
              className="px-2.5 py-1 rounded-md bg-[#1f242c] hover:bg-[#262b32] text-[#34d399] border border-[#3b424d] text-[11px] font-mono cursor-pointer transition-colors"
            >
              100M Simétrico
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomDlLimit(0);
                setCustomUlLimit(0);
              }}
              className="px-2.5 py-1 rounded-md bg-[#1f242c] hover:bg-[#262b32] text-[#34d399] border border-[#3b424d] text-[11px] font-mono cursor-pointer transition-colors"
            >
              Sin Límite (Max)
            </button>
          </div>

          <div className="flex items-center justify-between pt-1">
            {limitSavedMsg ? (
              <span className="text-xs text-[#34d399] font-semibold flex items-center gap-1 font-mono">
                <CheckCircle2 className="w-3.5 h-3.5" /> Límites guardados correctamente.
              </span>
            ) : <span />}

            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-xs font-bold bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e] transition-colors cursor-pointer"
            >
              Guardar Configuración
            </button>
          </div>
        </form>
      </div>

      {/* Target Servers Latency Matrix */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[#f3f4f6] flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#10b981]" />
              Matriz de Latencia a Servidores Mundiales (Edge Gateways)
            </h3>
            <p className="text-xs text-[#9ca3af]">
              Comprueba el tiempo de ida y vuelta (RTT) desde el contenedor host hacia los principales centros de datos.
            </p>
          </div>

          <button
            onClick={handleRefreshTargets}
            disabled={isPingingTargets}
            className="p-1.5 rounded-lg bg-[#1f242c] hover:bg-[#262b32] text-[#f3f4f6] border border-[#3b424d] transition-colors cursor-pointer disabled:opacity-50"
            title="Actualizar pings"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isPingingTargets ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-[#22272e]">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#1f242c] text-[#9ca3af] uppercase tracking-wider font-sans border-b border-[#22272e]">
              <tr>
                <th className="p-2.5 font-bold">Servidor / Ubicación</th>
                <th className="p-2.5 font-bold">Host / Gateway</th>
                <th className="p-2.5 font-bold">Latencia RTT</th>
                <th className="p-2.5 font-bold">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#22272e] bg-[#101317]">
              {targets.map((t) => (
                <tr key={t.host} className="hover:bg-[#161a1f] transition-colors">
                  <td className="p-2.5 font-bold text-[#f3f4f6] font-sans">{t.name}</td>
                  <td className="p-2.5 text-[#9ca3af]">{t.host}</td>
                  <td className="p-2.5 text-[#f3f4f6] font-bold">
                    {t.rtt !== null ? `${t.rtt} ms` : "--"}
                  </td>
                  <td className="p-2.5">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        t.status === "ok"
                          ? "bg-[#064e3b] text-[#34d399] border border-[#059669]/60"
                          : t.status === "slow"
                          ? "bg-[#713f12]/40 text-[#fde047] border border-[#eab308]/40"
                          : "bg-[#7f1d1d]/40 text-[#f87171] border border-[#ef4444]/40"
                      }`}
                    >
                      {t.status.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
