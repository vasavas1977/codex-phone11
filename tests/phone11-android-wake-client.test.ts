import { beforeEach, describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const m = vi.hoisted(() => ({
  capability: true, user: { id: 1 },
  account: { id: "phone", ownerUserId: 1, tenantId: 1, enabled: true, username: "3001", domain: "staging.invalid" },
  storage: new Map<string, string>(), callbacks: [] as ((token: string | null) => void)[], nativeBinding: null as any,
  start: vi.fn(), stop: vi.fn(), save: vi.fn(), register: vi.fn(), unregister: vi.fn(), enroll: vi.fn(), resolve: vi.fn(), bind: vi.fn(), bearer: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { android: { package: "ai.phone11.mobile.staging" }, extra: {} } } }));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "unlocked-device-only",
  getItemAsync: vi.fn(async (key: string) => m.storage.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { m.storage.set(key, value); }),
}));
vi.mock("../lib/_core/auth", () => ({ getAuthSnapshot: () => ({ user: m.user }), getSessionToken: m.bearer }));
vi.mock("../lib/sip/account-store", () => ({ useSipAccountStore: { getState: () => ({ account: m.account }) } }));
vi.mock("../lib/push/native-voip", () => ({
  getVoipCapabilities: async () => ({ registrationAvailable: m.capability, closedAppCalling: false }),
  createVoipDeviceId: async () => "android-device",
  startNativeVoip: m.start, stopNativeVoip: m.stop,
  getNativeWakeBinding: async () => m.nativeBinding,
  saveNativeWakeEnrollment: m.save,
}));
vi.mock("../lib/sip/siprix-engine", () => ({ siprixEngine: { bindWakeOwner: m.bind } }));
vi.mock("@trpc/client", () => ({
  createTRPCProxyClient: () => ({ push: { register: { mutate: m.register }, unregister: { mutate: m.unregister }, enrollWake: { mutate: m.enroll }, resolveWakeBinding: { query: m.resolve } } }),
  httpBatchLink: () => ({}),
}));

const binding = { bindingId: "11111111-1111-4111-8111-111111111111", ownerUserId: 1, tenantId: 1, deviceId: "android-device", sessionBinding: "22222222-2222-4222-8222-222222222222", expiresAt: 2_000_000_000_000 };
async function client() { return import("../lib/push/client"); }
async function emit(token: string) {
  m.callbacks.at(-1)?.(token);
  await vi.waitFor(() => expect(m.register).toHaveBeenCalled());
}

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); m.capability = true; m.user = { id: 1 };
  m.account = { id: "phone", ownerUserId: 1, tenantId: 1, enabled: true, username: "3001", domain: "staging.invalid" };
  m.storage.clear(); m.callbacks = []; m.nativeBinding = null;
  m.start.mockImplementation(async callback => { m.callbacks.push(callback); return vi.fn(); });
  m.stop.mockResolvedValue(undefined); m.bearer.mockResolvedValue("synthetic-session");
  m.register.mockResolvedValue(undefined); m.unregister.mockResolvedValue(undefined); m.resolve.mockImplementation(async () => m.nativeBinding);
  m.enroll.mockResolvedValue({ ...binding, grant: "synthetic-test-grant" });
  m.save.mockImplementation(async enrollment => { const { grant: _grant, ...publicBinding } = enrollment; m.nativeBinding = publicBinding; });
  m.bind.mockResolvedValue(undefined);
});

