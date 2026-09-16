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
import { CpuDetails } from "./components/CpuDetails";
import { MemoryDetails } from "./components/MemoryDetails";
import { StorageDetails } from "./components/StorageDetails";
import { NetworkDetails } from "./components/NetworkDetails";
import { RuntimeDetails } from "./components/RuntimeDetails";
import { BenchmarkView } from "./components/BenchmarkView";
import { ReportModal } from "./components/ReportModal";
import { DriveDownloadClient } from "./components/DriveDownloadClient";
import { FileCommander } from "./components/FileCommander";
import { DriveStreamDownloader } from "./components/DriveStreamDownloader";
import { loadDriveSession } from "./utils/driveStorage";
import { Loader2, AlertCircle, RefreshCw, Server } from "lucide-react";

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

  const serverSpecsRef = useRef<ServerSpecs | null>(serverSpecs);
  serverSpecsRef.current = serverSpecs;

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
      const [specs, hist, ping] = await Promise.all([
        fetchServerSpecs(),
        fetchServerHistory(),
        measureServerPing(),
      ]);
      setServerSpecs(specs);
      setHistory(hist);
      setApiLatency(ping);
      setError(null);
    } catch (err: any) {
      if (!isBackground) {
        console.warn("Aviso al consultar especificaciones del servidor:", err?.message || err);
      }
      if (!serverSpecsRef.current) {
        setError(err?.message || "No se pudo conectar con el servidor host");
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

  if (isLoading && !serverSpecs) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-16 w-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-xl shadow-indigo-950/50 animate-pulse">
            <Server className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white tracking-tight">
              Obteniendo Especificaciones del Servidor Host...
            </h2>
            <p className="text-xs text-slate-400 font-mono">
              Consultando kernel de Linux, vCPUs, memoria física, discos y runtime backend...
            </p>
          </div>
          <Loader2 className="w-5 h-5 animate-spin text-indigo-400 mt-2" />
        </div>
      </div>
    );
  }

  if (error && !serverSpecs) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-rose-500/30 rounded-2xl p-6 text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 mx-auto flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-white">Error de Conexión con el Servidor</h2>
            <p className="text-xs text-rose-300 font-mono bg-rose-950/40 p-2.5 rounded-lg border border-rose-900/50 break-words">
              {error}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
            <span>Reintentando automáticamente en <span className="text-indigo-400 font-bold font-mono">{retryCountdown}s</span></span>
          </div>
          <button
            onClick={() => loadSpecs()}
            disabled={isLoading || isRefreshing}
            className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition-all cursor-pointer shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2"
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
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500 selection:text-white flex flex-col">
      {/* Sticky Server Header */}
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
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-6">
        {activeTab === "overview" && (
          <OverviewDashboard
            serverSpecs={serverSpecs}
            benchmarkStats={benchmarkStats}
            history={history}
            onNavigateTab={setActiveTab}
            onRunBenchmark={handleRunBenchmark}
            apiLatency={apiLatency}
          />
        )}

        {activeTab === "stream" && (
          <DriveStreamDownloader
            accessToken={loadDriveSession().token}
            folderId={loadDriveSession().folder?.id}
            folderName={loadDriveSession().folder?.name || "Descargas Servidor"}
            onConnectDrive={() => setActiveTab("drive")}
          />
        )}

        {activeTab === "commander" && (
          <FileCommander
            serverSpecs={serverSpecs}
            onNavigateToStream={() => setActiveTab("drive")}
          />
        )}

        {activeTab === "drive" && (
          <DriveDownloadClient
            serverSpecs={serverSpecs}
            benchmarkStats={benchmarkStats}
            onNavigateToCommander={() => setActiveTab("commander")}
          />
        )}

        {activeTab === "cpu" && (
          <CpuDetails
            serverSpecs={serverSpecs}
            onRunBenchmark={handleRunBenchmark}
          />
        )}

        {activeTab === "memory" && (
          <MemoryDetails serverSpecs={serverSpecs} />
        )}

        {activeTab === "storage" && (
          <StorageDetails serverSpecs={serverSpecs} />
        )}

        {activeTab === "network" && (
          <NetworkDetails serverSpecs={serverSpecs} />
        )}

        {activeTab === "runtime" && (
          <RuntimeDetails serverSpecs={serverSpecs} />
        )}

        {activeTab === "benchmark" && (
          <BenchmarkView
            serverSpecs={serverSpecs}
            benchmarkStats={benchmarkStats}
            onRunBenchmark={handleRunBenchmark}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950/80 py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs font-mono text-slate-500">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Servidor: {serverSpecs.os.hostname}</span>
            <span>•</span>
            <span>OS: {serverSpecs.os.distroName}</span>
          </div>
          <div>
            <span>100% Server-Side Diagnostics • Linux Cloud Container</span>
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
