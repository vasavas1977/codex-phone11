import { EventEmitter } from "node:events";
import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createApnsSender, readApnsConfig } from "../server/push/apns";
import type { PushToken } from "../server/push-gateway";
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const config = { keyPath: "/fake/key.p8", keyId: "KEY1234567", teamId: "TEAM123456", bundleId: "test.phone11", environment: "production" as const };
const token: PushToken = { sessionId: "test-session", owner: { userId: 1, tenantId: 10, extensionId: 1, sipUri: "sip:1@test.invalid" }, token: "a".repeat(64), tokenType: "voip", sipUri: "sip:1@test.invalid", deviceId: "test-device", platform: "ios", bundleId: "test.phone11", registeredAt: 0 };
const payload = { callId: "test-call", callerNumber: "1001" };
type Response = { status?: number; reason?: string; retryAfter?: string; event?: "error" | "goaway" | "aborted" | "close" | "hang"; raw?: string };
function fixture(responses: Response[] = [{ status: 200 }], extra: Record<string, any> = {}) {
  const streams: any[] = [], sessions: any[] = [], headers: any[] = [], bodies: string[] = [];
  const connect = vi.fn(() => {
    const session = new EventEmitter() as any, stream = new EventEmitter() as any;
    session.destroy = vi.fn(); stream.close = vi.fn();
    session.request = vi.fn(h => { headers.push(h); return stream; });
    stream.end = vi.fn(body => {
      bodies.push(body); const response = responses.shift() ?? { status: 200 };
      queueMicrotask(() => {
        if (response.event === "hang") return;
        if (response.event) { (response.event === "goaway" ? session : stream).emit(response.event, new Error("secret token in network error")); return; }
        stream.emit("response", { ":status": response.status, "retry-after": response.retryAfter });
        stream.emit("data", Buffer.from(response.raw ?? JSON.stringify({ reason: response.reason })));
        stream.emit("end");
      });
    });
    streams.push(stream); sessions.push(session); return session;
  });
  const readKey = vi.fn(async () => pem);
  const sleep = vi.fn(async () => undefined);
  const send = createApnsSender({ connect: connect as any, loadConfig: () => config, readKey, sleep, ...extra });
  return { send, connect, streams, sessions, headers, bodies, readKey, sleep };
}
describe("APNs explicit HTTP/2 delivery", () => {
  it("requires complete server provider configuration before touching network", () => {
    vi.stubEnv("APNS_KEY_PATH", "");
    try { expect(() => readApnsConfig()).toThrow("configuration"); } finally { vi.unstubAllEnvs(); }
  });
  it("uses fixed Apple host, VoIP headers, no offline storage, and verified ES256 P1363 JWT", async () => {
    const f = fixture(); await f.send(token, payload);
    expect(f.connect).toHaveBeenCalledWith("https://api.push.apple.com", expect.objectContaining({ minVersion: "TLSv1.2" }));
    expect(f.headers[0]).toMatchObject({ ":method": "POST", ":path": `/3/device/${token.token}`, "apns-topic": "test.phone11.voip", "apns-push-type": "voip", "apns-priority": "10", "apns-expiration": "0" });
    const [header, claims, signature] = f.headers[0].authorization.slice(7).split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid: config.keyId });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({ iss: config.teamId });
    expect(Buffer.from(signature, "base64url")).toHaveLength(64);
    expect(verify("sha256", Buffer.from(`${header}.${claims}`), { key: keys.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
    expect(JSON.parse(f.bodies[0])).toMatchObject({ ...payload, type: "voip_call" });
    expect(f.sessions[0].destroy).toHaveBeenCalledOnce(); expect(f.streams[0].close).toHaveBeenCalledOnce();
  });
  it("reuses JWT within 50 minutes and refreshes afterward", async () => {
    let time = 1_000_000; const f = fixture([], { now: () => time });
    await f.send(token, payload); time += 49 * 60_000; await f.send(token, payload);
    expect(f.readKey).toHaveBeenCalledOnce(); expect(f.headers[0].authorization).toBe(f.headers[1].authorization);
    time += 60_000; await f.send(token, payload); expect(f.readKey).toHaveBeenCalledTimes(2);
  });
  it("rejects a non-P256 key without exposing key material or path", async () => {
    const f = fixture([], { readKey: async () => "secret malformed key" });
    await expect(f.send(token, payload)).rejects.toMatchObject({ kind: "configuration", message: "Push provider configuration" }); expect(f.connect).not.toHaveBeenCalled();
  });
  it.each([{ bundleId: "other.app" }, { sandbox: true }, { tokenType: "apns" }])("refuses client topic/environment/type outside server configuration (%j)", async change => {
    const f = fixture(); await expect(f.send({ ...token, ...change } as PushToken, payload)).rejects.toMatchObject({ kind: "configuration" }); expect(f.connect).not.toHaveBeenCalled();
  });
  it.each([[400, "BadDeviceToken"], [400, "DeviceTokenNotForTopic"], [410, "Unregistered"]])("classifies token invalidation %s/%s without retry", async (status, reason) => {
    const f = fixture([{ status: Number(status), reason: String(reason) }]);
    await expect(f.send(token, payload)).rejects.toMatchObject({ invalidToken: true, reason }); expect(f.connect).toHaveBeenCalledOnce();
  });
  it("retries a throttle only once, preserving request ID and JWT", async () => {
    const f = fixture([{ status: 429, reason: "TooManyRequests", retryAfter: "0.3" }, { status: 200 }]);
    await f.send(token, payload); expect(f.connect).toHaveBeenCalledTimes(2); expect(f.sleep).toHaveBeenCalledWith(300);
    expect(f.headers[1]["apns-id"]).toBe(f.headers[0]["apns-id"]); expect(f.headers[1].authorization).toBe(f.headers[0].authorization);
  });
  it.each([{ status: 503, reason: "ServiceUnavailable" }, { status: 429, reason: "TooManyRequests", retryAfter: "20" }, { status: 429, reason: "TooManyProviderTokenUpdates" }, { status: 403, reason: "ExpiredProviderToken" }])("does not replay rejected calls beyond the live-call retry budget (%j)", async response => {
    const f = fixture([response]); await expect(f.send(token, payload)).rejects.toBeDefined(); expect(f.connect).toHaveBeenCalledOnce(); expect(f.sleep).not.toHaveBeenCalled();
  });
  it.each(["error", "goaway", "aborted", "close"] as const)("cleans up %s without retrying an uncertain delivery", async event => {
    const f = fixture([{ event }]); await expect(f.send(token, payload)).rejects.toMatchObject({ kind: "transport", message: "Push provider transport" });
    expect(f.connect).toHaveBeenCalledOnce(); expect(f.sessions[0].destroy).toHaveBeenCalledOnce();
  });
  it("times out a stalled stream and closes its connection", async () => {
    const f = fixture([{ event: "hang" }], { timeoutMs: 10 }); await expect(f.send(token, payload)).rejects.toMatchObject({ kind: "timeout" }); expect(f.sessions[0].destroy).toHaveBeenCalledOnce();
  });
  it("never returns arbitrary provider response data", async () => {
    const f = fixture([{ status: 400, raw: '{"reason":"secret-device-token"}' }]);
    await expect(f.send(token, payload)).rejects.toMatchObject({ message: "Push provider rejected", reason: undefined });
  });
  it("coalesces concurrent JWT initialization", async () => {
    const f = fixture(); await Promise.all([f.send(token, payload), f.send(token, payload)]);
    expect(f.readKey).toHaveBeenCalledOnce(); expect(f.headers[0].authorization).toBe(f.headers[1].authorization);
  });
  it("rechecks device ownership before each retry", async () => {
    const f = fixture([{ status: 429, reason: "TooManyRequests" }]);
    const current = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(f.send(token, payload, current)).rejects.toMatchObject({ kind: "rejected" }); expect(f.connect).toHaveBeenCalledOnce();
  });
  it("times out a stalled signing-key read and never sends after that read completes", async () => {
    let finish!: (key: string) => void;
    const f = fixture([], { timeoutMs: 10, readKey: () => new Promise<string>(resolve => { finish = resolve; }) });
    await expect(f.send(token, payload)).rejects.toMatchObject({ kind: "timeout" });
    finish(pem); await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("times out a stalled ownership check and does not send after a late positive result", async () => {
    let finish!: (current: boolean) => void;
    const f = fixture([], { timeoutMs: 15 });
    const check = () => new Promise<boolean>(resolve => { finish = resolve; });
    await expect(f.send(token, payload, check)).rejects.toMatchObject({ kind: "timeout" });
    finish(true); await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("shares its budget across key loading, ownership checking and transport", async () => {
    let time = 1000;
    const f = fixture([], { timeoutMs: 100, now: () => time, readKey: async () => { time += 70; return pem; } });
    await expect(f.send(token, payload, async () => { time += 31; return true; })).rejects.toMatchObject({ kind: "timeout" });
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("honors an earlier gateway deadline and refuses already-expired calls", async () => {
    const f = fixture([], { now: () => 1000 });
    await expect(f.send(token, payload, undefined, 999)).rejects.toMatchObject({ kind: "timeout" });
    expect(f.readKey).not.toHaveBeenCalled(); expect(f.connect).not.toHaveBeenCalled();
    const stalled = fixture([{ event: "hang" }], { now: () => 1000 });
    await expect(stalled.send(token, payload, undefined, 1010)).rejects.toMatchObject({ kind: "timeout" });
    expect(stalled.sessions[0].destroy).toHaveBeenCalledOnce();
  });
  it("retains the provider invalidation timestamp for fresh-registration protection", async () => {
    const f = fixture([{ status: 410, raw: '{"reason":"Unregistered","timestamp":1234567890000}' }]);
    await expect(f.send(token, payload)).rejects.toMatchObject({ invalidToken: true, invalidatedAt: 1234567890000 });
  });

});
