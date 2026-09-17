import React, { useState } from "react";
import { Terminal, Shield, Cpu, Code2, Search } from "lucide-react";
import { ServerSpecs } from "../types";

interface RuntimeDetailsProps {
  serverSpecs: ServerSpecs;
}

export const RuntimeDetails: React.FC<RuntimeDetailsProps> = ({ serverSpecs }) => {
  const { runtime, os } = serverSpecs;
  const [envFilter, setEnvFilter] = useState("");

  const rawEnv = runtime?.environmentVariables;
  const envList: Array<{ key: string; value: string }> = Array.isArray(rawEnv)
    ? rawEnv.map((item: any) => {
        if (typeof item === "object" && item !== null && "key" in item && "value" in item) {
          return {
            key: String(item.key),
            value: typeof item.value === "object" ? JSON.stringify(item.value) : String(item.value),
          };
        }
        if (Array.isArray(item) && item.length >= 2) {
          return { key: String(item[0]), value: String(item[1]) };
        }
        return { key: "ENV", value: String(item) };
      })
    : typeof rawEnv === "object" && rawEnv !== null
    ? Object.entries(rawEnv).map(([key, value]) => ({
        key,
        value: typeof value === "object" ? JSON.stringify(value) : String(value),
      }))
    : [];

  const filteredEnv = envList.filter(
    (item) =>
      item.key.toLowerCase().includes(envFilter.toLowerCase()) ||
      item.value.toLowerCase().includes(envFilter.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-[#1f242c] border border-[#3b424d] text-[#10b981] shrink-0">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#f3f4f6]">Entorno de Ejecución (Node.js & Linux Kernel)</h2>
            <p className="text-xs text-[#9ca3af] font-mono">
              Node <span className="text-[#34d399] font-semibold">{runtime.nodeVersion}</span> • V8 {runtime.v8Version} • PID {runtime.pid}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono">
          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d]">
            Uptime Proceso: {runtime.processUptimeFormatted}
          </span>
        </div>
      </div>

      {/* Runtime Engines & Versions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
        <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-3.5 space-y-1">
          <span className="text-[#9ca3af] font-sans font-semibold block">Motor JavaScript (V8):</span>
          <span className="text-sm font-bold text-[#f3f4f6] block">{runtime.v8Version}</span>
          <span className="text-[11px] text-[#6b7280] font-sans">Compilación JIT Ignition/TurboFan</span>
        </div>

        <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-3.5 space-y-1">
          <span className="text-[#9ca3af] font-sans font-semibold block">Event Loop (libuv):</span>
          <span className="text-sm font-bold text-[#f3f4f6] block">{runtime.libuvVersion || "1.48.0"}</span>
          <span className="text-[11px] text-[#6b7280] font-sans">E/S asíncrona no bloqueante</span>
        </div>

        <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-3.5 space-y-1">
          <span className="text-[#9ca3af] font-sans font-semibold block">Criptografía (OpenSSL):</span>
          <span className="text-sm font-bold text-[#f3f4f6] block">{runtime.opensslVersion || "3.0.13"}</span>
          <span className="text-[11px] text-[#6b7280] font-sans">Cifrado TLS y hashing SHA/AES</span>
        </div>

        <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-3.5 space-y-1">
          <span className="text-[#9ca3af] font-sans font-semibold block">Compresión (zlib):</span>
          <span className="text-sm font-bold text-[#f3f4f6] block">{runtime.zlibVersion || "1.3.0"}</span>
          <span className="text-[11px] text-[#6b7280] font-sans">Gzip / Deflate nativo</span>
        </div>
      </div>

      {/* Process & Security Credentials */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-[#f3f4f6] flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#10b981]" />
          Credenciales de Proceso & Aislamiento Sandbox
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] space-y-1">
            <span className="text-[#9ca3af] font-sans font-semibold block">Proceso Actual (PID):</span>
            <span className="text-sm font-bold text-[#34d399] block">{runtime.pid}</span>
            <span className="text-[11px] text-[#6b7280] font-sans">PPID Padre: {runtime.ppid}</span>
          </div>

          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] space-y-1">
            <span className="text-[#9ca3af] font-sans font-semibold block">Usuario Host (UID/GID):</span>
            <span className="text-sm font-bold text-[#f3f4f6] block">{os?.user?.username || "root"} (UID {os?.user?.uid ?? 0})</span>
            <span className="text-[11px] text-[#6b7280] font-sans">Home: {os?.user?.homedir || os?.homedir || "/"}</span>
          </div>

          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] space-y-1">
            <span className="text-[#9ca3af] font-sans font-semibold block">Ruta Ejecutable Node:</span>
            <span className="text-sm font-bold text-[#f3f4f6] block truncate" title={runtime.execPath}>
              {runtime.execPath}
            </span>
            <span className="text-[11px] text-[#6b7280] font-sans">CWD: {runtime.cwd}</span>
          </div>

          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e] space-y-1">
            <span className="text-[#9ca3af] font-sans font-semibold block">Endianness de Memoria:</span>
            <span className="text-sm font-bold text-[#f3f4f6] block">{os.endianness === "LE" ? "Little Endian (x86_64)" : "Big Endian"}</span>
            <span className="text-[11px] text-[#6b7280] font-sans">Orden de bytes en memoria</span>
          </div>
        </div>
      </div>

      {/* Environment Variables Table */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#f3f4f6] flex items-center gap-2">
              <Code2 className="w-4 h-4 text-[#10b981]" />
              Variables de Entorno Sanitizadas (process.env)
            </h3>
            <p className="text-xs text-[#9ca3af]">
              Configuraciones del contenedor (los secretos y tokens se encuentran enmascarados de forma segura).
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[#6b7280] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filtrar variables..."
              value={envFilter}
              onChange={(e) => setEnvFilter(e.target.value)}
              className="w-full bg-[#101317] border border-[#22272e] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#f3f4f6] placeholder-[#6b7280] focus:outline-none focus:border-[#10b981] font-mono"
            />
          </div>
        </div>

        <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-lg border border-[#22272e]">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#1f242c] text-[#9ca3af] uppercase tracking-wider font-sans border-b border-[#22272e] sticky top-0">
              <tr>
                <th className="p-2.5 font-bold">Variable de Entorno</th>
                <th className="p-2.5 font-bold">Valor Asignado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#22272e] bg-[#101317]">
              {filteredEnv.map((item) => (
                <tr key={item.key} className="hover:bg-[#161a1f] transition-colors">
                  <td className="p-2.5 font-bold text-[#34d399]">{item.key}</td>
                  <td className="p-2.5 text-[#9ca3af] break-all max-w-lg">{item.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
