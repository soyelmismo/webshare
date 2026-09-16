const fs = require('fs');
const file = '/app/applet/server/streamManager.ts';
let code = fs.readFileSync(file, 'utf8');

let replaced = false;

// First replacement
const target1 = `          task.uploadedBytes = task.fileSize;
          task.uploadedBytesFormatted = formatBytes(task.fileSize);
          task.progressPercent = 100;
          task.status = "completed";`;

const repl1 = `          task.uploadedBytes = task.fileSize;
          task.uploadedBytesFormatted = formatBytes(task.fileSize);
          task.currentChunkIndex = task.totalChunks;
          task.progressPercent = 100;
          task.status = "completed";`;

if (code.includes(target1)) {
  code = code.replace(target1, repl1);
  replaced = true;
}

// Second replacement
const target2 = `        task.uploadedBytes = task.fileSize;
        task.uploadedBytesFormatted = formatBytes(task.fileSize);
        task.progressPercent = 100;
        task.status = "completed";`;

const repl2 = `        task.uploadedBytes = task.fileSize;
        task.uploadedBytesFormatted = formatBytes(task.fileSize);
        task.currentChunkIndex = task.totalChunks;
        task.progressPercent = 100;
        task.status = "completed";`;

// We might want to replace all occurrences.
if (code.includes(target2)) {
  code = code.split(target2).join(repl2);
  replaced = true;
}

if(replaced) {
  fs.writeFileSync(file, code);
  console.log("Patched successfully");
} else {
  console.log("Target not found");
}
