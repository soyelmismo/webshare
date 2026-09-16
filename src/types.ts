export interface ServerSpecs {
  os: {
    distroName: string;
    distroId: string;
    kernelRelease: string;
    kernelVersion: string;
    arch: string;
    platform: string;
    type: string;
    hostname: string;
    uptimeSeconds: number;
    uptimeFormatted: string;
    bootTime: string;
    endianness: string;
    homedir: string;
    tmpdir: string;
    user: {
      username: string;
      uid: number;
      gid: number;
      shell: string;
    };
  };
  cpu: {
    model: string;
    vendorId: string;
    family: string;
    speedMHz: number;
    coresCount: number;
    cores: Array<{
      id: number;
      model: string;
      speedMHz: number;
      times: {
        user: number;
        nice: number;
        sys: number;
        idle: number;
        irq: number;
      };
    }>;
    cacheSizeKB: number;
    bogomips: number;
    addressSizes: string;
    loadAverage: {
      "1min": string;
      "5min": string;
      "15min": string;
    };
    flags: string[];
    featureFlags: Array<{
      flag: string;
      name: string;
      description: string;
      supported: boolean;
    }>;
  };
  memory: {
    totalBytes: number;
    totalGB: string;
    freeBytes: number;
    freeGB: string;
    usedBytes: number;
    usedGB: string;
    usagePercentage: number;
    availableGB: string;
    cachedMB: string;
    buffersMB: string;
    swapTotalGB: string;
    swapFreeGB: string;
    meminfo: Record<string, string>;
    processMemory: {
      rssMB: string;
      heapTotalMB: string;
      heapUsedMB: string;
      externalMB: string;
      arrayBuffersMB: string;
    };
    v8HeapStats: {
      heapSizeLimitMB: string;
      totalAvailableMB: string;
      mallocedMB: string;
    };
  };
  storage: {
    mounts: Array<{
      path: string;
      type: string;
      totalBytes: number;
      totalGB: string;
      freeBytes: number;
      freeGB: string;
      usedBytes: number;
      usedGB: string;
      usagePercentage: number;
      totalInodes?: number;
      freeInodes?: number;
    }>;
    tmpDir: {
      path: string;
      freeGB: string;
      totalGB: string;
    };
  };
  network: {
    interfaces: Array<{
      name: string;
      family: string;
      address: string;
      netmask: string;
      mac: string;
      internal: boolean;
      cidr: string | null;
    }>;
    dnsServers: string[];
    hostname: string;
  };
  runtime: {
    nodeVersion: string;
    v8Version: string;
    opensslVersion: string;
    libuvVersion: string;
    zlibVersion: string;
    pid: number;
    ppid: number;
    processUptimeSeconds: number;
    processUptimeFormatted: string;
    cwd: string;
    execPath: string;
    environment: string;
    resourceUsage: {
      userCPUTimeMs: number;
      systemCPUTimeMs: number;
      maxRSSMB: string;
    };
    environmentVariables: Array<{
      key: string;
      value: string;
    }>;
  };
  timestamp: string;
}

export interface ServerBenchmarkStats {
  status: "idle" | "running" | "completed" | "error";
  cpuSingleScore: number | null;
  cpuSingleOpsSec: number | null;
  cpuMultiScore: number | null;
  cpuMultiOpsSec: number | null;
  memoryBandwidthMBps: number | null;
  diskWriteMBps: number | null;
  diskReadMBps: number | null;
  apiLatencyMs: number | null;
  overallScore: number | null;
  tier: string | null;
  progressPercent: number;
  currentStep: string;
  timestamp: string | null;
}

export interface ServerHistoryPoint {
  timestamp: number;
  cpuLoad1m: number;
  memUsagePercent: number;
  memUsedMB: number;
  processRssMB: number;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
  webContentLink?: string;
  thumbnailLink?: string;
  iconLink?: string;
}

export interface DriveFolderInfo {
  id: string;
  name: string;
  webViewLink?: string;
}

export interface DownloadJob {
  id: string;
  name: string;
  sourceUrl: string;
  status: "idle" | "downloading" | "uploading" | "completed" | "error" | "paused";
  progress: number;
  statusText: string;
  sizeBytes?: number;
  driveFile?: DriveFile;
  error?: string;
  createdAt: number;
  engine?: "direct" | "aria2";
  aria2JobId?: string;
}

