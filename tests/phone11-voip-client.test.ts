import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  owner: 1 as number | null,
  user: { id: 1 },
  capability: false,
  environment: "production" as string | undefined,
  storage: new Map<string, string>(),
  start: vi.fn(), stop: vi.fn(async () => {}),
  get: vi.fn(), set: vi.fn(), session: vi.fn(async () => "private-session"),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-secure-store", () => ({ getItemAsync: m.get, setItemAsync: m.set, WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked-device-only" }));
vi.mock("expo-constants", () => ({ default: { get expoConfig() { return { ios: { bundleIdentifier: "ai.phone11" }, extra: { phone11ApnsEnvironment: m.environment } }; } } }));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: m.owner === 1 ? m.user : m.owner ? { id: m.owner } : null }), getSessionToken: m.session }));
vi.mock("../lib/sip/account-store", () => ({ useSipAccountStore: { getState: () => ({ account: { ownerUserId: 1, enabled: true, username: "3001", domain: "sip.phone11.ai" } }) } }));
vi.mock("../lib/push/native-voip", () => ({ createVoipDeviceId: async () => "stable-device-id", getVoipCapabilities: async () => ({ registrationAvailable: m.capability, closedAppCalling: false }), startNativeVoip: m.start, stopNativeVoip: m.stop }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); m.owner = 1; m.user = { id: 1 }; m.capability = false; m.environment = "production"; m.storage.clear();
  m.get.mockImplementation(async (key: string) => m.storage.get(key) ?? null);
  m.set.mockImplementation(async (key: string, value: string) => { m.storage.set(key, value); });
  m.start.mockResolvedValue(() => {});
  m.session.mockResolvedValue("private-session");
});
describe("native push client gate and cleanup", () => {
  it("default-disabled requests no native registration, permission, storage or bearer", async () => {
    const client = await import("../lib/push/client"); await client.registerPhoneVoipPush();
    expect(m.start).not.toHaveBeenCalled(); expect(m.get).not.toHaveBeenCalled(); expect(m.session).not.toHaveBeenCalled();
  });
  it("does not register a phone account belonging to another signed-in owner", async () => {
    m.capability = true; m.owner = 2;
    await (await import("../lib/push/client")).registerPhoneVoipPush();
    expect(m.start).not.toHaveBeenCalled(); expect(m.get).not.toHaveBeenCalled();
  });
  it("requires explicit APNs environment and preserves locked credential policy", async () => {
    m.capability = true; m.environment = undefined;
    await (await import("../lib/push/client")).registerPhoneVoipPush();
    expect(m.start).not.toHaveBeenCalled();
    expect(m.set).toHaveBeenCalledWith("phone11_voip_device_v1", "stable-device-id", { keychainAccessible: "unlocked-device-only" });
  });
  it("stops native even when the encrypted cleanup ledger cannot be read", async () => {
    m.get.mockRejectedValue(new Error("keychain locked"));
    await (await import("../lib/push/client")).beforePhoneLogout();
    expect(m.stop).toHaveBeenCalledTimes(1); expect(m.session).not.toHaveBeenCalled();
  });
  it("ignores late token events after sign-out and account switch", async () => {
    m.capability = true; let callback: (token: string | null) => void = () => {};
    m.start.mockImplementation(async (listener) => { callback = listener; return () => {}; });
    const client = await import("../lib/push/client"); await client.registerPhoneVoipPush();
    await client.beforePhoneLogout(); m.owner = 2; callback("secret-provider-token");
    await Promise.resolve(); expect(m.session).not.toHaveBeenCalled();
  });
  it("never logs provider tokens or request errors during cleanup failure", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    m.get.mockRejectedValue(new Error("secret-provider-token"));
    await (await import("../lib/push/client")).beforePhoneLogout();
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); log.mockRestore(); error.mockRestore();
  });
  it("cannot bind using a new same-owner session after logout times out during a session read", async () => {
    m.capability = true;
    let callback: (token: string | null) => void = () => {};
    let release: (token: string) => void = () => {};
    m.start.mockImplementation(async listener => { callback = listener; return () => {}; });
    m.session.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const client = await import("../lib/push/client");
    await client.registerPhoneVoipPush();
    vi.useFakeTimers();
    try {
      callback("old-provider-token");
      await vi.waitFor(() => expect(m.session).toHaveBeenCalled());
      const logout = client.beforePhoneLogout();
      await vi.advanceTimersByTimeAsync(1000); await logout;
      m.user = { id: 1 }; // A replacement authenticated session for the same user.
      release("replacement-session");
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).not.toHaveBeenCalled();
      callback("late-provider-token");
      await vi.advanceTimersByTimeAsync(0);
      expect(m.session).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });
});
