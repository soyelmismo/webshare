import fs from "fs";
import os from "os";
import path from "path";

export interface RcloneAccount {
  remoteName: string;
  email: string;
  displayName: string;
  photoURL?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number; // Unix epoch ms
  rootFolderId?: string;
  source: "system_rclone_conf" | "manual_import";
  storageLimit?: number;
  storageUsage?: number;
  lastRefreshedAt: number;
}

export interface RcloneRemoteSummary {
  remoteName: string;
  email: string;
  displayName: string;
  photoURL?: string;
  hasRefreshToken: boolean;
  expiresAt: number;
  minutesRemaining: number;
  source: "system_rclone_conf" | "manual_import";
  storageLimit?: number;
  storageUsage?: number;
}

const CACHE_FILE = path.join(process.cwd(), ".rclone_accounts_cache.json");

/**
 * Parses INI-format configuration file (like rclone.conf).
 */
export function parseRcloneIni(content: string): Record<string, Record<string, string>> {
  const lines = content.split(/\r?\n/);
  const sections: Record<string, Record<string, string>> = {};
  let currentSec = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      currentSec = trimmed.slice(1, -1).trim();
      if (!sections[currentSec]) {
        sections[currentSec] = {};
      }
    } else if (currentSec && trimmed.includes("=")) {
      const idx = trimmed.indexOf("=");
      const key = trimmed.slice(0, idx).trim().toLowerCase();
      const val = trimmed.slice(idx + 1).trim();
      sections[currentSec][key] = val;
    }
  }

  return sections;
}

/**
 * Resolves the path to the system rclone.conf file if available.
 */
export function findSystemRcloneConfPath(): string | null {
  const envPath = process.env.RCLONE_CONFIG;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const userHome = os.homedir();
  const candidates = [
    path.join(userHome, ".config", "rclone", "rclone.conf"),
    path.join(userHome, ".rclone.conf"),
    "/etc/rclone/rclone.conf",
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  return null;
}

/**
 * Refreshes a Google OAuth access token using a refresh token.
 */
export async function refreshGoogleAccessToken(params: {
  refreshToken: string;
  clientId?: string;
  clientSecret?: string;
}): Promise<{ accessToken: string; expiresIn: number; expiresAt: number }> {
  const { refreshToken, clientId, clientSecret } = params;
  if (!refreshToken) {
    throw new Error("No se proporcionó refresh_token para la renovación.");
  }

  const bodyParams = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  if (clientId && clientId.trim()) {
    bodyParams.append("client_id", clientId.trim());
  }
  if (clientSecret && clientSecret.trim()) {
    bodyParams.append("client_secret", clientSecret.trim());
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: bodyParams.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google OAuth2 refresh_token falló (HTTP ${res.status}): ${errText}`);
  }

  const json = await res.json();
  if (!json.access_token) {
    throw new Error("Google no devolvió un access_token válido.");
  }

  const expiresIn = Number(json.expires_in) || 3600;
  // Expire 90 seconds before Google's TTL for maximum safety buffer
  const expiresAt = Date.now() + Math.max(60, expiresIn - 90) * 1000;

  return {
    accessToken: json.access_token,
    expiresIn,
    expiresAt,
  };
}

/**
 * Fetches Google Drive user profile and storage quota using an access token.
 */
export async function fetchDriveProfile(accessToken: string): Promise<{
  email: string;
  displayName: string;
  photoURL?: string;
  storageLimit?: number;
  storageUsage?: number;
}> {
  const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user,storageQuota", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error al obtener información de Google Drive: ${errText}`);
  }

  const data = await res.json();
  const user = data.user || {};
  const quota = data.storageQuota || {};

  return {
    email: user.emailAddress || "cuenta-rclone@google.com",
    displayName: user.displayName || "Cuenta Rclone",
    photoURL: user.photoLink || undefined,
    storageLimit: quota.limit ? Number(quota.limit) : undefined,
    storageUsage: quota.usage ? Number(quota.usage) : undefined,
  };
}

/**
 * Manages Rclone / Refresh Token accounts for permanent, zero-expiration streaming.
 */
export class RcloneAuthManager {
  private accounts: Map<string, RcloneAccount> = new Map();
  private activeRemoteName: string | null = null;
  private isInitialized = false;

  constructor() {
    this.loadFromCache();
    this.scanSystemRcloneConf().catch((e) => {
      console.warn("[RcloneAuth] Error en escaneo inicial de rclone.conf:", e.message);
    });
  }

