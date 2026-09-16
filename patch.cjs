const fs = require('fs');
const file = '/app/applet/server/streamManager.ts';
let code = fs.readFileSync(file, 'utf8');

const target = `        // 1. Fetch chunk slice from source (Direct HTTP, WebSeed mirror, or Torrent)
        let chunkBuffer: Buffer;
        if (
          prefetchedPromise &&
          prefetchedRange &&
          prefetchedRange.start === start &&
          prefetchedRange.end === end
        ) {
          chunkBuffer = await prefetchedPromise;
          prefetchedPromise = null;
          prefetchedRange = null;
          if (prefetchedError) {
            const err = prefetchedError;
            prefetchedError = null;
            throw err;
          }
        } else {
          prefetchedPromise = null;
          prefetchedRange = null;
          prefetchedError = null;
          chunkBuffer = await this.fetchSourceChunkSlice({
            taskId: task.id,
            sourceUrl: task.sourceUrl,
            sourceType: task.sourceType,
            start,
            end,
            signal: abortController.signal,
            torrentBase64: task.torrentBase64,
            webSeeds: task.webSeeds,
            activeMirrorUrl: task.activeMirrorUrl,
          });
        }

        if (chunkBuffer.length !== chunkLen) {
          throw new Error(
            \`Tamaño de chunk recibido (\${chunkBuffer.length} B) no coincide con el esperado (\${chunkLen} B).\`
          );
        }`;

const replacement = `        // 1. Fetch chunk slice from source (Direct HTTP, WebSeed mirror, or Torrent)
        let chunkBuffer: Buffer | null = null;
        let sourceAttempts = 0;
        const maxSourceAttempts = 5;
        let lastSourceErr: any = null;

        while (sourceAttempts < maxSourceAttempts) {
          if (abortController.signal.aborted) break;
          sourceAttempts++;
          try {
            let buf: Buffer;
            if (
              sourceAttempts === 1 &&
              prefetchedPromise &&
              prefetchedRange &&
              prefetchedRange.start === start &&
              prefetchedRange.end === end
            ) {
              if (prefetchedError) throw prefetchedError;
              buf = await prefetchedPromise;
            } else {
              buf = await this.fetchSourceChunkSlice({
                taskId: task.id,
                sourceUrl: task.sourceUrl,
                sourceType: task.sourceType,
                start,
                end,
                signal: abortController.signal,
                torrentBase64: task.torrentBase64,
                webSeeds: task.webSeeds,
                activeMirrorUrl: task.activeMirrorUrl,
              });
            }

            if (buf.length !== chunkLen) {
              throw new Error(\`Tamaño de chunk recibido (\${buf.length} B) no coincide con el esperado (\${chunkLen} B).\`);
            }
            chunkBuffer = buf;
            break; // Exito
          } catch (err: any) {
            lastSourceErr = err;
            console.warn(\`[StreamManager] Reintento \${sourceAttempts}/\${maxSourceAttempts} fallido al leer chunk de origen (\${start}-\${end}):\`, err?.message);
            if (sourceAttempts < maxSourceAttempts && !abortController.signal.aborted) {
              await new Promise((res) => setTimeout(res, 2000 * sourceAttempts));
            }
          }
        }

        prefetchedPromise = null;
        prefetchedRange = null;
        prefetchedError = null;

        if (!chunkBuffer || chunkBuffer.length !== chunkLen) {
          throw new Error(
            \`Fallo al obtener el bloque de datos de origen tras \${maxSourceAttempts} intentos. Último error: \${lastSourceErr?.message}\`
          );
        }`;

if(code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync(file, code);
  console.log("Patched successfully");
} else {
  console.log("Target not found");
}
