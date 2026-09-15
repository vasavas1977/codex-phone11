import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { SESSION_TOKEN_KEY, USER_INFO_KEY } from "@/constants/oauth";

export type User = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  lastSignedIn: Date;
};

type AuthState = { user: User | null; loading: boolean; error: Error | null };
let authState: AuthState = { user: null, loading: true, error: null };
const authChangeListeners = new Set<() => void>();

export function addAuthChangeListener(listener: () => void): () => void {
  authChangeListeners.add(listener);
  return () => {
    authChangeListeners.delete(listener);
  };
}

export function getAuthSnapshot(): AuthState {
  return authState;
}

export function updateAuthState(next: Partial<AuthState>): void {
  const updated = { ...authState, ...next };
  if (
    updated.user === authState.user &&
    updated.loading === authState.loading &&
    updated.error === authState.error
  )
    return;
  authState = updated;
  authChangeListeners.forEach((listener) => listener());
}

export function userFromData(value: unknown): User | null {
  if (!value || typeof value !== "object") return null;
  const user = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(user.id) ||
    (user.id as number) <= 0 ||
    typeof user.openId !== "string" ||
    !user.openId ||
    ![user.name, user.email, user.loginMethod].every(
      (field) => field === null || typeof field === "string",
    ) ||
    !(
      typeof user.lastSignedIn === "string" || user.lastSignedIn instanceof Date
    )
  )
    return null;
  const lastSignedIn = new Date(user.lastSignedIn);
  if (!Number.isFinite(lastSignedIn.getTime())) return null;
  return {
    id: user.id as number,
    openId: user.openId,
    name: user.name as string | null,
    email: user.email as string | null,
    loginMethod: user.loginMethod as string | null,
    lastSignedIn,
  };
}

export async function getSessionToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    return await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  } catch {
    throw new Error(
      "Phone11 could not read the saved session. Please try again.",
    );
  }
}

export async function setSessionToken(token: string): Promise<void> {
  if (Platform.OS === "web") return;
  if (!token.trim())
    throw new Error(
      "Phone11 could not save the session. Please sign in again.",
    );
  try {
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
  } catch {
    throw new Error(
      "Phone11 could not save the session securely. Please try again.",
    );
  }
}

export async function removeSessionToken(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  } catch {
    throw new Error(
      "Phone11 could not clear the saved session. Please try again.",
    );
  }
}

export async function getUserInfo(): Promise<User | null> {
  if (Platform.OS === "web") return authState.user;
  try {
    const info = await SecureStore.getItemAsync(USER_INFO_KEY);
    return info ? userFromData(JSON.parse(info)) : null;
  } catch {
    return null;
  }
}

// Profile caching is optional and never emits auth events or stores browser credentials.
export async function setUserInfo(user: User): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.setItemAsync(USER_INFO_KEY, JSON.stringify(user));
  } catch {
    // A cache failure does not invalidate a verified session.
  }
}

export async function clearUserInfo(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.deleteItemAsync(USER_INFO_KEY);
  } catch {
    // Cached profiles are never sufficient to authenticate.
  }
}

let clearingAuth: Promise<void> | null = null;
let cleanupFailed = false;

export function waitForAuthCleanup(): Promise<void> {
  return clearingAuth ?? (cleanupFailed ? clearAuth() : Promise.resolve());
}

export function clearAuth(): Promise<void> {
  if (clearingAuth) return clearingAuth;
  updateAuthState({ user: null, loading: false, error: null });
  const pending = (async () => {
    // Attempt every cleanup even when one fails, so SIP cannot retain a prior identity.
    const results = await Promise.allSettled([
      removeSessionToken(),
      clearUserInfo(),
      (async () => {
        try {
          const { sipEngine } = await import("@/lib/sip/engine");
          await sipEngine.destroy();
        } finally {
          const { useSipAccountStore } =
            await import("@/lib/sip/account-store");
          await useSipAccountStore.getState().clearAccount();
        }
      })(),
    ]);
    if (results.some((result) => result.status === "rejected")) {
      throw new Error(
        "Phone11 could not finish clearing the session. Please try again.",
      );
    }
  })();
  clearingAuth = pending;
  void pending.then(
    () => {
      cleanupFailed = false;
      clearingAuth = null;
    },
    () => {
      cleanupFailed = true;
      clearingAuth = null;
    },
  );
  return pending;
}
