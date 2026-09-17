import React, { useState, useEffect } from "react";
import { Network, Globe, Activity, Play, Square } from "lucide-react";
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
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-[#1f242c] border border-[#3b424d] text-[#10b981] shrink-0">
            <Network className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#f3f4f6]">Red & Conectividad del Host</h2>
            <p className="text-xs text-[#9ca3af] font-mono">
              Hostname: <span className="text-[#34d399] font-semibold">{network.hostname}</span> • DNS: {network.dnsServers[0] || "169.254.169.254"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono">
          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#1f242c] text-[#f3f4f6] border border-[#3b424d]">
            {network.interfaces.length} Interfaces Detectadas
          </span>
        </div>
      </div>

      {/* Interfaces Table */}
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-[#f3f4f6] flex items-center gap-2">
          <Globe className="w-4 h-4 text-[#10b981]" />
          Interfaces de Red del Servidor (Node / os.networkInterfaces)
        </h3>

        <div className="overflow-x-auto rounded-lg border border-[#22272e]">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#1f242c] text-[#9ca3af] uppercase tracking-wider font-sans border-b border-[#22272e]">
              <tr>
                <th className="p-2.5 font-bold">Interfaz</th>
                <th className="p-2.5 font-bold">Familia</th>
                <th className="p-2.5 font-bold">Dirección IP</th>
                <th className="p-2.5 font-bold">Máscara Subred</th>
                <th className="p-2.5 font-bold">Dirección MAC</th>
                <th className="p-2.5 font-bold">Tipo / Enlace</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#22272e] bg-[#101317]">
              {network.interfaces.map((iface, idx) => (
                <tr key={`${iface.name}-${idx}`} className="hover:bg-[#161a1f] transition-colors">
                  <td className="p-2.5 font-bold text-[#f3f4f6]">{iface.name}</td>
                  <td className="p-2.5 text-[#9ca3af]">{iface.family}</td>
                  <td className="p-2.5 text-[#34d399] font-semibold">{iface.address}</td>
                  <td className="p-2.5 text-[#9ca3af]">{iface.netmask}</td>
                  <td className="p-2.5 text-[#6b7280]">{iface.mac || "00:00:00:00:00:00"}</td>
                  <td className="p-2.5">
                    {iface.internal ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#1a1e24] text-[#9ca3af] border border-[#22272e] font-semibold font-mono">
                        Loopback Interno
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#064e3b] text-[#34d399] border border-[#059669]/60 font-semibold font-mono">
                        Ingress / Contenedor
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
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#f3f4f6] flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#10b981]" />
              Monitor de Latencia y RTT de API (/api/ping)
            </h3>
            <p className="text-xs text-[#9ca3af]">
              Mide en tiempo real el tiempo de respuesta (Round-Trip Time) del endpoint de salud del servidor.
            </p>
          </div>

          <button
            onClick={() => setIsPinging(!isPinging)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer border font-bold ${
              isPinging
                ? "bg-[#7f1d1d]/30 text-[#f87171] border-[#ef4444]/40 hover:bg-[#7f1d1d]/50"
                : "bg-[#10b981] text-[#0b0d0e] border-[#10b981] hover:bg-[#059669]"
            }`}
          >
            {isPinging ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Detener Ping</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Iniciar Ping en Vivo</span>
              </>
            )}
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e]">
            <span className="text-[#9ca3af] font-sans font-semibold block mb-0.5">Latencia Actual:</span>
            <span className="text-lg font-bold text-[#34d399]">
              {currentPing !== null ? `${currentPing} ms` : "--"}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e]">
            <span className="text-[#9ca3af] font-sans font-semibold block mb-0.5">Promedio RTT:</span>
            <span className="text-lg font-bold text-[#f3f4f6]">
              {pingHistory.length > 0 ? `${avgPing} ms` : "--"}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e]">
            <span className="text-[#9ca3af] font-sans font-semibold block mb-0.5">Mínimo RTT:</span>
            <span className="text-lg font-bold text-[#34d399]">
              {pingHistory.length > 0 ? `${minPing} ms` : "--"}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-[#101317] border border-[#22272e]">
            <span className="text-[#9ca3af] font-sans font-semibold block mb-0.5">Máximo RTT:</span>
            <span className="text-lg font-bold text-[#f3f4f6]">
              {pingHistory.length > 0 ? `${maxPing} ms` : "--"}
            </span>
          </div>
        </div>

        {/* Live SVG Graph */}
        {pingHistory.length > 1 && (
          <div className="pt-2">
            <div className="flex justify-between text-xs text-[#9ca3af] font-mono mb-1">
              <span>Historial RTT ({pingHistory.length} muestras)</span>
              <span>Último: <strong className="text-[#34d399]">{currentPing} ms</strong></span>
            </div>
            <div className="w-full h-20 bg-[#101317] rounded-lg p-2.5 border border-[#22272e] flex items-end">
              <div className="w-full flex items-end gap-1 h-full">
                {pingHistory.map((val, i) => {
                  const maxH = Math.max(20, ...pingHistory);
                  const pct = Math.max(5, (val / maxH) * 100);
                  return (
                    <div
                      key={i}
                      style={{ height: `${pct}%` }}
                      title={`${val} ms`}
                      className="flex-1 bg-[#10b981] rounded-t transition-all"
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
