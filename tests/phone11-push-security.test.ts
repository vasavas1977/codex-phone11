import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: db.query, withTransaction: vi.fn() }));
import { registerPushToken, unregisterPushToken, getTokensForUser, triggerPushForUser } from "../server/push-gateway";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
const token = { token: "not-a-real-device-token", tokenType: "voip" as const, sipUri: "sip:3001@sip.example.test", deviceId: "test-device", platform: "ios" as const, bundleId: "example.test" };
const assignment = { user_id: 17, tenant_id: 12, extension_id: 4, sip_username: "3001", sip_domain: "sip.example.test" };
const context = (userId?: number): TrpcContext => ({ user: userId ? { id: userId, role: "user" } : null, req: { headers: {} }, res: {} }) as TrpcContext;
beforeEach(() => { vi.clearAllMocks(); db.query.mockResolvedValue({ rows: [assignment] }); vi.stubEnv("APNS_KEY_PATH", ""); vi.stubEnv("FCM_PROJECT_ID", ""); vi.stubEnv("PUSH_SHARED_SECRET", ""); });
afterEach(() => { unregisterPushToken(token, 17); unregisterPushToken({ ...token, platform: "android" }, 17); vi.unstubAllEnvs(); });

describe("push account isolation and delivery evidence", () => {
  it("rejects registration without an authenticated session", async () => {
    await expect(appRouter.createCaller(context()).push.register(token)).rejects.toThrow();
    expect(db.query).not.toHaveBeenCalled();
  });
  it("rejects another user's SIP URI instead of binding arbitrary tokens", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(registerPushToken(token, 29)).rejects.toThrow("not assigned");
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("ue.user_id = $3"), ["3001", "sip.example.test", 29]);
  });
  it("only unregisters the current user's device even when device ID and token are known", async () => {
    await registerPushToken(token, 17);
    unregisterPushToken(token, 29);
    expect(getTokensForUser(token.sipUri)).toHaveLength(1);
    unregisterPushToken(token, 17);
    expect(getTokensForUser(token.sipUri)).toHaveLength(0);
  });
  it("reports zero sent when APNs credentials are missing", async () => {
    await registerPushToken(token, 17);
    const result = await triggerPushForUser({ sipUri: token.sipUri, callId: "test-call", callerNumber: "test-caller" });
    expect(result.sent).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(getTokensForUser(token.sipUri)[0].lastUsed).toBeUndefined();
  });
  it("reports zero sent when FCM is unavailable instead of a mock success", async () => {
    await registerPushToken({ ...token, tokenType: "fcm", platform: "android" }, 17);
    const result = await triggerPushForUser({ sipUri: token.sipUri, callId: "test-call", callerNumber: "test-caller" });
    expect(result.sent).toBe(0);
    expect(result.errors).toHaveLength(1);
  });
  it("does not deliver a token retained after its extension assignment changes", async () => {
    await registerPushToken(token, 17);
    db.query.mockResolvedValueOnce({ rows: [{ ...assignment, user_id: 29 }] });
    const result = await triggerPushForUser({ sipUri: token.sipUri, callId: "test-call", callerNumber: "test-caller" });
    expect(result).toEqual({ sent: 0, errors: ["No assigned device is available for push delivery"] });
  });
  it("does not fan an ambiguous SIP identity out across tenants", async () => {
    await registerPushToken(token, 17);
    db.query.mockResolvedValueOnce({ rows: [assignment, { ...assignment, user_id: 29, tenant_id: 30 }] });
    expect(await triggerPushForUser({ sipUri: token.sipUri, callId: "test-call", callerNumber: "test-caller" }))
      .toEqual({ sent: 0, errors: ["The target phone account is ambiguous"] });
  });
  it("rejects the public call trigger when its integration secret is missing or incorrect", async () => {
    const input = { sipUri: token.sipUri, callId: "test-call", callerNumber: "test-caller" };
    await expect(appRouter.createCaller(context()).push.triggerCall(input)).rejects.toThrow("not configured");
    process.env.PUSH_SHARED_SECRET = "test-push-integration-key-0123456789";
    await expect(appRouter.createCaller(context()).push.triggerCall(input)).rejects.toThrow();
    expect(db.query).not.toHaveBeenCalled();
  });
  it("requires an owned recording before paid transcript analysis can run", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(appRouter.createCaller(context(29)).recording.analyzeTranscript({ recordingId: "call-1", transcription: "Test transcript", callerName: "A", calleeName: "B", direction: "outbound", duration: 3 })).rejects.toThrow("Recording not found");
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("ue.user_id = $1"), [29, "call-1"]);
  });
});
