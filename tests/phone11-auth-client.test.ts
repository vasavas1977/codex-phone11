import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const storage = new Map<string, string>();
  return {
    platform: { OS: "ios" },
    storage,
    get: vi.fn(async (key: string) => storage.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
    destroy: vi.fn(async () => {}),
    clearAccount: vi.fn(async () => {}),
  };
});
vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: mocks.get,
  setItemAsync: mocks.set,
  deleteItemAsync: mocks.remove,
}));
vi.mock("@/lib/sip/engine", () => ({ sipEngine: { destroy: mocks.destroy } }));
vi.mock("@/lib/sip/account-store", () => ({
  useSipAccountStore: {
    getState: () => ({ clearAccount: mocks.clearAccount }),
  },
}));

const canonicalUser = {
  id: 11,
  openId: "phone11-user-11",
  name: "Test User",
  email: "test@example.com",
  loginMethod: "email",
  lastSignedIn: "2026-09-09T00:00:00.000Z",
};
const config = {
  authProvider: "phone11",
  emailPasswordEnabled: true,
  registrationEnabled: false,
};
const signedToken = "signed-native-test-session";
const password = "test-password-with-spaces ";
let api: typeof import("../lib/_core/api");
let auth: typeof import("../lib/_core/auth");
let keys: typeof import("../constants/oauth");
let fetchMock: ReturnType<typeof vi.fn>;

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function successfulSignIn() {
  fetchMock
    .mockResolvedValueOnce(json(config))
    .mockResolvedValueOnce(
      json(
        { token: "unsigned-body-token", user: { id: "better-auth-id" } },
        200,
        { "set-auth-token": signedToken },
      ),
    )
    .mockResolvedValueOnce(json({ user: canonicalUser }));
}