export interface SavedGoogleAccount {
  id: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  token: string;
  expiresAt: number | null;
  folder: DriveFolderInfo | null;
  addedAt: number;
}

export interface SequentialEngineStatus {
  active: boolean;
  version: string;
  engineName: string;
  features: string[];
  activeJobsCount: number;
}

// Backward-compatible alias
export type Aria2Status = SequentialEngineStatus;

export interface SequentialStreamJob {
  id: string;
  url: string;
  fileName: string;
  customName?: string;
  status: "starting" | "streaming" | "downloading" | "paused" | "completed" | "error" | "cancelled";
  progress: number;
  speed: string;
  downloadSpeed?: string;
  uploadSpeed?: string;
  eta: string;
  downloadedBytes: number;
  totalBytes: number;
  chunkSizeBytes: number;
  chunkSizeFormatted?: string;
  currentChunkIndex: number;
  totalChunks: number;
  pipelinePrefetch: boolean;
  destination: "drive" | "server" | "both";
  error?: string;
  logs: string[];
  startedAt: number;
  completedAt?: number;
  filePath?: string;
  fileSize?: number;
  savedToDrive?: boolean;
  isMagnet?: boolean;
  isTorrent?: boolean;
  statusText?: string;
  downloadedStr?: string;
  totalStr?: string;
  seeds?: number;
  uploadStatus?: "idle" | "uploading" | "completed" | "error";
  uploadProgress?: number;
  driveFile?: {
    id: string;
    name: string;
    webViewLink?: string;
    size?: string;
  };
  uploadError?: string;
  autoUploadToDrive?: boolean;
  // Visual chunk state representation
  chunksState?: Array<"pending" | "downloading" | "uploading" | "done" | "error">;
}

// Backward-compatible alias
export type Aria2Job = SequentialStreamJob;

export interface ServerFileItem {
  id: string;
  name: string;
  path: string;
  size: number;
  sizeFormatted: string;
  isDirectory: boolean;
  modifiedTime: number;
  mimeType?: string;
  jobId?: string;
  aria2JobId?: string;
  isJobActive?: boolean;
}

export interface ServerFsListResponse {
  currentPath: string;
  basePaths: Array<{ name: string; path: string; icon?: string }>;
  files: ServerFileItem[];
  diskStats: {
    usedInDownloads: number;
    usedInDownloadsFormatted: string;
    totalFiles: number;
  };
}

export interface TransferTask {
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

export interface StreamDriveTask {
  id: string;
  fileName: string;
  sourceUrl: string;
  sourceType: "torrent" | "direct";
  torrentBase64?: string;
  webSeeds?: string[];
  activeMirrorUrl?: string;
  fileSize: number;
  fileSizeFormatted: string;
  chunkSizeBytes: number;
  chunkSizeFormatted: string;
  resumableUploadUrl: string;
  driveFolderId: string;
  manifestFileId?: string;
  uploadedBytes: number;
  uploadedBytesFormatted: string;
  currentChunkIndex: number;
  totalChunks: number;
  progressPercent: number;
  speedMBs: number;
  torrentSpeedMBs?: number;
  peers?: number;
  status: "idle" | "initializing" | "streaming" | "paused" | "completed" | "error";
  statusText?: string;
  error?: string;
  md5Checksum?: string;
  finalDriveFileId?: string;
  webViewLink?: string;
  startedAt: number;
  lastChunkAt?: number;
  completedAt?: number;
}

export interface StreamManifestData {
  version: number;
  taskId: string;
  fileName: string;
  sourceUrl: string;
  sourceType: "torrent" | "direct";
  fileSize: number;
  chunkSizeBytes: number;
  resumableUploadUrl: string;
  driveFolderId: string;
  uploadedBytes: number;
  currentChunkIndex: number;
  totalChunks: number;
  status: string;
  startedAt: number;
  updatedAt: number;
  finalDriveFileId?: string;
  md5Checksum?: string;
  webSeeds?: string[];
  torrentBase64?: string;
}

export interface DriveSessionAuditResult {
  taskId: string;
  sessionUri: string;
  uploadId?: string;
  status: number;
  statusText: string;
  rangeHeader: string | null;
  committedBytes: number;
  committedBytesFormatted: string;
  totalBytes: number;
  totalBytesFormatted: string;
  progressPercent: number;
  sessionAlive: boolean;
  googleServer?: string;
  manifestFileId?: string;
  message: string;
  explanation: string;
}
