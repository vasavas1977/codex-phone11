import { Platform } from "react-native";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "./auth";

export const API_TIMEOUT_MS = 15000;
export type MobileAuthConfig = {
  authProvider: "phone11";
  emailPasswordEnabled: boolean;
  registrationEnabled: false;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function statusMessage(status: number): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "This action is unavailable for your account.";
  if (status === 429)
    return "Too many attempts. Please wait a moment and try again.";
  return "Phone11 is unavailable right now. Please try again.";
}

export function authErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Phone11 could not complete sign-in. Please try again.";
}

async function withTimeout<T>(
  options: RequestInit,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new ApiError("Phone11 took too long to respond. Please try again."),
          );
        }, API_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      controller.signal.aborted
        ? "Phone11 took too long to respond. Please try again."
        : "Cannot connect to Phone11. Check your connection and try again.",
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function fetchWithTimeout(
  url: RequestInfo | URL,
  options: RequestInit = {},
): Promise<Response> {
  return withTimeout(options, (signal) => fetch(url, { ...options, signal }));
}

async function requestJson<T>(
  endpoint: string,
  options: RequestInit = {},
  authenticated = true,
) {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  // Native sessions use only the signed bearer; browser sessions use only HttpOnly cookies.
  headers.delete("Authorization");
  if (authenticated && Platform.OS !== "web") {
    const token = await Auth.getSessionToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  return withTimeout(options, async (signal) => {
    const response = await fetch(
      `${getApiBaseUrl()}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`,
      {
        ...options,
        headers,
        signal,
        credentials: Platform.OS === "web" ? "include" : "omit",
      },
    );
    if (!response.ok)
      throw new ApiError(statusMessage(response.status), response.status);
    let data: T;
    try {
      data =
        response.status === 204 ? ({} as T) : ((await response.json()) as T);
    } catch {
      throw new ApiError(
        "Phone11 returned an unexpected response. Please try again.",
      );
    }
    return { data, response };
  });
}

export async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  return (await requestJson<T>(endpoint, options)).data;
}

export async function getMobileAuthConfig(): Promise<MobileAuthConfig> {
  const { data } = await requestJson<MobileAuthConfig>(
    "/api/mobile/config",
    {},
    false,
  );
  if (
    !data ||
    data.authProvider !== "phone11" ||
    typeof data.emailPasswordEnabled !== "boolean" ||
    data.registrationEnabled !== false
  ) {
    throw new ApiError(
      "Phone11 sign-in is unavailable right now. Please try again.",
    );
  }
  return {
    authProvider: "phone11",
    emailPasswordEnabled: data.emailPasswordEnabled,
    registrationEnabled: false,
  };
}

// A newer sign-in/sign-out must win over an older session validation response.
let authRevision = 0;
let authMutationPending = false;
let refreshInFlight: Promise<Auth.User | null> | null = null;
let clearedAuthRevision = -1;

async function clearAuthForRevision(revision: number): Promise<void> {
  if (revision !== authRevision || clearedAuthRevision === revision) return;
  await Auth.clearAuth();
  if (revision === authRevision) clearedAuthRevision = revision;
}

export async function getMe(_options?: {
  swallowErrors?: boolean;
}): Promise<Auth.User | null> {
  const revision = authRevision;
  try {
    const result = await apiCall<{ user: unknown }>("/api/auth/me");
    const user = Auth.userFromData(result?.user);
    if (!user)
      throw new ApiError(
        "Phone11 could not verify your account. Please try again.",
      );
    if (revision === authRevision) clearedAuthRevision = -1;
    return user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await clearAuthForRevision(revision);
      return null;
    }
    // Network failures and server errors never erase an existing session.
    throw error;
  }
}

export function refreshAuth(): Promise<Auth.User | null> {
  if (authMutationPending) return Promise.resolve(Auth.getAuthSnapshot().user);
  if (refreshInFlight) return refreshInFlight;
  const revision = authRevision;
  const pending = (async () => {
    try {
      Auth.updateAuthState({ error: null });
      if (Platform.OS !== "web") {
        const token = await Auth.getSessionToken();
        if (revision !== authRevision) return null;
        if (!token) {
          await clearAuthForRevision(revision);
          return null;
        }
      }
      // A persisted profile is not proof of a currently valid session.
      const user = await getMe();
      if (revision !== authRevision) return null;
      if (user) await Auth.setUserInfo(user);
      if (revision === authRevision) Auth.updateAuthState({ user });
      return user;
    } catch (error) {
      if (revision === authRevision)
        Auth.updateAuthState({ error: new ApiError(authErrorMessage(error)) });
      return null;
    } finally {
      if (revision === authRevision) Auth.updateAuthState({ loading: false });
    }
  })();
  refreshInFlight = pending;
  void pending.finally(() => {
    if (refreshInFlight === pending) refreshInFlight = null;
  });
  return pending;
}

function beginAuthMutation(): void {
  if (authMutationPending)
    throw new ApiError(
      "Please wait for the current sign-in or sign-out to finish.",
    );
  authMutationPending = true;
  authRevision += 1;
  refreshInFlight = null;
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<Auth.User> {
  if (!email.trim() || !password)
    throw new ApiError("Enter your email and password.");
  beginAuthMutation();
  try {
    await Auth.waitForAuthCleanup();
    const config = await getMobileAuthConfig();
    if (!config.emailPasswordEnabled)
      throw new ApiError(
        "Email sign-in is currently unavailable. Please contact your Phone11 administrator.",
      );
    const { response } = await requestJson<unknown>(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        ...(Platform.OS !== "web"
          ? { headers: { "X-Phone11-Client": "native" } }
          : {}),
        body: JSON.stringify({
          email: email.trim(),
          password,
          rememberMe: false,
        }),
      },
      false,
    );
    if (Platform.OS !== "web") {
      const token = response.headers.get("set-auth-token");
      if (!token?.trim())
        throw new ApiError(
          "Phone11 could not establish a secure session. Please try again.",
        );
      await Auth.setSessionToken(token);
    }
    await Auth.clearUserInfo();
    Auth.updateAuthState({ user: null, error: null });
    const user = await getMe();
    if (!user)
      throw new ApiError(
        "Phone11 could not verify your session. Please sign in again.",
      );
    await Auth.setUserInfo(user);
    Auth.updateAuthState({ user, loading: false, error: null });
    return user;
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 400)
    ) {
      throw new ApiError(
        "Email or password is incorrect. Please try again.",
        error.status,
      );
    }
    throw new ApiError(
      authErrorMessage(error),
      error instanceof ApiError ? error.status : undefined,
    );
  } finally {
    authMutationPending = false;
    Auth.updateAuthState({ loading: false });
  }
}

export async function logout(): Promise<void> {
  beginAuthMutation();
  try {
    await Auth.waitForAuthCleanup();
    try {
      await apiCall("/api/auth/sign-out", { method: "POST", body: "{}" });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    await clearAuthForRevision(authRevision);
  } catch {
    const safeError = new ApiError(
      "Phone11 could not sign out. Please check your connection and try again.",
    );
    Auth.updateAuthState({ error: safeError });
    throw safeError;
  } finally {
    authMutationPending = false;
    Auth.updateAuthState({ loading: false });
  }
}
