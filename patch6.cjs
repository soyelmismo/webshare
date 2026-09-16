const fs = require('fs');
const file = '/app/applet/server/streamManager.ts';
let code = fs.readFileSync(file, 'utf8');

const target = `  public cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.status = "idle";
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(taskId);
    }
    this.tasks.delete(taskId);
    this.saveTasksToDisk();
    return true;
  }`;

const repl = `  public async cancelTask(taskId: string, accessToken?: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.status = "idle";
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(taskId);
    }

    // Attempt to delete manifest from Drive if we have access token
    if (accessToken && task.manifestFileId) {
      try {
        await fetch(\`https://www.googleapis.com/drive/v3/files/\${task.manifestFileId}\`, {
          method: "DELETE",
          headers: { Authorization: \`Bearer \${accessToken}\` },
          signal: AbortSignal.timeout(5000)
        });
      } catch (e) {
        console.warn("Failed to delete manifest from Drive on cancel:", e);
      }
    }

    this.tasks.delete(taskId);
    this.saveTasksToDisk();
    return true;
  }`;

if (code.includes(target)) {
  code = code.replace(target, repl);
  fs.writeFileSync(file, code);
  console.log("Patched streamManager.ts successfully");
} else {
  console.log("Target not found");
}
