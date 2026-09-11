import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { Pool, type PoolClient } from "pg";
import { createWakeRepository } from "../server/push/wake-repository";
import { createPushRepository } from "../server/push/repository";
import type { PushToken } from "../server/push-gateway";

const connectionString = process.env.PHONE11_PUSH_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/phone11_push_test" || url.search || url.hash || !url.port) throw new Error("Wake tests require a dedicated loopback phone11_push_test database with explicit port");
}
const schema = `wake_test_${randomUUID().replaceAll("-", "")}`;
const admin = new Pool({ connectionString, max: 1, ssl: false });
const pool = new Pool({ connectionString, max: 12, ssl: false, options: `-c search_path=${schema}` });
async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='4s'");
    const result = await fn(client); await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
const wake = createWakeRepository(transaction), push = createPushRepository(transaction);
const uri = "sip:1001@test.invalid";
const token: PushToken = { sessionId: "session-1", owner: { userId: 1, tenantId: 10, extensionId: 1, sipUri: uri }, sipUri: uri,
  token: "a".repeat(64), tokenType: "voip", platform: "ios", deviceId: "device-a", bundleId: "test.phone11", sandbox: false, registeredAt: 0 };
async function enrolled() { await push.put(token); return wake.enroll("session-1", 1, "device-a", uri); }
async function offered() { const b = await enrolled(); const { call } = await wake.offer(uri, "sip-call-1"); return { b, call }; }
async function afterExpiry(expiry: Date) {
  await pool.query("SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.03)", [expiry]);
}
// Pause a real transaction after it obtains relevant locks, while the DB clock advances.
function delayedBefore(match: string, pause: () => Promise<void>) {
  return createWakeRepository(fn => transaction(client => fn({ query: async (sql: string, params?: any[]) => {
    if (sql.includes(match)) await pause();
    return client.query(sql, params);
  } } as PoolClient)));
}

