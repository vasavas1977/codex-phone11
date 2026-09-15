import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { Pool } from "pg";
import type { Express, Request, Response } from "express";
import { createPhone11Auth, type Phone11Auth } from "../server/_core/phone11-auth";
import { applyAuthMigration, createExistingUserIdentity } from "../server/_core/phone11-auth-admin";
import { isPhone11AuthReady } from "../server/_core/phone11-auth-readiness";
import { registerAuthRoutes } from "../server/_core/auth-routes";

describe("Phone11 readiness schema validation", () => {
  const database = { query: vi.fn().mockRejectedValue(new Error("Test database unavailable")) } as unknown as Pool;
  beforeEach(() => vi.clearAllMocks());

  it("waits for the actual schema verdict before inspecting identities", async () => {
    let finish!: () => void;
    const checkSchema = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const auth = { $context: Promise.resolve({ checkSchema }) } as unknown as Phone11Auth;
    const pending = isPhone11AuthReady(auth, database);
    await vi.waitFor(() => expect(checkSchema).toHaveBeenCalledOnce());
    expect(database.query).not.toHaveBeenCalled();
    finish();
    expect(await pending).toBe(false);
    expect(database.query).toHaveBeenCalledOnce();
  });

  it("fails closed when the adapter does not support schema validation", async () => {
    const auth = { $context: Promise.resolve({}) } as Phone11Auth;
    expect(await isPhone11AuthReady(auth, database)).toBe(false);
    expect(database.query).not.toHaveBeenCalled();
  });

  it("fails closed on auth initialization or schema validation errors", async () => {
    const failedContext = { $context: Promise.reject(new Error("Initialization failed")) } as Phone11Auth;
    expect(await isPhone11AuthReady(failedContext, database)).toBe(false);
    const failedSchema = { $context: Promise.resolve({ checkSchema: () => Promise.reject(new Error("Incomplete migration")) }) } as unknown as Phone11Auth;
    expect(await isPhone11AuthReady(failedSchema, database)).toBe(false);
    expect(database.query).not.toHaveBeenCalled();
  });
});

