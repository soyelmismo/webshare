const fs = require('fs');
const file = '/app/applet/src/components/DriveStreamDownloader.tsx';
let code = fs.readFileSync(file, 'utf8');

const importTarget = `  Clock,
} from "lucide-react";`;
const importRepl = `  Clock,
  Download,
} from "lucide-react";`;

if (code.includes(importTarget)) {
  code = code.replace(importTarget, importRepl);
}

const renderTarget = `                    <span className="text-slate-400">
                      {task.status === "streaming" && task.speedMBs > 0 && (
                        <>
                          <span className="text-emerald-400 font-semibold mr-2">
                            ⚡ {task.speedMBs} MB/s
                          </span>
                          {task.fileSize > task.uploadedBytes && (
                            <span className="text-cyan-300 font-medium mr-3 inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" /> ETA:{" "}
                              {formatEta(
                                (task.fileSize - task.uploadedBytes) / (task.speedMBs * 1024 * 1024)
                              )}
                            </span>
                          )}
                        </>
                      )}
                      Chunk {task.currentChunkIndex} de {task.totalChunks}
                    </span>`;

const renderRepl = `                    <span className="text-slate-400 flex flex-wrap justify-end gap-3 items-center">
                      {task.status === "streaming" && (
                        <>
                          {task.sourceType === "torrent" && task.torrentSpeedMBs !== undefined && (
                            <span className="text-indigo-400 font-semibold inline-flex items-center gap-1" title="Velocidad real de descarga del enjambre Torrent">
                              <Download className="w-3 h-3" /> {task.torrentSpeedMBs} MB/s 
                              <span className="text-slate-500 font-normal text-[10px] uppercase ml-1">({task.peers || 0} pares)</span>
                            </span>
                          )}
                          {task.speedMBs > 0 && (
                            <span className="text-emerald-400 font-semibold inline-flex items-center gap-1" title="Velocidad de subida a Google Drive">
                              ☁️ {task.speedMBs} MB/s
                            </span>
                          )}
                          {task.fileSize > task.uploadedBytes && task.speedMBs > 0 && (
                            <span className="text-cyan-300 font-medium inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" /> ETA:{" "}
                              {formatEta(
                                (task.fileSize - task.uploadedBytes) / (task.speedMBs * 1024 * 1024)
                              )}
                            </span>
                          )}
                        </>
                      )}
                      <span>Chunk {task.currentChunkIndex} de {task.totalChunks}</span>
                    </span>`;

if (code.includes(renderTarget)) {
  code = code.replace(renderTarget, renderRepl);
  fs.writeFileSync(file, code);
  console.log("Patched DriveStreamDownloader.tsx successfully");
} else {
  console.log("Target not found");
}