describe.skipIf(!connectionString)("Wake grants and calls in isolated real PostgreSQL", () => {
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE phone11_auth_session (id TEXT PRIMARY KEY, "userId" TEXT, "expiresAt" TIMESTAMPTZ);
      CREATE TABLE phone11_auth_identity (auth_user_id TEXT PRIMARY KEY, legacy_user_id INTEGER REFERENCES users(id), disabled_at TIMESTAMPTZ);
      CREATE TABLE tenants (id INTEGER PRIMARY KEY, status TEXT);
      CREATE TABLE extensions (id INTEGER PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), status TEXT, deleted_at TIMESTAMPTZ);
      CREATE TABLE user_extensions (user_id INTEGER REFERENCES users(id), extension_id INTEGER REFERENCES extensions(id));
      CREATE TABLE sip_accounts (extension_id INTEGER REFERENCES extensions(id), tenant_id INTEGER REFERENCES tenants(id), sip_username TEXT, sip_domain TEXT, status TEXT, deleted_at TIMESTAMPTZ, transport_preference TEXT);
      CREATE TABLE subscriber (username TEXT, domain TEXT, password TEXT, PRIMARY KEY(username,domain));`);
    for (const path of ["../server/push/migration.sql", "../server/push/wake-migration.sql"]) {
      const migration = await readFile(new URL(path, import.meta.url), "utf8");
      await pool.query(migration); await pool.query(migration);
    }
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE phone11_wake_terminals, phone11_wake_calls, phone11_wake_bindings, phone11_push_devices, phone11_auth_identity, phone11_auth_session, subscriber, sip_accounts, user_extensions, extensions, users, tenants CASCADE;
      INSERT INTO users VALUES (1),(2),(3);
      INSERT INTO phone11_auth_identity VALUES ('auth-1',1,NULL),('auth-2',2,NULL),('auth-3',3,NULL);
      INSERT INTO phone11_auth_session VALUES ('session-1','auth-1',clock_timestamp()+INTERVAL '1 day'),('session-2','auth-2',clock_timestamp()+INTERVAL '1 day'),('session-3','auth-3',clock_timestamp()+INTERVAL '1 day'),('session-new','auth-1',clock_timestamp()+INTERVAL '1 day');
      INSERT INTO tenants VALUES (10,'active'),(20,'active');
      INSERT INTO extensions VALUES (1,10,'active',NULL),(2,10,'active',NULL),(3,20,'active',NULL);
      INSERT INTO user_extensions VALUES (1,1),(2,2),(3,3);
      INSERT INTO sip_accounts VALUES (1,10,'1001','test.invalid','active',NULL,'TLS'),(2,10,'1002','test.invalid','active',NULL,'UDP'),(3,20,'2001','test.invalid','active',NULL,'UDP');
      INSERT INTO subscriber VALUES ('1001','test.invalid','synthetic-only-password'),('1002','test.invalid','other-synthetic-password'),('2001','test.invalid','third-synthetic-password');`);
  });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); });

  it("applies both migrations twice and persists only the grant hash", async () => {
    const b = await enrolled();
    const { rows: [stored] } = await pool.query("SELECT * FROM phone11_wake_bindings");
    expect(stored.grant_hash).toBe(createHash("sha256").update(b.grant).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(b.grant);
    const safe = await createWakeRepository(transaction).resolve(b.bindingId, "session-1", 1);
    expect(safe).not.toHaveProperty("grant"); expect(safe).not.toHaveProperty("grant_hash"); expect(safe).not.toHaveProperty("sip");
    expect(safe.bindingId).toBe(b.bindingId);
  });
  it("binds resolve and revoke to the exact session, not merely the same user", async () => {
    const b = await enrolled();
    await expect(wake.resolve(b.bindingId, "session-new", 1)).rejects.toMatchObject({ status: 403 });
    await expect(wake.resolve(b.bindingId, "session-1", 2)).rejects.toMatchObject({ status: 403 });
    await wake.revoke(b.bindingId, "session-new", 1); expect(await wake.resolve(b.bindingId, "session-1", 1)).toBeTruthy();
    await wake.revoke(b.bindingId, "session-1", 1); await expect(wake.resolve(b.bindingId, "session-1", 1)).rejects.toMatchObject({ status: 403 });
  });
  it("returns credentials only for the matching pending call and grant", async () => {
    const { b, call } = await offered();
    await expect(wake.deviceCall(b.bindingId, "wrong", call.callUUID, "claim")).rejects.toMatchObject({ status: 403 });
    await expect(wake.deviceCall(b.bindingId, b.grant, randomUUID(), "claim")).rejects.toMatchObject({ status: 404 });
    const claimed = await wake.deviceCall(b.bindingId, b.grant, call.callUUID, "claim");
    expect(claimed).toMatchObject({ callUUID: call.callUUID, ownerUserId: 1, tenantId: 10, sip: { sipExtension: "1001", sipPassword: "synthetic-only-password", transport: "TLS" } });
    expect(await wake.current(call.callUUID)).not.toHaveProperty("sip");
    expect(await wake.deviceCall(b.bindingId,b.grant,call.callUUID,"status")).not.toHaveProperty("sip");
    expect(await wake.deliveryTarget(call.callUUID)).toMatchObject({ sipUri: uri });
  });
  it.each([
    "DELETE FROM phone11_auth_session WHERE id='session-1'",
    `UPDATE phone11_auth_session SET "expiresAt"=clock_timestamp()-INTERVAL '1 second' WHERE id='session-1'`,
    "UPDATE phone11_auth_identity SET disabled_at=clock_timestamp() WHERE auth_user_id='auth-1'",
    "UPDATE phone11_auth_identity SET legacy_user_id=2 WHERE auth_user_id='auth-1'",
    "DELETE FROM user_extensions WHERE user_id=1",
    "UPDATE extensions SET tenant_id=20 WHERE id=1",
    "UPDATE tenants SET status='inactive' WHERE id=10",
    "UPDATE sip_accounts SET sip_username='replacement' WHERE extension_id=1",
    "DELETE FROM phone11_push_devices",
    "UPDATE phone11_push_devices SET device_id='replacement-device'",
    "UPDATE phone11_push_devices SET user_id=2",
    "UPDATE phone11_push_devices SET bundle_id='other.app'",
    "UPDATE phone11_push_devices SET sandbox=true",
    "UPDATE phone11_push_devices SET token_type='apns'",
    "UPDATE phone11_push_devices SET session_id='session-new'",
  ])("revocation immediately blocks grants, offers and delivery (%s)", async change => {
    const { b, call } = await offered(); await pool.query(change);
    await expect(wake.deviceCall(b.bindingId,b.grant,call.callUUID,"claim")).rejects.toMatchObject({ status:403 });
    await expect(wake.offer(uri,"next-call")).rejects.toMatchObject({ status:404 });
    await expect(wake.deliveryTarget(call.callUUID)).rejects.toMatchObject({ status:410 });
    expect(await wake.current(call.callUUID)).toBeNull();
  });
  it("keeps an unchanged push registration and live grant valid", async () => {
    const { b, call } = await offered(); await push.put(token);
    expect(await wake.resolve(b.bindingId,"session-1",1)).toBeTruthy();
    expect(await wake.deviceCall(b.bindingId,b.grant,call.callUUID,"claim")).toHaveProperty("sip");
  });
  it("transfers a live grant to a new token revision only for the same exact phone session", async () => {
    const {b,call}=await offered(); const before=await wake.deliveryTarget(call.callUUID);
    await push.put({...token,token:"b".repeat(64)});
    const after=await wake.deliveryTarget(call.callUUID); expect(after.revision).not.toBe(before.revision);
    expect(await wake.resolve(b.bindingId,"session-1",1)).toBeTruthy();
    expect(await wake.deviceCall(b.bindingId,b.grant,call.callUUID,"claim")).toHaveProperty("sip");
    await push.remove(1,token,"session-1"); // Late unregister for the obsolete token is harmless.
    expect(await wake.resolve(b.bindingId,"session-1",1)).toBeTruthy();
  });
  it("same-owner relogin invalidates old grant without letting old revoke remove the new binding", async () => {
    const old = await enrolled(); await push.put({ ...token, sessionId:"session-new" });
    const fresh = await wake.enroll("session-new",1,"device-a",uri);
    await wake.revoke(old.bindingId,"session-1",1);
    await expect(wake.resolve(old.bindingId,"session-1",1)).rejects.toMatchObject({ status:403 });
    expect(await wake.resolve(fresh.bindingId,"session-new",1)).toBeTruthy();
  });
  it("deduplicates concurrent repeated offers and rejects a second distinct call", async () => {
    await enrolled(); const attempts = await Promise.all(Array.from({length:6},()=>wake.offer(uri,"same-sip-call")));
    expect(new Set(attempts.map(r=>r.call.callUUID)).size).toBe(1); expect(attempts.filter(r=>r.created)).toHaveLength(1);
    await expect(wake.offer(uri,"different")).rejects.toMatchObject({ status:409 });
    expect((await pool.query("SELECT count(*)::int AS n FROM phone11_wake_calls")).rows[0].n).toBe(1);
  });
  it("serializes distinct concurrent calls to exactly one accepted offer", async () => {
    await enrolled(); const attempts=await Promise.allSettled([wake.offer(uri,"one"),wake.offer(uri,"two")]);
    expect(attempts.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(attempts.find(r=>r.status==="rejected")).toMatchObject({ reason:{status:409} });
  });
  it("cancellation before claim is terminal, idempotent and permits the next offer", async () => {
    const {b,call}=await offered(); await wake.transitionTrusted(uri,"sip-call-1","cancelled");
    await expect(wake.deviceCall(b.bindingId,b.grant,call.callUUID,"claim")).rejects.toMatchObject({status:410});
    expect((await wake.offer(uri,"sip-call-1")).call.status).toBe("cancelled");
    await wake.transitionTrusted(uri,"sip-call-1","ended"); expect((await wake.current(call.callUUID))?.status).toBe("cancelled");
    expect((await wake.offer(uri,"new-call")).created).toBe(true);
  });
  it("remembers a terminal event that arrives before the initial offer", async () => {
    await enrolled(); await wake.transitionTrusted(uri,"terminal-first","cancelled");
    const result=await wake.offer(uri,"terminal-first").catch(error=>{expect(error).toMatchObject({status:410});return null;});
    if(result) expect(result.call.status).toBe("cancelled");
    const rows=(await pool.query("SELECT state FROM phone11_wake_calls WHERE sip_call_id='terminal-first'")).rows;
    expect(rows.every(row=>row.state==="cancelled")).toBe(true);
  });
  it("expired setup cannot provide credentials but can still be ended", async () => {
    const {b,call}=await offered(); await pool.query("UPDATE phone11_wake_calls SET expires_at=clock_timestamp()-INTERVAL '1 second'");
    await expect(wake.deviceCall(b.bindingId,b.grant,call.callUUID,"claim")).rejects.toMatchObject({status:410});
    expect((await wake.deviceCall(b.bindingId,b.grant,call.callUUID,"ready")).status).toBe("expired");
    expect((await wake.deviceCall(b.bindingId,b.grant,call.callUUID,"end")).status).toBe("ended");
  });
  it("ready heartbeat keeps a separate 90-second busy lease without extending credential TTL", async () => {
    const {b,call}=await offered(); await wake.deviceCall(b.bindingId,b.grant,call.callUUID,"ready");
    const {rows:[lease]}=await pool.query("SELECT EXTRACT(EPOCH FROM busy_until-clock_timestamp())::float AS seconds,expires_at FROM phone11_wake_calls");
    expect(lease.seconds).toBeGreaterThan(85); expect(lease.seconds).toBeLessThanOrEqual(90);
    expect(new Date(lease.expires_at).getTime()).toBe(call.expiresAt);
    await pool.query("UPDATE phone11_wake_calls SET expires_at=clock_timestamp()-INTERVAL '1 second',busy_until=clock_timestamp()+INTERVAL '3 seconds'");
    expect((await wake.deviceCall(b.bindingId,b.grant,call.callUUID,"ready")).status).toBe("ready");
    await expect(wake.deviceCall(b.bindingId,b.grant,call.callUUID,"claim")).rejects.toMatchObject({status:410});
    await expect(wake.offer(uri,"second")).rejects.toMatchObject({status:409});
    expect((await wake.deviceCall(b.bindingId,b.grant,call.callUUID,"end")).status).toBe("ended");
    expect((await wake.offer(uri,"second")).created).toBe(true);
  });
  it("an expired busy lease cannot be revived by a late heartbeat", async () => {
    const {b,call}=await offered(); await wake.deviceCall(b.bindingId,b.grant,call.callUUID,"ready");
    await pool.query("UPDATE phone11_wake_calls SET expires_at=clock_timestamp()-INTERVAL '2 seconds',busy_until=clock_timestamp()-INTERVAL '1 second'");
    expect((await wake.deviceCall(b.bindingId,b.grant,call.callUUID,"ready")).status).toBe("expired");
    expect((await wake.offer(uri,"next")).created).toBe(true);
  });
  it("reenrollment cannot cascade-delete a pending or connected call", async () => {
    const {b,call}=await offered(); await expect(wake.enroll("session-1",1,"device-a",uri)).rejects.toMatchObject({status:409});
    await wake.deviceCall(b.bindingId,b.grant,call.callUUID,"ready");
    await pool.query("UPDATE phone11_wake_calls SET expires_at=clock_timestamp()-INTERVAL '1 second'");
    await expect(wake.enroll("session-1",1,"device-a",uri)).rejects.toMatchObject({status:409});
    expect((await wake.current(call.callUUID))?.status).toBe("ready");
  });
  it("concurrent enrollment and offer do not deadlock or delete the accepted call", async () => {
    await enrolled(); const results=await Promise.allSettled([wake.enroll("session-1",1,"device-a",uri),wake.offer(uri,"racing-call")]);
    const offeredResult=results[1]; expect(offeredResult.status).toBe("fulfilled");
    if(offeredResult.status==="fulfilled") expect((await wake.current((offeredResult.value as any).call.callUUID))?.status).toBe("pending");
    if(results[0].status==="rejected") expect(results[0].reason).toMatchObject({status:409});
  });
  it("matches the exact credential URI and fails closed on an ambiguous subscriber", async () => {
    const {b,call}=await offered();
    await pool.query("INSERT INTO sip_accounts VALUES (1,10,'alternate','test.invalid','active',NULL,'UDP'); INSERT INTO subscriber VALUES ('alternate','test.invalid','must-not-return')");
    expect(await wake.deviceCall(b.bindingId,b.grant,call.callUUID,"claim")).toMatchObject({sip:{sipExtension:"1001",sipPassword:"synthetic-only-password"}});
    await pool.query("INSERT INTO subscriber VALUES ('1001','TEST.INVALID','ambiguous-must-not-return')");
    await expect(wake.deviceCall(b.bindingId,b.grant,call.callUUID,"claim")).rejects.toMatchObject({status:503});
  });
  it("reclaims an expired binding for a newly registered device", async () => {
    const b=await enrolled(); await pool.query("UPDATE phone11_wake_bindings SET expires_at=clock_timestamp()-INTERVAL '1 second'");
    await push.put({...token,deviceId:"device-new",token:"b".repeat(64)});
    const fresh=await wake.enroll("session-1",1,"device-new",uri);
    expect(fresh.bindingId).not.toBe(b.bindingId);
    expect(fresh.deviceId).toBe("device-new");
  });
  it("cancels an offer racing with a terminal event before its INSERT", async () => {
    await enrolled(); let release!:()=>void, arrived!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}); const paused=new Promise<void>(resolve=>{arrived=resolve;});
    const slow=delayedBefore("INSERT INTO phone11_wake_calls",async()=>{arrived();await gate;});
    const attempt=slow.offer(uri,"cancel-race"); await paused;
    // Terminal can complete before an INSERT exists, or wait for the serialized offer.
    let terminalPid=0,terminalSettled=false;
    const terminalRepository=createWakeRepository(fn=>transaction(async client=>{
      terminalPid=(await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;return fn(client);
    }));
    const terminal=terminalRepository.transitionTrusted(uri,"cancel-race","cancelled");
    void terminal.then(()=>{terminalSettled=true;},()=>{terminalSettled=true;});
    let observed=false;
    try {
      for(let i=0;i<100;i++) {
        if(terminalSettled || (terminalPid && (await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[terminalPid])).rows[0]?.wait_event_type==="Lock")) {observed=true;break;}
        await new Promise(resolve=>setTimeout(resolve,5));
      }
    } finally {release();}
    expect(observed).toBe(true);
    const outcomes=await Promise.allSettled([attempt,terminal]);
    expect(outcomes[1].status).toBe("fulfilled");
    const rows=(await pool.query("SELECT state FROM phone11_wake_calls WHERE sip_call_id='cancel-race'")).rows;
    expect(rows.every(row=>row.state==="cancelled")).toBe(true);
  });
  it("does not deadlock a claim against the token-refresh lifecycle trigger", async () => {
    const {b,call}=await offered(); const rotation=await pool.connect();
    let claim:Promise<unknown>|undefined, update:Promise<unknown>|undefined, pid=0;
    try {
      await rotation.query("BEGIN; SET LOCAL statement_timeout='3s'; SET LOCAL deadlock_timeout='100ms'");
      await rotation.query("SELECT 1 FROM phone11_push_devices FOR UPDATE");
      const racing=createWakeRepository(fn=>transaction(async client=>{
        pid=(await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;return fn(client);
      }));
      claim=racing.deviceCall(b.bindingId,b.grant,call.callUUID,"claim");
      void claim.catch(()=>{});
      let waiting=false;
      for(let i=0;i<100;i++) {
        if(pid && (await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.wait_event_type==="Lock") {waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,5));
      }
      expect(waiting).toBe(true);
      update=rotation.query("UPDATE phone11_push_devices SET revision=gen_random_uuid()").then(()=>rotation.query("COMMIT"),async error=>{await rotation.query("ROLLBACK");throw error;});
      const outcomes=await Promise.allSettled([claim,update]);
      expect(outcomes[1].status, outcomes[1].status==="rejected" ? String(outcomes[1].reason?.code)+": "+outcomes[1].reason?.message : "rotation committed").toBe("fulfilled");
      // A snapshot invalidated by token rotation may safely require a claim retry.
      if(outcomes[0].status==="rejected") expect(outcomes[0].reason).toMatchObject({status:403});
      expect(await wake.deviceCall(b.bindingId,b.grant,call.callUUID,"claim")).toHaveProperty("sip");
    } finally {await rotation.query("ROLLBACK");await Promise.allSettled([claim,update].filter(Boolean));rotation.release();}
  });
  it("does not deadlock a claim against authoritative session logout cascade", async () => {
    const {b,call}=await offered(); const logout=await pool.connect();
    let claim:Promise<unknown>|undefined, deletion:Promise<unknown>|undefined,pid=0;
    try {
      await logout.query("BEGIN; SET LOCAL statement_timeout='3s'; SET LOCAL deadlock_timeout='100ms'");
      await logout.query("SELECT 1 FROM phone11_auth_session WHERE id='session-1' FOR UPDATE");
      const racing=createWakeRepository(fn=>transaction(async client=>{
        pid=(await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;return fn(client);
      }));
      claim=racing.deviceCall(b.bindingId,b.grant,call.callUUID,"claim");void claim.catch(()=>{});
      let waiting=false;
      for(let i=0;i<100;i++) {
        if(pid && (await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.wait_event_type==="Lock") {waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,5));
      }
      expect(waiting).toBe(true);
      deletion=logout.query("DELETE FROM phone11_auth_session WHERE id='session-1'").then(()=>logout.query("COMMIT"),async error=>{await logout.query("ROLLBACK");throw error;});
      const outcomes=await Promise.allSettled([claim,deletion]);
      expect(outcomes[1].status,outcomes[1].status==="rejected"?String(outcomes[1].reason?.code)+": "+outcomes[1].reason?.message:"logout committed").toBe("fulfilled");
      expect(outcomes[0]).toMatchObject({status:"rejected",reason:{status:403}});
      expect((await pool.query("SELECT count(*)::int AS n FROM phone11_wake_bindings")).rows[0].n).toBe(0);
    } finally {await logout.query("ROLLBACK");await Promise.allSettled([claim,deletion].filter(Boolean));logout.release();}
  });
  it("prunes only old inactive calls and expired tombstones while skipping locked rows", async () => {
    const b=await enrolled();
    await pool.query(`INSERT INTO phone11_wake_calls(id,binding_id,sip_call_id,sip_uri,state,expires_at,busy_until) VALUES
      (gen_random_uuid(),$1,'old-ended',$2,'ended',clock_timestamp()-INTERVAL '25 hours',NULL),
      (gen_random_uuid(),$1,'old-pending',$2,'pending',clock_timestamp()-INTERVAL '25 hours',NULL),
      (gen_random_uuid(),$1,'locked-old',$2,'cancelled',clock_timestamp()-INTERVAL '25 hours',NULL),
      (gen_random_uuid(),$1,'old-active-lease',$2,'ready',clock_timestamp()-INTERVAL '25 hours',clock_timestamp()+INTERVAL '60 seconds'),
      (gen_random_uuid(),$1,'recent-expired',$2,'ended',clock_timestamp()-INTERVAL '1 hour',NULL),
      (gen_random_uuid(),$1,'fresh-pending',$2,'pending',clock_timestamp()+INTERVAL '20 seconds',NULL);
      `,[b.bindingId,uri]);
    await pool.query(`INSERT INTO phone11_wake_terminals VALUES ($1,'expired','cancelled',clock_timestamp()-INTERVAL '1 second'),($1,'active','ended',clock_timestamp()+INTERVAL '1 minute')`,[uri]);
    const held=await pool.connect();
    try {
      await held.query("BEGIN"); await held.query("SELECT id FROM phone11_wake_calls WHERE sip_call_id='locked-old' FOR UPDATE");
      await wake.pruneExpired();
      expect((await pool.query("SELECT sip_call_id FROM phone11_wake_calls ORDER BY sip_call_id")).rows.map(r=>r.sip_call_id)).toEqual(["fresh-pending","locked-old","old-active-lease","recent-expired"]);
      expect((await pool.query("SELECT sip_call_id FROM phone11_wake_terminals")).rows.map(r=>r.sip_call_id)).toEqual(["active"]);
    } finally {await held.query("ROLLBACK");held.release();}
    await wake.pruneExpired();
    expect((await pool.query("SELECT 1 FROM phone11_wake_calls WHERE sip_call_id='locked-old'")).rows).toHaveLength(0);
    expect(await wake.resolve(b.bindingId,"session-1",1)).toBeTruthy();
  });
  it("bounds each retention batch to 1000 rows per table", async () => {
    const b=await enrolled();
    await pool.query(`INSERT INTO phone11_wake_calls (id,binding_id,sip_call_id,sip_uri,state,expires_at)
      SELECT gen_random_uuid(),$1,'old-'||n,$2,'ended',clock_timestamp()-INTERVAL '25 hours' FROM generate_series(1,1005) n`,[b.bindingId,uri]);
    await pool.query(`INSERT INTO phone11_wake_terminals SELECT $1,'old-'||n,'ended',clock_timestamp()-INTERVAL '1 minute' FROM generate_series(1,1005) n`,[uri]);
    await wake.pruneExpired();
    expect((await pool.query("SELECT count(*)::int AS n FROM phone11_wake_calls")).rows[0].n).toBe(5);
    expect((await pool.query("SELECT count(*)::int AS n FROM phone11_wake_terminals")).rows[0].n).toBe(5);
  });
  it("does not return credentials after the setup TTL expires during credential fetch", async () => {
    const {b,call}=await offered(); const {rows:[r]}=await pool.query("UPDATE phone11_wake_calls SET expires_at=clock_timestamp()+INTERVAL '150 milliseconds' RETURNING expires_at");
    let paused=false; const slow=delayedBefore("SELECT sa.sip_username",async()=>{paused=true;await afterExpiry(r.expires_at);});
    await expect(slow.deviceCall(b.bindingId,b.grant,call.callUUID,"claim")).rejects.toMatchObject({status:410}); expect(paused).toBe(true);
  });
  it("does not return credentials after the auth session expires during credential fetch", async () => {
    const {b,call}=await offered(); const {rows:[r]}=await pool.query(`UPDATE phone11_auth_session SET "expiresAt"=clock_timestamp()+INTERVAL '150 milliseconds' WHERE id='session-1' RETURNING "expiresAt" AS expires_at`);
    let paused=false; const slow=delayedBefore("SELECT sa.sip_username",async()=>{paused=true;await afterExpiry(r.expires_at);});
    await expect(slow.deviceCall(b.bindingId,b.grant,call.callUUID,"claim")).rejects.toMatchObject({status:403}); expect(paused).toBe(true);
  });
  it("does not issue an already expired grant after enrollment waits on locks", async () => {
    await push.put(token); const {rows:[r]}=await pool.query(`UPDATE phone11_auth_session SET "expiresAt"=clock_timestamp()+INTERVAL '150 milliseconds' WHERE id='session-1' RETURNING "expiresAt" AS expires_at`);
    let paused=false; const slow=delayedBefore("INSERT INTO phone11_wake_bindings",async()=>{paused=true;await afterExpiry(r.expires_at);});
    await expect(slow.enroll("session-1",1,"device-a",uri)).rejects.toMatchObject({status:403}); expect(paused).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS n FROM phone11_wake_bindings")).rows[0].n).toBe(0);
  });
  it("does not offer an already expired binding after waiting on locks", async () => {
    await enrolled(); const {rows:[r]}=await pool.query("UPDATE phone11_wake_bindings SET expires_at=clock_timestamp()+INTERVAL '150 milliseconds' RETURNING expires_at");
    let paused=false; const slow=delayedBefore("INSERT INTO phone11_wake_calls",async()=>{paused=true;await afterExpiry(r.expires_at);});
    await expect(slow.offer(uri,"late-offer")).rejects.toMatchObject({status:404}); expect(paused).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS n FROM phone11_wake_calls")).rows[0].n).toBe(0);
  });
});
