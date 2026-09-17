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
}

export async function inspectStreamUrl(url: string): Promise<StreamSourceInfo> {
  const info = await inspectStreamSource(url);
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
  accessToken: string;
  chunkSizeMB?: number;
}): Promise<{ task: StreamTask }> {
  const result = await startStreamToDrive({
    sourceUrl: params.sourceUrl,
    accessToken: params.accessToken,
    folderId: params.folderId || "root",
    customFileName: params.targetFilename,
    customChunkSizeMB: params.chunkSizeMB,
  });
  return { task: result.task };
}

export async function cancelStreamJob(taskId: string): Promise<void> {
  await cancelStreamTask(taskId);
}
