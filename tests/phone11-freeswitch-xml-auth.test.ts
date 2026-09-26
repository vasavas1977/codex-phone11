import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: db.query }));
vi.mock("../server/pbx/redis", () => ({ cacheGetOrSet: vi.fn((_key, _ttl, load) => load()), invalidateCache: vi.fn(), rateLimitCheck: vi.fn() }));
import { freeswitchRouter } from "../server/pbx/freeswitch-routes";

const secret = "test-integration-secret-0123456789";
const basic = (user = "phone11-freeswitch", password = secret) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
let server: Server;
let base: string;
const post = (path: string, headers: Record<string, string> = {}, fields: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields) });

beforeAll(async () => {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use("/fs", freeswitchRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FS_SHARED_SECRET", secret);
  db.query.mockResolvedValue({ rows: [] });
});

it("accepts canonical gateway Basic and existing header auth on directory and dialplan", async () => {
  for (const path of ["/fs/directory", "/fs/dialplan"]) {
    expect((await post(path, { authorization: basic() })).status).toBe(200);
    expect((await post(path, { "x-fs-secret": secret })).status).toBe(200);
  }
  const directory = await post("/fs/directory", { authorization: basic() }, { user: "3001", domain: "sip.example.test" });
  expect(directory.status).toBe(200);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining("FROM sip_accounts sa"), ["3001", "sip.example.test"]);
});

it("rejects missing, malformed, oversized, noncanonical, wrong-user and wrong-secret Basic before lookup", async () => {
  const invalid = ["", "Bearer " + secret, "Basic " + "A".repeat(5600), "Basic Zg=", "Basic Zg== ",
    "Basic " + Buffer.from([0xff, 0xfe]).toString("base64"), basic("phone11-cdr"), basic("other"), basic("phone11-freeswitch", "wrong")];
  for (const authorization of invalid) {
    expect((await post("/fs/directory", { authorization }, { user: "3001", domain: "sip.example.test" })).status).toBe(403);
  }
  expect(db.query).not.toHaveBeenCalled();
});

it("rejects dual auth and query or body secret fields even with valid credentials", async () => {
  expect((await post("/fs/directory", { authorization: basic(), "x-fs-secret": secret })).status).toBe(403);
  for (const path of [`/fs/directory?secret=${secret}`, `/fs/directory?fs_secret=${secret}`])
    expect((await post(path, { authorization: basic() })).status).toBe(403);
  for (const field of ["secret", "fs_secret", "FS_SHARED_SECRET", "authorization"])
    expect((await post("/fs/dialplan", { "x-fs-secret": secret }, { [field]: secret })).status).toBe(403);
  expect((await post(`/fs/directory?secret=${secret}`, {}, { secret })).status).toBe(403);
  expect(db.query).not.toHaveBeenCalled();
});

it("returns 503 when the configured secret is missing or a placeholder", async () => {
  for (const configured of ["", "phone11-fs-secret-change-me"] ) {
    vi.stubEnv("FS_SHARED_SECRET", configured);
    expect((await post("/fs/directory", { authorization: basic() })).status).toBe(503);
    expect((await post("/fs/dialplan", { "x-fs-secret": secret })).status).toBe(503);
  }
  expect(db.query).not.toHaveBeenCalled();
});

it("keeps Basic unavailable to other FreeSWITCH callbacks", async () => {
  expect((await post("/fs/event", { authorization: basic() })).status).toBe(403);
  expect((await post("/fs/cdr", { authorization: basic() })).status).toBe(403);
  expect(db.query).not.toHaveBeenCalled();
});
