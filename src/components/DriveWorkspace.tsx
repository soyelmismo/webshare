import React, { useState, useEffect } from "react";
import { CloudLightning, Columns2, CloudDownload, Activity } from "lucide-react";
import { ServerSpecs, ServerBenchmarkStats } from "../types";
import { StoredDriveSession, loadDriveSession, onDriveSessionChange } from "../utils/driveStorage";
import { DriveStreamDownloader } from "./DriveStreamDownloader";
import { FileCommander } from "./FileCommander";
import { DriveDownloadClient } from "./DriveDownloadClient";
import { UnifiedJobList } from "./UnifiedJobList";

export type DriveSubTab = "jobs" | "stream" | "commander" | "cloud";

interface DriveWorkspaceProps {
  session: StoredDriveSession;
  accessToken: string | null;
  serverSpecs: ServerSpecs;
  benchmarkStats: ServerBenchmarkStats;
  initialSubTab?: DriveSubTab;
  onOpenCookieModal: () => void;
}

export const DriveWorkspace: React.FC<DriveWorkspaceProps> = ({
  session: propSession,
  accessToken: propToken,
  serverSpecs,
  benchmarkStats,
  initialSubTab = "jobs",
  onOpenCookieModal,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<DriveSubTab>(initialSubTab);
  const [driveSession, setDriveSession] = useState<StoredDriveSession>(() => propSession || loadDriveSession());

  useEffect(() => {
    if (propSession) {
      setDriveSession(propSession);
    }
  }, [propSession]);

  useEffect(() => {
    const unsubscribe = onDriveSessionChange((updated) => {
      setDriveSession(updated);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (initialSubTab) {
      setActiveSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const activeToken = propToken || driveSession?.token || null;
  const activeUserEmail = driveSession?.user?.email || driveSession?.activeAccount?.email;

  return (
    <div className="space-y-4">
      {/* Sub-navigation bar */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-lg p-1.5 flex flex-wrap gap-1">
        <button
          onClick={() => setActiveSubTab("jobs")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === "jobs"
              ? "bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d] shadow-sm"
              : "text-[#9ca3af] hover:text-[#f3f4f6] hover:bg-[#1a1e24] border border-transparent"
          }`}
        >
          <Activity className={`w-3.5 h-3.5 ${activeSubTab === "jobs" ? "text-[#10b981]" : "text-[#6b7280]"}`} />
          <span>Listado Unificado de Jobs</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#0b0d0e] text-[#10b981] border border-[#262b32]">
            Streaming + Secuencial
          </span>
        </button>

        <button
          onClick={() => setActiveSubTab("stream")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === "stream"
              ? "bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d] shadow-sm"
              : "text-[#9ca3af] hover:text-[#f3f4f6] hover:bg-[#1a1e24] border border-transparent"
          }`}
        >
          <CloudLightning className={`w-3.5 h-3.5 ${activeSubTab === "stream" ? "text-[#10b981]" : "text-[#6b7280]"}`} />
          <span>Nueva Transferencia Stream</span>
        </button>

        <button
          onClick={() => setActiveSubTab("commander")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === "commander"
              ? "bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d] shadow-sm"
              : "text-[#9ca3af] hover:text-[#f3f4f6] hover:bg-[#1a1e24] border border-transparent"
          }`}
        >
          <Columns2 className={`w-3.5 h-3.5 ${activeSubTab === "commander" ? "text-[#3b82f6]" : "text-[#6b7280]"}`} />
          <span>Explorador / File Commander</span>
        </button>

        <button
          onClick={() => setActiveSubTab("cloud")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === "cloud"
              ? "bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d] shadow-sm"
              : "text-[#9ca3af] hover:text-[#f3f4f6] hover:bg-[#1a1e24] border border-transparent"
          }`}
        >
          <CloudDownload className={`w-3.5 h-3.5 ${activeSubTab === "cloud" ? "text-[#8b5cf6]" : "text-[#6b7280]"}`} />
          <span>Cuentas & Presets</span>
          {activeUserEmail && (
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#0b0d0e] text-[#8b5cf6] border border-[#262b32] truncate max-w-[120px]">
              {activeUserEmail}
            </span>
          )}
        </button>
      </div>

      {/* Active Sub View */}
      <div>
        {activeSubTab === "jobs" && (
          <UnifiedJobList
            session={driveSession}
            accessToken={activeToken}
            folderId={driveSession?.folder?.id || driveSession?.activeAccount?.folder?.id}
            folderName={driveSession?.folder?.name || driveSession?.activeAccount?.folder?.name}
            onOpenConnectModal={onOpenCookieModal}
            onRefreshFiles={() => {}}
          />
        )}
        {activeSubTab === "stream" && (
          <DriveStreamDownloader
            session={driveSession}
            accessToken={activeToken}
            folderId={driveSession?.folder?.id || driveSession?.activeAccount?.folder?.id}
            folderName={driveSession?.folder?.name || driveSession?.activeAccount?.folder?.name || "Descargas Servidor"}
            onConnectDrive={() => setActiveSubTab("cloud")}
            onOpenCookieModal={onOpenCookieModal}
            onNavigateToDriveTab={() => setActiveSubTab("cloud")}
          />
        )}
        {activeSubTab === "commander" && (
          <FileCommander
            session={driveSession}
            accessToken={activeToken}
            onOpenCookieModal={onOpenCookieModal}
          />
        )}
        {activeSubTab === "cloud" && (
          <DriveDownloadClient
            serverSpecs={serverSpecs}
            benchmarkStats={benchmarkStats}
            onNavigateToCommander={() => setActiveSubTab("commander")}
          />
        )}
      </div>
    </div>
  );
};