async function signedIn() {
  await auth.setSessionToken(signedToken);
  const user = auth.userFromData(canonicalUser)!;
  await auth.setUserInfo(user);
  auth.updateAuthState({ user, loading: false });
  return user;
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.storage.clear();
  mocks.platform.OS = "ios";
  vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", "https://phone11.test");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  api = await import("../lib/_core/api");
  auth = await import("../lib/_core/auth");
  keys = await import("../constants/oauth");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Phone11 email/password client", () => {
  it("stores only the signed header token natively, then verifies the canonical profile with bearer auth", async () => {
    successfulSignIn();
    const user = await api.signInWithEmail("  test@example.com  ", password);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/api/mobile/config",
      "/api/auth/sign-in/email",
      "/api/auth/me",
    ]);
    const [, options] = fetchMock.mock.calls[1];
    expect(JSON.parse(options.body)).toEqual({
      email: "test@example.com",
      password,
      rememberMe: false,
    });
    expect(options.credentials).toBe("omit");
    expect(options.headers.get("X-Phone11-Client")).toBe("native");
    expect(fetchMock.mock.calls[0][1].headers.has("X-Phone11-Client")).toBe(
      false,
    );
    expect(fetchMock.mock.calls[2][1].headers.has("X-Phone11-Client")).toBe(
      false,
    );
    expect(options.headers.has("authorization")).toBe(false);
    expect(fetchMock.mock.calls[2][1].headers.get("authorization")).toBe(
      `Bearer ${signedToken}`,
    );
    expect(mocks.storage.get(keys.SESSION_TOKEN_KEY)).toBe(signedToken);
    expect(user.id).toBe(11);
    expect(user.lastSignedIn).toEqual(new Date(canonicalUser.lastSignedIn));
    expect(auth.getAuthSnapshot().user).toEqual(user);
    expect(JSON.parse(mocks.storage.get(keys.USER_INFO_KEY)!)).toEqual(
      canonicalUser,
    );
  });

  it("waits for native secure storage before making the profile request", async () => {
    let release!: () => void;
    const stored = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.set.mockImplementationOnce(async (key, value) => {
      await stored;
      mocks.storage.set(key, value);
    });
    successfulSignIn();
    const pending = api.signInWithEmail(canonicalUser.email, password);
    await vi.waitFor(() => expect(mocks.set).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.getAuthSnapshot().user).toBeNull();
    release();
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses cookies on web and never reads or stores a bearer, even when the response includes one", async () => {
    mocks.platform.OS = "web";
    const browserStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", browserStorage);
    vi.stubGlobal("window", { localStorage: browserStorage });
    successfulSignIn();
    await api.signInWithEmail(canonicalUser.email, password);
    expect(
      fetchMock.mock.calls.every(
        ([, options]) => !options.headers.has("X-Phone11-Client"),
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.every(
        ([, options]) => options.credentials === "include",
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.every(
        ([, options]) => !options.headers.has("authorization"),
      ),
    ).toBe(true);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(browserStorage.setItem).not.toHaveBeenCalled();
    expect(browserStorage.getItem).not.toHaveBeenCalled();
    expect(await auth.getSessionToken()).toBeNull();
  });

  it("does not fall back to the unsigned response-body token when the signed header is absent", async () => {
    fetchMock
      .mockResolvedValueOnce(json(config))
      .mockResolvedValueOnce(json({ token: "untrusted", user: canonicalUser }));
    await expect(
      api.signInWithEmail(canonicalUser.email, password),
    ).rejects.toThrow("secure session");
    expect(mocks.set).not.toHaveBeenCalled();
    expect(auth.getAuthSnapshot().user).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed if secure storage cannot save the signed bearer", async () => {
    mocks.set.mockRejectedValueOnce(new Error("sensitive native exception"));
    successfulSignIn();
    await expect(
      api.signInWithEmail(canonicalUser.email, password),
    ).rejects.toThrow("Please try again");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.getAuthSnapshot().user).toBeNull();
  });

  it.each([400, 401, 403, 429, 500])(
    "sanitizes sign-in status %s and never caches a failed login profile",
    async (status) => {
      fetchMock.mockResolvedValueOnce(json(config)).mockResolvedValueOnce(
        json(
          {
            message: "secret database failure",
            password,
            user: canonicalUser,
          },
          status,
        ),
      );
      const error = await api
        .signInWithEmail(canonicalUser.email, password)
        .catch((failure) => failure);
      expect(error).toBeInstanceOf(api.ApiError);
      expect(error.message).not.toContain("secret");
      expect(error.message).not.toContain(password);
      expect(mocks.set).not.toHaveBeenCalled();
      expect(auth.getAuthSnapshot().user).toBeNull();
    },
  );

  it.each([
    { ...config, emailPasswordEnabled: false },
    { authProvider: "legacy", appId: "legacy-app" },
    { ...config, registrationEnabled: true },
  ])(
    "rejects unavailable or incompatible configuration without starting another login flow",
    async (data) => {
      fetchMock.mockResolvedValueOnce(json(data));
      await expect(
        api.signInWithEmail(canonicalUser.email, password),
      ).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(mocks.set).not.toHaveBeenCalled();
    },
  );

  it("allows retry after a config failure without caching the failed response", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(json(config));
    await expect(api.getMobileAuthConfig()).rejects.toThrow(
      "Check your connection",
    );
    await expect(api.getMobileAuthConfig()).resolves.toEqual(config);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    null,
    { ...canonicalUser, id: "11" },
    { ...canonicalUser, lastSignedIn: "invalid" },
  ])("rejects an unverified canonical profile", async (user) => {
    fetchMock
      .mockResolvedValueOnce(json(config))
      .mockResolvedValueOnce(
        json({ user: canonicalUser }, 200, { "set-auth-token": signedToken }),
      )
      .mockResolvedValueOnce(json({ user }));
    await expect(
      api.signInWithEmail(canonicalUser.email, password),
    ).rejects.toThrow("verify your account");
    expect(auth.getAuthSnapshot().user).toBeNull();
    expect(mocks.storage.has(keys.USER_INFO_KEY)).toBe(false);
  });

  it("does not log tokens, response headers, passwords, raw failures, or profiles", async () => {
    const spies = ["log", "warn", "error", "debug", "info"].map((method) =>
      vi.spyOn(console, method as "log").mockImplementation(() => {}),
    );
    successfulSignIn();
    await api.signInWithEmail(canonicalUser.email, password);
    fetchMock.mockRejectedValueOnce(new Error(password));
    await api.getMe().catch(() => {});
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("Phone11 session lifecycle", () => {
  it.each(["ios", "web"])(
    "clears rejected auth on 401 on %s without notification/refetch loops",
    async (platform) => {
      mocks.platform.OS = platform;
      await signedIn();
      const listener = vi.fn();
      const unsubscribe = auth.addAuthChangeListener(listener);
      fetchMock.mockResolvedValueOnce(json({ message: "expired" }, 401));
      await expect(api.refreshAuth()).resolves.toBeNull();
      expect(auth.getAuthSnapshot()).toMatchObject({
        user: null,
        loading: false,
      });
      expect(await auth.getSessionToken()).toBeNull();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(mocks.destroy).toHaveBeenCalledTimes(1);
      expect(mocks.clearAccount).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      unsubscribe();
    },
  );

  it.each(["ios", "web"])(
    "preserves verified auth on %s through network failure, 500, 503, and malformed 200 responses",
    async (platform) => {
      mocks.platform.OS = platform;
      const user = await signedIn();
      fetchMock
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(json({ message: "backend details" }, 500))
        .mockResolvedValueOnce(json({ message: "schema unavailable" }, 503))
        .mockResolvedValueOnce(json({ user: null }));
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await api.refreshAuth();
        expect(auth.getAuthSnapshot()).toMatchObject({ user, loading: false });
        expect(auth.getAuthSnapshot().error).toBeInstanceOf(api.ApiError);
      }
      if (platform !== "web")
        expect(await auth.getSessionToken()).toBe(signedToken);
      expect(mocks.destroy).not.toHaveBeenCalled();
      expect(mocks.clearAccount).not.toHaveBeenCalled();
    },
  );

  it("does not swallow server failures as signed-out responses", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(api.getMe({ swallowErrors: true })).rejects.toMatchObject({
      status: 500,
    });
  });

  it("does not treat a cached profile without a native token as authentication", async () => {
    mocks.storage.set(keys.USER_INFO_KEY, JSON.stringify(canonicalUser));
    await api.refreshAuth();
    expect(auth.getAuthSnapshot()).toMatchObject({
      user: null,
      loading: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 503, "network"])(
    "never authenticates a cold-start cached profile when its stale token encounters %s",
    async (failure) => {
      mocks.storage.set(keys.SESSION_TOKEN_KEY, signedToken);
      mocks.storage.set(keys.USER_INFO_KEY, JSON.stringify(canonicalUser));
      const observedAuthenticated: boolean[] = [];
      const unsubscribe = auth.addAuthChangeListener(() => {
        observedAuthenticated.push(Boolean(auth.getAuthSnapshot().user));
      });
      let resolveMe!: (response: Response) => void;
      let rejectMe!: (error: Error) => void;
      fetchMock.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve, reject) => {
            resolveMe = resolve;
            rejectMe = reject;
          }),
      );
      const refresh = api.refreshAuth();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const whileVerifying = auth.getAuthSnapshot();
      if (failure === "network") rejectMe(new Error("offline"));
      else resolveMe(json({}, failure as number));
      await refresh;
      unsubscribe();

      expect(whileVerifying).toMatchObject({ user: null, loading: true });
      expect(auth.getAuthSnapshot()).toMatchObject({
        user: null,
        loading: false,
      });
      expect(observedAuthenticated).not.toContain(true);
      expect(await auth.getSessionToken()).toBe(
        failure === 401 ? null : signedToken,
      );
      if (failure !== 401) {
        expect(mocks.destroy).not.toHaveBeenCalled();
        expect(mocks.clearAccount).not.toHaveBeenCalled();
      }
    },
  );

  it("authenticates a cold start only after receiving the verified profile", async () => {
    mocks.storage.set(keys.SESSION_TOKEN_KEY, signedToken);
    mocks.storage.set(
      keys.USER_INFO_KEY,
      JSON.stringify({ ...canonicalUser, id: 999 }),
    );
    let resolveMe!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveMe = resolve;
        }),
    );
    const refresh = api.refreshAuth();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const whileVerifying = auth.getAuthSnapshot();
    resolveMe(json({ user: canonicalUser }));
    await refresh;

    expect(whileVerifying).toMatchObject({ user: null, loading: true });
    expect(auth.getAuthSnapshot()).toMatchObject({
      user: { id: canonicalUser.id },
      loading: false,
    });
  });

  it("clears missing-session SIP identity once across concurrent and repeated startup checks", async () => {
    mocks.storage.set(keys.USER_INFO_KEY, JSON.stringify(canonicalUser));
    const listener = vi.fn();
    const unsubscribe = auth.addAuthChangeListener(listener);
    const first = api.refreshAuth();
    const second = api.refreshAuth();
    expect(first).toBe(second);
    await Promise.all([first, second]);
    await api.refreshAuth();
    await api.refreshAuth();

    expect(auth.getAuthSnapshot()).toMatchObject({
      user: null,
      loading: false,
    });
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.clearAccount).toHaveBeenCalledTimes(1);
    expect(mocks.storage.has(keys.USER_INFO_KEY)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("allows a later explicit retry when missing-session SIP cleanup fails", async () => {
    mocks.clearAccount.mockRejectedValueOnce(
      new Error("device cleanup failed"),
    );
    await api.refreshAuth();
    const failedCleanup = auth.getAuthSnapshot();
    await api.refreshAuth();
    await api.refreshAuth();

    expect(failedCleanup.user).toBeNull();
    expect(failedCleanup.error).toBeInstanceOf(api.ApiError);
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
    expect(mocks.clearAccount).toHaveBeenCalledTimes(2);
    expect(auth.getAuthSnapshot()).toMatchObject({
      user: null,
      loading: false,
      error: null,
    });
  });

  it("cleans up a subsequently lost native session after startup cleanup has already completed", async () => {
    await api.refreshAuth();
    successfulSignIn();
    await api.signInWithEmail(canonicalUser.email, password);
    await auth.removeSessionToken();
    await api.refreshAuth();
    await api.refreshAuth();

    expect(mocks.destroy).toHaveBeenCalledTimes(2);
    expect(mocks.clearAccount).toHaveBeenCalledTimes(2);
    expect(auth.getAuthSnapshot().user).toBeNull();
  });

  it("does not repeat completed 401 cleanup when later native checks find no token", async () => {
    await signedIn();
    fetchMock.mockResolvedValueOnce(json({}, 401));
    await api.refreshAuth();
    await api.refreshAuth();
    await api.refreshAuth();
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.clearAccount).toHaveBeenCalledTimes(1);
    expect(auth.getAuthSnapshot().user).toBeNull();
  });

  it("allows cleanup of a later verified cookie session after a signed-out startup", async () => {
    mocks.platform.OS = "web";
    fetchMock
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ user: canonicalUser }))
      .mockResolvedValueOnce(json({}, 401));
    await api.refreshAuth();
    await api.refreshAuth();
    expect(auth.getAuthSnapshot().user?.id).toBe(canonicalUser.id);
    await api.refreshAuth();
    expect(auth.getAuthSnapshot().user).toBeNull();
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
    expect(mocks.clearAccount).toHaveBeenCalledTimes(2);
  });

  it("ignores legacy native token/profile keys", async () => {
    mocks.storage.set("app_session_token", "legacy-token");
    mocks.storage.set("manus-runtime-user-info", JSON.stringify(canonicalUser));
    await api.refreshAuth();
    expect(auth.getAuthSnapshot().user).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent session checks and does not re-enter loading after validation", async () => {
    await signedIn();
    fetchMock.mockResolvedValueOnce(json({ user: canonicalUser }));
    const observedLoading: boolean[] = [];
    const unsubscribe = auth.addAuthChangeListener(() =>
      observedLoading.push(auth.getAuthSnapshot().loading),
    );
    const first = api.refreshAuth();
    const second = api.refreshAuth();
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(observedLoading).not.toContain(true);
    expect(observedLoading.length).toBeLessThanOrEqual(1);
    unsubscribe();
  });

  it.each(["ios", "web"])(
    "invalidates the current %s session before clearing local auth",
    async (platform) => {
      mocks.platform.OS = platform;
      await signedIn();
      fetchMock.mockImplementationOnce(async (url, options) => {
        expect(url).toBe("https://phone11.test/api/auth/sign-out");
        expect(options.method).toBe("POST");
        expect(auth.getAuthSnapshot().user).not.toBeNull();
        expect(options.headers.get("authorization")).toBe(
          platform === "web" ? null : `Bearer ${signedToken}`,
        );
        expect(options.credentials).toBe(
          platform === "web" ? "include" : "omit",
        );
        return json({ success: true });
      });
      await api.logout();
      expect(auth.getAuthSnapshot().user).toBeNull();
      expect(await auth.getSessionToken()).toBeNull();
      expect(mocks.destroy).toHaveBeenCalledTimes(1);
      expect(mocks.clearAccount).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["network", 503])(
    "retains the session when server invalidation fails with %s so sign-out can be retried",
    async (failure) => {
      const user = await signedIn();
      if (failure === "network")
        fetchMock.mockRejectedValueOnce(new Error("offline"));
      else
        fetchMock.mockResolvedValueOnce(
          json({ error: "session deletion failed" }, 503),
        );
      fetchMock.mockResolvedValueOnce(json({ success: true }));
      await expect(api.logout()).rejects.toThrow("could not sign out");
      expect(auth.getAuthSnapshot().user).toBe(user);
      expect(await auth.getSessionToken()).toBe(signedToken);
      expect(mocks.destroy).not.toHaveBeenCalled();
      expect(mocks.clearAccount).not.toHaveBeenCalled();
      await api.logout();
      expect(auth.getAuthSnapshot().user).toBeNull();
    },
  );

  it("clears SIP account and auth even if engine teardown rejects", async () => {
    await signedIn();
    mocks.destroy.mockRejectedValueOnce(new Error("native teardown failure"));
    fetchMock.mockResolvedValueOnce(json({}, 401));
    await api.refreshAuth();
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.clearAccount).toHaveBeenCalledTimes(1);
    expect(auth.getAuthSnapshot().user).toBeNull();
    expect(await auth.getSessionToken()).toBeNull();
  });

  it("waits for expired-session SIP cleanup before accepting another identity", async () => {
    await signedIn();
    let release!: () => void;
    mocks.destroy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    fetchMock.mockResolvedValueOnce(json({}, 401));
    const refresh = api.refreshAuth();
    await vi.waitFor(() => expect(mocks.destroy).toHaveBeenCalledTimes(1));
    successfulSignIn();
    const login = api.signInWithEmail(canonicalUser.email, password);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([refresh, login]);
    expect(auth.getAuthSnapshot().user?.id).toBe(canonicalUser.id);
  });

  it("retries failed native cleanup before sending another sign-in request", async () => {
    await signedIn();
    mocks.destroy.mockRejectedValueOnce(new Error("native teardown failure"));
    fetchMock.mockResolvedValueOnce(json({}, 401));
    await api.refreshAuth();
    mocks.destroy.mockRejectedValueOnce(new Error("still active"));
    await expect(api.signInWithEmail(canonicalUser.email, password)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(auth.getAuthSnapshot().user).toBeNull();
    successfulSignIn();
    await api.signInWithEmail(canonicalUser.email, password);
    expect(auth.getAuthSnapshot().user?.id).toBe(canonicalUser.id);
  });

  it("prevents a stale profile response from restoring a signed-out session", async () => {
    await signedIn();
    let resolveMe!: (response: Response) => void;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveMe = resolve;
          }),
      )
      .mockResolvedValueOnce(json({ success: true }));
    const refresh = api.refreshAuth();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await api.logout();
    resolveMe(json({ user: canonicalUser }));
    await refresh;
    expect(auth.getAuthSnapshot().user).toBeNull();
    expect(mocks.storage.has(keys.USER_INFO_KEY)).toBe(false);
  });

  it("does not let a stale 401 clear a newly signed-in native session", async () => {
    await signedIn();
    let resolveMe!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveMe = resolve;
        }),
    );
    const refresh = api.refreshAuth();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    successfulSignIn();
    await api.signInWithEmail(canonicalUser.email, password);
    resolveMe(json({}, 401));
    await refresh;
    expect(auth.getAuthSnapshot().user?.id).toBe(canonicalUser.id);
    expect(await auth.getSessionToken()).toBe(signedToken);
  });

  it("keeps the new token but no profile when post-login verification encounters a server error", async () => {
    fetchMock
      .mockResolvedValueOnce(json(config))
      .mockResolvedValueOnce(
        json({ user: canonicalUser }, 200, { "set-auth-token": signedToken }),
      )
      .mockResolvedValueOnce(json({}, 500));
    await expect(
      api.signInWithEmail(canonicalUser.email, password),
    ).rejects.toMatchObject({ status: 500 });
    expect(await auth.getSessionToken()).toBe(signedToken);
    expect(auth.getAuthSnapshot().user).toBeNull();
    expect(mocks.storage.has(keys.USER_INFO_KEY)).toBe(false);
  });
});

describe("bounded requests", () => {
  it("times out an unresponsive request even when a caller supplies an abort signal", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const controller = new AbortController();
    const request = api.apiCall("/api/mobile/config", {
      signal: controller.signal,
    });
    const rejection = expect(request).rejects.toThrow("too long");
    await vi.advanceTimersByTimeAsync(api.API_TIMEOUT_MS + 1);
    await rejection;
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("also bounds a response whose JSON body never finishes", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
    });
    const request = api.getMobileAuthConfig();
    const rejection = expect(request).rejects.toThrow("too long");
    await vi.advanceTimersByTimeAsync(api.API_TIMEOUT_MS + 1);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });
});