describe.skipIf(!process.env.PHONE11_AUTH_TEST_SOCKET)("Phone11 readiness against private PostgreSQL", () => {
  const bin = process.env.PHONE11_TEST_PG_BIN || "/opt/homebrew/opt/postgresql@17/bin";
  const config = {
    baseURL: "https://phone11-readiness.example.test",
    secret: randomBytes(48).toString("base64url"),
    trustedOrigins: ["https://phone11-readiness.example.test"],
  };
  let root: string;
  let socket: string;
  let database: Pool;
  let started = false;
  function run(command: string, args: string[]) {
    const result = spawnSync(join(bin, command), args, { encoding: "utf8" });
    if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr}`);
  }
  const ready = () => isPhone11AuthReady(createPhone11Auth(database, config), database);

  beforeAll(async () => {
    // Own a new private cluster. Never use DATABASE_URL or an existing test/production DB.
    root = await mkdtemp(join(tmpdir(), "phone11-auth-test-"));
    await chmod(root, 0o700);
    socket = join(root, "socket");
    await mkdir(socket, { mode: 0o700 });
    const data = join(root, "data");
    run("initdb", ["-D", data, "-U", "phone11_test", "--auth-local=trust", "--auth-host=reject", "--no-locale", "-E", "UTF8"]);
    const quotedSocket = "'" + socket.replace(/'/g, "'\\''") + "'";
    run("pg_ctl", ["-D", data, "-l", join(root, "postgres.log"), "-o", "-h '' -k " + quotedSocket, "-w", "start"]);
    started = true;
    database = new Pool({ host: socket, port: 5432, database: "postgres", user: "phone11_test", password: "", ssl: false });
  }, 30000);

  beforeEach(async () => {
    await database.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      CREATE TABLE users (
        id SERIAL PRIMARY KEY, "openId" TEXT UNIQUE NOT NULL, name TEXT, email TEXT,
        "loginMethod" TEXT, role TEXT NOT NULL, "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ DEFAULT NOW(), "lastSignedIn" TIMESTAMPTZ DEFAULT NOW()
      );
      INSERT INTO users (id, "openId", name, email, "loginMethod", role)
        VALUES (17, 'canonical-id', 'Readiness fixture', 'owner@example.test', 'legacy', 'admin');
    `);
    await applyAuthMigration(database, config);
    await createExistingUserIdentity(database, {
      userId: 17, email: "owner@example.test", password: "private-readiness-test-password",
    });
  }, 30000);

  afterAll(async () => {
    try {
      if (database) await database.end();
    } finally {
      try {
        if (started) run("pg_ctl", ["-D", join(root, "data"), "-m", "fast", "-w", "stop"]);
      } finally {
        if (root) await rm(root, { recursive: true, force: true });
      }
    }
  });

  it("accepts an approved mapping under a read-only DB session", async () => {
    const readOnly = new Pool({ host: socket, port: 5432, database: "postgres", user: "phone11_test", password: "", ssl: false,
      options: "-c default_transaction_read_only=on" });
    try {
      expect(await isPhone11AuthReady(createPhone11Auth(readOnly, config), readOnly)).toBe(true);
    } finally { await readOnly.end(); }
    expect((await database.query('SELECT id, "openId", role FROM users')).rows)
      .toEqual([{ id: 17, openId: "canonical-id", role: "admin" }]);
  });

  it.each([
    "phone11_auth_session", "phone11_auth_rate_limit", "phone11_auth_verification", "phone11_auth_identity",
  ])("rejects the missing migration table %s", async (table) => {
    await database.query(`DROP TABLE ${table} CASCADE`);
    expect(await ready()).toBe(false);
  });

  it.each([
    ["phone11_auth_session", "token"], ["phone11_auth_rate_limit", "count"],
    ["phone11_auth_account", "password"], ["phone11_auth_user", "email"],
    ["users", "lastSignedIn"],
  ])("rejects a missing required column in %s: %s", async (table, column) => {
    await database.query(`ALTER TABLE ${table} DROP COLUMN "${column}" CASCADE`);
    expect(await ready()).toBe(false);
  });

  it.each([
    "phone11_auth_identity_pkey", "phone11_auth_identity_legacy_user_id_key",
    "phone11_auth_identity_auth_user_id_fkey", "phone11_auth_identity_legacy_user_id_fkey",
  ])("rejects a missing mapping constraint %s", async (constraint) => {
    await database.query(`ALTER TABLE phone11_auth_identity DROP CONSTRAINT ${constraint}`);
    expect(await ready()).toBe(false);
  });

  it("does not mistake a composite key for canonical-user uniqueness", async () => {
    await database.query(`
      ALTER TABLE phone11_auth_identity DROP CONSTRAINT phone11_auth_identity_legacy_user_id_key;
      ALTER TABLE phone11_auth_identity ADD UNIQUE (legacy_user_id, auth_user_id);
    `);
    expect(await ready()).toBe(false);
  });

  it("rejects an unvalidated mapping foreign key", async () => {
    await database.query(`
      ALTER TABLE phone11_auth_identity DROP CONSTRAINT phone11_auth_identity_legacy_user_id_fkey;
      ALTER TABLE phone11_auth_identity ADD FOREIGN KEY (legacy_user_id) REFERENCES users(id) ON DELETE RESTRICT NOT VALID;
    `);
    expect(await ready()).toBe(false);
  });

  it("checks foreign-key targets rather than their names", async () => {
    await database.query(`
      CREATE TABLE wrong_users (id INTEGER PRIMARY KEY);
      INSERT INTO wrong_users VALUES (17);
      ALTER TABLE phone11_auth_identity DROP CONSTRAINT phone11_auth_identity_legacy_user_id_fkey;
      ALTER TABLE phone11_auth_identity ADD CONSTRAINT phone11_auth_identity_legacy_user_id_fkey
        FOREIGN KEY (legacy_user_id) REFERENCES wrong_users(id) ON DELETE RESTRICT;
    `);
    expect(await ready()).toBe(false);
  });

  it("rejects a nullable canonical mapping key", async () => {
    await database.query("ALTER TABLE phone11_auth_identity ALTER COLUMN legacy_user_id DROP NOT NULL");
    expect(await ready()).toBe(false);
  });

  it.each([null, "", "plaintext-password", "a".repeat(32) + ":short"])(
    "rejects an unusable credential hash (%s)", async (password) => {
      await database.query("UPDATE phone11_auth_account SET password = $1", [password]);
      expect(await ready()).toBe(false);
    },
  );

  it.each([
    "DELETE FROM phone11_auth_identity",
    "UPDATE phone11_auth_identity SET disabled_at = NOW()",
    "UPDATE phone11_auth_account SET \"providerId\" = 'other'",
    "UPDATE phone11_auth_account SET \"accountId\" = 'wrong-identity'",
    "UPDATE phone11_auth_user SET email = 'invalid-email'",
  ])("rejects an unprovisioned or unusable mapping: %s", async (sql) => {
    await database.query(sql);
    expect(await ready()).toBe(false);
  });

  it("rechecks mapping constraints and session columns after a cached schema success", async () => {
    const auth = createPhone11Auth(database, config);
    expect(await isPhone11AuthReady(auth, database)).toBe(true);
    await database.query("ALTER TABLE phone11_auth_session DROP COLUMN token CASCADE");
    expect(await isPhone11AuthReady(auth, database)).toBe(false);
  });

  it("reports incomplete migration as 503 and disables mobile login without leaking details", async () => {
    await database.query("ALTER TABLE phone11_auth_account DROP COLUMN password");
    const handlers = new Map<string, (req: Request, res: Response) => Promise<void>>();
    const app = { get: (path: string, handler: never) => handlers.set(path, handler), use() {}, all() {} } as unknown as Express;
    const auth = createPhone11Auth(database, config);
    registerAuthRoutes(app, { getAuth: () => auth, getDatabase: () => database });
    const invoke = async (path: string) => {
      let status = 200;
      let body: unknown;
      const headers: Record<string, string> = {};
      const res = {
        setHeader: (name: string, value: string) => { headers[name] = value; },
        status: (value: number) => { status = value; return res; },
        json: (value: unknown) => { body = value; },
      };
      await handlers.get(path)!({} as Request, res as unknown as Response);
      return { status, body, headers };
    };
    expect(await invoke("/api/ready/auth")).toEqual({ status: 503,
      body: { ready: false, authProvider: "phone11" }, headers: { "Cache-Control": "no-store" } });
    expect((await invoke("/api/mobile/config")).body).toEqual({
      authProvider: "phone11", emailPasswordEnabled: false, registrationEnabled: false,
    });
  });
});

