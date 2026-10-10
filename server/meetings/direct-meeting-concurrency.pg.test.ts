import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Pool, type PoolClient } from "pg";

import { createChannelMeetingAdminRepository } from "./channel-meeting-admin-repository";
import { channelMeetingOriginAllows } from "./channel-meeting-origin";
import { createDirectMeetingRepository } from "./direct-meeting-repository";
import { createPlainVideoAdmissionLeaseRepository } from "./plain-video-admission-lease-repository";

const socket = "/tmp/phone11-direct-meeting-candidate-pg/socket";
const enabled = process.env.PHONE11_TEST_DISPOSABLE_PG === "YES"
  && process.env.PHONE11_TEST_PG_SOCKET === socket;
const directId = "12345678-1234-4234-8234-123456789012";
const foreignId = "22345678-1234-4234-8234-123456789012";
const meetingId = "32345678-1234-4234-8234-123456789012";
const secondMeetingId = "42345678-1234-4234-8234-123456789012";
const requestId = "52345678-1234-4234-8234-123456789012";

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function waitForLock(pool: Pool, fragment: string) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query(`SELECT 1 FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND state='active'
        AND wait_event_type='Lock' AND query LIKE $1 LIMIT 1`, [`%${fragment}%`]);
    if (waiting.rows.length) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected lock wait for ${fragment}`);
}

describe.runIf(enabled)("direct meetings on disposable PostgreSQL 17", () => {
  let pool: Pool;
  const transaction = (pause?: (sql: string) => Promise<void>) => async <T>(fn: (db: PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='8s'");
      await client.query("SET LOCAL lock_timeout='6s'");
      const db = { query: async (sql: string, values?: unknown[]) => {
        const result = await client.query(sql, values);
        await pause?.(sql);
        return result;
      } };
      const result = await fn(db as never);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  };

  async function block(blockerId: number, blockedId: number) {
    return transaction()(async (db) => {
      // Match chat block's workspace authority and pair lock sequence.
      await db.query(`SELECT membership.user_id FROM tenant_memberships membership
        WHERE membership.tenant_id=41 AND membership.user_id=$1 AND membership.status='active' FOR SHARE`, [blockerId]);
      const [low, high] = [blockerId, blockedId].sort((a, b) => a - b);
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`phone11-chat-safety:41:${low}:${high}`]);
      await db.query(`INSERT INTO phone11_chat_blocks(tenant_id,blocker_id,blocked_id)
        VALUES(41,$1,$2) ON CONFLICT DO NOTHING`, [blockerId, blockedId]);
    });
  }

  beforeAll(async () => {
    pool = new Pool({ host: socket, port: 55440, database: "phone11_direct_meeting_candidate",
      user: process.env.USER, max: 8 });
    const identity = await pool.query(`SELECT current_database() AS db,
      inet_server_addr() IS NULL AS socket_only, current_setting('server_version_num')::integer AS version`);
    if (identity.rows[0]?.db !== "phone11_direct_meeting_candidate" || identity.rows[0]?.socket_only !== true
      || identity.rows[0]?.version < 170000 || identity.rows[0]?.version >= 180000)
      throw new Error("Refusing non-disposable or non-local PostgreSQL 17");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await pool.query(`
      CREATE TABLE tenants(id integer PRIMARY KEY,status text NOT NULL);
      CREATE TABLE users(id integer PRIMARY KEY,name text NOT NULL);
      CREATE TABLE tenant_memberships(tenant_id integer,user_id integer,status text,role text,
        PRIMARY KEY(tenant_id,user_id));
      CREATE TABLE phone11_auth_identity(legacy_user_id integer PRIMARY KEY,disabled_at timestamptz);
      CREATE TABLE extensions(id integer PRIMARY KEY,tenant_id integer,status text,deleted_at timestamptz);
      CREATE TABLE user_extensions(id integer PRIMARY KEY,user_id integer,extension_id integer);
      CREATE TABLE phone11_chat_conversations(id uuid PRIMARY KEY,tenant_id integer,kind text,name text,
        UNIQUE(tenant_id,id));
      CREATE TABLE phone11_chat_members(tenant_id integer,conversation_id uuid,user_id integer REFERENCES users(id),
        PRIMARY KEY(tenant_id,conversation_id,user_id),
        FOREIGN KEY(tenant_id,conversation_id) REFERENCES phone11_chat_conversations(tenant_id,id));
      CREATE TABLE phone11_chat_blocks(tenant_id integer,blocker_id integer,blocked_id integer,
        PRIMARY KEY(tenant_id,blocker_id,blocked_id));
      CREATE TABLE phone11_plain_video_admission_rooms(id uuid PRIMARY KEY,tenant_id integer,state text,
        revision uuid,ended_at timestamptz,UNIQUE(id,tenant_id));
      CREATE TABLE phone11_plain_video_admission_members(meeting_id uuid,tenant_id integer,user_id integer,
        participant_id text,grant_profile text,lobby_state text,revision uuid,revoked_at timestamptz,
        PRIMARY KEY(meeting_id,user_id),UNIQUE(meeting_id,tenant_id,user_id));
      CREATE TABLE phone11_plain_video_admission_leases(id uuid PRIMARY KEY,tenant_id integer,
        meeting_id uuid,user_id integer,participant_id text,room_revision uuid,member_revision uuid,
        state text,expires_at timestamptz);
    `);
    for (const migration of ["channel-meeting-migration.sql", "direct-meeting-migration.sql"]) {
      const sql = await readFile(fileURLToPath(new URL(migration, import.meta.url).toString()), "utf8");
      await pool.query(sql);
    }
    await pool.query(`
      INSERT INTO tenants VALUES(41,'active'),(42,'active');
      INSERT INTO users VALUES(7,'Host'),(8,'Recipient'),(9,'Other tenant');
      INSERT INTO tenant_memberships VALUES(41,7,'active','owner'),(41,8,'active','member'),
        (42,7,'active','owner'),(42,9,'active','member');
      INSERT INTO phone11_auth_identity VALUES(7,NULL),(8,NULL),(9,NULL);
      INSERT INTO extensions VALUES(107,41,'active',NULL),(108,41,'active',NULL),(207,42,'active',NULL),(209,42,'active',NULL);
      INSERT INTO user_extensions VALUES(1,7,107),(2,8,108),(3,7,207),(4,9,209);
      INSERT INTO phone11_chat_conversations VALUES('${directId}',41,'direct','Direct'),
        ('${foreignId}',42,'direct','Other');
      INSERT INTO phone11_chat_members(tenant_id,conversation_id,user_id) VALUES
        (41,'${directId}',7),(41,'${directId}',8),(42,'${foreignId}',7),(42,'${foreignId}',9);
    `);
  });

  afterAll(async () => { await pool?.end(); });

  it("checks explicit grant, tenant, recipient, replay, migration and block races", async () => {
    const direct = createDirectMeetingRepository(transaction() as never);
    const admin = createChannelMeetingAdminRepository(transaction() as never);
    const input = { actorId: 7, tenantId: 41, conversationId: directId, requestId, meetingId };
    await expect(direct.start(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(direct.start({ ...input, conversationId: foreignId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin.setHostPermission(8, { tenantId: 41, channelId: directId,
      userId: 8, canStartMeeting: true }, true, "direct")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await admin.setHostPermission(7, { tenantId: 41, channelId: directId,
      userId: 7, canStartMeeting: true }, true, "direct");
    await expect(direct.start(input)).resolves.toMatchObject({ meetingId, invitedMemberId: 8, replayed: false });
    const readOnly = await pool.connect();
    try {
      await readOnly.query("BEGIN READ ONLY");
      await expect(channelMeetingOriginAllows(readOnly, { meetingId, tenantId: 41, userId: 8 }))
        .resolves.toBe(true);
      await readOnly.query("COMMIT");
    } finally {
      await readOnly.query("ROLLBACK");
      readOnly.release();
    }
    await expect(direct.start({ ...input, meetingId: secondMeetingId })).resolves.toMatchObject({ meetingId, replayed: true });
    await expect(direct.start({ ...input, tenantId: 42 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await direct.invitations(7, 41, directId)).toEqual([]);
    expect(await direct.invitations(8, 42, directId)).toEqual([]);
    expect(await direct.invitations(8, 41, directId)).toHaveLength(1);
    const invitation = await pool.query("SELECT recipient_id FROM phone11_channel_meeting_invitations WHERE meeting_id=$1", [meetingId]);
    expect(invitation.rows).toEqual([{ recipient_id: 8 }]);

    const startedAtPair = deferred();
    const releaseStart = deferred();
    const startAfterGrant = createDirectMeetingRepository(transaction(async (sql) => {
      if (sql.includes("INSERT INTO phone11_channel_meeting_invitations")) {
        startedAtPair.release();
        await releaseStart.promise;
      }
    }) as never).start({ ...input, requestId: "62345678-1234-4234-8234-123456789012",
      meetingId: secondMeetingId });
    await startedAtPair.promise;
    const blocking = block(8, 7);
    await waitForLock(pool, "FROM tenant_memberships");
    releaseStart.release();
    await expect(startAfterGrant).resolves.toMatchObject({ meetingId: secondMeetingId });
    await blocking;
    const revoked = await pool.query(`SELECT user_id,revoked_at FROM phone11_plain_video_admission_members
      WHERE meeting_id=$1 ORDER BY user_id`, [secondMeetingId]);
    expect(revoked.rows).toHaveLength(2);
    expect(revoked.rows.every((row) => row.revoked_at !== null)).toBe(true);
    await expect(direct.start({ ...input, requestId: "72345678-1234-4234-8234-123456789012",
      meetingId: "82345678-1234-4234-8234-123456789012" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const lease = createPlainVideoAdmissionLeaseRepository(transaction() as never);
    await expect(lease.begin({ meetingId, tenantId: 41, userId: 8 })).resolves.toBeNull();

    await pool.query("DELETE FROM phone11_chat_blocks WHERE tenant_id=41 AND blocker_id=8 AND blocked_id=7");
    const thirdMeetingId = "92345678-1234-4234-8234-123456789012";
    await direct.start({ ...input, requestId: "a2345678-1234-4234-8234-123456789012", meetingId: thirdMeetingId });
    const joinAtPair = deferred();
    const releaseJoin = deferred();
    const pendingJoin = createPlainVideoAdmissionLeaseRepository(transaction(async (sql) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        joinAtPair.release();
        await releaseJoin.promise;
      }
    }) as never).begin({ meetingId: thirdMeetingId, tenantId: 41, userId: 8 });
    await joinAtPair.promise;
    const blockDuringJoin = block(8, 7);
    await waitForLock(pool, "FROM tenant_memberships");
    releaseJoin.release();
    const pending = await pendingJoin;
    expect(pending).not.toBeNull();
    await blockDuringJoin;
    await expect(lease.confirm(pending!)).resolves.toBeNull();

    // A recipient must not keep using a room after its host loses authority.
    await pool.query("DELETE FROM phone11_chat_blocks WHERE tenant_id=41 AND blocker_id=8 AND blocked_id=7");
    const hostLifecycleMeetingId = "b2345678-1234-4234-8234-123456789012";
    await direct.start({ ...input, requestId: "c2345678-1234-4234-8234-123456789012",
      meetingId: hostLifecycleMeetingId });
    const recipientGrant = { meetingId: hostLifecycleMeetingId, tenantId: 41, userId: 8 };
    const beforeHostDisabled = await lease.begin(recipientGrant);
    expect(beforeHostDisabled).not.toBeNull();
    await pool.query("UPDATE phone11_auth_identity SET disabled_at=clock_timestamp() WHERE legacy_user_id=7");
    await expect(direct.invitations(8, 41, directId)).resolves.toEqual([]);
    await expect(lease.begin(recipientGrant)).resolves.toBeNull();
    await expect(lease.confirm(beforeHostDisabled!)).resolves.toBeNull();
    await pool.query("UPDATE phone11_auth_identity SET disabled_at=NULL WHERE legacy_user_id=7");

    await pool.query("UPDATE tenant_memberships SET status='inactive' WHERE tenant_id=41 AND user_id=7");
    await expect(direct.invitations(8, 41, directId)).resolves.toEqual([]);
    await expect(lease.begin(recipientGrant)).resolves.toBeNull();
    await pool.query("UPDATE tenant_memberships SET status='active' WHERE tenant_id=41 AND user_id=7");

    await pool.query("DELETE FROM user_extensions WHERE id=1 AND user_id=7 AND extension_id=107");
    await expect(direct.invitations(8, 41, directId)).resolves.toEqual([]);
    await expect(lease.begin(recipientGrant)).resolves.toBeNull();
  }, 20_000);
});
