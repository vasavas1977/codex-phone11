import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishHandoff, redeemLocalFallback } from "../scripts/phone11-voicemail-local-fallback-ingress";

const reference = "a".repeat(64);
const channelUuid = "11111111-1111-4111-8111-111111111111";
const epoch = "22222222-2222-4222-8222-222222222222";
const input = { reference, callId: "call-123@phone11.invalid", fromTag: "tag-123", channelUuid };
const config = { apiBase: "http://127.0.0.1:3013/api/voicemail/local-fallback",
  integrationSecret: "s".repeat(32), handoffRoot: "/private/fallback" };
const valid = { identity: {
  tenantId: 12,
  caller: { extensionId: 41, userId: 17, sipUsername: "3001", sipDomain: "sip.phone11.ai" },
  target: { extensionId: 42, ownerUserId: 18, ownerEpoch: epoch,
    extensionNumber: "1020", sipUsername: "1020", sipDomain: "sip.phone11.ai" },
}, expectedOwnerEpoch: epoch };
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("local fallback ingress", () => {
  it("redeems the bound identity and returns only canonical admission fields", async () => {
    const send = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(url.toString()).toBe("http://127.0.0.1:3013/api/voicemail/local-fallback/redeem");
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      expect(JSON.parse(init?.body as string)).toEqual({ reference, callId: input.callId, fromTag: input.fromTag });
      expect((init?.headers as Record<string, string>)["x-fs-secret"]).toBe(config.integrationSecret);
      return Response.json(valid);
    });
    expect(await redeemLocalFallback(config, input, send as typeof fetch)).toEqual({
      channelUuid, tenantId: 12, extension: "1020", account: "1020",
      domain: "sip.phone11.ai", expectedOwnerEpoch: epoch,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed leg identities before contacting the API", async () => {
    const send = vi.fn();
    for (const changed of [
      { ...input, reference: "bad" }, { ...input, fromTag: "tag;evil" },
      { ...input, callId: "bad\nheader" }, { ...input, channelUuid: "bad" },
      { ...input, tenantId: 12 },
    ]) await expect(redeemLocalFallback(config, changed, send as typeof fetch)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("accepts only a fixed loopback base and never sends a secret to another host", async () => {
    const send = vi.fn();
    for (const apiBase of ["https://evil.example/api/voicemail/local-fallback",
      "http://127.0.0.1:3000/api/voicemail/local-fallback",
      "http://127.0.0.1:3013/api/voicemail/local-fallback?redirect=1"])
      await expect(redeemLocalFallback({ ...config, apiBase }, input, send as typeof fetch)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("denies expired, replayed, mismatched and malformed redemption responses", async () => {
    for (const response of [
      new Response("", { status: 404 }), new Response("", { status: 503 }),
      new Response("", { status: 302, headers: { Location: "https://evil.example" } }),
      Response.json({ ...valid, expectedOwnerEpoch: channelUuid }),
      Response.json({ ...valid, identity: { ...valid.identity, target: { ...valid.identity.target, sipUsername: "other" } } }),
      Response.json({ ...valid, identity: { ...valid.identity, tenantId: 0 } }),
      new Response("x".repeat(5000)),
    ]) await expect(redeemLocalFallback(config, input, async () => response)).rejects.toThrow();
  });

  it("publishes one private handoff file and never overwrites it", async () => {
    const root = await mkdtemp(path.join(await realpath(os.tmpdir()), "phone11-fallback-ingress-"));
    roots.push(root);
    const canonical = await redeemLocalFallback(config, input, async () => Response.json(valid));
    await publishHandoff(root, canonical);
    const file = path.join(root, `${channelUuid}.ready`);
    expect(await readFile(file, "utf8")).toBe(`12\n1020\n1020\nsip.phone11.ai\n${epoch}\n`);
    await expect(publishHandoff(root, canonical)).rejects.toThrow();
    expect(await readFile(file, "utf8")).toContain(epoch);
    await expect(publishHandoff(root, { ...canonical, channelUuid: "../escape" })).rejects.toThrow();
  });

  it("rejects a symlinked ancestor or readable handoff directory", async () => {
    const parent = await mkdtemp(path.join(await realpath(os.tmpdir()), "phone11-fallback-private-"));
    roots.push(parent);
    const root = path.join(parent, "real", "handoff");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const canonical = await redeemLocalFallback(config, input, async () => Response.json(valid));
    await symlink(path.join(parent, "real"), path.join(parent, "alias"));
    await expect(publishHandoff(path.join(parent, "alias", "handoff"), canonical)).rejects.toThrow("private");
    await chmod(root, 0o755);
    await expect(publishHandoff(root, canonical)).rejects.toThrow("private");
  });
});
