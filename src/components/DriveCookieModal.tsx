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
  Cloud,
  Sparkles,
} from "lucide-react";
import {
  StoredDriveSession,
  loadDriveSession,
  getClientCookie,
  verifyDriveToken,
  onDriveSessionChange,
  saveGoogleAccount,
} from "../utils/driveStorage";
import { SavedGoogleAccount } from "../types";
import {
  fetchRcloneStatus,
  useRcloneAccount,
  importRcloneInput,
  removeRcloneAccount,
  RcloneRemoteSummary,
} from "../utils/streamApi";

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

  // Rclone integration state
  const [rcloneRemotes, setRcloneRemotes] = useState<RcloneRemoteSummary[]>([]);
  const [isLoadingRclone, setIsLoadingRclone] = useState(false);
  const [activatingRemote, setActivatingRemote] = useState<string | null>(null);

  const loadRcloneRemotes = async () => {
    setIsLoadingRclone(true);
    try {
      const status = await fetchRcloneStatus();
      if (status && status.remotes) {
        setRcloneRemotes(status.remotes);
      }
    } catch (e) {
      console.warn("Error cargando remotes de rclone:", e);
    } finally {
      setIsLoadingRclone(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadRcloneRemotes();
    }
  }, [isOpen]);

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
    setVerifyError(null);
    setVerifySuccess(null);
    try {
      if (session?.activeAccount?.isAutoRenew) {
        const res = await useRcloneAccount({
          remoteName: session.activeAccount.remoteName,
          email: session.activeAccount.email,
        });
        if (res.token) {
          saveGoogleAccount(
            {
              ...session.activeAccount,
              token: res.token,
              expiresAt: res.account?.expiresAt || Date.now() + 3600 * 1000,
            },
            true
          );
          setVerifySuccess("¡Token Rclone renovado exitosamente desde el servidor!");
          return;
        }
      }
      await onRenew();
    } catch (e: any) {
      setVerifyError(e.message || "Error al renovar token");
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

  const handleRemove = async (acc: SavedGoogleAccount) => {
    if (acc.isAutoRenew) {
      await removeRcloneAccount(acc.remoteName || acc.email);
    }
    await onRemoveAccount(acc.id);
    loadRcloneRemotes();
  };

  const handleActivateRcloneRemote = async (remote: RcloneRemoteSummary) => {
    setActivatingRemote(remote.remoteName);
    setVerifyError(null);
    setVerifySuccess(null);
    try {
      const res = await useRcloneAccount({ remoteName: remote.remoteName });
      if (!res.success || !res.token) {
        throw new Error("No se pudo obtener token de la cuenta de Rclone");
      }
      const accId = res.user?.email || res.account?.email || remote.remoteName;
      const newAcc: SavedGoogleAccount = {
        id: accId,
        displayName: res.user?.displayName || res.account?.displayName || remote.remoteName,
        email: res.user?.email || res.account?.email || `${remote.remoteName}@rclone`,
        photoURL: res.user?.photoURL,
        token: res.token,
        expiresAt: res.account?.expiresAt || Date.now() + 3600 * 1000,
        isAutoRenew: true,
        remoteName: remote.remoteName,
        folder: null,
        addedAt: Date.now(),
      };
      saveGoogleAccount(newAcc, true);
      setVerifySuccess(`¡Cuenta Rclone '${remote.remoteName}' (${newAcc.email}) activada con auto-renovación 24/7!`);
      loadRcloneRemotes();
    } catch (e: any) {
      setVerifyError(e.message || "Error al activar cuenta de Rclone");
    } finally {
      setActivatingRemote(null);
    }
  };

  const handleVerifyAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualInput.trim();
    if (!trimmed) return;

    setIsVerifying(true);
    setVerifyError(null);
    setVerifySuccess(null);

    // Detect if input is Rclone INI config, token JSON, or refresh_token
    const isRcloneInput =
      trimmed.startsWith("{") ||
      trimmed.includes("[") ||
      trimmed.includes("refresh_token") ||
      trimmed.startsWith("1//");

    if (isRcloneInput) {
      try {
        const res = await importRcloneInput({
          content: trimmed,
          name: manualName.trim() || undefined,
        });
        if (!res.success || !res.token) {
          throw new Error("No se pudo importar o refrescar el token de Rclone");
        }
        const accId = res.user?.email || res.account?.email || `rclone-${Date.now().toString().slice(-4)}`;
        const newAcc: SavedGoogleAccount = {
          id: accId,
          displayName: res.user?.displayName || manualName.trim() || res.account?.displayName || "Cuenta Rclone",
          email: res.user?.email || res.account?.email || (manualEmail.trim() || `${accId}@rclone`),
          photoURL: res.user?.photoURL,
          token: res.token,
          expiresAt: res.account?.expiresAt || Date.now() + 3600 * 1000,
          isAutoRenew: true,
          remoteName: res.account?.remoteName,
          folder: null,
          addedAt: Date.now(),
        };
        saveGoogleAccount(newAcc, true);
        setVerifySuccess(`¡Configuración Rclone importada con éxito para ${newAcc.email}! Se auto-renovará 24/7 en segundo plano.`);
        setManualInput("");
        setManualEmail("");
        setManualName("");
        loadRcloneRemotes();
      } catch (err: any) {
        setVerifyError(err?.message || "Error al procesar configuración de Rclone.");
      } finally {
        setIsVerifying(false);
      }
      return;
    }

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
                <span>Multi-Cuentas & Tokens Google Drive</span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-[#064e3b]/40 text-[#34d399] border border-[#059669]/50 font-mono font-bold flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" />
                  Auto-Renew 24/7 (Rclone)
                </span>
              </h3>
              <p className="text-xs text-[#9ca3af]">
                Gestiona cuentas, auto-renovación infinita mediante Rclone y cookies persistentes.
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
          {/* Rclone Auto-Renew Section */}
          <div className="p-3.5 rounded-xl bg-[#0e1013] border border-[#10b981]/30 space-y-3 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-[#10b981]" />
                <h4 className="text-xs font-bold text-[#f3f4f6] uppercase tracking-wide flex items-center gap-2">
                  <span>Tokens Rclone (Auto-Renovación Permanente)</span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/30 font-bold">
                    RECOMENDADO
                  </span>
                </h4>
              </div>
              <button
                onClick={loadRcloneRemotes}
                disabled={isLoadingRclone}
                className="p-1 rounded text-[#9ca3af] hover:text-[#f3f4f6] transition-colors cursor-pointer"
                title="Volver a escanear remotes del servidor"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRclone ? "animate-spin text-[#10b981]" : ""}`} />
              </button>
            </div>

            <p className="text-[11px] text-[#9ca3af] leading-relaxed">
              Los tokens de <code className="text-[#10b981] font-mono">rclone.conf</code> se renuevan automáticamente en el backend cada hora, eliminando para siempre las desconexiones y caídas a mitad de subida.
            </p>

            {isLoadingRclone && rcloneRemotes.length === 0 ? (
              <div className="p-3 text-center text-xs text-[#9ca3af] flex items-center justify-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#10b981]" />
                <span>Detectando remotes en el sistema...</span>
              </div>
            ) : rcloneRemotes.length > 0 ? (
              <div className="space-y-2">
                {rcloneRemotes.map((rem) => {
                  const isCurrentActive =
                    session?.activeAccount?.isAutoRenew &&
                    (session.activeAccount.remoteName === rem.remoteName ||
                      session.activeAccount.email === rem.email);

                  return (
                    <div
                      key={rem.remoteName}
                      className={`p-2.5 rounded-lg border flex items-center justify-between gap-3 transition-colors ${
                        isCurrentActive
                          ? "bg-[#13221b] border-[#10b981]/60"
                          : "bg-[#14171a] border-[#22272e] hover:border-[#2f3540]"
                      }`}
                    >
                      <div className="min-w-0 flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-[#1a231f] border border-[#10b981]/40 flex items-center justify-center text-[#10b981] font-bold text-xs shrink-0">
                          ☁️
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[#f3f4f6] font-mono">
                              [{rem.remoteName}]
                            </span>
                            {rem.displayName && (
                              <span className="text-xs text-[#9ca3af] truncate max-w-[140px]">
                                {rem.displayName}
                              </span>
                            )}
                            <span className="px-1.5 py-0.2 rounded text-[9px] bg-[#064e3b]/40 text-[#34d399] border border-[#059669]/40 font-mono font-bold">
                              Auto-Renew 24/7
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-[#9ca3af] font-mono truncate">
                            <span>{rem.email || "Sin email"}</span>
                            {rem.storageLimit && (
                              <>
                                <span>•</span>
                                <span>
                                  Cuota: {rem.storageUsage ? (rem.storageUsage / 1024 ** 4).toFixed(1) : 0} /{" "}
                                  {(rem.storageLimit / 1024 ** 4).toFixed(1)} TB
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isCurrentActive ? (
                          <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/40 text-xs font-bold font-mono">
                            <Check className="w-3.5 h-3.5" />
                            <span>En Uso</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => handleActivateRcloneRemote(rem)}
                            disabled={activatingRemote === rem.remoteName}
                            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#10b981] hover:bg-[#059669] text-[#0b0d0e] text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
                          >
                            {activatingRemote === rem.remoteName ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5" />
                            )}
                            <span>Conectar y Activar</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-[#14171a] border border-dashed border-[#262b32] text-center space-y-1">
                <p className="text-xs text-[#9ca3af]">
                  No se detectó un archivo <code className="font-mono text-[#f3f4f6]">~/.config/rclone/rclone.conf</code> con remotes tipo drive en este servidor.
                </p>
                <p className="text-[11px] text-[#6b7280]">
                  Puedes pegar tu bloque de configuración <code className="font-mono text-[#9ca3af]">[remote]</code> o el JSON de tokens de tu otro servidor abajo en el formulario manual.
                </p>
              </div>
            )}
          </div>

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
                <span>+ Agregar por Google OAuth</span>
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
                  const isAutoRenew = Boolean(acc.isAutoRenew);
                  const isAccountExpired = !isAutoRenew && acc.expiresAt ? Date.now() > acc.expiresAt : false;
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
                            {isAutoRenew && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] bg-[#064e3b]/40 text-[#34d399] border border-[#059669]/40 font-bold font-mono flex items-center gap-1">
                                <RefreshCw className="w-2.5 h-2.5" />
                                <span>Rclone 24/7</span>
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-[#9ca3af] font-mono truncate">
                            <span>{acc.email || acc.id}</span>
                            <span>•</span>
                            {isAutoRenew ? (
                              <span className="text-[#34d399] font-medium">Permanente (Auto-refresh)</span>
                            ) : (
                              <span className={isAccountExpired ? "text-[#f87171]" : "text-[#9ca3af]"}>
                                {isAccountExpired ? "Expirado" : `~${minsRemaining}m`}
                              </span>
                            )}
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
                          onClick={() => handleRemove(acc)}
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
                  <span>Cookie Local</span>
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
                  {session?.activeAccount?.isAutoRenew && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-[#064e3b]/50 text-[#34d399] border border-[#059669]/50 font-mono font-bold">
                      Auto-Renovación Activa
                    </span>
                  )}
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
                  <span>
                    {isRenewing
                      ? "Renovando..."
                      : session?.activeAccount?.isAutoRenew
                      ? "Refrescar Token Rclone Ahora"
                      : "Renovar Token Activo"}
                  </span>
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

          {/* Manual Token / Rclone Import Form */}
          <div className="p-3.5 rounded-xl bg-[#0e1013] border border-[#22272e] space-y-3">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-[#f59e0b]" />
              <h4 className="text-xs font-bold text-[#f3f4f6]">
                Vincular Cuenta Manualmente (Access Token o Rclone Config / JSON)
              </h4>
            </div>
            <p className="text-[11px] text-[#9ca3af] leading-relaxed">
              Puedes pegar un <code className="font-mono text-[#f3f4f6]">Access Token (ya29...)</code>, un bloque INI de{" "}
              <code className="font-mono text-[#10b981]">rclone.conf</code> (<code className="font-mono">[gdrive]...</code>), o el{" "}
              <code className="font-mono text-[#10b981]">JSON con refresh_token</code>. Si contiene credenciales de Rclone, se auto-renovará 24/7 en segundo plano.
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
                    placeholder="Etiqueta (ej. Cuenta Personal / Rclone Server)"
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#14171a] border border-[#22272e] focus:border-[#3b424d] text-xs text-[#f3f4f6] placeholder-[#6b7280] outline-none"
                  />
                </div>
              </div>

              <textarea
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="Pega aquí el Access Token OAuth2 (ya29...), bloque de rclone.conf [remote] o JSON de tokens..."
                rows={3}
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
                      <span>Verificando e Importando...</span>
                    </>
                  ) : (
                    <>
                      <Cookie className="w-3.5 h-3.5" />
                      <span>Guardar e Importar Cuenta</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-[#22272e] flex items-center justify-between text-[11px] text-[#9ca3af] font-mono shrink-0">
          <span>Tokens & Rclone: Auto-Renovación en segundo plano 24/7</span>
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
