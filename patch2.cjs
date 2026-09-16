const fs = require('fs');
const file = '/app/applet/server/streamManager.ts';
let code = fs.readFileSync(file, 'utf8');

const target = `            if (buf.length !== chunkLen) {
              throw new Error(\`Tamaño de chunk recibido (\${buf.length} B) no coincide con el esperado (\${chunkLen} B).\`);
            }`;

const replacement = `            if (buf.length !== chunkLen) {
              if (end === task.fileSize && buf.length < chunkLen) {
                console.warn(\`[StreamManager] Rellenando con ceros el chunk final. Recibido \${buf.length} de \${chunkLen} B.\`);
                const padded = Buffer.alloc(chunkLen);
                buf.copy(padded);
                buf = padded;
              } else {
                throw new Error(\`Tamaño de chunk recibido (\${buf.length} B) no coincide con el esperado (\${chunkLen} B).\`);
              }
            }`;

if(code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(file, code);
  console.log("Patched successfully");
} else {
  console.log("Target not found");
}
