import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { Pool, type PoolClient } from "pg";
import { createPushRepository } from "../server/push/repository";
import type { PushToken } from "../server/push-gateway";
const connectionString = process.env.PHONE11_PUSH_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/phone11_push_test" || url.search || url.hash || !url.port) throw new Error("Push integration tests require a dedicated loopback phone11_push_test database with explicit port");
}
const pool = new Pool({ connectionString, max: 12, ssl: false });
async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
const repository = createPushRepository(transaction);
const token: PushToken = { sessionId: "session-1", owner: { userId: 1, tenantId: 10, extensionId: 1, sipUri: "sip:1001@test.invalid" },
  sipUri: "sip:1001@test.invalid", token: "a".repeat(64), tokenType: "voip", platform: "ios", deviceId: "device-a", bundleId: "test.phone11", sandbox: false, registeredAt: 0 };
describe.skipIf(!connectionString)("Push registry real PostgreSQL persistence and isolation", () => {
  beforeAll(async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS phone11_auth_session (id TEXT PRIMARY KEY, "userId" TEXT, "expiresAt" TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS phone11_auth_identity (auth_user_id TEXT PRIMARY KEY, legacy_user_id INTEGER REFERENCES users(id), disabled_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY, status TEXT);
      CREATE TABLE IF NOT EXISTS extensions (id INTEGER PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), status TEXT, deleted_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS user_extensions (user_id INTEGER REFERENCES users(id), extension_id INTEGER REFERENCES extensions(id));
      CREATE TABLE IF NOT EXISTS sip_accounts (extension_id INTEGER REFERENCES extensions(id), tenant_id INTEGER REFERENCES tenants(id), sip_username TEXT, sip_domain TEXT, status TEXT, deleted_at TIMESTAMPTZ);`);
    const migration = await readFile(new URL("../server/push/migration.sql", import.meta.url), "utf8");
    await pool.query(migration); await pool.query(migration);
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE phone11_push_devices, phone11_auth_identity, phone11_auth_session, sip_accounts, user_extensions, extensions, users, tenants CASCADE;
      INSERT INTO users VALUES (1),(2),(3);
      INSERT INTO phone11_auth_identity VALUES ('auth-1',1,NULL),('auth-2',2,NULL),('auth-3',3,NULL);
      INSERT INTO phone11_auth_session VALUES ('session-1','auth-1',NOW()+INTERVAL '1 day'),('session-2','auth-2',NOW()+INTERVAL '1 day'),('session-3','auth-3',NOW()+INTERVAL '1 day');
      INSERT INTO tenants VALUES (10,'active'),(20,'active');
      INSERT INTO extensions VALUES (1,10,'active',NULL),(2,10,'active',NULL),(3,20,'active',NULL);
      INSERT INTO user_extensions VALUES (1,1),(2,2),(3,3);
      INSERT INTO sip_accounts VALUES (1,10,'1001','test.invalid','active',NULL),(2,10,'1002','test.invalid','active',NULL),(3,20,'2001','test.invalid','active',NULL);`);
  });
  afterAll(() => pool.end());
  it("persists across independent repository instances and stores provider acceptance time", async () => {
    await repository.put(token); const other = createPushRepository(transaction);
    const [saved] = await other.list(token.sipUri); expect(saved.owner).toEqual(token.owner); expect(saved.lastUsed).toBeUndefined(); expect(saved.registeredAt).toBeGreaterThan(0);
    await other.markUsed(saved); expect((await repository.list(token.sipUri))[0].lastUsed).toBeGreaterThan(0);
    expect(await repository.stats()).toEqual({ totalUsers: 1, totalDevices: 1, byPlatform: { ios: 1, android: 0 } });
  });
  it("cannot remove another owner's device even with its token", async () => {
    await repository.put(token); await repository.remove(2, token, "session-2"); expect(await repository.list(token.sipUri)).toHaveLength(1);
    await repository.remove(1, { ...token, platform: "android" }, "session-1"); expect(await repository.list(token.sipUri)).toHaveLength(1);
    await repository.remove(1, token, "session-1"); expect(await repository.list(token.sipUri)).toHaveLength(0);
  });
  it.each([{ userId: 2 }, { tenantId: 20 }, { extensionId: 3 }])("rejects forged assignment before inserting (%j)", async change => {
    await expect(repository.put({ ...token, owner: { ...token.owner, ...change } })).rejects.toThrow("not assigned"); expect((await repository.stats()).totalDevices).toBe(0);
  });
  it("rechecks an assignment revoked between gateway authentication and persistence", async () => {
    await pool.query("DELETE FROM user_extensions WHERE user_id=1");
    await expect(repository.put(token)).rejects.toThrow("not assigned"); expect((await repository.stats()).totalDevices).toBe(0);
  });
  it.each(["UPDATE tenants SET status='inactive' WHERE id=10", "UPDATE extensions SET deleted_at=NOW() WHERE id=1", "UPDATE sip_accounts SET status='inactive' WHERE extension_id=1", "DELETE FROM user_extensions WHERE user_id=1", "UPDATE sip_accounts SET sip_username='replacement' WHERE extension_id=1"])("excludes stale assignment at both lookup and last delivery check (%s)", async change => {
    await repository.put(token); const [saved] = await repository.list(token.sipUri); await pool.query(change);
    expect(await repository.list(token.sipUri)).toHaveLength(0); expect(await repository.isCurrent(saved)).toBe(false);
  });
  it("preserves a newly registered token when an older provider rejection arrives", async () => {
    await repository.put(token); const [old] = await repository.list(token.sipUri);
    await repository.put(token); const [fresh] = await repository.list(token.sipUri); expect(fresh.revision).not.toBe(old.revision);
    await repository.removeInvalid(old); await repository.markUsed(old); expect(await repository.isCurrent(old)).toBe(false);
    expect(await repository.list(token.sipUri)).toEqual([fresh]);
    await repository.removeInvalid(fresh); expect(await repository.list(token.sipUri)).toHaveLength(0);
  });
  it("rotates one device token without creating duplicate registrations", async () => {
    await repository.put(token); await repository.put({ ...token, token: "b".repeat(64) });
    const saved = await repository.list(token.sipUri); expect(saved).toHaveLength(1); expect(saved[0].token).toBe("b".repeat(64));
  });
  it("moves a provider token to the freshly authenticated owner on account switch", async () => {
    await repository.put(token);
    const second = { ...token, sessionId: "session-2", sipUri: "sip:1002@test.invalid", owner: { userId: 2, tenantId: 10, extensionId: 2, sipUri: "sip:1002@test.invalid" } };
    await repository.put(second); expect(await repository.list(token.sipUri)).toHaveLength(0); expect(await repository.list(second.sipUri)).toHaveLength(1);
    await repository.remove(1, token, "session-1"); expect(await repository.list(second.sipUri)).toHaveLength(1);
  });
  it("serializes concurrent device registrations to enforce the ten-device quota", async () => {
    const results = await Promise.allSettled(Array.from({ length: 14 }, (_, index) => repository.put({ ...token, token: index.toString(16).padStart(64, "0"), deviceId: `device-${index}` })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(10);
    expect((await repository.stats()).totalDevices).toBe(10);
  });
  it("rolls back token removal if a replacement insert fails", async () => {
    await repository.put(token); const [before] = await repository.list(token.sipUri);
    await expect(repository.put({ ...token, appVersion: "x".repeat(129) })).rejects.toThrow();
    expect(await repository.list(token.sipUri)).toEqual([before]);
  });
  it("cascades durable device revocation when logout deletes its auth session", async () => {
    await repository.put(token); await pool.query("DELETE FROM phone11_auth_session WHERE id='session-1'");
    expect(await repository.list(token.sipUri)).toHaveLength(0); expect((await repository.stats()).totalDevices).toBe(0);
    await expect(repository.put(token)).rejects.toThrow("not assigned");
  });
  it.each([`UPDATE phone11_auth_session SET "expiresAt"=NOW()-INTERVAL '1 second' WHERE id='session-1'`,
    "UPDATE phone11_auth_identity SET disabled_at=NOW() WHERE auth_user_id='auth-1'",
    "UPDATE phone11_auth_identity SET legacy_user_id=2 WHERE auth_user_id='auth-1'"])("refuses inactive or changed session identity at lookup and put (%s)", async change => {
    await repository.put(token); const [saved] = await repository.list(token.sipUri); await pool.query(change);
    expect(await repository.list(token.sipUri)).toHaveLength(0); expect(await repository.isCurrent(saved)).toBe(false);
    await expect(repository.put(token)).rejects.toThrow("not assigned");
  });
  it("does not let another auth session bind the current user's assignment", async () => {
    await expect(repository.put({ ...token, sessionId: "session-2" })).rejects.toThrow("not assigned");
  });
  it("preserves a new same-owner session binding after older-session unregister/logout", async () => {
    await repository.put(token); await pool.query(`INSERT INTO phone11_auth_session VALUES ('session-new','auth-1',NOW()+INTERVAL '1 day')`);
    await repository.put({ ...token, sessionId: "session-new" }); await repository.remove(1, token, "session-1");
    await pool.query("DELETE FROM phone11_auth_session WHERE id='session-1'");
    expect((await repository.list(token.sipUri))[0].sessionId).toBe("session-new");
  });

  it("reclaims expired-session device quota for a new authenticated sign-in", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, index) => repository.put({ ...token, deviceId: `old-${index}`, token: index.toString(16).padStart(64, "0") })));
    await pool.query(`UPDATE phone11_auth_session SET "expiresAt"=NOW()-INTERVAL '1 second' WHERE id='session-1';
      INSERT INTO phone11_auth_session VALUES ('session-new','auth-1',NOW()+INTERVAL '1 day')`);
    await repository.put({ ...token, sessionId: "session-new", deviceId: "new-device" });
    expect((await repository.stats()).totalDevices).toBe(1); expect((await repository.list(token.sipUri))[0].sessionId).toBe("session-new");
  });

  it("serializes concurrent registration with logout and leaves no resurrected device", async () => {
    let notifyLocked!: () => void, releaseInsert!: () => void;
    const locked = new Promise<void>(resolve => { notifyLocked = resolve; });
    const gate = new Promise<void>(resolve => { releaseInsert = resolve; });
    const delayed = createPushRepository(fn => transaction(client => fn({
      query: async (sql: string, params: any[]) => {
        if (sql.includes("INSERT INTO phone11_push_devices")) { notifyLocked(); await gate; }
        return client.query(sql, params);
      },
    } as PoolClient)));
    const registration = delayed.put(token);
    await locked; // The session row is held FOR SHARE; the device INSERT is paused.
    const logout = await pool.connect(); let deletion: Promise<any> | undefined;
    try {
      const { rows: [{ pid }] } = await logout.query("SELECT pg_backend_pid() AS pid");
      deletion = logout.query("DELETE FROM phone11_auth_session WHERE id='session-1'");
      let waiting = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const { rows: [activity] } = await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid]);
        if (activity?.wait_event_type === "Lock") { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      releaseInsert(); await registration; await deletion;
      expect((await repository.stats()).totalDevices).toBe(0);
      expect(await repository.list(token.sipUri)).toHaveLength(0);
      await expect(repository.put(token)).rejects.toThrow("not assigned");
    } finally { releaseInsert(); await registration.catch(() => {}); await deletion; logout.release(); }
  });

  it("rejects a revoked old session's late registration after token handover", async () => {
    await repository.put(token);
    const next = { ...token, sessionId: "session-2", sipUri: "sip:1002@test.invalid",
      owner: { userId: 2, tenantId: 10, extensionId: 2, sipUri: "sip:1002@test.invalid" } };
    await repository.put(next); await pool.query("DELETE FROM phone11_auth_session WHERE id='session-1'");
    await expect(repository.put(token)).rejects.toThrow("not assigned");
    expect(await repository.list(token.sipUri)).toHaveLength(0);
    const [remaining] = await repository.list(next.sipUri);
    expect(remaining.owner.userId).toBe(2); expect(remaining.sessionId).toBe("session-2");
  });

});
