const fs = require('fs');
const file = '/app/applet/src/types.ts';
let code = fs.readFileSync(file, 'utf8');

const target = `  speedMBs: number;
  status: "idle" | "initializing" | "streaming" | "paused" | "completed" | "error";`;

const repl = `  speedMBs: number;
  torrentSpeedMBs?: number;
  peers?: number;
  status: "idle" | "initializing" | "streaming" | "paused" | "completed" | "error";`;

if (code.includes(target)) {
  code = code.replace(target, repl);
  fs.writeFileSync(file, code);
  console.log("Patched src/types.ts");
} else {
  console.log("Target not found");
}