  /**
   * Scans the system rclone.conf file for Google Drive remotes.
   */
  public async scanSystemRcloneConf(): Promise<number> {
    const confPath = findSystemRcloneConfPath();
    if (!confPath) return 0;

    try {
      const content = fs.readFileSync(confPath, "utf-8");
      const sections = parseRcloneIni(content);
      let found = 0;

      for (const [name, sec] of Object.entries(sections)) {
        if (sec.type !== "drive") continue;

        let tokenObj: any = null;
        if (sec.token) {
          try {
            tokenObj = JSON.parse(sec.token);
          } catch {}
        }

        const refreshToken = tokenObj?.refresh_token;
        if (!refreshToken) continue;

        const clientId = sec.client_id || undefined;
        const clientSecret = sec.client_secret || undefined;
        const rootFolderId = sec.root_folder_id || undefined;

        // Check if we already have this account with fresh access token
        const existing = this.accounts.get(name.toLowerCase());
        let accessToken = existing?.accessToken || tokenObj?.access_token || "";
        let expiresAt = existing?.expiresAt || (tokenObj?.expiry ? new Date(tokenObj.expiry).getTime() : 0);

        // If expired or missing, refresh now
        if (!accessToken || expiresAt <= Date.now() + 60_000) {
          try {
            const refreshed = await refreshGoogleAccessToken({
              refreshToken,
              clientId,
              clientSecret,
            });
            accessToken = refreshed.accessToken;
            expiresAt = refreshed.expiresAt;
          } catch (refErr: any) {
            console.warn(`[RcloneAuth] No se pudo refrescar token inicial para remote "${name}":`, refErr.message);
          }
        }

        let profile = {
          email: existing?.email || `${name}@rclone`,
          displayName: existing?.displayName || `Rclone (${name})`,
          photoURL: existing?.photoURL,
          storageLimit: existing?.storageLimit,
          storageUsage: existing?.storageUsage,
        };

        if (accessToken) {
          try {
            const fetched = await fetchDriveProfile(accessToken);
            profile = { ...profile, ...fetched };
          } catch {}
        }

        const account: RcloneAccount = {
          remoteName: name,
          email: profile.email,
          displayName: profile.displayName,
          photoURL: profile.photoURL,
          clientId,
          clientSecret,
          refreshToken,
          accessToken,
          expiresAt,
          rootFolderId,
          source: "system_rclone_conf",
          storageLimit: profile.storageLimit,
          storageUsage: profile.storageUsage,
          lastRefreshedAt: Date.now(),
        };

        this.accounts.set(name.toLowerCase(), account);
        this.accounts.set(profile.email.toLowerCase(), account);
        if (!this.activeRemoteName) {
          this.activeRemoteName = name;
        }
        found++;
      }

      this.saveToCache();
      return found;
    } catch (e: any) {
      console.warn("[RcloneAuth] Error leyendo system rclone.conf:", e.message);
      return 0;
    }
  }

