import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistrationLifecycle, type RegistrationSnapshot } from "../lib/sip/registration-lifecycle";

const account = {
  id: "phone", ownerUserId: 17, enabled: true, username: "3001", password: "test-only",
  domain: "sip.example.test", displayName: "Test", port: 5061, transport: "TLS" as const, srtp: true,
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe("automatic foreground phone registration", () => {
  let state: RegistrationSnapshot;
  let controller: ReturnType<typeof createRegistrationLifecycle>;
  const loadAccount = vi.fn<() => Promise<void>>();
  const initialize = vi.fn<() => Promise<void>>();
  const restart = vi.fn<() => Promise<void>>();
  const onError = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.resetAllMocks();
    state = { userId: 17, authLoading: false, account, registrationState: "unregistered", hasLiveCall: false };
    loadAccount.mockResolvedValue();
    initialize.mockImplementation(async () => { state.registrationState = "registering"; });
    restart.mockImplementation(async () => { state.registrationState = "registering"; });
    controller = createRegistrationLifecycle({ snapshot: () => state, loadAccount, initialize, restart, onError }, true);
  });
  afterEach(() => { controller.stop(); vi.useRealTimers(); });
  it("hydrates and connects the verified owner's account without diagnostics interaction", async () => {
    controller.start(); await flush();
    expect(loadAccount).toHaveBeenCalledOnce();
    expect(initialize).toHaveBeenCalledOnce();
    expect(state.registrationState).toBe("registering"); // Command acceptance is not registration success.
  });
  it("waits for verified auth before reading credentials or starting native SIP", async () => {
    state.authLoading = true;
    controller.start(); await flush();
    expect(loadAccount).not.toHaveBeenCalled();
    expect(initialize).not.toHaveBeenCalled();
    state.authLoading = false; controller.changed(); await flush();
    expect(initialize).toHaveBeenCalledOnce();
  });
  it.each([null, { ...account, ownerUserId: 29 }, { ...account, enabled: false }])("does not connect missing, mismatched, or disabled accounts: %s", async (configured) => {
    state.account = configured;
    controller.start(); await flush();
    expect(initialize).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });
  it("starts when provisioning arrives after startup hydration", async () => {
    state.account = null;
    controller.start(); await flush();
    state.account = account; controller.changed(); await flush();
    expect(initialize).toHaveBeenCalledOnce();
  });
  it("does not reconnect after logout during secure hydration", async () => {
    let finish!: () => void;
    loadAccount.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    controller.start(); await flush();
    state.userId = undefined; controller.changed();
    finish(); await flush();
    expect(initialize).not.toHaveBeenCalled();
  });
  it("does not register the previous account after switching users during hydration", async () => {
    let finish!: () => void;
    loadAccount.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    controller.start(); await flush();
    state.userId = 29; controller.changed(); finish(); await flush();
    expect(loadAccount).toHaveBeenCalledTimes(2);
    expect(initialize).not.toHaveBeenCalled();
  });
  it("backs off failures and cancels retries once the SDK confirms registration", async () => {
    initialize.mockRejectedValueOnce(new Error("offline"));
    controller.start(); await flush();
    expect(onError).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(restart).toHaveBeenCalledOnce();
    state.registrationState = "registered"; controller.changed();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(restart).toHaveBeenCalledOnce();
  });
  it("waits for a registering callback before retrying a stalled registration", async () => {
    controller.start(); await flush();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(restart).toHaveBeenCalledOnce();
  });
  it("recovers an SDK network failure while foregrounded", async () => {
    state.registrationState = "registered";
    controller.start(); await flush();
    state.registrationState = "network_error"; controller.changed(); await flush();
    expect(restart).toHaveBeenCalledOnce();
  });
  it("never tears down a live call to recover registration", async () => {
    state.registrationState = "network_error";
    state.hasLiveCall = true;
    controller.start(); await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(restart).not.toHaveBeenCalled();
    state.hasLiveCall = false; controller.changed(); await flush();
    expect(restart).toHaveBeenCalledOnce();
  });
  it("refreshes a stale registered contact after foregrounding but waits for any live call to finish", async () => {
    state.registrationState = "registered";
    controller.start(); await flush();
    controller.setActive(false);
    state.hasLiveCall = true;
    controller.setActive(true); await flush();
    expect(restart).not.toHaveBeenCalled();
    state.hasLiveCall = false; controller.changed(); await flush();
    expect(restart).toHaveBeenCalledOnce();
  });
  it("pauses retries in background and reconnects on foreground", async () => {
    controller.setActive(false);
    controller.start(); await flush();
    expect(loadAccount).not.toHaveBeenCalled();
    controller.setActive(true); await flush();
    expect(restart).toHaveBeenCalledOnce();
    controller.setActive(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(restart).toHaveBeenCalledOnce();
    state.registrationState = "network_error";
    controller.setActive(true); await flush();
    expect(restart).toHaveBeenCalledTimes(2);
  });
  it("serializes repeated foreground/account events during native startup", async () => {
    let finish!: () => void;
    initialize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    controller.start(); await flush();
    for (let i = 0; i < 5; i++) controller.changed();
    expect(initialize).toHaveBeenCalledOnce();
    state.registrationState = "registered"; finish(); await flush();
    expect(restart).not.toHaveBeenCalled();
  });
  it("lets a reconnect action retry immediately without duplicating an in-flight operation", async () => {
    state.registrationState = "registered";
    controller.start(); await flush();
    let finish!: () => void;
    restart.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = controller.reconnect();
    const second = controller.reconnect();
    expect(restart).toHaveBeenCalledOnce();
    finish(); await Promise.all([first, second]);
  });
  it("rejects manual reconnect during a live call and without the matching signed-in account", async () => {
    state.hasLiveCall = true;
    await expect(controller.reconnect()).rejects.toThrow("End your current call");
    state.hasLiveCall = false;
    state.userId = 29;
    await expect(controller.reconnect()).rejects.toThrow("Sign in");
    expect(restart).not.toHaveBeenCalled();
  });
  it("shows a safe manual error while retaining automatic retry after failure", async () => {
    state.registrationState = "registered";
    controller.start(); await flush();
    restart.mockImplementationOnce(async () => { state.registrationState = "failed"; throw new Error("private native text"); });
    await expect(controller.reconnect()).rejects.toThrow("Phone11 will keep trying");
    expect(onError).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(restart).toHaveBeenCalledTimes(2);
  });
  it("cleans up its watchdog when the provider unmounts", async () => {
    controller.start(); await flush(); controller.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(restart).not.toHaveBeenCalled();
  });
});
