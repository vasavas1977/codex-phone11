import { createServer, request as httpRequest, type Server } from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoicemailFallbackRouter } from "../server/pbx/voicemail-fallback-routes";
import type { LocalVoicemailFallbackAuthority } from "../server/pbx/voicemail-fallback-authority";
import type { VoicemailFallbackReferenceSnapshot, VoicemailFallbackReferenceStore } from "../server/pbx/voicemail-fallback-reference-store";

const kamSecret = "kam-testing-secret-0123456789-abcdef";
const fsSecret = "fs-testing-secret-0123456789-abcdef";
const reference = "a".repeat(64);
const mintBody = {
  authenticatedCallerUsername: "3001", authenticatedCallerRealm: "phone11.invalid",
  canonicalTargetUsername: "1020", canonicalTargetDomain: "phone11.invalid",
  terminalCause: "no-answer", callId: "abc123@phone11.invalid", fromTag: "tag-001",
};
const identity = {
  tenantId: 12,
  caller: { extensionId: 41, userId: 17, sipUsername: "3001", sipDomain: "phone11.invalid" },
  target: { extensionId: 42, ownerUserId: 18, ownerEpoch: "11111111-1111-4111-8111-111111111111",
    extensionNumber: "1020", sipUsername: "1020", sipDomain: "phone11.invalid" },
};

let server: Server;
let baseUrl: string;
let saved: VoicemailFallbackReferenceSnapshot | null;
let resolution: LocalVoicemailFallbackAuthority;
let storeFailure = false;
let resolveCalls = 0;
const store: VoicemailFallbackReferenceStore = {
  async issue(value) { if (storeFailure) throw Error("private-store-detail"); saved = value; return reference; },
  async consume(value) {
    if (storeFailure) throw Error("private-store-detail");
    if (value !== reference) return null;
    const result = saved;
    saved = null;
    return result;
  },
};

function start() {
  const app = express();
  app.use("/fallback", createVoicemailFallbackRouter({ store, resolve: async () => {
    resolveCalls++;
    return resolution;
  } }));
  server = createServer(app);
  return new Promise<void>(done => server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw Error("No port");
    baseUrl = `http://127.0.0.1:${address.port}/fallback`;
    done();
  }));
}

async function post(path: string, body: unknown, secret: string, header: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST", headers: { "content-type": "application/json", [header]: secret, ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

beforeEach(async () => {
  process.env.KAM_SHARED_SECRET = kamSecret;
  process.env.FS_SHARED_SECRET = fsSecret;
  process.env.PHONE11_VOICEMAIL_LOCAL_FALLBACK_ENABLED = "true";
  saved = null; storeFailure = false; resolveCalls = 0; resolution = { allowed: true, identity };
  await start();
});
afterEach(async () => {
  await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
  delete process.env.KAM_SHARED_SECRET;
  delete process.env.FS_SHARED_SECRET;
  delete process.env.PHONE11_VOICEMAIL_LOCAL_FALLBACK_ENABLED;
  vi.restoreAllMocks();
});

describe("local voicemail fallback route boundary", () => {
  it("is default-off and does not call authority or store", async () => {
    delete process.env.PHONE11_VOICEMAIL_LOCAL_FALLBACK_ENABLED;
    expect((await post("/mint", mintBody, kamSecret, "x-kam-secret")).status).toBe(404);
    expect(resolveCalls).toBe(0);
    expect(saved).toBeNull();
  });

  it("rejects missing, wrong, duplicate, and ambiguous integration secrets", async () => {
    expect((await post("/mint", mintBody, "wrong", "x-kam-secret")).status).toBe(403);
    expect((await post("/mint", mintBody, `${kamSecret},other`, "x-kam-secret")).status).toBe(403);
    const duplicated = await new Promise<number>((done, fail) => {
      const request = httpRequest(`${baseUrl}/mint`, { method: "POST", headers: {
        "content-type": "application/json", "x-kam-secret": [kamSecret, kamSecret],
      } }, response => { response.resume(); done(response.statusCode ?? 0); });
      request.on("error", fail); request.end(JSON.stringify(mintBody));
    });
    expect(duplicated).toBe(403);
    expect(resolveCalls).toBe(0);
    expect((await post("/redeem", { reference, callId: mintBody.callId, fromTag: mintBody.fromTag }, kamSecret, "x-fs-secret")).status).toBe(403);
  });

  it("requires exact bounded proxy inputs without a tenant claim", async () => {
    for (const body of [
      { ...mintBody, tenantId: 12 }, { ...mintBody, terminalCause: "busy" },
      { ...mintBody, callId: "x".repeat(161) }, { ...mintBody, fromTag: "bad tag" },
    ]) expect((await post("/mint", body, kamSecret, "x-kam-secret")).status).toBe(400);
    expect((await post("/mint", { ...mintBody, callId: "x".repeat(160), padding: "y".repeat(2048) }, kamSecret, "x-kam-secret")).status).toBe(400);
    expect(resolveCalls).toBe(0);
  });

  it("mints only a reference; redeem consumes once and returns canonical fields with expected epoch", async () => {
    const minted = await post("/mint", mintBody, kamSecret, "x-kam-secret");
    expect(minted).toEqual({ status: 201, body: { reference } });
    expect(saved?.input).not.toHaveProperty("tenantId");
    const body = { reference, callId: mintBody.callId, fromTag: mintBody.fromTag };
    const redeemed = await post("/redeem", body, fsSecret, "x-fs-secret");
    expect(redeemed.status).toBe(200);
    expect(redeemed.body).toMatchObject({ tenantId: 12, targetExtensionId: 42,
      expectedOwnerEpoch: identity.target.ownerEpoch });
    expect(JSON.stringify(redeemed.body)).not.toContain("ha1");
    expect((await post("/redeem", body, fsSecret, "x-fs-secret")).status).toBe(404);
  });

  it("burns a wrong call binding and denies owner epoch or assignment drift", async () => {
    await post("/mint", mintBody, kamSecret, "x-kam-secret");
    const body = { reference, callId: mintBody.callId, fromTag: mintBody.fromTag };
    expect((await post("/redeem", { ...body, fromTag: "wrong" }, fsSecret, "x-fs-secret")).status).toBe(404);
    expect((await post("/redeem", body, fsSecret, "x-fs-secret")).status).toBe(404);
    await post("/mint", mintBody, kamSecret, "x-kam-secret");
    resolution = { allowed: true, identity: { ...identity, target: { ...identity.target, ownerEpoch: "22222222-2222-4222-8222-222222222222" } } };
    expect((await post("/redeem", body, fsSecret, "x-fs-secret")).status).toBe(404);
    await post("/mint", mintBody, kamSecret, "x-kam-secret");
    resolution = { allowed: true, identity: { ...identity, target: { ...identity.target, ownerUserId: 19 } } };
    expect((await post("/redeem", body, fsSecret, "x-fs-secret")).status).toBe(404);
  });

  it("fails closed on authority and store failures without exposing private diagnostics", async () => {
    resolution = { allowed: false };
    expect((await post("/mint", mintBody, kamSecret, "x-kam-secret")).status).toBe(404);
    resolution = { allowed: true, identity };
    storeFailure = true;
    const failed = await post("/mint", mintBody, kamSecret, "x-kam-secret");
    expect(failed.status).toBe(503);
    expect(JSON.stringify(failed.body)).not.toContain("private-store-detail");
    expect((await post("/redeem", { reference, callId: mintBody.callId, fromTag: mintBody.fromTag }, fsSecret, "x-fs-secret")).status).toBe(503);
  });
});
