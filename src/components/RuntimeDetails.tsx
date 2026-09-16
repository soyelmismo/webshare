import React, { useState } from "react";
import { Terminal, ShieldCheck, Cpu, Code2, Search, UserCheck, HardDrive } from "lucide-react";
import { ServerSpecs } from "../types";

interface RuntimeDetailsProps {
  serverSpecs: ServerSpecs;
}

export const RuntimeDetails: React.FC<RuntimeDetailsProps> = ({ serverSpecs }) => {
  const { runtime, os } = serverSpecs;
  const [envFilter, setEnvFilter] = useState("");

  const filteredEnv = runtime.environmentVariables.filter(
    (ev) =>
      ev.key.toLowerCase().includes(envFilter.toLowerCase()) ||
      ev.value.toLowerCase().includes(envFilter.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Terminal className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Runtime, Kernel & Entorno del Servidor</h2>
            <p className="text-xs text-slate-400 font-mono">
              Node.js <span className="text-cyan-400 font-semibold">{runtime.nodeVersion}</span> • V8 {runtime.v8Version} • PID {runtime.pid}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono">
          <span className="px-3 py-1 rounded-lg text-xs font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
            {runtime.environment.toUpperCase()}
          </span>
          <span className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">
            Uptime Proceso: {runtime.processUptimeFormatted}
          </span>
        </div>
      </div>

      {/* Grid: OS & Versions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Linux Kernel */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-3 font-mono text-xs">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2 font-sans">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Kernel Linux & Distribución
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Distribución:</span>
              <span className="text-white font-bold">{os.distroName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Versión Kernel:</span>
              <span className="text-indigo-300 truncate max-w-[150px]" title={os.kernelRelease}>
                {os.kernelRelease}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Arquitectura:</span>
              <span className="text-cyan-300">{os.arch} ({os.endianness})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Hora de Arranque:</span>
              <span className="text-slate-300">{os.bootTime}</span>
            </div>
          </div>
        </div>

        {/* Engine Versions */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-3 font-mono text-xs">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2 font-sans">
            <Code2 className="w-4 h-4 text-cyan-400" />
            Bibliotecas & Motores del Runtime
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Node.js:</span>
              <span className="text-emerald-400 font-bold">{runtime.nodeVersion}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Motor V8:</span>
              <span className="text-cyan-300">{runtime.v8Version}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Criptografía OpenSSL:</span>
              <span className="text-slate-300">{runtime.opensslVersion}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Búfer zlib / libuv:</span>
              <span className="text-slate-400">{runtime.zlibVersion} / {runtime.libuvVersion}</span>
            </div>
          </div>
        </div>

        {/* Process Resource Usage */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-3 font-mono text-xs">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2 font-sans">
            <UserCheck className="w-4 h-4 text-indigo-400" />
            Proceso & Consumo de Recursos
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">PID / PPID:</span>
              <span className="text-white font-bold">{runtime.pid} / {runtime.ppid}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">Usuario / Grupo:</span>
              <span className="text-indigo-300">{os.user.username} (UID {os.user.uid})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">CPU Usuario (ms):</span>
              <span className="text-amber-300">{runtime.resourceUsage.userCPUTimeMs} ms</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-sans">CPU Sistema (ms):</span>
              <span className="text-slate-300">{runtime.resourceUsage.systemCPUTimeMs} ms</span>
            </div>
          </div>
        </div>
      </div>

      {/* Directory & Paths Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 font-mono text-xs">
        <h3 className="text-base font-bold text-white flex items-center gap-2 font-sans">
          <HardDrive className="w-4 h-4 text-slate-400" />
          Rutas del Sistema de Archivos del Servidor
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
            <span className="text-slate-500 font-sans block mb-1">Directorio de Trabajo Actual (CWD):</span>
            <span className="text-white font-bold block truncate" title={runtime.cwd}>{runtime.cwd}</span>
          </div>
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
            <span className="text-slate-500 font-sans block mb-1">Binario Ejecutable de Node:</span>
            <span className="text-cyan-300 font-bold block truncate" title={runtime.execPath}>{runtime.execPath}</span>
          </div>
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
            <span className="text-slate-500 font-sans block mb-1">Directorio Home del Usuario:</span>
            <span className="text-indigo-300 font-bold block truncate" title={os.homedir}>{os.homedir}</span>
          </div>
        </div>
      </div>

      {/* Safe Environment Variables Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Terminal className="w-4 h-4 text-cyan-400" />
              Variables de Entorno del Servidor (Sanitizadas)
            </h3>
            <p className="text-xs text-slate-400">
              Variables del sistema del host (claves de acceso y secretos están estrictamente omitidos por seguridad).
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar variable..."
              value={envFilter}
              onChange={(e) => setEnvFilter(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-sans border-b border-slate-800">
              <tr>
                <th className="p-3">Variable</th>
                <th className="p-3">Valor Configurado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 bg-slate-950/40">
              {filteredEnv.map((ev) => (
                <tr key={ev.key} className="hover:bg-slate-800/40">
                  <td className="p-3 font-bold text-cyan-400 whitespace-nowrap">{ev.key}</td>
                  <td className="p-3 text-slate-300 break-all">{ev.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
