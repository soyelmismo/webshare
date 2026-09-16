import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";
import {
  saveDriveSession,
  loadDriveSession,
  clearDriveSession,
  clearAllDriveSessions,
  saveGoogleAccount,
  setActiveAccount,
  getActiveAccount,
  getSavedAccounts,
  removeGoogleAccount,
  verifyDriveToken,
  CachedDriveUser,
} from "./driveStorage";
import { SavedGoogleAccount } from "../types";

export const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.activity",
  "https://www.googleapis.com/auth/drive.activity.readonly",
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.apps.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.install",
  "https://www.googleapis.com/auth/drive.meet.readonly",
  "https://www.googleapis.com/auth/drive.metadata",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.photos.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.scripts",
];

// Initialize Firebase App instance safely without re-initializing
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => {
  provider.addScope(scope);
});
provider.setCustomParameters({
  prompt: "consent",
  access_type: "offline",
});

// Flag to indicate if sign-in is currently underway
let isSigningIn = false;

// Initialize cached access token from persistent client-side cookies & localStorage
const initialSession = loadDriveSession();
let cachedAccessToken: string | null = initialSession.token;

/**
 * Creates a compatible Firebase User object from cached/cookie profile
 */
export function createSyntheticUser(cached: CachedDriveUser): User {
  return {
    uid: cached.uid || "google-user",
    displayName: cached.displayName,
    email: cached.email,
    photoURL: cached.photoURL,
    emailVerified: true,
    isAnonymous: false,
    metadata: {},
    providerData: [],
    refreshToken: "",
    tenantId: null,
    delete: async () => {},
    getIdToken: async () => "",
    getIdTokenResult: async () => ({} as any),
    reload: async () => {},
    toJSON: () => ({}),
    phoneNumber: null,
    providerId: "google.com",
  } as unknown as User;
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  // 1. Immediately check if there is a permanent token in Cookies / LocalStorage
  const stored = loadDriveSession();
  if (stored.token) {
    cachedAccessToken = stored.token;
    if (stored.user && onAuthSuccess) {
      // Restore immediately so UI does not flicker or require re-login
      onAuthSuccess(createSyntheticUser(stored.user), stored.token);
    }
  }

  // 2. Listen to Firebase auth state changes
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (!cachedAccessToken) {
      const currentStored = loadDriveSession();
      if (currentStored.token) {
        cachedAccessToken = currentStored.token;
      }
    }

    if (user) {
      if (cachedAccessToken) {
        // Save/refresh session in client-side cookies & localStorage
        saveDriveSession(cachedAccessToken, 3600, {
          uid: user.uid,
          displayName: user.displayName,
          email: user.email,
          photoURL: user.photoURL,
        });
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      // Even if Firebase auth is null (e.g. reload or custom token), if we have a valid stored token & user, keep it
      if (cachedAccessToken) {
        const currentStored = loadDriveSession();
        if (currentStored.token && currentStored.user) {
          if (onAuthSuccess) {
            onAuthSuccess(createSyntheticUser(currentStored.user), currentStored.token);
          }
          return;
        }
      }

      if (onAuthFailure) onAuthFailure();
    }
  });
};

/**
 * Initiates Google sign-in.
 * Pass selectAccount=true to force the Google Account Chooser dialog
 * allowing the user to add a second/third Google account.
 */
export const googleSignIn = async (
  selectAccount: boolean = false
): Promise<{ user: User; accessToken: string; account: SavedGoogleAccount } | null> => {
  try {
    isSigningIn = true;
    if (selectAccount) {
      provider.setCustomParameters({
        prompt: "select_account",
        access_type: "offline",
      });
    } else {
      provider.setCustomParameters({
        prompt: "consent",
        access_type: "offline",
      });
    }

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("No se pudo obtener el token de acceso de Google Drive.");
    }

    cachedAccessToken = credential.accessToken;

    const savedAcc: SavedGoogleAccount = {
      id: result.user.email || result.user.uid,
      displayName: result.user.displayName,
      email: result.user.email,
      photoURL: result.user.photoURL,
      token: cachedAccessToken,
      expiresAt: Date.now() + 3600 * 1000,
      folder: null,
      addedAt: Date.now(),
    };

    saveGoogleAccount(savedAcc, true);

    return { user: result.user, accessToken: cachedAccessToken, account: savedAcc };
  } catch (error: any) {
    console.error("Error al iniciar sesión con Google:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Switches the active Google account to another one in the multi-account pool
 */
export const switchGoogleAccount = (
  accountId: string
): { user: User; token: string; account: SavedGoogleAccount } | null => {
  const switched = setActiveAccount(accountId);
  if (!switched) return null;

  cachedAccessToken = switched.token;
  const user = createSyntheticUser({
    uid: switched.id,
    displayName: switched.displayName,
    email: switched.email,
    photoURL: switched.photoURL,
  });

  return { user, token: switched.token, account: switched };
};

/**
 * Manually set or update a custom Google Drive access token or cookie
 */
export const setCustomDriveToken = (
  token: string,
  userProfile?: { displayName?: string | null; email?: string | null; photoURL?: string | null }
): { user: User; account: SavedGoogleAccount } => {
  cachedAccessToken = token.trim();
  const email = userProfile?.email || `manual-${Date.now().toString().slice(-4)}@google.com`;
  const name = userProfile?.displayName || "Google Drive User";

  const user: CachedDriveUser = {
    uid: email,
    displayName: name,
    email: email,
    photoURL: userProfile?.photoURL || null,
  };

  const savedAcc: SavedGoogleAccount = {
    id: email,
    displayName: name,
    email: email,
    photoURL: userProfile?.photoURL || null,
    token: cachedAccessToken,
    expiresAt: Date.now() + 3600 * 24 * 30 * 1000, // 30 days
    folder: null,
    addedAt: Date.now(),
  };

  saveGoogleAccount(savedAcc, true);

  return {
    user: createSyntheticUser(user),
    account: savedAcc,
  };
};

export const getAccessToken = async (): Promise<string | null> => {
  if (!cachedAccessToken) {
    const session = loadDriveSession();
    cachedAccessToken = session.token;
  }
  return cachedAccessToken;
};

export const logout = async () => {
  try {
    await auth.signOut();
  } catch (e) {
    console.error("Error signing out:", e);
  } finally {
    cachedAccessToken = null;
    clearDriveSession();
  }
};

export const removeSavedAccount = (accountId: string) => {
  return removeGoogleAccount(accountId);
};

export const clearAllAccounts = async () => {
  try {
    await auth.signOut();
  } catch (e) {
    console.error("Error signing out:", e);
  } finally {
    cachedAccessToken = null;
    clearAllDriveSessions();
  }
};
