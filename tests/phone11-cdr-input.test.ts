import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
const db = vi.hoisted(() => ({ query: vi.fn(), cdr: vi.fn(), route: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: db.query }));
vi.mock("../server/pbx/redis", () => ({ cacheGetOrSet: vi.fn(), invalidateCache: vi.fn(), rateLimitCheck: vi.fn() }));
vi.mock("../server/pbx/cdr-processor", () => ({ processCdr: db.cdr }));
vi.mock("../server/cloud-recordings/correlation", () => ({ trustedCdrRecordingRoute: db.route, bindAuthenticatedOutbound: vi.fn() }));
import { freeswitchRouter, freeswitchCdrRouter } from "../server/pbx/freeswitch-routes";
import { parseCdrBody } from "../server/pbx/cdr-input";
const secret = "test-integration-secret-0123456789";
const uuid = "10000000-0000-4000-8000-000000000001";
const xml = (vars = "") => `<cdr core-uuid="untrusted-parent"><variables><uuid>${uuid}</uuid><sip_call_id>exact%40sip</sip_call_id>${vars}</variables><callflow><caller_profile><uuid>parent</uuid></caller_profile></callflow></cdr>`;
let server: Server, base: string;
const post = (body: string, headers: Record<string, string> = {}, path = "/fs/cdr") => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from("phone11-cdr:" + secret).toString("base64"), ...headers }, body });
beforeAll(async () => {
  const app = express();
  app.use("/fs/cdr", freeswitchCdrRouter);
  app.use(express.json({ limit: "50mb" })); app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use("/fs", freeswitchRouter);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 500).json({ error: "Rejected request" }));
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllEnvs(); });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("FS_SHARED_SECRET", secret); db.query.mockResolvedValue({ rows: [{ id: 12 }] }); db.route.mockResolvedValue({ tenantId: 12, extensionId: 23 }); db.cdr.mockResolvedValue({ callRecordId: 1, callLegId: 2 }); });
describe("native mod_xml_cdr input", () => {
  it("accepts Basic-auth form XML and resolves absent tenant only by own channel and SIP identity", async () => {
    const response = await post(new URLSearchParams({ cdr: xml("<caller_id_name>A%26B%20%E0%B9%84%E0%B8%97%E0%B8%A2%20100%25</caller_id_name><answer_epoch>1700000010</answer_epoch><end_epoch>1700000020</end_epoch>") }).toString());
    expect(response.status).toBe(200);
    expect(db.route).toHaveBeenCalledWith(uuid, "exact@sip");
    expect(db.cdr.mock.calls[0][0].variables).toMatchObject({ uuid, tenant_id: "12", caller_id_name: "A&B ไทย 100%", answer_epoch: "1700000010", end_epoch: "1700000020" });
  });
  it("rejects absent/ambiguous mapping without defaulting tenant or using parent UUID", async () => {
    db.route.mockResolvedValue(null);
    const response = await post(new URLSearchParams({ cdr: xml() }).toString());
    expect(response.status).toBe(400); expect(db.cdr).not.toHaveBeenCalled();
  });
  it("rejects a tenant mismatch before processing", async () => {
    expect((await post(new URLSearchParams({ cdr: xml("<tenant_id>99</tenant_id>") }).toString())).status).toBe(403);
    expect(db.cdr).not.toHaveBeenCalled();
  });
  it("does not enable Basic auth on directory or dialplan", async () => {
    for (const path of ["/fs/directory", "/fs/dialplan", "/fs/event"]) expect((await post("user=3001", {}, path)).status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
  it("rejects invalid Basic username, secret, query secrets, and unconfigured integration", async () => {
    for (const authorization of ["Basic " + Buffer.from("other:" + secret).toString("base64"), "Basic " + Buffer.from("phone11-cdr:wrong").toString("base64"), "Bearer " + secret]) expect((await post("cdr=x", { authorization })).status).toBe(403);
    expect((await post("cdr=x&secret=" + secret, { authorization: "" }, "/fs/cdr?secret=" + secret)).status).toBe(403);
    vi.stubEnv("FS_SHARED_SECRET", ""); expect((await post("cdr=x")).status).toBe(503);
    expect(db.cdr).not.toHaveBeenCalled();
  });
  it("retains authenticated JSON callbacks", async () => {
    expect((await post(JSON.stringify({ variables: { uuid, tenant_id: 12 } }), { "Content-Type": "application/json", "x-fs-secret": secret, authorization: "" })).status).toBe(200);
  });
  it("applies the small body limit before the global 50MB parser", async () => {
    expect((await post("cdr=" + "x".repeat(1024 * 1024))).status).toBe(413);
    expect(db.route).not.toHaveBeenCalled();
  });
  it("bounds decoded XML, duplicates, nesting and variable values", async () => {
    expect(() => parseCdrBody({ cdr: " ".repeat(512 * 1024 + 1) })).toThrow("too large");
    for (const cdr of [xml("<uuid>duplicate</uuid>"), xml("<x><y>bad</y></x>"), xml("<x>" + "a".repeat(65537) + "</x>"), "<cdr>" + "<x>".repeat(32) + "</x>".repeat(32) + "</cdr>"]) expect(() => parseCdrBody({ cdr })).toThrow();
  });
  it("rejects DTD/entity payloads, malformed XML and duplicate form fields", async () => {
    for (const cdr of ["<!DOCTYPE cdr [<!ENTITY x SYSTEM 'file:///etc/passwd'>]>" + xml("<x>&x;</x>"), xml().replace("</cdr>", "</bad>"), xml("<x>&unknown;</x>"), xml("<x>%ZZ</x>")]) expect((await post(new URLSearchParams({ cdr }).toString())).status).toBe(400);
    expect((await post("cdr=x&cdr=y")).status).toBe(400);
    expect(db.cdr).not.toHaveBeenCalled();
  });
});
