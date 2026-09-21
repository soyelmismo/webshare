import { DriveFolderInfo, SavedGoogleAccount } from "../types";

export interface CachedDriveUser {
  uid?: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export interface StoredDriveSession {
  token: string | null;
  expiresAt: number | null;
  isExpired: boolean;
  minutesRemaining: number;
  user: CachedDriveUser | null;
  folder: DriveFolderInfo | null;
  activeAccount: SavedGoogleAccount | null;
  accounts: SavedGoogleAccount[];
}

const COOKIE_NAME = "gdrive_access_token";
const STORAGE_TOKEN_KEY = "gdrive_access_token";
const STORAGE_EXPIRES_KEY = "gdrive_token_expires_at";
const STORAGE_USER_KEY = "gdrive_cached_user";
const STORAGE_FOLDER_KEY = "gdrive_cached_folder";
const STORAGE_ACCOUNTS_KEY = "gdrive_saved_accounts";
const STORAGE_ACTIVE_ACCOUNT_KEY = "gdrive_active_account_id";

/**
 * Helper to get a cookie by name client-side
 */
export function getClientCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(^|;\\s*)" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Helper to set a client-side cookie with long-lived persistence (1 year by default)
 */
export function setClientCookie(name: string, value: string, days: number = 365) {
  if (typeof document === "undefined") return;
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
}

/**
 * Helper to delete a client-side cookie
 */
export function deleteClientCookie(name: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; max-age=0; path=/; SameSite=Lax`;
}

/**
 * Retrieves all saved Google accounts from localStorage
 */
export function getSavedAccounts(): SavedGoogleAccount[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(STORAGE_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("Error leyendo cuentas guardadas de Drive:", e);
    return [];
  }
}

/**
 * Retrieves the currently active account ID
 */
export function getActiveAccountId(): string | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    return localStorage.getItem(STORAGE_ACTIVE_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

/**
 * Gets the full SavedGoogleAccount currently active
 */
export function getActiveAccount(): SavedGoogleAccount | null {
  const accounts = getSavedAccounts();
  if (accounts.length === 0) return null;
  const activeId = getActiveAccountId();
  if (activeId) {
    const found = accounts.find((acc) => acc.id === activeId || acc.email === activeId);
    if (found) return found;
  }
  return accounts[0] || null;
}

/**
 * Saves or updates a Google account in the multi-account pool.
 * If makeActive is true, makes this account active immediately and updates cookies.
 */
export function saveGoogleAccount(
  account: SavedGoogleAccount,
  makeActive: boolean = true
): SavedGoogleAccount[] {
  const accounts = getSavedAccounts();
  const existingIndex = accounts.findIndex(
    (a) => a.id === account.id || (a.email && a.email.toLowerCase() === (account.email || "").toLowerCase())
  );

  let updatedAccounts: SavedGoogleAccount[];
  if (existingIndex >= 0) {
    // Merge existing folder if new one doesn't have it yet
    const existing = accounts[existingIndex];
    const merged: SavedGoogleAccount = {
      ...existing,
      ...account,
      folder: account.folder || existing.folder,
      addedAt: existing.addedAt || Date.now(),
    };
    updatedAccounts = [...accounts];
    updatedAccounts[existingIndex] = merged;
  } else {
    updatedAccounts = [...accounts, account];
  }

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(updatedAccounts));
    } catch (e) {
      console.warn("Error guardando cuentas:", e);
    }
  }

  if (makeActive) {
    setActiveAccount(account.id);
  } else {
    notifyDriveSessionChanged();
  }

  return updatedAccounts;
}

/**
 * Switches the active Google account and sets the appropriate cookies and tokens
 */
export function setActiveAccount(accountId: string): SavedGoogleAccount | null {
  const accounts = getSavedAccounts();
  const target = accounts.find((a) => a.id === accountId || a.email === accountId);
  if (!target) return null;

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(STORAGE_ACTIVE_ACCOUNT_KEY, target.id);
      localStorage.setItem(STORAGE_TOKEN_KEY, target.token);
      if (target.expiresAt) {
        localStorage.setItem(STORAGE_EXPIRES_KEY, target.expiresAt.toString());
      }
      localStorage.setItem(
        STORAGE_USER_KEY,
        JSON.stringify({
          uid: target.id,
          displayName: target.displayName,
          email: target.email,
          photoURL: target.photoURL,
        })
      );
      if (target.folder) {
        localStorage.setItem(STORAGE_FOLDER_KEY, JSON.stringify(target.folder));
      } else {
        localStorage.removeItem(STORAGE_FOLDER_KEY);
      }
    } catch (e) {
      console.warn("Error cambiando cuenta activa en localStorage:", e);
    }
  }

  // Update client cookie
  setClientCookie(COOKIE_NAME, target.token, 365);

  notifyDriveSessionChanged();
  return target;
}

/**
 * Updates the dedicated folder info for an account
 */
export function updateAccountFolder(accountId: string, folder: DriveFolderInfo) {
  const accounts = getSavedAccounts();
  const idx = accounts.findIndex((a) => a.id === accountId || a.email === accountId);
  if (idx >= 0) {
    accounts[idx].folder = folder;
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        localStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
        const activeId = getActiveAccountId();
        if (activeId === accounts[idx].id) {
          localStorage.setItem(STORAGE_FOLDER_KEY, JSON.stringify(folder));
        }
      } catch (e) {
        console.warn("Error actualizando carpeta de cuenta:", e);
      }
    }
    notifyDriveSessionChanged();
  }
}

/**
 * Removes an account from the multi-account pool
 */
export function removeGoogleAccount(accountId: string): SavedGoogleAccount[] {
  const accounts = getSavedAccounts();
  const filtered = accounts.filter((a) => a.id !== accountId && a.email !== accountId);

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(STORAGE_ACCOUNTS_KEY, JSON.stringify(filtered));
      const currentActive = getActiveAccountId();
      if (currentActive === accountId) {
        if (filtered.length > 0) {
          setActiveAccount(filtered[0].id);
        } else {
          localStorage.removeItem(STORAGE_ACTIVE_ACCOUNT_KEY);
          clearDriveSession();
        }
      }
    } catch (e) {
      console.warn("Error eliminando cuenta:", e);
    }
  }

  notifyDriveSessionChanged();
  return filtered;
}

/**
 * Saves Google Drive credentials permanently in both client-side Cookies and LocalStorage
 */
export function saveDriveSession(
  token: string,
  expiresInSeconds: number = 3600,
  user?: CachedDriveUser | null,
  folder?: DriveFolderInfo | null
) {
  const expiresAt = Date.now() + expiresInSeconds * 1000;

  // 1. Save in document.cookie (permanent for 1 year)
  setClientCookie(COOKIE_NAME, token, 365);

  // 2. Save in localStorage
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(STORAGE_TOKEN_KEY, token);
      localStorage.setItem(STORAGE_EXPIRES_KEY, expiresAt.toString());

      if (user) {
        localStorage.setItem(
          STORAGE_USER_KEY,
          JSON.stringify({
            uid: user.uid || "google-user",
            displayName: user.displayName,
            email: user.email,
            photoURL: user.photoURL,
          })
        );
      }

      if (folder) {
        localStorage.setItem(STORAGE_FOLDER_KEY, JSON.stringify(folder));
      }
    } catch (e) {
      console.warn("No se pudo guardar sesión en localStorage:", e);
    }
  }

  // 3. Sync to saved accounts list
  if (user && user.email) {
    const acc: SavedGoogleAccount = {
      id: user.uid || user.email,
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
      token,
      expiresAt,
      folder: folder || null,
      addedAt: Date.now(),
    };
    saveGoogleAccount(acc, true);
  } else {
    notifyDriveSessionChanged();
  }
}

/**
 * Loads the current Google Drive session from client cookies or localStorage
 */
export function loadDriveSession(): StoredDriveSession {
  let token: string | null = null;
  let expiresAt: number | null = null;
  let user: CachedDriveUser | null = null;
  let folder: DriveFolderInfo | null = null;

  const accounts = getSavedAccounts();
  const activeAccount = getActiveAccount();

  if (activeAccount) {
    token = activeAccount.token;
    expiresAt = activeAccount.expiresAt;
    user = {
      uid: activeAccount.id,
      displayName: activeAccount.displayName,
      email: activeAccount.email,
      photoURL: activeAccount.photoURL,
    };
    folder = activeAccount.folder;
  } else {
    // Check cookie first
    token = getClientCookie(COOKIE_NAME);

    // Fallback to localStorage
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        if (!token) {
          token = localStorage.getItem(STORAGE_TOKEN_KEY);
        }

        const exp = localStorage.getItem(STORAGE_EXPIRES_KEY);
        if (exp) {
          expiresAt = parseInt(exp, 10);
        }

        const storedUser = localStorage.getItem(STORAGE_USER_KEY);
        if (storedUser) {
          user = JSON.parse(storedUser);
        }

        const storedFolder = localStorage.getItem(STORAGE_FOLDER_KEY);
        if (storedFolder) {
          folder = JSON.parse(storedFolder);
        }
      } catch (e) {
        console.warn("Error leyendo sesión de Drive desde localStorage:", e);
      }
    }
  }

  const now = Date.now();
  const hasTokenExpired = expiresAt ? now > expiresAt : false;
  // Account is only treated as auto-renewing if the server has not confirmed that Rclone is unavailable
  const isAutoRenew = Boolean(activeAccount?.isAutoRenew && isServerAutoRenewVerified !== false);
  const isExpired = isAutoRenew
    ? (hasTokenExpired && isServerAutoRenewVerified === false ? true : false)
    : hasTokenExpired;
  const minutesRemaining = isAutoRenew && !isExpired
    ? (isServerAutoRenewVerified === true ? 999999 : (expiresAt ? Math.max(0, Math.round((expiresAt - now) / 60000)) : 60))
    : (expiresAt ? Math.max(0, Math.round((expiresAt - now) / 60000)) : 0);

  return {
    token,
    expiresAt,
    isExpired,
    minutesRemaining,
    user,
    folder,
    activeAccount,
    accounts,
  };
}

type SessionChangeListener = (session: StoredDriveSession) => void;
const sessionChangeListeners: Set<SessionChangeListener> = new Set();

export function notifyDriveSessionChanged() {
  const currentSession = loadDriveSession();
  sessionChangeListeners.forEach((fn) => {
    try {
      fn(currentSession);
    } catch (e) {
      console.warn("Error en listener de cambio de sesión de Drive:", e);
    }
  });
}

export function onDriveSessionChange(listener: SessionChangeListener): () => void {
  sessionChangeListeners.add(listener);
  return () => {
    sessionChangeListeners.delete(listener);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (
      e.key === STORAGE_ACCOUNTS_KEY ||
      e.key === STORAGE_ACTIVE_ACCOUNT_KEY ||
      e.key === STORAGE_TOKEN_KEY ||
      e.key === STORAGE_USER_KEY ||
      e.key === STORAGE_FOLDER_KEY
    ) {
      notifyDriveSessionChanged();
    }
  });
}

type ExpiryListener = (reason?: string) => void;
const sessionExpiredListeners: Set<ExpiryListener> = new Set();

export function notifyDriveSessionExpired(reason?: string) {
  sessionExpiredListeners.forEach((fn) => {
    try {
      fn(reason);
    } catch (e) {
      console.warn("Error in session expired listener:", e);
    }
  });
}

export function onDriveSessionExpired(listener: ExpiryListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

/**
 * Clears active Google Drive session
 */
export function clearDriveSession() {
  deleteClientCookie(COOKIE_NAME);

  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.removeItem(STORAGE_TOKEN_KEY);
      localStorage.removeItem(STORAGE_EXPIRES_KEY);
      localStorage.removeItem(STORAGE_USER_KEY);
      localStorage.removeItem(STORAGE_FOLDER_KEY);
    } catch (e) {
      console.warn("Error borrando sesión de localStorage:", e);
    }
  }

  notifyDriveSessionChanged();
}

/**
 * Clears ALL accounts, cookies and stored sessions
 */
export function clearAllDriveSessions() {
  deleteClientCookie(COOKIE_NAME);
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.removeItem(STORAGE_TOKEN_KEY);
      localStorage.removeItem(STORAGE_EXPIRES_KEY);
      localStorage.removeItem(STORAGE_USER_KEY);
      localStorage.removeItem(STORAGE_FOLDER_KEY);
      localStorage.removeItem(STORAGE_ACCOUNTS_KEY);
      localStorage.removeItem(STORAGE_ACTIVE_ACCOUNT_KEY);
    } catch (e) {
      console.warn("Error borrando todas las cuentas:", e);
    }
  }

  notifyDriveSessionChanged();
}

/**
 * Validates a Google Drive access token using Google's tokeninfo endpoint.
 */
export async function verifyDriveToken(token: string): Promise<{
  valid: boolean;
  expiresInSec?: number;
  email?: string;
  scope?: string;
  error?: string;
}> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(token)}`
    );

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      return {
        valid: false,
        error: errJson.error_description || "Token inválido o expirado",
      };
    }

    const data = await res.json();
    return {
      valid: true,
      expiresInSec: data.expires_in,
      email: data.email,
      scope: data.scope,
    };
  } catch (err: any) {
    return {
      valid: false,
      error: err?.message || "Error de red al verificar el token",
    };
  }
}