  /**
   * Imports rclone configuration from user-provided text (INI block, JSON token, or refresh_token).
   */
  public async importFromText(input: string, customName?: string): Promise<RcloneAccount> {
    const trimmed = input.trim();
    if (!trimmed) throw new Error("Entrada vacía");

    let clientId: string | undefined;
    let clientSecret: string | undefined;
    let refreshToken: string | undefined;
    let remoteName = customName || "rclone_custom";
    let rootFolderId: string | undefined;

    // 1. Try parsing as JSON
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const obj = JSON.parse(trimmed);
        refreshToken = obj.refresh_token || obj.refreshToken;
        clientId = obj.client_id || obj.clientId;
        clientSecret = obj.client_secret || obj.clientSecret;
        if (obj.name || obj.remoteName) remoteName = obj.name || obj.remoteName;
        if (obj.root_folder_id || obj.rootFolderId) rootFolderId = obj.root_folder_id || obj.rootFolderId;
      } catch (jsonErr: any) {
        throw new Error(`JSON de token no válido: ${jsonErr.message}`);
      }
    } else if (trimmed.includes("[") && trimmed.includes("=")) {
      // 2. Try parsing as INI
      const sections = parseRcloneIni(trimmed);
      const firstKey = Object.keys(sections)[0];
      if (!firstKey) throw new Error("No se encontraron secciones válidas de rclone");

      remoteName = firstKey;
      const sec = sections[firstKey];
      clientId = sec.client_id;
      clientSecret = sec.client_secret;
      rootFolderId = sec.root_folder_id;

      if (sec.token) {
        try {
          const tok = JSON.parse(sec.token);
          refreshToken = tok.refresh_token;
        } catch {}
      }
    } else if (trimmed.startsWith("1//")) {
      // 3. Raw refresh token
      refreshToken = trimmed;
    }

    if (!refreshToken) {
      throw new Error("No se encontró ningún refresh_token en la entrada suministrada.");
    }

    // Verify by refreshing immediately
    const refreshed = await refreshGoogleAccessToken({
      refreshToken,
      clientId,
      clientSecret,
    });

    const profile = await fetchDriveProfile(refreshed.accessToken);

    const account: RcloneAccount = {
      remoteName,
      email: profile.email,
      displayName: profile.displayName,
      photoURL: profile.photoURL,
      clientId,
      clientSecret,
      refreshToken,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      rootFolderId,
      source: "manual_import",
      storageLimit: profile.storageLimit,
      storageUsage: profile.storageUsage,
      lastRefreshedAt: Date.now(),
    };

    this.accounts.set(remoteName.toLowerCase(), account);
    this.accounts.set(profile.email.toLowerCase(), account);
    this.activeRemoteName = remoteName;

    this.saveToCache();
    return account;
  }

  /**
   * Retrieves a guaranteed-valid (auto-refreshed) access token for the given account/email.
   */
  public async getValidAccessToken(identifier?: string): Promise<string | null> {
    const acc = this.findAccount(identifier);
    if (!acc) return null;

    // Proactive refresh: if expiring in less than 3 minutes, refresh immediately
    const bufferMs = 180_000;
    if (Date.now() >= acc.expiresAt - bufferMs) {
      try {
        const refreshed = await refreshGoogleAccessToken({
          refreshToken: acc.refreshToken,
          clientId: acc.clientId,
          clientSecret: acc.clientSecret,
        });
        acc.accessToken = refreshed.accessToken;
        acc.expiresAt = refreshed.expiresAt;
        acc.lastRefreshedAt = Date.now();
        this.saveToCache();
      } catch (err: any) {
        console.warn(`[RcloneAuth] Error auto-refrescando token para ${acc.email}:`, err.message);
        // If current token is not yet expired, return it as fallback
        if (Date.now() < acc.expiresAt) {
          return acc.accessToken;
        }
        return null;
      }
    }

    return acc.accessToken;
  }

  /**
   * Forces an immediate token refresh with Google (e.g. after receiving a 401 error).
   */
  public async forceRefreshToken(identifier?: string): Promise<string | null> {
    const acc = this.findAccount(identifier);
    if (!acc) return null;

    try {
      console.log(`[RcloneAuth] Forzando renovación de token para ${acc.email}...`);
      const refreshed = await refreshGoogleAccessToken({
        refreshToken: acc.refreshToken,
        clientId: acc.clientId,
        clientSecret: acc.clientSecret,
      });
      acc.accessToken = refreshed.accessToken;
      acc.expiresAt = refreshed.expiresAt;
      acc.lastRefreshedAt = Date.now();
      this.saveToCache();
      return acc.accessToken;
    } catch (err: any) {
      console.warn(`[RcloneAuth] Error forzando renovación de token para ${acc.email}:`, err.message);
      return null;
    }
  }

  /**
   * Returns summaries of all detected and imported remotes.
   */
  public listRemotes(): RcloneRemoteSummary[] {
    const seen = new Set<string>();
    const list: RcloneRemoteSummary[] = [];

    for (const acc of this.accounts.values()) {
      if (seen.has(acc.remoteName.toLowerCase())) continue;
      seen.add(acc.remoteName.toLowerCase());

      const now = Date.now();
      const minutesRemaining = Math.max(0, Math.round((acc.expiresAt - now) / 60000));

      list.push({
        remoteName: acc.remoteName,
        email: acc.email,
        displayName: acc.displayName,
        photoURL: acc.photoURL,
        hasRefreshToken: Boolean(acc.refreshToken),
        expiresAt: acc.expiresAt,
        minutesRemaining,
        source: acc.source,
        storageLimit: acc.storageLimit,
        storageUsage: acc.storageUsage,
      });
    }

    return list;
  }

  public getActiveAccount(): RcloneAccount | null {
    if (this.activeRemoteName) {
      const acc = this.accounts.get(this.activeRemoteName.toLowerCase());
      if (acc) return acc;
    }
    // Return first account if any
    for (const acc of this.accounts.values()) {
      return acc;
    }
    return null;
  }

  public setActiveRemote(name: string): boolean {
    const acc = this.accounts.get(name.toLowerCase());
    if (acc) {
      this.activeRemoteName = acc.remoteName;
      return true;
    }
    return false;
  }

  public removeAccount(nameOrEmail: string): boolean {
    const target = nameOrEmail.toLowerCase();
    const acc = this.accounts.get(target);
    if (!acc) return false;

    this.accounts.delete(acc.remoteName.toLowerCase());
    this.accounts.delete(acc.email.toLowerCase());
    if (this.activeRemoteName === acc.remoteName) {
      this.activeRemoteName = null;
    }
    this.saveToCache();
    return true;
  }

  private findAccount(identifier?: string): RcloneAccount | null {
    if (identifier && identifier.trim()) {
      const clean = identifier.trim().toLowerCase();
      if (this.accounts.has(clean)) {
        return this.accounts.get(clean)!;
      }
    }
    return this.getActiveAccount();
  }

  private loadFromCache(): void {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const raw = fs.readFileSync(CACHE_FILE, "utf-8");
        const list: RcloneAccount[] = JSON.parse(raw);
        for (const acc of list) {
          this.accounts.set(acc.remoteName.toLowerCase(), acc);
          this.accounts.set(acc.email.toLowerCase(), acc);
          if (!this.activeRemoteName) {
            this.activeRemoteName = acc.remoteName;
          }
        }
      }
    } catch {}
  }

  private saveToCache(): void {
    try {
      const seen = new Set<string>();
      const list: RcloneAccount[] = [];
      for (const acc of this.accounts.values()) {
        if (seen.has(acc.remoteName.toLowerCase())) continue;
        seen.add(acc.remoteName.toLowerCase());
        list.push(acc);
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify(list, null, 2), "utf-8");
    } catch {}
  }
}

export const rcloneAuthManager = new RcloneAuthManager();
