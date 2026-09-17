import React, { useState, useEffect, useCallback, useRef } from "react";
import { ServerSpecs, ServerBenchmarkStats, ServerHistoryPoint } from "./types";
import {
  fetchServerSpecs,
  fetchServerHistory,
  runServerFullBenchmark,
  measureServerPing,
  getCachedServerSpecs,
} from "./utils/serverApi";
import { Header } from "./components/Header";
import { NavigationTabs, TabId } from "./components/NavigationTabs";
import { OverviewDashboard } from "./components/OverviewDashboard";
import { SystemWorkspace, SystemSubTab } from "./components/SystemWorkspace";
import { DriveWorkspace, DriveSubTab } from "./components/DriveWorkspace";
import { PerformanceWorkspace, PerformanceSubTab } from "./components/PerformanceWorkspace";
import { ReportModal } from "./components/ReportModal";
import { loadDriveSession, StoredDriveSession } from "./utils/driveStorage";
import { recoverStreamTasksFromDrive } from "./utils/streamApi";
import { Loader2, AlertCircle, RefreshCw, Server, Zap, CheckCircle2 } from "lucide-react";

export function App() {
  const [serverSpecs, setServerSpecs] = useState<ServerSpecs | null>(() => getCachedServerSpecs());
  const [history, setHistory] = useState<ServerHistoryPoint[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [isLoading, setIsLoading] = useState(() => !getCachedServerSpecs());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [apiLatency, setApiLatency] = useState<number>(0);
  const [retryCountdown, setRetryCountdown] = useState<number>(3);
  const [autoResumeNotice, setAutoResumeNotice] = useState<string | null>(null);
  const [driveSession, setDriveSession] = useState<StoredDriveSession>(() => loadDriveSession());

  const serverSpecsRef = useRef<ServerSpecs | null>(serverSpecs);
  serverSpecsRef.current = serverSpecs;
  const initialRecoverTriggered = useRef(false);

  // Auto-recover transactions from Drive ONCE on initial app load / browser refresh
  useEffect(() => {
    if (initialRecoverTriggered.current) return;
    initialRecoverTriggered.current = true;

    try {
      const alreadyRecoveredInSession = sessionStorage.getItem("drive_stream_session_recovered");
      if (alreadyRecoveredInSession) return;
    } catch {}

    const session = loadDriveSession();
    setDriveSession(session);
    if (session.token && !session.isExpired) {
      recoverStreamTasksFromDrive(session.token, session.folder?.id)
        .then((res) => {
          try {
            sessionStorage.setItem("drive_stream_session_recovered", "true");
          } catch {}

          if (res.recoveredCount > 0 || (res.resumedSequentialCount && res.resumedSequentialCount > 0)) {
            const totalResumed = res.recoveredCount + (res.resumedSequentialCount || 0);
            setAutoResumeNotice(
              `Sesión de Google Drive activa: Se recuperaron y auto-reanudaron ${totalResumed} transacciones en curso.`
            );
          }
        })
        .catch((err) => {
          console.warn("[App] Auto-recovery notice:", err.message);
        });
    }
  }, []);

  const [benchmarkStats, setBenchmarkStats] = useState<ServerBenchmarkStats>({
    status: "idle",
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
    progressPercent: 0,
    currentStep: "Listo para iniciar",
    timestamp: null,
  });

  // Load server specs
  const loadSpecs = useCallback(async (isBackground = false) => {
    if (!isBackground) setIsRefreshing(true);
    try {
      const specs = await fetchServerSpecs();
      setServerSpecs(specs);
      setError(null);

      // Fetch non-blocking history and latency metrics asynchronously
      fetchServerHistory().then(setHistory).catch(() => {});
      measureServerPing().then(setApiLatency).catch(() => {});
    } catch (err: any) {
      const errMsg =
        typeof err === "string"
          ? err
          : err?.message && typeof err.message === "string"
          ? err.message
          : "No se pudo conectar con el servidor host";

      if (!isBackground) {
        console.warn("Aviso al consultar especificaciones del servidor:", errMsg);
      }
      if (!serverSpecsRef.current) {
        setError(errMsg);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadSpecs();
  }, [loadSpecs]);

  // Periodic polling for real-time history & metrics
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      loadSpecs(true);
    }, 2000);
    return () => clearInterval(timer);
  }, [autoRefresh, loadSpecs]);

  // Auto-retry timer when connection fails
  useEffect(() => {
    if (!error || serverSpecs) return;
    setRetryCountdown(3);
    const interval = setInterval(() => {
      setRetryCountdown((prev) => {
        if (prev <= 1) {
          loadSpecs();
          return 3;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [error, serverSpecs, loadSpecs]);

  // Execute benchmark on the server
  const handleRunBenchmark = async () => {
    setActiveTab("benchmark");
    setBenchmarkStats((prev) => ({
      ...prev,
      status: "running",
      progressPercent: 10,
      currentStep: "Iniciando suite en el servidor...",
    }));

    const result = await runServerFullBenchmark((pct, step) => {
      setBenchmarkStats((prev) => ({
        ...prev,
        progressPercent: pct,
        currentStep: step,
      }));
    });

    setBenchmarkStats(result);
  };

  const isOverviewTab = activeTab === "overview";
  const isSystemTab = ["system", "cpu", "memory", "storage", "network", "runtime"].includes(activeTab);
  const isDriveTab = ["drive", "stream", "commander"].includes(activeTab);
  const isPerformanceTab = ["performance", "benchmark", "speedtest"].includes(activeTab);

  const getSystemSubTab = (): SystemSubTab => {
    if (activeTab === "memory") return "memory";
    if (activeTab === "storage") return "storage";
    if (activeTab === "network") return "network";
    if (activeTab === "runtime") return "runtime";
    return "cpu";
  };

  const getDriveSubTab = (): DriveSubTab => {
    if (activeTab === "commander") return "commander";
    if (activeTab === "drive") return "cloud";
    return "stream";
  };

  const getPerformanceSubTab = (): PerformanceSubTab => {
    if (activeTab === "speedtest") return "speedtest";
    return "benchmark";
  };

  if (isLoading && !serverSpecs) {
    return (
      <div className="min-h-screen bg-[#0b0d0e] text-[#f3f4f6] flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-14 w-14 rounded-xl bg-[#14171a] border border-[#22272e] flex items-center justify-center text-[#10b981] shadow-xl">
            <Server className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-[#f3f4f6]">
              Obteniendo Especificaciones del Servidor Host...
            </h2>
            <p className="text-xs text-[#9ca3af] font-mono">
              Consultando kernel de Linux, vCPUs, memoria física, discos y runtime...
            </p>
          </div>
          <Loader2 className="w-5 h-5 animate-spin text-[#10b981] mt-2" />
        </div>
      </div>
    );
  }

  if (error && !serverSpecs) {
    return (
      <div className="min-h-screen bg-[#0b0d0e] text-[#f3f4f6] flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#14171a] border border-[#ef4444]/40 rounded-xl p-6 text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 rounded-xl bg-[#7f1d1d]/30 border border-[#ef4444]/40 text-[#f87171] mx-auto flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-[#f3f4f6]">Error de Conexión con el Servidor</h2>
            <p className="text-xs text-[#f87171] font-mono bg-[#7f1d1d]/20 p-2.5 rounded-lg border border-[#ef4444]/30 break-words">
              {error}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-[#9ca3af]">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#10b981]" />
            <span>Reintentando en <span className="text-[#f3f4f6] font-bold font-mono">{retryCountdown}s</span></span>
          </div>
          <button
            onClick={() => loadSpecs()}
            disabled={isLoading || isRefreshing}
            className="w-full py-2.5 px-4 rounded-lg bg-[#10b981] hover:bg-[#059669] disabled:opacity-50 text-[#0b0d0e] text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading || isRefreshing ? "animate-spin" : ""}`} />
            <span>Reintentar Conexión Ahora</span>
          </button>
        </div>
      </div>
    );
  }

  if (!serverSpecs) return null;

  return (
    <div className="min-h-screen bg-[#0b0d0e] text-[#f3f4f6] flex flex-col selection:bg-[#10b981] selection:text-[#0b0d0e]">
      {/* Header */}
      <Header
        serverSpecs={serverSpecs}
        onRefresh={() => loadSpecs()}
        onRunBenchmark={handleRunBenchmark}
        isRefreshing={isRefreshing}
        onOpenReport={() => setIsReportOpen(true)}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={() => setAutoRefresh(!autoRefresh)}
        onOpenDrive={() => setActiveTab("drive")}
      />

      {/* Navigation Tabs Bar */}
      <NavigationTabs activeTab={activeTab} onChangeTab={setActiveTab} />

      {/* Main Content View */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-5 space-y-4">
        {autoResumeNotice && (
          <div className="bg-[#064e3b]/30 border border-[#059669]/60 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-[#34d399]">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#10b981] shrink-0" />
              <span className="font-medium">{autoResumeNotice}</span>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              {activeTab !== "stream" && (
                <button
                  onClick={() => {
                    setActiveTab("stream");
                    setAutoResumeNotice(null);
                  }}
                  className="px-2.5 py-1 bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e] font-bold rounded-lg text-xs transition cursor-pointer"
                >
                  Ver Streaming
                </button>
              )}
              <button
                onClick={() => setAutoResumeNotice(null)}
                className="px-2 py-1 text-[#34d399] hover:text-[#f3f4f6] text-xs cursor-pointer font-bold"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <div className={isOverviewTab ? "block" : "hidden"}>
          <OverviewDashboard
            serverSpecs={serverSpecs}
            benchmarkStats={benchmarkStats}
            history={history}
            onNavigateTab={setActiveTab}
            onRunBenchmark={handleRunBenchmark}
            apiLatency={apiLatency}
          />
        </div>

        <div className={isSystemTab ? "block" : "hidden"}>
          <SystemWorkspace
            serverSpecs={serverSpecs}
            onRunBenchmark={handleRunBenchmark}
            initialSubTab={getSystemSubTab()}
          />
        </div>

        <div className={isDriveTab ? "block" : "hidden"}>
          <DriveWorkspace
            session={driveSession}
            accessToken={driveSession.token}
            serverSpecs={serverSpecs}
            benchmarkStats={benchmarkStats}
            initialSubTab={getDriveSubTab()}
            onOpenCookieModal={() => setActiveTab("drive")}
          />
        </div>

        <div className={isPerformanceTab ? "block" : "hidden"}>
          <PerformanceWorkspace
            serverSpecs={serverSpecs}
            benchmarkStats={benchmarkStats}
            onRunBenchmark={handleRunBenchmark}
            initialSubTab={getPerformanceSubTab()}
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#22272e] bg-[#101317] py-3.5 mt-auto">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs font-mono text-[#9ca3af]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#10b981]" />
            <span>Servidor: <strong className="text-[#f3f4f6]">{serverSpecs.os.hostname}</strong></span>
            <span>•</span>
            <span>OS: <strong className="text-[#f3f4f6]">{serverSpecs.os.distroName}</strong></span>
          </div>
          <div>
            <span>Diagnóstico del Servidor Host • Entorno Linux Cloud</span>
          </div>
        </div>
      </footer>

      {/* Export Report Modal */}
      {isReportOpen && (
        <ReportModal
          serverSpecs={serverSpecs}
          benchmarkStats={benchmarkStats}
          onClose={() => setIsReportOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
