import React, { useState, useEffect } from "react";
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
import { StoredDriveSession, loadDriveSession, getClientCookie, verifyDriveToken, onDriveSessionChange } from "../utils/driveStorage";
import { SavedGoogleAccount } from "../types";

interface DriveCookieModalProps {
  isOpen: boolean;
  onClose: () => void;
  session?: StoredDriveSession;
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
  session: propSession,
  accessToken,
  onRenew,
  onAddAnotherAccount,
  onSwitchAccount,
  onRemoveAccount,
  onSaveManualToken,
  onClearSession,
}) => {
  const [driveSession, setDriveSession] = useState<StoredDriveSession>(() => propSession || loadDriveSession());

  useEffect(() => {
    if (propSession) {
      setDriveSession(propSession);
    }
  }, [propSession]);

  useEffect(() => {
    const unsubscribe = onDriveSessionChange((updated) => {
      setDriveSession(updated);
    });
    return () => unsubscribe();
  }, []);

  const session = driveSession;
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
  const hasToken = Boolean(accessToken || session?.token);
  const activeToken = accessToken || session?.token || "";
  const accounts = session?.accounts || [];
  const activeAccountId = session?.activeAccount?.id || session?.user?.email || session?.user?.uid;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#000000]/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#14171a] border border-[#22272e] rounded-xl max-w-2xl w-full p-5 shadow-2xl relative overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#22272e] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#1f242c] flex items-center justify-center text-[#f3f4f6] border border-[#2a303c]">
              <Cookie className="w-5 h-5 text-[#f59e0b]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#f3f4f6] flex items-center gap-2">
                <span>Multi-Cuentas & Cookies Google Drive</span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-[#161a1f] text-[#10b981] border border-[#262b32] font-mono">
                  Client-Side
                </span>
              </h3>
              <p className="text-xs text-[#9ca3af]">
                Gestiona múltiples cuentas de Google y almacena credenciales locales de sesión.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#9ca3af] hover:text-[#f3f4f6] hover:bg-[#1f242c] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="overflow-y-auto py-4 space-y-4 flex-1 pr-1">
          {/* Linked Accounts Section */}
          <div className="p-3.5 rounded-xl bg-[#0e1013] border border-[#22272e] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#10b981]" />
                <h4 className="text-xs font-bold text-[#f3f4f6] uppercase tracking-wide">
                  Cuentas Vinculadas ({accounts.length})
                </h4>
              </div>
              <button
                onClick={handleAddAnother}
                disabled={isAddingGoogle}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1f242c] hover:bg-[#28303b] border border-[#3b424d] text-[#f3f4f6] text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                {isAddingGoogle ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#10b981]" />
                ) : (
                  <UserPlus className="w-3.5 h-3.5 text-[#10b981]" />
                )}
                <span>+ Agregar otra cuenta</span>
              </button>
            </div>

            {accounts.length === 0 ? (
              <div className="p-4 text-center border border-dashed border-[#262b32] rounded-lg bg-[#14171a] space-y-2">
                <p className="text-xs text-[#9ca3af]">No hay cuentas de Google guardadas aún.</p>
                <button
                  onClick={handleAddAnother}
                  className="px-3 py-1.5 rounded-lg bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
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
                      className={`p-3 rounded-lg border flex items-center justify-between gap-3 transition-colors ${
                        isActive
                          ? "bg-[#1a1e24] border-[#10b981]/50"
                          : "bg-[#14171a] border-[#22272e] hover:border-[#2f3540]"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {acc.photoURL ? (
                          <img
                            src={acc.photoURL}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover border border-[#262b32] shrink-0"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-[#1f242c] border border-[#262b32] flex items-center justify-center text-xs font-bold text-[#f3f4f6] shrink-0">
                            {acc.displayName ? acc.displayName[0].toUpperCase() : "G"}
                          </div>
                        )}

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[#f3f4f6] truncate">
                              {acc.displayName || "Usuario de Google"}
                            </span>
                            {isActive && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] bg-[#10b981] text-[#0b0d0e] font-bold font-mono">
                                ACTIVA
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-[#9ca3af] font-mono truncate">
                            <span>{acc.email || acc.id}</span>
                            <span>•</span>
                            <span className={isAccountExpired ? "text-[#f87171]" : "text-[#9ca3af]"}>
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
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#1f242c] hover:bg-[#28303b] border border-[#262b32] text-[#f3f4f6] text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                            title="Cambiar y activar esta cuenta"
                          >
                            {switchingId === acc.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#10b981]" />
                            ) : (
                              <ArrowRightLeft className="w-3.5 h-3.5" />
                            )}
                            <span>Activar</span>
                          </button>
                        )}

                        <button
                          onClick={() => onRemoveAccount(acc.id)}
                          className="p-1.5 rounded-md bg-[#14171a] hover:bg-[#7f1d1d]/30 text-[#9ca3af] hover:text-[#f87171] border border-[#22272e] transition-colors cursor-pointer"
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
            <div className="p-3 rounded-xl bg-[#0e1013] border border-[#22272e] space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#9ca3af] font-medium flex items-center gap-1.5">
                  <Cookie className="w-3.5 h-3.5 text-[#f59e0b]" />
                  <span>Cookie Activa</span>
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                    hasCookie
                      ? "bg-[#064e3b]/30 text-[#34d399] border border-[#059669]/60"
                      : "bg-[#161a1f] text-[#6b7280] border border-[#22272e]"
                  }`}
                >
                  {hasCookie ? "ACTIVA (1 año)" : "NO GUARDADA"}
                </span>
              </div>
              <p className="text-[11px] text-[#6b7280]">
                Almacenada en <code className="text-[#9ca3af] font-mono">document.cookie</code> como{" "}
                <code className="text-[#9ca3af]">gdrive_access_token</code>.
              </p>
            </div>

            {/* LocalStorage Status */}
            <div className="p-3 rounded-xl bg-[#0e1013] border border-[#22272e] space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#9ca3af] font-medium flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-[#3b82f6]" />
                  <span>Almacenamiento Local</span>
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                    hasToken
                      ? "bg-[#064e3b]/30 text-[#34d399] border border-[#059669]/60"
                      : "bg-[#161a1f] text-[#6b7280] border border-[#22272e]"
                  }`}
                >
                  {hasToken ? `${accounts.length} CUENTAS` : "VACÍO"}
                </span>
              </div>
              <p className="text-[11px] text-[#6b7280]">
                Sincronización instantánea de perfiles y carpetas dedicadas al recargar.
              </p>
            </div>
          </div>

          {/* Active Token Info Card */}
          {hasToken && (
            <div className="p-3.5 rounded-xl bg-[#14171a] border border-[#22272e] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#10b981]" />
                  <span className="text-xs font-bold text-[#f3f4f6]">
                    Token Activo ({session?.user?.email || session?.activeAccount?.email || "Google Drive"})
                  </span>
                </div>
                <button
                  onClick={handleCopyToken}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#1f242c] hover:bg-[#28303b] text-[#f3f4f6] border border-[#262b32] text-xs font-mono transition-colors cursor-pointer"
                  title="Copiar token"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#10b981]" />
                      <span className="text-[#10b981]">Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#9ca3af]" />
                      <span>Copiar Token</span>
                    </>
                  )}
                </button>
              </div>

              <div className="p-2 rounded-lg bg-[#0e1013] border border-[#22272e] font-mono text-[11px] text-[#9ca3af] truncate">
                {activeToken.substring(0, 22)}...{activeToken.substring(activeToken.length - 8)}
              </div>

              <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                <button
                  onClick={handleRenewClick}
                  disabled={isRenewing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1f242c] hover:bg-[#28303b] border border-[#3b424d] text-[#f3f4f6] text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRenewing ? "animate-spin text-[#10b981]" : ""}`} />
                  <span>{isRenewing ? "Renovando..." : "Renovar Token Activo"}</span>
                </button>

                <button
                  onClick={onClearSession}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#7f1d1d]/20 hover:bg-[#7f1d1d]/40 text-[#f87171] border border-[#991b1b]/40 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Desconectar Todas las Cuentas</span>
                </button>
              </div>
            </div>
          )}

          {/* Manual Token Form */}
          <div className="p-3.5 rounded-xl bg-[#0e1013] border border-[#22272e] space-y-3">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-[#f59e0b]" />
              <h4 className="text-xs font-bold text-[#f3f4f6]">
                Vincular Cuenta Manualmente (Token o Cookie)
              </h4>
            </div>
            <p className="text-[11px] text-[#9ca3af] leading-relaxed">
              Puedes agregar cuentas adicionales mediante un Access Token OAuth2 o Cookie de Google Drive sin sobrescribir las existentes.
            </p>

            <form onSubmit={handleVerifyAndSave} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 text-[#6b7280] absolute left-3 top-3 pointer-events-none" />
                  <input
                    type="email"
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    placeholder="Correo (opcional, ej. trabajo@gmail.com)"
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#14171a] border border-[#22272e] focus:border-[#3b424d] text-xs text-[#f3f4f6] placeholder-[#6b7280] outline-none"
                  />
                </div>
                <div className="relative">
                  <UserIcon className="w-3.5 h-3.5 text-[#6b7280] absolute left-3 top-3 pointer-events-none" />
                  <input
                    type="text"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Etiqueta (ej. Cuenta Personal / Trabajo)"
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#14171a] border border-[#22272e] focus:border-[#3b424d] text-xs text-[#f3f4f6] placeholder-[#6b7280] outline-none"
                  />
                </div>
              </div>

              <textarea
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="Pega aquí el Access Token OAuth2 (ya29...) o Cookie de Drive..."
                rows={2}
                disabled={isVerifying}
                className="w-full p-2.5 rounded-lg bg-[#14171a] border border-[#22272e] focus:border-[#3b424d] text-xs font-mono text-[#f3f4f6] placeholder-[#6b7280] outline-none resize-none"
              />

              {verifyError && (
                <div className="p-2.5 rounded-lg bg-[#7f1d1d]/20 border border-[#991b1b]/40 text-[#f87171] text-xs flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{verifyError}</span>
                </div>
              )}

              {verifySuccess && (
                <div className="p-2.5 rounded-lg bg-[#064e3b]/30 border border-[#059669]/60 text-[#34d399] text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{verifySuccess}</span>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isVerifying || !manualInput.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e] text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
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
        <div className="pt-3 border-t border-[#22272e] flex items-center justify-between text-[11px] text-[#9ca3af] font-mono shrink-0">
          <span>Multi-cuentas: 100% Client-Side en tu navegador</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#1a1e24] hover:bg-[#222831] border border-[#262b32] text-[#f3f4f6] text-xs font-semibold transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
