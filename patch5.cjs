const fs = require('fs');
const file1 = '/app/applet/server.ts';
let code1 = fs.readFileSync(file1, 'utf8');

const target1 = `  app.post("/api/stream/cancel", (req, res) => {
    const { taskId } = req.body;
    if (!taskId) return res.status(400).json({ error: "Falta 'taskId'" });
    const success = streamManager.cancelTask(taskId);
    res.json({ success });
  });`;

const repl1 = `  app.post("/api/stream/cancel", async (req, res) => {
    try {
      const { taskId, accessToken } = req.body;
      if (!taskId) return res.status(400).json({ error: "Falta 'taskId'" });
      const success = await streamManager.cancelTask(taskId, accessToken);
      res.json({ success });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });`;

if (code1.includes(target1)) {
  code1 = code1.replace(target1, repl1);
  fs.writeFileSync(file1, code1);
  console.log("Patched server.ts successfully");
}

const file2 = '/app/applet/src/utils/streamApi.ts';
let code2 = fs.readFileSync(file2, 'utf8');

const target2 = `export async function cancelStreamTask(taskId: string): Promise<boolean> {
  const res = await fetch("/api/stream/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ taskId }),
  });`;

const repl2 = `export async function cancelStreamTask(taskId: string, accessToken?: string): Promise<boolean> {
  const res = await fetch("/api/stream/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ taskId, accessToken }),
  });`;

if (code2.includes(target2)) {
  code2 = code2.replace(target2, repl2);
  fs.writeFileSync(file2, code2);
  console.log("Patched streamApi.ts successfully");
}

const file3 = '/app/applet/src/components/DriveStreamDownloader.tsx';
let code3 = fs.readFileSync(file3, 'utf8');

const target3 = `  const confirmCancel = async () => {
    if (!taskToCancel) return;
    await cancelStreamTask(taskToCancel);
    await refreshTasks();
    setTaskToCancel(null);
  };`;

const repl3 = `  const confirmCancel = async () => {
    if (!taskToCancel) return;
    await cancelStreamTask(taskToCancel, accessToken || undefined);
    await refreshTasks();
    setTaskToCancel(null);
  };`;

if (code3.includes(target3)) {
  code3 = code3.replace(target3, repl3);
  fs.writeFileSync(file3, code3);
  console.log("Patched DriveStreamDownloader.tsx successfully");
}
