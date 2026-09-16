import React, { useState, useEffect } from "react";
import { Network, Globe, Activity, CheckCircle2, Play, Square } from "lucide-react";
import { ServerSpecs } from "../types";
import { measureServerPing } from "../utils/serverApi";

interface NetworkDetailsProps {
  serverSpecs: ServerSpecs;
}

export const NetworkDetails: React.FC<NetworkDetailsProps> = ({ serverSpecs }) => {
  const { network } = serverSpecs;

  const [isPinging, setIsPinging] = useState(false);
  const [pingHistory, setPingHistory] = useState<number[]>([]);
  const [currentPing, setCurrentPing] = useState<number | null>(null);

  useEffect(() => {
    let interval: any;
    if (isPinging) {
      interval = setInterval(async () => {
        const ms = await measureServerPing();
        setCurrentPing(ms);
        setPingHistory((prev) => [...prev.slice(-25), ms]);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPinging]);

  const avgPing = pingHistory.length > 0 ? Math.round(pingHistory.reduce((a, b) => a + b, 0) / pingHistory.length) : 0;
  const minPing = pingHistory.length > 0 ? Math.min(...pingHistory) : 0;
  const maxPing = pingHistory.length > 0 ? Math.max(...pingHistory) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Network className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Red & Conectividad del Host</h2>
            <p className="text-xs text-slate-400 font-mono">
              Hostname: <span className="text-emerald-400 font-semibold">{network.hostname}</span> • Servidor DNS: {network.dnsServers[0] || "169.254.169.254"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono">
          <span className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {network.interfaces.length} Interfaces Detectadas
          </span>
        </div>
      </div>

      {/* Interfaces Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Globe className="w-4 h-4 text-emerald-400" />
          Interfaces de Red del Servidor (Node / os.networkInterfaces)
        </h3>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-sans border-b border-slate-800">
              <tr>
                <th className="p-3">Interfaz</th>
                <th className="p-3">Familia</th>
                <th className="p-3">Dirección IP</th>
                <th className="p-3">Máscara de Subred</th>
                <th className="p-3">Dirección MAC</th>
                <th className="p-3">Tipo / Enlace</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 bg-slate-950/40">
              {network.interfaces.map((iface, idx) => (
                <tr key={`${iface.name}-${idx}`} className="hover:bg-slate-800/40">
                  <td className="p-3 font-bold text-white">{iface.name}</td>
                  <td className="p-3 text-slate-300">{iface.family}</td>
                  <td className="p-3 text-emerald-400 font-semibold">{iface.address}</td>
                  <td className="p-3 text-slate-400">{iface.netmask}</td>
                  <td className="p-3 text-slate-500">{iface.mac || "00:00:00:00:00:00"}</td>
                  <td className="p-3">
                    {iface.internal ? (
                      <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 font-medium">
                        Loopback Interno
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                        Ingress / Contenedor Activo
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Latency & Ping Monitor Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              Monitor de Latencia y RTT de API del Servidor
            </h3>
            <p className="text-xs text-slate-400">
              Mide en tiempo real el tiempo de ida y vuelta (Round-Trip Time) del endpoint de salud del servidor (/api/ping).
            </p>
          </div>

          <button
            onClick={() => setIsPinging(!isPinging)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md ${
              isPinging
                ? "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20"
                : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20"
            }`}
          >
            {isPinging ? (
              <>
                <Square className="w-3.5 h-3.5" />
                <span>Detener Ping</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Iniciar Ping en Vivo</span>
              </>
            )}
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
            <span className="text-slate-400 font-sans block mb-0.5">Latencia Actual:</span>
            <span className="text-xl font-bold text-emerald-400">
              {currentPing !== null ? `${currentPing} ms` : "--"}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
            <span className="text-slate-400 font-sans block mb-0.5">Promedio RTT:</span>
            <span className="text-xl font-bold text-cyan-300">
              {pingHistory.length > 0 ? `${avgPing} ms` : "--"}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
            <span className="text-slate-400 font-sans block mb-0.5">Mínimo RTT:</span>
            <span className="text-xl font-bold text-indigo-300">
              {pingHistory.length > 0 ? `${minPing} ms` : "--"}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
            <span className="text-slate-400 font-sans block mb-0.5">Máximo RTT:</span>
            <span className="text-xl font-bold text-amber-400">
              {pingHistory.length > 0 ? `${maxPing} ms` : "--"}
            </span>
          </div>
        </div>

        {/* Live SVG Graph */}
        {pingHistory.length > 1 && (
          <div className="pt-2">
            <div className="flex justify-between text-xs text-slate-400 font-mono mb-1">
              <span>Historial RTT ({pingHistory.length} muestras)</span>
              <span>Último: {currentPing} ms</span>
            </div>
            <div className="w-full h-24 bg-slate-950 rounded-xl p-3 border border-slate-800 flex items-end">
              <div className="w-full flex items-end gap-1 h-full">
                {pingHistory.map((val, i) => {
                  const maxH = Math.max(20, ...pingHistory);
                  const pct = Math.max(5, (val / maxH) * 100);
                  return (
                    <div
                      key={i}
                      style={{ height: `${pct}%` }}
                      title={`${val} ms`}
                      className="flex-1 bg-emerald-500 hover:bg-emerald-400 rounded-t transition-all"
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