// Server auto-renewal verification state:
// null = not checked yet, true = backend confirmed Rclone active, false = backend returned 404 (no Rclone on server)
export let isServerAutoRenewVerified: boolean | null = null;

/**
 * Synchronizes the active Google Drive token from the backend if it is an auto-renewing Rclone account.
 */
export async function syncRcloneActiveToken(): Promise<string | null> {
  const active = getActiveAccount();
  if (!active || !active.isAutoRenew) return null;
  try {
    const emailParam = active.email ? `?email=${encodeURIComponent(active.email)}` : "";
    const res = await fetch(`/api/drive/rclone/active-token${emailParam}`);
    if (!res.ok) {
      if (res.status === 404 || res.status === 400) {
        // Backend confirms Rclone auto-renewal is NOT configured on this machine/instance
        isServerAutoRenewVerified = false;
        notifyDriveSessionChanged();
      }
      return null;
    }
    const data = await res.json();
    if (data.token) {
      isServerAutoRenewVerified = true;
      if (data.token !== active.token || (data.expiresAt && data.expiresAt !== active.expiresAt)) {
        active.token = data.token;
        if (data.expiresAt) active.expiresAt = data.expiresAt;
        saveGoogleAccount(active, true);
      }
      return data.token;
    }
  } catch (e) {
    console.warn("Error sincronizando token de rclone:", e);
  }
  return null;
}

// Background sync for auto-renewing rclone accounts
if (typeof window !== "undefined") {
  // Run initial check on startup
  const initialActive = getActiveAccount();
  if (initialActive?.isAutoRenew) {
    syncRcloneActiveToken().catch(() => {});
  }

  setInterval(() => {
    const active = getActiveAccount();
    if (active?.isAutoRenew) {
      syncRcloneActiveToken().catch(() => {});
    }
  }, 4 * 60 * 1000);
}