describe("authenticated Android FCM wake enrollment", () => {
  it("does no token, storage, or authenticated work when native Firebase commissioning is unavailable", async () => {
    m.capability = false; await (await client()).registerPhoneVoipPush();
    expect(m.start).not.toHaveBeenCalled();expect(m.bearer).not.toHaveBeenCalled();expect(m.storage.size).toBe(0);
  });

  it("registers FCM, enrolls the Android binding, saves it natively, and binds the exact owner", async () => {
    await (await client()).registerPhoneVoipPush(); await emit("synthetic-fcm-token");
    await vi.waitFor(() => expect(m.bind).toHaveBeenCalledWith(binding));
    expect(m.register).toHaveBeenCalledWith({ deviceId: "android-device", token: "synthetic-fcm-token", sipUri: "sip:3001@staging.invalid", bundleId: "ai.phone11.mobile.staging", platform: "android", sandbox: false, tokenType: "fcm" });
    expect(m.enroll).toHaveBeenCalledWith({ deviceId: "android-device", platform: "android" });
    expect(m.save).toHaveBeenCalledWith({ ...binding, grant: "synthetic-test-grant" });
  });

  it("revalidates the saved Android binding under the current authenticated session", async () => {
    m.nativeBinding=binding;
    expect(await (await client()).getWakeAdoptionBinding()).toEqual(binding);
    expect(m.resolve).toHaveBeenCalledWith({bindingId:binding.bindingId});
  });

  it("registers a rotated token before old-token cleanup and retains the existing binding", async () => {
    await (await client()).registerPhoneVoipPush(); await emit("fcm-token-one"); await vi.waitFor(() => expect(m.save).toHaveBeenCalledOnce());
    m.register.mockClear();m.unregister.mockClear();m.resolve.mockResolvedValue(binding);
    m.callbacks[0]("fcm-token-two");await vi.waitFor(() => expect(m.unregister).toHaveBeenCalledOnce());
    expect(m.register.mock.invocationCallOrder[0]).toBeLessThan(m.unregister.mock.invocationCallOrder[0]);
    expect(m.unregister).toHaveBeenCalledWith({token:"fcm-token-one",deviceId:"android-device",platform:"android"});
    expect(m.enroll).toHaveBeenCalledOnce();expect(m.bind).toHaveBeenLastCalledWith(binding);
  });

  it("rejects a late same-owner session completion without saving or binding it", async () => {
    const pending = deferred<void>();m.register.mockReturnValue(pending.promise);
    await (await client()).registerPhoneVoipPush();m.callbacks[0]("stale-fcm-token");
    await vi.waitFor(() => expect(m.register).toHaveBeenCalledOnce());m.user = { id: 1 };pending.resolve();
    await vi.waitFor(() => expect(m.bearer).toHaveBeenCalled());await Promise.resolve();await Promise.resolve();
    expect(m.enroll).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();expect(m.bind).not.toHaveBeenCalled();
  });

  it("ignores a token callback after the signed-in owner changes", async () => {
    await (await client()).registerPhoneVoipPush();m.user={id:2};m.callbacks[0]("old-owner-fcm-token");
    await Promise.resolve();await Promise.resolve();expect(m.bearer).not.toHaveBeenCalled();expect(m.register).not.toHaveBeenCalled();
  });

  it("clears native state and unregisters only the current Android token before logout", async () => {
    const api=await client();await api.registerPhoneVoipPush();await emit("logout-fcm-token");await vi.waitFor(()=>expect(m.bind).toHaveBeenCalledOnce());
    await api.beforePhoneLogout();
    expect(m.stop).toHaveBeenCalledOnce();expect(m.unregister).toHaveBeenCalledWith({token:"logout-fcm-token",deviceId:"android-device",platform:"android"});
    expect(JSON.parse(m.storage.get("phone11_voip_revocations_v1") || "[]")).toEqual([]);
  });

  it("retries an unchanged token after a transient registration failure without logging it", async () => {
    const log=vi.spyOn(console,"log").mockImplementation(()=>{}),error=vi.spyOn(console,"error").mockImplementation(()=>{});
    try {
      m.register.mockRejectedValueOnce(new Error("private token detail")).mockResolvedValue(undefined);
      await (await client()).registerPhoneVoipPush();m.callbacks[0]("retry-fcm-token");await vi.waitFor(()=>expect(m.register).toHaveBeenCalledOnce());
      m.callbacks[0]("retry-fcm-token");await vi.waitFor(()=>expect(m.bind).toHaveBeenCalledOnce());
      expect(m.register).toHaveBeenCalledTimes(2);expect(m.save).toHaveBeenCalledOnce();expect(log).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
    } finally {log.mockRestore();error.mockRestore();}
  });
});
