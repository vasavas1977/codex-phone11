import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
const db = vi.hoisted(() => ({ query: vi.fn(), cdr: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: db.query }));
vi.mock("../server/pbx/redis", () => ({ cacheGetOrSet: vi.fn((_key, _ttl, callback) => callback()), invalidateCache: vi.fn(), rateLimitCheck: vi.fn(async () => true) }));
vi.mock("../server/pbx/cdr-processor", () => ({ processCdr: db.cdr }));
import { kamailioRouter } from "../server/pbx/kamailio-routes";
import { freeswitchRouter } from "../server/pbx/freeswitch-routes";
let server: Server;
let base: string;
const secret = "test-integration-secret-0123456789";
const post = (route: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use("/kam", kamailioRouter); app.use("/fs", freeswitchRouter);
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllEnvs(); });
beforeEach(() => { vi.clearAllMocks(); db.query.mockResolvedValue({ rows: [] }); vi.stubEnv("FS_SHARED_SECRET", secret); vi.stubEnv("KAM_SHARED_SECRET", secret); });
describe("PBX callback security", () => {
  it("denies both actual routers before database work without an integration header", async () => {
    expect((await post("/kam/auth", { username: "3001", domain: "sip.example.test", secret })).status).toBe(403);
    expect((await post("/fs/directory?secret=" + secret, { user: "3001", domain: "sip.example.test", secret })).status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
  it("fails closed when the deployed secret is a known placeholder", async () => {
    process.env.FS_SHARED_SECRET = "phone11-fs-secret-change-me";
    expect((await post("/fs/directory", {}, { "x-fs-secret": process.env.FS_SHARED_SECRET })).status).toBe(503);
    expect(db.query).not.toHaveBeenCalled();
  });
  it("refuses CDR ingestion without an explicit tenant instead of defaulting to tenant 1", async () => {
    expect((await post("/fs/cdr", { variables: { uuid: "test" } }, { "x-fs-secret": secret })).status).toBe(400);
    expect(db.cdr).not.toHaveBeenCalled();
  });
  it("scopes a Kamailio extension lookup to the caller's active tenant and domain", async () => {
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ tenant_id: 12 }] }).mockResolvedValueOnce({ rows: [] });
    await post("/kam/route", { ruri_user: "3002", from_user: "3001", domain: "sip.example.test" }, { "x-kam-secret": secret });
    expect(db.query.mock.calls[1][1]).toEqual(["3001", "sip.example.test"]);
    expect(db.query.mock.calls[2][0]).toContain("e.tenant_id = $2");
    expect(db.query.mock.calls[2][1]).toEqual(["3002", 12]);
  });
  it("does not resolve an extension from another tenant when caller mapping is absent", async () => {
    const response = await post("/kam/route", { ruri_user: "3002", from_user: "other", domain: "other.example.test" }, { "x-kam-secret": secret });
    expect(await response.json()).toEqual({ action: "reject", code: 403 });
    expect(db.query).toHaveBeenCalledTimes(2);
  });
  it("refuses PSTN routing when the caller and domain have no active tenant mapping", async () => {
    const response = await post("/fs/dialplan", { "Caller-Destination-Number": "0812345678", "variable_sip_from_user": "other", "variable_domain_name": "other.example.test" }, { "x-fs-secret": secret });
    expect(await response.text()).not.toContain("sofia/gateway");
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("sa.sip_domain = $2"), ["other", "other.example.test"]);
  });
});
