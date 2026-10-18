import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { createServer, request as httpRequest, type ClientRequest, type Server } from "node:http";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { Pool, type PoolConfig } from "pg";
import superjson from "superjson";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Only DB transport and unrelated integrations are substituted. Authentication,
// cookies, HTTP/tRPC middleware, tenant admission and the restricted adapter are real.
const transport = vi.hoisted(() => ({ pool: null as Pool | null, refusedFraudQueries: 0 }));
vi.mock("../server/pbx/db", () => ({
  getPool: () => {
    if (!transport.pool) throw new Error("Generated auth database is unavailable");
    return transport.pool;
  },
  query: (sql: string, values?: unknown[]) => {
    if (!transport.pool) throw new Error("Generated membership database is unavailable");
    if (/fraud_controls|audit_logs|phone11_lock_fixed_fraud_admin/.test(sql)) {
      transport.refusedFraudQueries++;
      throw new Error("Shared fraud resource access is forbidden");
    }
    return transport.pool.query(sql, values);
  },
  withTransaction: () => {
    transport.refusedFraudQueries++;
    throw new Error("Shared fraud transactions are forbidden");
  },
}));
vi.mock("../server/pbx/redis", () => ({
  cacheGetOrSet: (_key: string, _ttl: number, load: () => unknown) => load(),
  invalidateCache: vi.fn(), rateLimitCheck: vi.fn(),
}));
vi.mock("../server/pbx/schema-capabilities", () => ({
  readManagementCapabilities: async () => ({ phoneNumbers: false }),
  schemaHasRequiredColumns: async () => false,
}));
vi.mock("../server/pbx/cdr-processor", () => ({
  getCallStats: vi.fn(), getVoicemails: vi.fn(), requireVoicemailStorage: vi.fn(),
  processCdr: vi.fn(), VoicemailStorageUnavailableError: class extends Error {},
}));
vi.mock("../server/profile/photo", () => ({ profilePhotoDescriptors: vi.fn() }));
vi.mock("../server/phone-provisioning", () => ({
  reactivateExtensionSipAuth: vi.fn(), revokeExtensionSipAuth: vi.fn(), rotateExtensionSipAuth: vi.fn(),
}));

import { registerAuthRoutes, phone11Cors } from "../server/_core/auth-routes";
import { applyAuthMigration, createExistingUserIdentity } from "../server/_core/phone11-auth-admin";
import { readAuthConfig } from "../server/_core/phone11-auth";
import { createContext } from "../server/_core/context";
import { createPbxReadinessHttpGuard } from "../server/_core/pbx-readiness-http";
import { createInvitationHttpGuard } from "../server/_core/phone11-invitation-http";
import { router } from "../server/_core/trpc";
import { pbxRouter } from "../server/pbx/pbx-router";
import { closeFraudPolicyPool } from "../server/pbx/fraud-policy-db";

const expectedServerMajor = process.env.PHONE11_PBX_TEST_SERVER_MAJOR ?? "17";
if (expectedServerMajor !== "16" && expectedServerMajor !== "17") {
  throw new Error("Generated HTTP rehearsal server major must be exactly 16 or 17");
}
const connectionString = process.env.PHONE11_PBX_TEST_DATABASE_URL;
let target: URL | undefined;
if (connectionString) {
  try { target = new URL(connectionString); } catch {
    throw new Error("HTTP rehearsal requires the dedicated generated loopback database");
  }
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" ||
      target.port !== "55436" || target.pathname !== "/phone11_pbx_test" ||
      target.username !== "phone11_fixture_owner" || !target.password || target.search || target.hash) {
    throw new Error("HTTP rehearsal requires the dedicated generated loopback database");
  }
}

