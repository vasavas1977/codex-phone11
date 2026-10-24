import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ query: vi.fn(), invalidate: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: f.query }));
vi.mock("../server/pbx/redis", () => ({ cacheGetOrSet: vi.fn(), invalidateCache: f.invalidate }));
import { kamailioRouter } from "../server/pbx/kamailio-routes";

const route = kamailioRouter.stack.find(item => item.route?.path === "/register")!.route!;
const secret = "synthetic-kam-registration-secret-0123456789";
const body = { username: "3001", domain: "phone11-fixture.invalid", contact: "sip:3001@192.0.2.11", user_agent: "ignored synthetic client" };

async function register(input: unknown = body, suppliedSecret: string | null = secret) {
  const req = { headers: suppliedSecret === null ? {} : { "x-kam-secret": suppliedSecret }, body: input };
  const res = {
    code: 200, body: null as unknown,
    status(code: number) { this.code = code; return this; },
    json(value: unknown) { this.body = value; return this; },
  };
  let admitted = false;
  route.stack[0].handle(req as any, res as any, () => { admitted = true; });
  if (admitted) await route.stack[1].handle(req as any, res as any, () => undefined);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("KAM_SHARED_SECRET", secret);
  f.query.mockResolvedValue({ rows: [], rowCount: 1 });
  f.invalidate.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Kamailio registration callback", () => {
  it.each([{ label: "missing", value: null }, { label: "wrong", value: "wrong" }])("rejects a $label secret before SQL or cache work", async ({ value }) => {
    const res = await register(body, value);
    expect(res.code).toBe(403);
    expect(f.query).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
  });

  it("updates only supported registration columns with bound identity and invalidates the existing cache key", async () => {
    const res = await register();
    expect(res.body).toEqual({ ok: true });
    expect(f.query).toHaveBeenCalledOnce();
    const [sql, params] = f.query.mock.calls[0];
    expect(sql).toContain("last_registered_at = NOW()");
    expect(sql).toContain("last_registered_contact = $1");
    expect(sql).toContain("sip_username = $2 AND sip_domain = $3 AND deleted_at IS NULL");
    expect(sql).not.toContain("user_agent"); expect(sql).not.toContain(body.contact);
    expect(params).toEqual([body.contact, body.username, body.domain]);
    expect(f.invalidate).toHaveBeenCalledOnce();
    expect(f.invalidate).toHaveBeenCalledWith("kam:auth:phone11-fixture.invalid:3001");
    expect(f.query.mock.invocationCallOrder[0]).toBeLessThan(f.invalidate.mock.invocationCallOrder[0]);
  });

  it("preserves the empty contact fallback and ignores optional client metadata", async () => {
    expect((await register({ ...body, contact: undefined, expires: 60 })).body).toEqual({ ok: true });
    expect(f.query.mock.calls[0][1]).toEqual(["", body.username, body.domain]);
  });

  it.each([{ username: "3001" }, { domain: body.domain }, {}])("does no work for incomplete identity %j", async input => {
    expect((await register(input)).body).toEqual({ ok: true });
    expect(f.query).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
  });

  it("returns the existing failure response without invalidating cache when SQL fails", async () => {
    f.query.mockRejectedValue(new Error("PRIVATE_DATABASE_FAILURE"));
    const res = await register();
    expect(res.code).toBe(200); expect(res.body).toEqual({ ok: false });
    expect(JSON.stringify(res.body)).not.toContain("PRIVATE_DATABASE_FAILURE");
    expect(f.invalidate).not.toHaveBeenCalled();
  });
});

