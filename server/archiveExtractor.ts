import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const ARCHIVE_EXTENSIONS = [
  /\.7z(?:\.\d+)?$/i,
  /\.zip(?:\.\d+)?$/i,
  /\.rar(?:\.\d+)?$/i,
  /\.part\d+\.rar$/i,
  /\.tar$/i,
  /\.tar\.(?:gz|bz2|xz)$/i,
  /\.tgz$/i,
  /\.tbz2$/i,
  /\.txz$/i,
  /\.gz$/i,
  /\.bz2$/i,
  /\.xz$/i,
];

/**
 * Checks if a filename corresponds to a supported compressed archive.
 */
export function isArchiveFileName(fileName: string): boolean {
  if (!fileName || typeof fileName !== "string") return false;
  return ARCHIVE_EXTENSIONS.some((regex) => regex.test(fileName.trim()));
}

/**
 * Derives a clean file name by stripping common archive extensions.
 * e.g.: "Movie.mkv.7z.001" -> "Movie.mkv"
 *       "Album.zip" -> "Album"
 */
export function cleanArchiveFileName(fileName: string): string {
  let clean = fileName.trim();
  // Strip multi-part split extensions like .7z.001 or .zip.001
  clean = clean.replace(/\.(?:7z|zip|rar)\.\d+$/i, "");
  // Strip standard extensions
  clean = clean.replace(/\.(?:7z|zip|rar|tar\.gz|tar\.bz2|tar\.xz|tgz|tbz2|txz|tar)$/i, "");
  return clean || fileName;
}

/**
 * Recursively collects all file paths within a directory.
 */
export function listAllFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...listAllFilesRecursive(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  } catch (err: any) {
    console.warn(`[ArchiveExtractor] Error listando archivos en ${dir}:`, err?.message);
  }
  return results;
}

/**
 * Extracts a compressed archive using 7-Zip CLI (7z x -y) with fallback to unar or unzip.
 */
export async function extractArchive(
  archiveFilePath: string,
  destinationDir: string,
  signal?: AbortSignal
): Promise<{ extractedFiles: string[]; totalExtractedSize: number }> {
  if (!fs.existsSync(destinationDir)) {
    fs.mkdirSync(destinationDir, { recursive: true });
  }

  console.log(`[ArchiveExtractor] Descomprimiendo: ${path.basename(archiveFilePath)} en ${destinationDir}...`);

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error("Operación de descompresión abortada."));
    }

    // Use 7z x with -y (assume yes to all queries) and -o<dir> (no space between -o and dir in 7z syntax!)
    const proc = spawn("7z", ["x", "-y", `-o${destinationDir}`, archiveFilePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const onAbort = () => {
      try {
        proc.kill("SIGTERM");
      } catch {}
      reject(new Error("Descompresión cancelada por el usuario."));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    proc.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(new Error(`No se pudo ejecutar '7z': ${err.message}`));
    });

    proc.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);

      if (code !== 0) {
        console.warn(`[ArchiveExtractor] 7z finalizó con código ${code}. Salida: ${stderr || stdout}`);
        // If 7z failed, check if files were still extracted
        const extracted = listAllFilesRecursive(destinationDir);
        if (extracted.length > 0) {
          const totalSize = extracted.reduce((acc, f) => acc + (fs.statSync(f).size || 0), 0);
          return resolve({ extractedFiles: extracted, totalExtractedSize: totalSize });
        }
        return reject(
          new Error(`Error al descomprimir archivo (${code}): ${stderr.slice(-200) || stdout.slice(-200)}`)
        );
      }

      const extracted = listAllFilesRecursive(destinationDir);
      const totalSize = extracted.reduce((acc, f) => {
        try {
          return acc + (fs.statSync(f).size || 0);
        } catch {
          return acc;
        }
      }, 0);

      console.log(
        `[ArchiveExtractor] Descompresión exitosa: ${extracted.length} archivo(s) extraídos (${(
          totalSize /
          (1024 * 1024)
        ).toFixed(1)} MB).`
      );

      resolve({ extractedFiles: extracted, totalExtractedSize: totalSize });
    });
  });
}
