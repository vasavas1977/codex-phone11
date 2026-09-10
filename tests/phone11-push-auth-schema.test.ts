import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { Pool, type PoolClient } from "pg";
import { applyAuthMigration, createExistingUserIdentity } from "../server/_core/phone11-auth-admin";
import { createPhone11Auth, revokePhone11Session } from "../server/_core/phone11-auth";
import { createPushRepository } from "../server/push/repository";

const connectionString = process.env.PHONE11_PUSH_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/phone11_push_test" || url.search || url.hash || !url.port) {
    throw new Error("Push auth schema tests require a dedicated loopback phone11_push_test database with explicit port");
  }
}

describe.skipIf(!connectionString)("Push migration with the actual installed Phone11 auth migration", () => {
  const schema = `push_auth_test_${randomBytes(8).toString("hex")}`;
  const config = { baseURL: "http://127.0.0.1:19231", trustedOrigins: ["http://127.0.0.1:19231"], secret: randomBytes(48).toString("base64url") };
  const admin = new Pool({ connectionString, ssl: false });
  const database = new Pool({ connectionString, ssl: false, options: `-c search_path=${schema}` });
  const password = randomBytes(24).toString("base64url");
  const transaction = async <T>(fn: (client: PoolClient) => Promise<T>) => {
    const client = await database.connect();
    try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  };
  const repository = createPushRepository(transaction);

  beforeAll(async () => {
    // Isolated from the public registry fixture; use the deployed auth migration generator,
    // not a handwritten imitation of its column names or types.
    await admin.query(`CREATE SCHEMA ${schema}`);
    await database.query(`CREATE TABLE users (id INTEGER PRIMARY KEY, "openId" TEXT, name TEXT, email TEXT, role TEXT);
      CREATE TABLE tenants (id INTEGER PRIMARY KEY, status TEXT);
      CREATE TABLE extensions (id INTEGER PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), status TEXT, deleted_at TIMESTAMPTZ);
      CREATE TABLE user_extensions (user_id INTEGER REFERENCES users(id), extension_id INTEGER REFERENCES extensions(id));
      CREATE TABLE sip_accounts (extension_id INTEGER REFERENCES extensions(id), tenant_id INTEGER REFERENCES tenants(id), sip_username TEXT, sip_domain TEXT, status TEXT, deleted_at TIMESTAMPTZ);
      INSERT INTO users VALUES (1,'synthetic-owner','Synthetic owner','push-schema@example.test','user');
      INSERT INTO tenants VALUES (10,'active'); INSERT INTO extensions VALUES (1,10,'active',NULL);
      INSERT INTO user_extensions VALUES (1,1); INSERT INTO sip_accounts VALUES (1,10,'1001','test.invalid','active',NULL);`);
    await applyAuthMigration(database, config);
    await createExistingUserIdentity(database, { userId: 1, email: "push-schema@example.test", password });
    const migration = await readFile(new URL("../server/push/migration.sql", import.meta.url), "utf8");
    await database.query(migration);
    await database.query(migration);
  }, 20000);

  afterAll(async () => {
    await database.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("matches real auth column types and installs the session cascade idempotently", async () => {
    const { rows } = await database.query(`SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema=$1 AND
      ((table_name='phone11_auth_session' AND column_name IN ('id','userId','expiresAt')) OR
       (table_name='phone11_auth_identity' AND column_name IN ('auth_user_id','legacy_user_id','disabled_at')))`, [schema]);
    const actual = Object.fromEntries(rows.map(row => [`${row.table_name}.${row.column_name}`, row.data_type]));
    expect(actual).toEqual({ "phone11_auth_session.id": "text", "phone11_auth_session.userId": "text", "phone11_auth_session.expiresAt": "timestamp with time zone",
      "phone11_auth_identity.auth_user_id": "text", "phone11_auth_identity.legacy_user_id": "integer", "phone11_auth_identity.disabled_at": "timestamp with time zone" });
    const constraints = await database.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='phone11_push_devices'::regclass AND confrelid='phone11_auth_session'::regclass`);
    expect(constraints.rows).toEqual([{ definition: "FOREIGN KEY (session_id) REFERENCES phone11_auth_session(id) ON DELETE CASCADE" }]);
  });

  it("revokes a persisted device through actual signed authentication and Phone11 logout", async () => {
    const auth = createPhone11Auth(database, config);
    const response = await auth.api.signInEmail({ body: { email: "push-schema@example.test", password }, asResponse: true });
    expect(response.status).toBe(200);
    const bearer = response.headers.get("set-auth-token");
    expect(bearer).toBeTruthy();
    const headers = { authorization: `Bearer ${bearer}` };
    const current = await auth.api.getSession({ headers: new Headers(headers), query: { disableCookieCache: true, disableRefresh: true } });
    expect(current?.session.id).toBeTruthy();
    const token = { sessionId: current!.session.id, owner: { userId: 1, tenantId: 10, extensionId: 1, sipUri: "sip:1001@test.invalid" },
      sipUri: "sip:1001@test.invalid", token: "a".repeat(64), tokenType: "voip" as const, platform: "ios" as const, deviceId: "synthetic-device", bundleId: "test.phone11", sandbox: false, registeredAt: 0 };
    await repository.put(token);
    expect(await repository.list(token.sipUri)).toHaveLength(1);
    await revokePhone11Session(headers, auth, database);
    expect((await database.query("SELECT 1 FROM phone11_auth_session WHERE id=$1", [current!.session.id])).rows).toHaveLength(0);
    expect((await database.query("SELECT 1 FROM phone11_push_devices")).rows).toHaveLength(0);
    await expect(repository.put(token)).rejects.toThrow("not assigned");
  }, 20000);
});
