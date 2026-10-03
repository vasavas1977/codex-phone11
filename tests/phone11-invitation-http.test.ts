import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
vi.mock("../server/_core/phone11-auth", () => ({ readAuthConfig: () => ({ trustedOrigins: [] }) }));
import { createInvitationHttpGuard } from "../server/_core/phone11-invitation-http";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use("/api/trpc", createInvitationHttpGuard(() => ["https://1toall.phone11.ai"]));
  app.use(express.json({ limit: "50mb" }));
  app.use((_req, res) => res.json({ ok: true }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/trpc/`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
const post = (route = "invitations.accept", headers: Record<string, string> = {}, body = "{}") => fetch(base + route, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body,
});

describe("Invitation HTTP boundary", () => {
  it("accepts trusted browser and bearer-native requests, requiring no-store", async () => {
    for (const headers of [{ origin: "https://1toall.phone11.ai", cookie: "session=fixture" }, { authorization: "Bearer fixture" }] as Record<string, string>[]) {
      const response = await post(undefined, headers);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });
  it("rejects cross-site and originless cookie mutations", async () => {
    for (const headers of [{ origin: "https://attacker.test" }, { cookie: "session=fixture" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) {
      expect((await post(undefined, headers)).status).toBe(403);
    }
  });
  it("never accepts token inspection or acceptance through a query URL", async () => {
    for (const route of ["invitations.accept", "invitations.inspect", "invitations.availability,invitations.accept"]) {
      expect((await fetch(base + route)).status).toBe(405);
    }
    expect((await fetch(base + "invitations.list")).status).toBe(200);
  });
  it("limits bodies for batches and encoded invitation paths", async () => {
    for (const route of ["invitations.accept", "auth.me,invitations.accept", "invitations%2Eaccept"]) {
      const response = await post(route, {}, JSON.stringify({ password: "x".repeat(9000) }));
      expect(response.status).toBe(413);
      expect(await response.text()).not.toContain("xxx");
    }
  });
  it("does not reflect malformed secrets or accept simple cross-site content types", async () => {
    const response = await post(undefined, {}, '{"token":"private-secret');
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private-secret");
    expect((await post(undefined, { "Content-Type": "text/plain" })).status).toBe(415);
  });
  it("leaves unrelated RPC requests unaffected", async () => {
    expect((await post("auth.me", { cookie: "fixture" }, JSON.stringify({ data: "x".repeat(9000) }))).status).toBe(200);
  });
  it("rejects malformed encoded RPC paths before the general body parser", async () => {
    expect((await post("invitations%ZZaccept", {}, JSON.stringify({ data: "x".repeat(9000) }))).status).toBe(400);
  });
});
