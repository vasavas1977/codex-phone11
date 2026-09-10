import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ owners: vi.fn(), list: vi.fn(), current: vi.fn(), markUsed: vi.fn(), removeInvalid: vi.fn(), send: vi.fn(), adc: vi.fn() }));
vi.mock("../server/pbx/push-access", () => ({ assignedPushOwners: mocks.owners, requirePushOwner: vi.fn() }));
vi.mock("../server/push/repository", () => ({ pushRepository: { list: mocks.list, isCurrent: mocks.current, markUsed: mocks.markUsed, removeInvalid: mocks.removeInvalid } }));
vi.mock("../server/push/apns", () => ({ sendApnsPush: mocks.send }));
vi.mock("google-auth-library", () => ({ GoogleAuth: class { async getClient() { return { getAccessToken: mocks.adc }; } } }));
import { triggerPushForUser } from "../server/push-gateway";
const owner = { userId: 1, tenantId: 10, extensionId: 1, sipUri: "sip:1001@test.invalid" };
const token = { owner, sipUri: owner.sipUri, token: "a".repeat(64), tokenType: "voip", platform: "ios", revision: "test-revision", deviceId: "test-device", bundleId: "test.phone11", registeredAt: 1000 };
const call = { sipUri: owner.sipUri, callId: "call-test", callerNumber: "1002" };
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset()); mocks.owners.mockResolvedValue([owner]); mocks.list.mockResolvedValue([token]); mocks.current.mockResolvedValue(true);
  mocks.send.mockResolvedValue(undefined); mocks.markUsed.mockResolvedValue(undefined); mocks.removeInvalid.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
describe("push gateway provider acceptance and registry lifecycle", () => {
  it("counts only provider acceptance and records the exact saved revision", async () => {
    expect(await triggerPushForUser(call)).toEqual({ sent: 1, errors: [] }); expect(mocks.markUsed).toHaveBeenCalledWith(token);
    expect(mocks.send).toHaveBeenCalledWith(token, expect.objectContaining({ callId: call.callId }), expect.any(Function), expect.any(Number));
    await mocks.send.mock.calls[0][2](); expect(mocks.current).toHaveBeenCalledTimes(2);
  });
  it("does not submit a token revoked after target lookup", async () => {
    mocks.current.mockResolvedValue(false); expect((await triggerPushForUser(call)).sent).toBe(0); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("removes only the rejected revision on explicit invalid-device responses", async () => {
    mocks.send.mockRejectedValue({ invalidToken: true }); const result = await triggerPushForUser(call);
    expect(result.sent).toBe(0); expect(mocks.removeInvalid).toHaveBeenCalledWith(token); expect(mocks.markUsed).not.toHaveBeenCalled();
  });
  it("does not remove a registration newer than Apple's invalidation timestamp", async () => {
    mocks.send.mockRejectedValue({ invalidToken: true, invalidatedAt: 900 }); expect((await triggerPushForUser(call)).sent).toBe(0); expect(mocks.removeInvalid).not.toHaveBeenCalled();
  });
  it("preserves tokens on provider configuration/auth/network failure and returns no private details", async () => {
    mocks.send.mockRejectedValue(new Error("secret-token /secret/key.p8"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await triggerPushForUser(call)).toEqual({ sent: 0, errors: ["Push delivery unavailable or rejected by provider"] });
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret"); expect(mocks.removeInvalid).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  it("does not send later device pushes after the shared call deadline", async () => {
    let time = 1000; const clock = vi.spyOn(Date, "now").mockImplementation(() => time);
    mocks.list.mockResolvedValue([token, { ...token, deviceId: "second-device" }]);
    mocks.current.mockResolvedValueOnce(true).mockImplementationOnce(async () => { time = 7000; return true; });
    try {
      expect(await triggerPushForUser(call)).toEqual({ sent: 1, errors: ["Push delivery deadline elapsed"] });
      expect(mocks.send).toHaveBeenCalledOnce(); expect(mocks.send.mock.calls[0][3]).toBe(6000);
    } finally { clock.mockRestore(); }
  });

  it.each(["owners", "list", "current"] as const)("bounds stalled %s lookup and never sends after late completion", async stage => {
    vi.useFakeTimers(); const pending = deferred<any>(); mocks[stage].mockReturnValue(pending.promise);
    const result = triggerPushForUser(call); await vi.advanceTimersByTimeAsync(5001);
    expect(await result).toEqual({ sent: 0, errors: ["Push delivery deadline elapsed"] });
    pending.resolve(stage === "owners" ? [owner] : stage === "list" ? [token] : true);
    await vi.advanceTimersByTimeAsync(0); expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.markUsed).not.toHaveBeenCalled();
  });
  it("keeps observed provider acceptance when persistence hangs and observes its late rejection", async () => {
    vi.useFakeTimers(); const pending = deferred<void>(); mocks.markUsed.mockReturnValue(pending.promise);
    const result = triggerPushForUser(call); await vi.advanceTimersByTimeAsync(5001);
    expect(await result).toEqual({ sent: 1, errors: ["Push delivery deadline elapsed"] });
    pending.reject(new Error("late private database error")); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  it("bounds invalid-token cleanup and observes abandoned cleanup rejection", async () => {
    vi.useFakeTimers(); const pending = deferred<void>(); mocks.send.mockRejectedValue({ invalidToken: true }); mocks.removeInvalid.mockReturnValue(pending.promise);
    const result = triggerPushForUser(call); await vi.advanceTimersByTimeAsync(5001);
    expect(await result).toEqual({ sent: 0, errors: ["Push delivery unavailable or rejected by provider", "Push delivery deadline elapsed"] });
    pending.reject(new Error("late cleanup error")); await vi.advanceTimersByTimeAsync(0);
  });
  it("does not make an FCM request after credential acquisition outlives the call", async () => {
    vi.useFakeTimers(); vi.stubEnv("FCM_PROJECT_ID", "test-only-project");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    mocks.list.mockResolvedValue([{ ...token, platform: "android", tokenType: "fcm" }]);
    const pending = deferred<any>(); mocks.adc.mockReturnValue(pending.promise);
    const result = triggerPushForUser(call); await vi.advanceTimersByTimeAsync(5001);
    expect(await result).toEqual({ sent: 0, errors: ["Push delivery deadline elapsed"] });
    pending.resolve({ token: "fake-delayed-credential" }); await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.markUsed).not.toHaveBeenCalled();
  });

});