describe("deployment auth readiness acceptance", () => {
  let source: string;
  let readinessFunction: string;
  beforeAll(async () => {
    source = await readFile(new URL("../ops/scripts/redeploy-mobile-branch.sh", import.meta.url), "utf8");
    const start = source.indexOf("wait_for_auth_readiness() {");
    expect(start).toBeGreaterThan(-1);
    readinessFunction = source.slice(start, source.indexOf("\n}\n", start) + 3);
  });

  function acceptance(body: string, curlStatus = 0) {
    // Execute only the extracted acceptance function. No deploy, Docker or network commands run.
    return spawnSync("bash", ["-c", `
      set -euo pipefail
      exec 3>&1
      curl() { printf 'probe:%s\\n' "\${@: -1}" >&3; printf '%s' "$REVIEW_BODY"; return "$REVIEW_STATUS"; }
      docker() {
        [[ "$1 $2 $3 $4 $5" == "exec -i cp11-backend node -e" ]] || return 1
        shift 3
        "$@"
      }
      seq() { printf '1\\n'; }
      sleep() { :; }
      ${readinessFunction}
      wait_for_auth_readiness
    `], { encoding: "utf8", env: { ...process.env, REVIEW_BODY: body, REVIEW_STATUS: String(curlStatus) } });
  }

  it("requires readiness on both the local and public routes", () => {
    const result = acceptance(JSON.stringify({ ready: true, authProvider: "phone11" }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("probe:http://127.0.0.1:3000/api/ready/auth");
    expect(result.stdout).toContain("probe:https://api.phone11.ai/api/ready/auth");
  });

  it.each([
    ['{"ready":false,"authProvider":"phone11"}', 0],
    ['{"ready":"true","authProvider":"phone11"}', 0],
    ['{"ready":true,"authProvider":"other"}', 0],
    ['{"ready":true,"authProvider":"phone11"}', 22],
    ["not-json", 0],
  ])("rejects non-ready responses or failed HTTP requests", (body, curlStatus) => {
    expect(acceptance(body, curlStatus).status).toBe(63);
  });

  it("gates both standalone and Compose acceptance after the build-SHA check", () => {
    expect(source.match(/wait_for_public_api_health\n\s*wait_for_auth_readiness\n\s*echo "Redeploy finished\."/g)).toHaveLength(2);
    expect(source).toContain('if [[ "$body" == *"$GITHUB_SHA"* ]]');
  });
});