// Optional native PostgreSQL proof owns a fresh socket-only cluster, never an
// existing DATABASE_URL, Docker service, customer table or provider callback.
describe.skipIf(process.env.PHONE11_KAM_REGISTER_NATIVE_PG !== "1")("registration against the existing twenty-column schema", () => {
  const bin = process.env.PHONE11_TEST_PG_BIN || "/opt/homebrew/opt/postgresql@17/bin";
  let root: string | undefined;
  let database: Pool | undefined;
  let started = false;
  function run(command: string, args: string[]) {
    const result = spawnSync(join(bin, command), args, { encoding: "utf8", timeout: 30000 });
    if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr}`);
  }
  beforeAll(async () => {
    root = await mkdtemp("/tmp/p11-kam-register-"); await chmod(root, 0o700);
    const socket = join(root, "socket"); await mkdir(socket, { mode: 0o700 });
    run("initdb", ["-D", join(root, "data"), "-U", "phone11_test", "--auth-local=trust", "--auth-host=reject", "--no-locale", "-E", "UTF8"]);
    run("pg_ctl", ["-D", join(root, "data"), "-l", join(root, "postgres.log"), "-o", `-h '' -k '${socket}'`, "-w", "start"]);
    started = true;
    database = new Pool({ host: socket, port: 5432, user: "phone11_test", database: "postgres", password: "", ssl: false });
    // Installed catalog OID24635 contains these twenty columns, no user_agent.
    await database.query(`CREATE TABLE sip_accounts (
      id integer PRIMARY KEY, tenant_id integer, org_id integer, extension_id integer, user_id integer,
      sip_username varchar NOT NULL, sip_domain varchar NOT NULL, ha1 varchar, ha1b varchar,
      secret_ciphertext bytea, secret_iv bytea, secret_tag bytea, dek_id varchar,
      transport_preference varchar NOT NULL, status varchar NOT NULL,
      last_registered_at timestamptz, last_registered_contact text, deleted_at timestamptz,
      created_at timestamptz, updated_at timestamptz
    )`);
  }, 30000);
  beforeEach(async () => {
    await database!.query(`DELETE FROM sip_accounts;
      INSERT INTO sip_accounts(id,sip_username,sip_domain,transport_preference,status,last_registered_at,last_registered_contact,deleted_at)
      VALUES(1,'3001','phone11-fixture.invalid','TLS','active','2000-01-01Z','old-1',NULL),
            (2,'3002','phone11-fixture.invalid','TLS','active','2000-01-01Z','old-2',NULL),
            (3,'3001','other-fixture.invalid','TLS','active','2000-01-01Z','old-3',NULL),
            (4,'3001','phone11-fixture.invalid','TLS','active','2000-01-01Z','old-4','2000-01-01Z')`);
    f.query.mockImplementation((sql, params) => database!.query(sql, params));
  });
  afterAll(async () => {
    try { await database?.end(); }
    finally {
      if (root) {
        // A timed-out pg_ctl start may still have created the owned postmaster.
        // Keep the directory if stopping fails; never remove a live data root.
        if (started || existsSync(join(root, "data", "postmaster.pid"))) run("pg_ctl", ["-D", join(root, "data"), "-m", "fast", "-w", "stop"]);
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it("executes actual router SQL without adding a column and touches only the matching undeleted account", async () => {
    expect((await database!.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='sip_accounts'")).rows).toEqual([{ n: 20 }]);
    expect((await register()).body).toEqual({ ok: true });
    const rows = (await database!.query("SELECT id,last_registered_contact,last_registered_at FROM sip_accounts ORDER BY id")).rows;
    expect(rows[0].last_registered_contact).toBe(body.contact);
    expect(rows[0].last_registered_at.getTime()).toBeGreaterThan(Date.parse("2000-01-01Z"));
    for (const row of rows.slice(1)) {
      expect(row.last_registered_contact).toBe(`old-${row.id}`);
      expect(row.last_registered_at.toISOString()).toBe("2000-01-01T00:00:00.000Z");
    }
    expect(f.invalidate).toHaveBeenCalledOnce();
    expect(f.invalidate).toHaveBeenCalledWith("kam:auth:phone11-fixture.invalid:3001");
  });

  it("keeps callback identity parameterized for punctuation rather than broadening the WHERE predicate", async () => {
    expect((await register({ ...body, username: "3001' OR 1=1 --" })).body).toEqual({ ok: true });
    expect((await database!.query("SELECT count(*)::int AS n FROM sip_accounts WHERE last_registered_contact NOT LIKE 'old-%'")).rows).toEqual([{ n: 0 }]);
  });
});
