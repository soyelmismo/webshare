import { StreamDriveTask } from "../types";
import {
  inspectStreamSource,
  fetchStreamTasks,
  startStreamToDrive,
  cancelStreamTask,
} from "./streamApi";

export type StreamTask = StreamDriveTask;

export interface StreamSourceInfo {
  suggestedFilename?: string;
  fileName?: string;
  fileSize?: number;
  fileSizeFormatted?: string;
  acceptRanges?: boolean;
  sourceType?: "direct" | "torrent";
  files?: Array<{ name: string; length: number; path: string }>;
  torrentBase64?: string;
}

export async function inspectStreamUrl(url: string, torrentBase64?: string): Promise<StreamSourceInfo> {
  const info = await inspectStreamSource(url, torrentBase64);
  return {
    ...info,
    suggestedFilename: info.fileName,
  };
}

export async function getStreamTasks(): Promise<StreamTask[]> {
  return await fetchStreamTasks();
}

export async function startStreamJob(params: {
  sourceUrl: string;
  targetFilename?: string;
  folderId?: string;
  accountEmail?: string;
  accessToken: string;
  chunkSizeMB?: number;
  torrentBase64?: string;
  selectedFilePath?: string;
  selectedFileSize?: number;
}): Promise<{ task: StreamTask }> {
  const result = await startStreamToDrive({
    sourceUrl: params.sourceUrl,
    accessToken: params.accessToken,
    folderId: params.folderId || "root",
    accountEmail: params.accountEmail,
    customFileName: params.targetFilename,
    customChunkSizeMB: params.chunkSizeMB,
    torrentBase64: params.torrentBase64,
    selectedFilePath: params.selectedFilePath,
    selectedFileSize: params.selectedFileSize,
  });
  return { task: result.task };
}

export async function cancelStreamJob(taskId: string): Promise<void> {
  await cancelStreamTask(taskId);
}
