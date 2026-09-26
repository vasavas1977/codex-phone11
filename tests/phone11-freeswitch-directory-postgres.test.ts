import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { Pool } from "pg";
import { SaxesParser } from "saxes";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("../server/pbx/db", () => ({ query: (sql: string, values?: unknown[]) => state.pool!.query(sql, values) }));
vi.mock("../server/pbx/redis", () => ({ cacheGetOrSet: vi.fn((_key, _ttl, load) => load()), invalidateCache: vi.fn(), rateLimitCheck: vi.fn() }));
import { freeswitchRouter } from "../server/pbx/freeswitch-routes";

const socket = process.env.PHONE11_FS_DIRECTORY_TEST_SOCKET;
const schema = `phone11_fs_directory_${randomUUID().replaceAll("-", "")}`;
const secret = "test-integration-secret-0123456789";
let server: Server;
let base: string;

function directory(xml: string) {
  const users: Array<{ id: string; attributes: Record<string, string> }> = [];
  let current: { id: string; attributes: Record<string, string> } | null = null;
  const parser = new SaxesParser();
  parser.on("opentag", (tag) => {
    if (tag.name === "user") {
      current = { id: String(tag.attributes.id), attributes: {} };
      users.push(current);
    } else if (tag.name === "param" || tag.name === "variable") {
      if (current) current.attributes[String(tag.attributes.name)] = String(tag.attributes.value);
    }
  });
  parser.on("closetag", (tag) => { if (tag.name === "user") current = null; });
  parser.write(xml).close();
  return users;
}

async function lookup(user: string, domain = "sip.phone11.test") {
  const response = await fetch(`${base}/fs/directory`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`phone11-freeswitch:${secret}`).toString("base64")}` },
    body: new URLSearchParams({ user, domain }),
  });
  expect(response.status).toBe(200);
  return directory(await response.text());
}

describe.skipIf(!socket)("FreeSWITCH directory against maintained PostgreSQL shape", () => {
  beforeAll(async () => {
    vi.stubEnv("FS_SHARED_SECRET", secret);
    state.pool = new Pool({ host: socket, port: Number(process.env.PHONE11_FS_DIRECTORY_TEST_PORT),
      user: "phone11_test", database: "phone11_fs_directory_test", ssl: false,
      options: `-c search_path=${schema}` });
    await state.pool.query(`CREATE SCHEMA ${schema}`);
    // The maintained tenant and extension shape has no slug or forwarding columns.
    await state.pool.query(`
      CREATE TABLE tenants(id integer PRIMARY KEY, status text NOT NULL);
      CREATE TABLE extensions(id integer PRIMARY KEY, tenant_id integer NOT NULL,
        extension_number text NOT NULL, display_name text, voicemail_enabled boolean NOT NULL,
        status text NOT NULL, deleted_at timestamptz);
      CREATE TABLE sip_accounts(extension_id integer NOT NULL, tenant_id integer NOT NULL,
        sip_username text NOT NULL, sip_domain text NOT NULL, ha1 text,
        status text NOT NULL, deleted_at timestamptz);
      INSERT INTO tenants VALUES(1,'active'),(2,'inactive');
      INSERT INTO extensions VALUES
        (11,1,'3001','A & "B" <user id="9999"> ไทย',true,'active',NULL),
        (12,1,'1020','Peer 1020',false,'active',NULL),
        (21,2,'4001','Inactive tenant',false,'active',NULL);
      INSERT INTO sip_accounts VALUES
        (11,1,'3001','sip.phone11.test','hash3001','active',NULL),
        (12,1,'1020','sip.phone11.test','hash1020','active',NULL),
        (21,2,'4001','sip.phone11.test','hash4001','active',NULL);
    `);
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use("/fs", freeswitchRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.on("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (state.pool) {
      await state.pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await state.pool.end();
    }
    vi.unstubAllEnvs();
  });

  it("serves 3001 and 1020 from the current schema with valid escaped XML", async () => {
    expect(await lookup("3001")).toEqual([{ id: "3001", attributes: {
      "a1-hash": "hash3001", "vm-enabled": "true", toll_allow: "domestic,local",
      accountcode: "default", user_context: "default",
      effective_caller_id_name: 'A & "B" <user id="9999"> ไทย',
      effective_caller_id_number: "3001", callgroup: "default", tenant_id: "1",
    } }]);
    expect((await lookup("1020"))[0]).toMatchObject({ id: "1020", attributes: {
      "a1-hash": "hash1020", "vm-enabled": "false", effective_caller_id_name: "Peer 1020",
    } });
  });

  it("keeps account, extension, domain and tenant active gates", async () => {
    expect(await lookup("4001")).toEqual([]);
    expect(await lookup("3001", "other.test")).toEqual([]);
    await state.pool!.query("UPDATE extensions SET status='inactive' WHERE id=11");
    expect(await lookup("3001")).toEqual([]);
    await state.pool!.query("UPDATE extensions SET status='active' WHERE id=11");
    await state.pool!.query("UPDATE sip_accounts SET status='inactive' WHERE sip_username='1020'");
    expect(await lookup("1020")).toEqual([]);
  });
});
