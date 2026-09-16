const fs = require('fs');
const file = '/app/applet/server/streamManager.ts';
let code = fs.readFileSync(file, 'utf8');

const target1 = `  private async runStreamingLoop(taskId: string, accessToken: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const abortController = new AbortController();
    this.abortControllers.set(taskId, abortController);

    let lastBytesSample = task.uploadedBytes;
    let lastTimeSample = Date.now();

    try {`;

const repl1 = `  private async runStreamingLoop(taskId: string, accessToken: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const abortController = new AbortController();
    this.abortControllers.set(taskId, abortController);

    let lastBytesSample = task.uploadedBytes;
    let lastTimeSample = Date.now();

    let statsTimer: NodeJS.Timeout | null = null;
    if (task.sourceType === "torrent") {
      statsTimer = setInterval(async () => {
        try {
          const client = await getWebTorrentClient();
          if (client) {
            const torrentId = task.torrentBase64 || task.sourceUrl;
            const existing = client.get(torrentId);
            if (existing) {
              task.torrentSpeedMBs = Math.round((existing.downloadSpeed / (1024 * 1024)) * 10) / 10;
              task.peers = existing.numPeers;
            }
          }
        } catch {}
      }, 1500);
    }

    try {`;

const target2 = `    } finally {
      this.abortControllers.delete(taskId);
      this.saveTasksToDisk();
    }
  }`;

const repl2 = `    } finally {
      if (statsTimer) clearInterval(statsTimer);
      this.abortControllers.delete(taskId);
      this.saveTasksToDisk();
    }
  }`;

if (code.includes(target1) && code.includes(target2)) {
  code = code.replace(target1, repl1);
  code = code.replace(target2, repl2);
  fs.writeFileSync(file, code);
  console.log("Patched streamManager.ts loop");
} else {
  console.log("Target not found");
}