type HttpResult = { status: number; body: any; text: string; cookies: string[]; headers: Record<string, unknown> };
// The gate encloses every Pool and listener. Ordinary offline runs start neither.
const suite = connectionString ? describe.sequential : describe.skip;
suite("generated fraud policy: real HTTP, cookie authentication and restricted LOGIN", () => {
  let operator: Pool | undefined;
  let authPool: Pool | undefined;
  let server: Server | undefined;
  const ownedRequests = new Set<ClientRequest>();
  let origin = "";
  let schema = "", role = "", helperOwner = "";
  let madeSchema = false, madeRole = false, madeOwner = false;
  const password = randomBytes(24).toString("base64url");
  const secret = randomBytes(48).toString("base64url");
  const adminEmail = "admin@generated.example.test";
  const memberEmail = "member@generated.example.test";

  function request(path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(origin + path, {
        method: options.method || "GET", headers: options.headers, agent: false, maxHeaderSize: 16_384,
      }, res => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", chunk => {
          const buffer = Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > 65_536) {
            clearTimeout(deadline);
            req.destroy(new Error("Generated HTTP response exceeded its bound"));
            return;
          }
          chunks.push(buffer);
        });
        res.on("error", error => { clearTimeout(deadline); reject(error); });
        res.on("aborted", () => { clearTimeout(deadline); reject(new Error("Generated HTTP response was aborted")); });
        res.on("end", () => {
          clearTimeout(deadline);
          const text = Buffer.concat(chunks).toString("utf8");
          let body: unknown;
          try { body = JSON.parse(text); } catch { return reject(new Error("Generated HTTP response was not JSON")); }
          resolve({ status: res.statusCode || 0, body, text, cookies: res.headers["set-cookie"] || [], headers: res.headers });
        });
      });
      ownedRequests.add(req);
      const deadline = setTimeout(() => req.destroy(new Error("Generated HTTP request timed out")), 10_000);
      req.once("close", () => { clearTimeout(deadline); ownedRequests.delete(req); });
      req.on("error", error => { clearTimeout(deadline); reject(error); });
      req.end(options.body);
    });
  }
  function rpc(method: "get" | "update", input?: Record<string, unknown>, cookie?: string, extra: Record<string, string> = {}) {
    const path = `/api/trpc/pbx.fraudControls.${method}`;
    const headers = { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...extra };
    if (method === "get") return request(path + (input ? `?input=${encodeURIComponent(JSON.stringify(superjson.serialize(input)))}` : ""), { headers });
    return request(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(superjson.serialize(input)) });
  }
  function value<T = any>(result: HttpResult): T { return superjson.deserialize<T>(result.body.result.data); }
  function expectRpcError(result: HttpResult, status: number, code: string) {
    expect(result.status).toBe(status);
    expect(result.body.error.json.data.code).toBe(code);
  }
  async function login(email = adminEmail): Promise<string> {
    const result = await request("/api/auth/sign-in/email", { method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email, password, rememberMe: false }),
    });
    expect(result.status).toBe(200);
    // Boolean assertions keep unexpected auth bodies/tokens out of failure output.
    expect(result.body?.success === true && Object.keys(result.body).length === 1).toBe(true);
    expect(result.headers["set-auth-token"] === undefined).toBe(true);
    expect(result.cookies.some(cookie => /httponly/i.test(cookie) && /samesite=lax/i.test(cookie))).toBe(true);
    expect(result.cookies.every(cookie => !/domain=/i.test(cookie))).toBe(true);
    const cookies = result.cookies.map(cookie => cookie.split(";")[0]).join("; ");
    expect(cookies.includes("phone11.session_token=")).toBe(true);
    return cookies;
  }
  async function expectNoPolicyWrites() {
    expect((await operator!.query("SELECT count(*)::int AS n FROM fraud_controls")).rows[0].n).toBe(0);
    expect((await operator!.query("SELECT count(*)::int AS n FROM audit_logs")).rows[0].n).toBe(0);
  }

  beforeAll(async () => {
    if (!target) throw new Error("Generated database gate was not satisfied");
    // Do not import the application bootstrap, load dotenv, or inherit auth/provider settings.
    for (const name of Object.keys(process.env)) {
      if (name.startsWith("PHONE11_FRAUD_") || name.startsWith("PHONE11_AUTH_") || name.startsWith("PHONE11_PASSWORD_RESET_")) {
        vi.stubEnv(name, undefined);
      }
    }
    vi.stubEnv("NODE_ENV", "test");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const nonce = randomBytes(8).toString("hex");
    schema = `http_${nonce}`; role = `http_login_${nonce}`; helperOwner = `http_lock_${nonce}`;
    const poolConfig: PoolConfig = {
      host: "127.0.0.1", port: 55436, database: "phone11_pbx_test", user: "phone11_fixture_owner",
      password: decodeURIComponent(target.password), ssl: false,
      options: `-c search_path=${schema} -c statement_timeout=10000 -c lock_timeout=3000`,
      connectionTimeoutMillis: 5000, query_timeout: 10000,
    };
    operator = new Pool({ ...poolConfig, max: 1 });
    const identity = (await operator.query("SELECT current_database() AS database, current_user AS role, current_setting('server_version_num')::int / 10000 AS major")).rows[0];
    expect(identity).toEqual({ database: "phone11_pbx_test", role: "phone11_fixture_owner", major: Number(expectedServerMajor) });
    const loginPassword = randomBytes(32).toString("hex");
    await operator.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION NOINHERIT PASSWORD '${loginPassword}'`); madeRole = true;
    await operator.query(`CREATE ROLE ${helperOwner} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION NOINHERIT`); madeOwner = true;
    await operator.query(`CREATE SCHEMA ${schema}`); madeSchema = true;
    await operator.query(`CREATE TABLE users (
        id SERIAL PRIMARY KEY, "openId" TEXT UNIQUE NOT NULL, name TEXT, email TEXT,
        "loginMethod" TEXT, role TEXT NOT NULL, "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ DEFAULT NOW(), "lastSignedIn" TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE tenants(id integer PRIMARY KEY,status text NOT NULL,name text NOT NULL);
      CREATE TABLE tenant_memberships(user_id integer NOT NULL,tenant_id integer NOT NULL,role text NOT NULL,status text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,tenant_id));
      INSERT INTO tenants VALUES(7,'active','Generated One'),(8,'active','Generated Two');
      INSERT INTO tenant_memberships(user_id,tenant_id,role,status) VALUES
        (9,7,'admin','active'),(9,8,'owner','active'),(33,7,'user','active')`);
    await operator.query(`INSERT INTO users(id,"openId",name,email,"loginMethod",role)
      VALUES(9,'generated-admin','Generated Admin',$1,'phone11','user'),
        (33,'generated-member','Generated Member',$2,'phone11','user')`, [adminEmail, memberEmail]);
    for (const [key, setting] of [["expected_database", "phone11_pbx_test"], ["expected_schema", schema], ["expected_server_major", expectedServerMajor]]) {
      await operator.query("SELECT set_config($1,$2,false)", [`phone11.${key}`, setting]);
    }
    for (const file of ["fraud-controls-migration.sql", "audit-storage-migration.sql"]) {
      await operator.query(await readFile(new URL(`../server/pbx/${file}`, import.meta.url), "utf8"));
    }
    const pins = (await operator.query(`SELECT 'fraud_controls'::regclass::oid::text AS fraud,'audit_logs'::regclass::oid::text AS audit,
      pg_get_serial_sequence('audit_logs','id')::regclass::oid::text AS sequence,
      (SELECT oid::text FROM pg_roles WHERE rolname=$1) AS runtime,(SELECT oid::text FROM pg_roles WHERE rolname=$2) AS owner`, [role, helperOwner])).rows[0];
    for (const [key, setting] of [["fixed_tenant_id", "7"], ["runtime_role", role], ["runtime_role_oid", pins.runtime],
      ["lock_owner_role", helperOwner], ["lock_owner_role_oid", pins.owner], ["expected_fraud_oid", pins.fraud],
      ["expected_audit_oid", pins.audit], ["expected_audit_sequence_oid", pins.sequence]]) {
      await operator.query("SELECT set_config($1,$2,false)", [`phone11.${key}`, setting]);
    }
    await operator.query(await readFile(new URL("../server/pbx/audit-runtime-permissions.sql", import.meta.url), "utf8"));
    const helper = (await operator.query(`SELECT p.oid::text AS oid,n.oid::text AS schema_oid,
      encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS hash FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=$1 AND p.proname='phone11_lock_fixed_fraud_admin'`, [schema])).rows[0];
    const settings: Record<string, string> = {
      HOST: "127.0.0.1", PORT: "55436", DATABASE: "phone11_pbx_test", USER: role, PASSWORD: loginPassword,
      SCHEMA: schema, TENANT_ID: "7", ROLE_OID: pins.runtime, SCHEMA_OID: helper.schema_oid,
      HELPER_OID: helper.oid, HELPER_OWNER: helperOwner, HELPER_OWNER_OID: pins.owner, HELPER_SHA256: helper.hash,
      SERVER_MAJOR: expectedServerMajor, FRAUD_OID: pins.fraud, AUDIT_OID: pins.audit, AUDIT_SEQUENCE_OID: pins.sequence, GENERATED_LAB: "1",
    };
    for (const [key, setting] of Object.entries(settings)) vi.stubEnv(`PHONE11_FRAUD_${key}`, setting);

    // Sign-in holds one advisory-lock client while Better Auth uses the second.
    // Operator(1) + auth(2) + dedicated fraud(2) remain below the lab's eight slots.
    authPool = new Pool({ ...poolConfig, max: 2 });
    transport.pool = authPool;
    const app = express();
    app.use(phone11Cors);
    registerAuthRoutes(app);
    app.use("/api/trpc", createPbxReadinessHttpGuard());
    app.use("/api/trpc", createInvitationHttpGuard());
    app.use(express.json({ limit: "16kb" }));
    app.use("/api/trpc", createExpressMiddleware({ router: router({ pbx: pbxRouter }), createContext }));
    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", () => { server!.off("error", reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Generated listener address is unavailable");
    origin = `http://127.0.0.1:${address.port}`;
    vi.stubEnv("PHONE11_AUTH_BASE_URL", origin);
    vi.stubEnv("PHONE11_AUTH_SECRET", secret);
    vi.stubEnv("PHONE11_AUTH_TRUSTED_ORIGINS", origin);
    await applyAuthMigration(authPool, readAuthConfig());
    await createExistingUserIdentity(authPool, { userId: 9, email: adminEmail, password });
    await createExistingUserIdentity(authPool, { userId: 33, email: memberEmail, password });
  }, 30_000);

  beforeEach(async () => {
    transport.refusedFraudQueries = 0;
    await operator!.query("ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS private_generated_audit_reject");
    await operator!.query("TRUNCATE fraud_controls, audit_logs, phone11_auth_session, phone11_auth_rate_limit");
    await operator!.query("UPDATE tenant_memberships SET status='active',role=CASE WHEN user_id=33 THEN 'user' WHEN tenant_id=8 THEN 'owner' ELSE 'admin' END");
  });
  afterEach(() => { expect(transport.refusedFraudQueries).toBe(0); });
  afterAll(async () => {
    try {
      for (const req of ownedRequests) req.destroy(new Error("Generated HTTP fixture is closing"));
      if (server?.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
      }
    } finally {
      try { await closeFraudPolicyPool(); }
      finally {
        transport.pool = null;
        try { await authPool?.end(); }
        finally {
          try {
            if (operator) {
              await operator.query("ROLLBACK");
              if (madeSchema) await operator.query(`DROP SCHEMA ${schema} CASCADE`);
              if (madeRole) await operator.query(`DROP ROLE ${role}`);
              if (madeOwner) await operator.query(`DROP ROLE ${helperOwner}`);
            }
          } finally {
            await operator?.end();
            vi.unstubAllEnvs(); vi.restoreAllMocks();
          }
        }
      }
    }
  });

  it("uses genuine browser sign-in cookies for empty GET, save, readback and actor-scoped audit", async () => {
    const cookie = await login();
    const empty = await rpc("get", { tenantId: 7 }, cookie);
    expect(empty.status).toBe(200); expect(value(empty)).toBeNull();
    const saved = await rpc("update", { tenantId: 7, internationalEnabled: true }, cookie);
    expect(saved.status).toBe(200); expect(value(saved)).toEqual({ success: true });
    const loaded = await rpc("get", { tenantId: 7 }, cookie);
    expect(loaded.status).toBe(200);
    expect(value(loaded)).toMatchObject({ tenant_id: 7, international_enabled: true, premium_rate_enabled: false });
    expect((await operator!.query("SELECT tenant_id,actor_user_id,action,resource_type,new_value FROM audit_logs")).rows)
      .toEqual([{ tenant_id: 7, actor_user_id: 9, action: "update", resource_type: "fraud_controls",
        new_value: { tenantId: 7, internationalEnabled: true } }]);
  }, 20_000);
  it("rejects GET and update without a session cookie", async () => {
    expectRpcError(await rpc("get", { tenantId: 7 }), 401, "UNAUTHORIZED");
    expectRpcError(await rpc("update", { tenantId: 7, internationalEnabled: true }), 401, "UNAUTHORIZED");
    await expectNoPolicyWrites();
  }, 20_000);
  it("rejects a tampered session cookie", async () => {
    const cookie = (await login()).split("; ").map(part => part.startsWith("phone11.session_token=")
      ? part.slice(0, -1) + (part.endsWith("A") ? "B" : "A") : part).join("; ");
    expectRpcError(await rpc("get", { tenantId: 7 }, cookie), 401, "UNAUTHORIZED");
    await expectNoPolicyWrites();
  }, 20_000);
  it("rejects the original cookie after real HTTP sign-out", async () => {
    const cookie = await login();
    expect((await request("/api/auth/sign-out", { method: "POST", headers: { Cookie: cookie, Origin: origin } })).status).toBe(200);
    expectRpcError(await rpc("get", { tenantId: 7 }, cookie), 401, "UNAUTHORIZED");
    await expectNoPolicyWrites();
  }, 20_000);
  it("never falls back to a valid cookie when an invalid bearer is supplied", async () => {
    const cookie = await login();
    expectRpcError(await rpc("get", { tenantId: 7 }, cookie, { Authorization: "Bearer generated-invalid" }), 401, "UNAUTHORIZED");
    await expectNoPolicyWrites();
  }, 20_000);
  it("denies a genuinely authenticated nonadministrator", async () => {
    const cookie = await login(memberEmail);
    expectRpcError(await rpc("get", { tenantId: 7 }, cookie), 403, "FORBIDDEN");
    expectRpcError(await rpc("update", { tenantId: 7, internationalEnabled: true }, cookie), 403, "FORBIDDEN");
    await expectNoPolicyWrites();
  }, 20_000);
  it("denies revoked membership while the same cookie still authenticates", async () => {
    const cookie = await login();
    await operator!.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=9 AND tenant_id=7");
    expect((await request("/api/auth/me", { headers: { Cookie: cookie, Origin: origin } })).status).toBe(200);
    expectRpcError(await rpc("get", { tenantId: 7 }, cookie), 403, "FORBIDDEN");
    expectRpcError(await rpc("update", { tenantId: 7, internationalEnabled: true }, cookie), 403, "FORBIDDEN");
    await expectNoPolicyWrites();
  }, 20_000);
  it("refuses a joined administrator tenant outside the fixed restricted binding", async () => {
    const cookie = await login();
    expectRpcError(await rpc("get", { tenantId: 8 }, cookie), 412, "PRECONDITION_FAILED");
    expectRpcError(await rpc("update", { tenantId: 8, internationalEnabled: true }, cookie), 412, "PRECONDITION_FAILED");
    await expectNoPolicyWrites();
  }, 20_000);
  it("requires explicit joined workspace selection for this multi-workspace user", async () => {
    const cookie = await login();
    expectRpcError(await rpc("get", undefined, cookie), 403, "FORBIDDEN");
    expectRpcError(await rpc("get", { tenantId: 99 }, cookie), 403, "FORBIDDEN");
    await expectNoPolicyWrites();
  }, 20_000);
  it("rejects unsupported, unknown, empty and malformed updates over the wire", async () => {
    const cookie = await login();
    for (const input of [{ tenantId: 7, internationalEnabled: true, dailyCostCeiling: 100 },
      { tenantId: 7, internationalEnabled: true, actorUserId: 9 }, { tenantId: 7 }, { tenantId: "7", internationalEnabled: true }]) {
      expectRpcError(await rpc("update", input, cookie), 400, "BAD_REQUEST");
    }
    await expectNoPolicyWrites();
  }, 20_000);
  it("rejects an untrusted browser Origin before policy access", async () => {
    const cookie = await login();
    const result = await rpc("update", { tenantId: 7, internationalEnabled: true }, cookie, { Origin: "https://generated-attacker.example.test" });
    expect(result.status).toBe(403); expect(result.body).toEqual({ error: "Origin not allowed" });
    await expectNoPolicyWrites();
  }, 20_000);
  it("sanitizes genuine audit rejection and rolls back the already attempted policy update", async () => {
    const cookie = await login();
    expect((await rpc("update", { tenantId: 7, internationalEnabled: false }, cookie)).status).toBe(200);
    await operator!.query("ALTER TABLE audit_logs ADD CONSTRAINT private_generated_audit_reject CHECK (resource_type <> 'fraud_controls') NOT VALID");
    const result = await rpc("update", { tenantId: 7, internationalEnabled: true }, cookie);
    expectRpcError(result, 500, "INTERNAL_SERVER_ERROR");
    expect(result.body.error.json.message).toBe("Could not record PBX change");
    expect(result.text).not.toMatch(/private_generated_audit_reject|23514|Failing row|postgresql?:\/\//i);
    expect((await operator!.query("SELECT tenant_id,international_enabled FROM fraud_controls")).rows)
      .toEqual([{ tenant_id: 7, international_enabled: false }]);
    expect((await operator!.query("SELECT count(*)::int AS n FROM audit_logs")).rows[0].n).toBe(1);
    const loaded = await rpc("get", { tenantId: 7 }, cookie);
    expect(loaded.status).toBe(200); expect(value(loaded)).toMatchObject({ international_enabled: false });
  }, 20_000);
});
