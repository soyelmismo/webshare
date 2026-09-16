import React, { useState } from "react";
import {
  Cookie,
  ShieldCheck,
  Key,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
  HardDrive,
  Users,
  UserPlus,
  ArrowRightLeft,
  Mail,
  User as UserIcon,
} from "lucide-react";
import { StoredDriveSession, getClientCookie, verifyDriveToken } from "../utils/driveStorage";
import { SavedGoogleAccount } from "../types";

interface DriveCookieModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: StoredDriveSession;
  accessToken: string | null;
  onRenew: () => Promise<void>;
  onAddAnotherAccount: () => Promise<void>;
  onSwitchAccount: (accountId: string) => Promise<void>;
  onRemoveAccount: (accountId: string) => Promise<void>;
  onSaveManualToken: (token: string, email?: string, name?: string) => Promise<void>;
  onClearSession: () => Promise<void>;
}

export const DriveCookieModal: React.FC<DriveCookieModalProps> = ({
  isOpen,
  onClose,
  session,
  accessToken,
  onRenew,
  onAddAnotherAccount,
  onSwitchAccount,
  onRemoveAccount,
  onSaveManualToken,
  onClearSession,
}) => {
  const [copied, setCopied] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualName, setManualName] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifySuccess, setVerifySuccess] = useState<string | null>(null);
  const [isRenewing, setIsRenewing] = useState(false);
  const [isAddingGoogle, setIsAddingGoogle] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  if (!isOpen) return null;

  const cookieVal = getClientCookie("gdrive_access_token");
  const hasCookie = Boolean(cookieVal);
  const hasToken = Boolean(accessToken || session.token);
  const activeToken = accessToken || session.token || "";
  const accounts = session.accounts || [];
  const activeAccountId = session.activeAccount?.id || session.user?.email || session.user?.uid;

  const handleCopyToken = () => {
    if (!activeToken) return;
    navigator.clipboard.writeText(activeToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleRenewClick = async () => {
    setIsRenewing(true);
    try {
      await onRenew();
    } finally {
      setIsRenewing(false);
    }
  };

  const handleAddAnother = async () => {
    setIsAddingGoogle(true);
    try {
      await onAddAnotherAccount();
    } finally {
      setIsAddingGoogle(false);
    }
  };

  const handleSwitch = async (id: string) => {
    setSwitchingId(id);
    try {
      await onSwitchAccount(id);
    } finally {
      setSwitchingId(null);
    }
  };

  const handleVerifyAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualInput.trim();
    if (!trimmed) return;

    setIsVerifying(true);
    setVerifyError(null);
    setVerifySuccess(null);

    try {
      const result = await verifyDriveToken(trimmed);
      if (!result.valid) {
        throw new Error(result.error || "Token inválido o expirado según la API de Google.");
      }

      const emailToUse = manualEmail.trim() || result.email || "cuenta-manual@google.com";
      const nameToUse = manualName.trim() || "Cuenta Google Manual";

      await onSaveManualToken(trimmed, emailToUse, nameToUse);
      setVerifySuccess(`¡Cuenta ${emailToUse} vinculada con éxito y almacenada en cookies!`);
      setManualInput("");
      setManualEmail("");
      setManualName("");
    } catch (err: any) {
      setVerifyError(err?.message || "Error al verificar el token.");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative overflow-hidden max-h-[92vh] flex flex-col">
        {/* Glow effect */}
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-52 h-52 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-indigo-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Cookie className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Multi-Cuentas & Cookies Google Drive</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono">
                  Client-Side
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Gestiona múltiples cuentas de Google y mantén sus accesos permanentes en tu navegador.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="overflow-y-auto py-4 space-y-5 flex-1 pr-1">
          {/* Linked Accounts Section */}
          <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-400" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Cuentas de Google Vinculadas ({accounts.length})
                </h4>
              </div>
              <button
                onClick={handleAddAnother}
                disabled={isAddingGoogle}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/20 cursor-pointer disabled:opacity-50"
              >
                {isAddingGoogle ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <UserPlus className="w-3.5 h-3.5" />
                )}
                <span>+ Agregar otra cuenta</span>
              </button>
            </div>

            {accounts.length === 0 ? (
              <div className="p-4 text-center border border-dashed border-slate-800 rounded-xl space-y-2">
                <p className="text-xs text-slate-400">No hay cuentas de Google guardadas aún.</p>
                <button
                  onClick={handleAddAnother}
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Conectar primera cuenta</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {accounts.map((acc: SavedGoogleAccount) => {
                  const isActive = acc.id === activeAccountId || acc.email === activeAccountId;
                  const isAccountExpired = acc.expiresAt ? Date.now() > acc.expiresAt : false;
                  const minsRemaining = acc.expiresAt
                    ? Math.max(0, Math.round((acc.expiresAt - Date.now()) / 60000))
                    : 60;

                  return (
                    <div
                      key={acc.id}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                        isActive
                          ? "bg-indigo-950/30 border-indigo-500/40 shadow-sm shadow-indigo-900/20"
                          : "bg-slate-900/60 border-slate-800/80 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {acc.photoURL ? (
                          <img
                            src={acc.photoURL}
                            alt=""
                            className="w-9 h-9 rounded-full object-cover ring-2 ring-indigo-500/30 shrink-0"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-200 shrink-0">
                            {acc.displayName ? acc.displayName[0].toUpperCase() : "G"}
                          </div>
                        )}

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white truncate">
                              {acc.displayName || "Usuario de Google"}
                            </span>
                            {isActive && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-semibold font-mono">
                                ACTIVA
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono truncate">
                            <span>{acc.email || acc.id}</span>
                            <span>•</span>
                            <span className={isAccountExpired ? "text-rose-400" : "text-slate-400"}>
                              {isAccountExpired ? "Expirado" : `~${minsRemaining}m`}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {!isActive && (
                          <button
                            onClick={() => handleSwitch(acc.id)}
                            disabled={switchingId === acc.id}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                            title="Cambiar y activar esta cuenta"
                          >
                            {switchingId === acc.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <ArrowRightLeft className="w-3.5 h-3.5 text-indigo-400" />
                            )}
                            <span>Activar</span>
                          </button>
                        )}

                        <button
                          onClick={() => onRemoveAccount(acc.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                          title="Desvincular esta cuenta"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Status Overview Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Cookie Status */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium flex items-center gap-1.5">
                  <Cookie className="w-3.5 h-3.5 text-amber-400" />
                  <span>Cookie Activa</span>
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                    hasCookie
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {hasCookie ? "ACTIVA (1 año)" : "NO GUARDADA"}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Almacenada en <code className="text-amber-300 font-mono">document.cookie</code> como{" "}
                <code className="text-slate-300">gdrive_access_token</code>.
              </p>
            </div>

            {/* LocalStorage Status */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Almacenamiento Local</span>
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                    hasToken
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {hasToken ? `${accounts.length} CUENTAS` : "VACÍO"}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Sincronización instantánea de perfiles y carpetas dedicadas al recargar.
              </p>
            </div>
          </div>

          {/* Active Token Info Card */}
          {hasToken && (
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-white">
                    Token de Cuenta Activa ({session.user?.email || "Google Drive"})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyToken}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono transition-colors cursor-pointer"
                    title="Copiar token"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar Token</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 font-mono text-[11px] text-slate-400 truncate">
                {activeToken.substring(0, 22)}...{activeToken.substring(activeToken.length - 8)}
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={handleRenewClick}
                  disabled={isRenewing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRenewing ? "animate-spin" : ""}`} />
                  <span>{isRenewing ? "Renovando..." : "Renovar Token Activo"}</span>
                </button>

                <button
                  onClick={onClearSession}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Desconectar Todas las Cuentas</span>
                </button>
              </div>
            </div>
          )}

          {/* Manual Token / Account Registration Form */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-amber-400" />
              <h4 className="text-xs font-bold text-white">
                Vincular Cuenta Manualmente (Token o Cookie)
              </h4>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Puedes agregar cuentas adicionales mediante un Access Token OAuth2 o Cookie de Google Drive sin sobrescribir las existentes.
            </p>

            <form onSubmit={handleVerifyAndSave} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3 pointer-events-none" />
                  <input
                    type="email"
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    placeholder="Correo (opcional, ej. trabajo@gmail.com)"
                    className="w-full pl-8 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-800 focus:border-amber-500 text-xs text-white placeholder:text-slate-600 outline-none transition-all"
                  />
                </div>
                <div className="relative">
                  <UserIcon className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3 pointer-events-none" />
                  <input
                    type="text"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Etiqueta (ej. Cuenta Personal / Trabajo)"
                    className="w-full pl-8 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-800 focus:border-amber-500 text-xs text-white placeholder:text-slate-600 outline-none transition-all"
                  />
                </div>
              </div>

              <textarea
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="Pega aquí el Access Token OAuth2 (ya29...) o Cookie de Drive..."
                rows={2}
                disabled={isVerifying}
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 focus:border-amber-500 text-xs font-mono text-white placeholder:text-slate-600 outline-none resize-none transition-all"
              />

              {verifyError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                  <span>{verifyError}</span>
                </div>
              )}

              {verifySuccess && (
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                  <span>{verifySuccess}</span>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isVerifying || !manualInput.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-amber-500/20 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isVerifying ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Verificando y Guardando...</span>
                    </>
                  ) : (
                    <>
                      <Cookie className="w-3.5 h-3.5" />
                      <span>Guardar Cuenta en Cookies</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500 font-mono shrink-0">
          <span>Multi-cuentas: 100% Client-Side en tu navegador</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
