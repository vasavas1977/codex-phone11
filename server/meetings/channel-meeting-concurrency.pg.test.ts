import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import { createChannelMeetingAdminRepository } from "./channel-meeting-admin-repository";
import { createChannelMeetingRepository } from "./channel-meeting-repository";
import { createPlainVideoAdmissionLeaseRepository, type PlainVideoIssuanceTransaction } from "./plain-video-admission-lease-repository";

// Explicitly opt in only against this disposable, socket-only local cluster.
// Never point this test at a hosted database or an existing Phone11 database.
const socket = "/tmp/phone11-meeting-candidate-pg/socket";
const enabled = process.env.PHONE11_TEST_DISPOSABLE_PG === "YES"
  && process.env.PHONE11_TEST_PG_SOCKET === socket;

const channelId = "12345678-1234-4234-8234-123456789012";
const otherChannelId = "d2345678-1234-4234-8234-123456789012";
const meetingId = "22345678-1234-4234-8234-123456789012";
const grant = (userId: number) => ({ meetingId, tenantId: 41, userId });

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function within<T>(promise: Promise<T>, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), 2_000);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForLock(pool: Pool, queryFragment: string) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query(`SELECT 1 FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid()
        AND state='active' AND wait_event_type='Lock'
        AND query LIKE $1 LIMIT 1`, [`%${queryFragment}%`]);
    if (waiting.rows.length === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected PostgreSQL lock wait for ${queryFragment}`);
}

describe.runIf(enabled)("real PostgreSQL meeting lock order", () => {
  let pool: Pool;

  const transaction = (pause?: (sql: string) => Promise<void>): PlainVideoIssuanceTransaction =>
    (async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout = '6s'");
        await client.query("SET LOCAL lock_timeout = '4s'");
        const db = { query: async (sql: string, values?: unknown[]) => {
          const result = await client.query(sql, values);
          await pause?.(sql);
          return result;
        } };
        const value = await fn(db as never);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }) as PlainVideoIssuanceTransaction;

  const writeTransaction = (pause?: (sql: string) => Promise<void>) =>
    (async (fn: (db: PoolClient) => Promise<unknown>) => transaction(pause)(fn as never)) as never;

  beforeAll(async () => {
    pool = new Pool({ host: socket, port: 55439, database: "phone11_meeting_candidate", user: process.env.USER, max: 8 });
    const location = await pool.query(`SELECT current_database() AS db,
      inet_server_addr() IS NULL AS socket_only, current_setting('server_version_num')::integer AS version`);
    if (location.rows[0]?.db !== "phone11_meeting_candidate" || location.rows[0]?.socket_only !== true
      || location.rows[0]?.version < 170000 || location.rows[0]?.version >= 180000)
      throw new Error("Refusing to run meeting concurrency test outside disposable local PostgreSQL 17");
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await pool.query(`
      CREATE TABLE tenants(id integer PRIMARY KEY, status text NOT NULL);
      CREATE TABLE users(id integer PRIMARY KEY, name text NOT NULL);
      CREATE TABLE tenant_memberships(tenant_id integer, user_id integer, status text, role text, PRIMARY KEY(tenant_id,user_id));
      CREATE TABLE phone11_auth_identity(legacy_user_id integer PRIMARY KEY, disabled_at timestamptz);
      CREATE TABLE extensions(id integer PRIMARY KEY, tenant_id integer, status text, deleted_at timestamptz);
      CREATE TABLE user_extensions(id integer PRIMARY KEY, user_id integer, extension_id integer);
      CREATE TABLE phone11_chat_conversations(id uuid PRIMARY KEY, tenant_id integer, kind text, name text);
      CREATE TABLE phone11_chat_members(tenant_id integer, conversation_id uuid, user_id integer,
        can_start_meeting boolean NOT NULL DEFAULT false, PRIMARY KEY(tenant_id,conversation_id,user_id));
      CREATE TABLE phone11_plain_video_admission_rooms(id uuid PRIMARY KEY, tenant_id integer,
        state text, revision uuid, ended_at timestamptz);
      CREATE TABLE phone11_plain_video_admission_members(meeting_id uuid, tenant_id integer,
        user_id integer, participant_id text, grant_profile text, lobby_state text,
        revision uuid, revoked_at timestamptz, PRIMARY KEY(meeting_id,user_id));
      CREATE TABLE phone11_plain_video_admission_leases(id uuid PRIMARY KEY, tenant_id integer,
        meeting_id uuid, user_id integer, participant_id text, room_revision uuid,
        member_revision uuid, state text, expires_at timestamptz);
      CREATE TABLE phone11_channel_meetings(meeting_id uuid PRIMARY KEY, tenant_id integer,
        channel_id uuid, created_by integer, request_id uuid, selection_fingerprint char(64),
        created_at timestamptz DEFAULT clock_timestamp(), expires_at timestamptz DEFAULT clock_timestamp()+interval '2 hours');
      CREATE TABLE phone11_channel_meeting_invitations(id uuid PRIMARY KEY, meeting_id uuid,
        tenant_id integer, channel_id uuid, recipient_id integer, created_at timestamptz DEFAULT clock_timestamp());
      CREATE FUNCTION revoke_removed_channel_member() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE phone11_plain_video_admission_members admission
          SET revoked_at=clock_timestamp(), revision=gen_random_uuid()
          FROM phone11_channel_meetings source
          WHERE source.meeting_id=admission.meeting_id AND source.tenant_id=OLD.tenant_id
            AND source.channel_id=OLD.conversation_id AND admission.user_id=OLD.user_id
            AND admission.revoked_at IS NULL;
        RETURN OLD;
      END; $$;
      CREATE TRIGGER revoke_removed_channel_member BEFORE DELETE ON phone11_chat_members
        FOR EACH ROW EXECUTE FUNCTION revoke_removed_channel_member();
      INSERT INTO tenants VALUES(41,'active'),(42,'active');
      INSERT INTO users VALUES(7,'Host'),(8,'Invitee');
      INSERT INTO tenant_memberships VALUES(41,7,'active','owner'),(41,8,'active','member'),(42,7,'active','owner');
      INSERT INTO phone11_auth_identity VALUES(7,NULL),(8,NULL);
      INSERT INTO extensions VALUES(107,41,'active',NULL),(108,41,'active',NULL),(207,42,'active',NULL);
      INSERT INTO user_extensions VALUES(1,7,107),(2,8,108),(4,7,207);
      INSERT INTO phone11_chat_conversations VALUES('${channelId}',41,'channel','Test'),('${otherChannelId}',42,'channel','Other');
      INSERT INTO phone11_chat_members VALUES(41,'${channelId}',7,true),(41,'${channelId}',8,false),(42,'${otherChannelId}',7,true);
      INSERT INTO phone11_plain_video_admission_rooms VALUES('${meetingId}',41,'open','32345678-1234-4234-8234-123456789012',NULL);
      INSERT INTO phone11_plain_video_admission_members VALUES
        ('${meetingId}',41,7,'pv_7','interactive','admitted','42345678-1234-4234-8234-123456789012',NULL),
        ('${meetingId}',41,8,'pv_8','interactive','admitted','52345678-1234-4234-8234-123456789012',NULL);
      INSERT INTO phone11_channel_meetings(meeting_id,tenant_id,channel_id,created_by,request_id,selection_fingerprint)
        VALUES('${meetingId}',41,'${channelId}',7,'62345678-1234-4234-8234-123456789012','${"a".repeat(64)}');
    `);
  });

  afterAll(async () => { await pool?.end(); });

  it("serializes starts, admin edits, and joins while revoked authority cannot issue a lease", async () => {
    let arrivals = 0;
    const bothAtTenant = deferred();
    const pauseTwoInvitees = async (sql: string) => {
      if (!sql.includes("FROM tenants") || !sql.includes("FOR SHARE")) return;
      if (++arrivals === 2) bothAtTenant.release();
      await bothAtTenant.promise;
    };
    const first = createPlainVideoAdmissionLeaseRepository(transaction(pauseTwoInvitees));
    const second = createPlainVideoAdmissionLeaseRepository(transaction(pauseTwoInvitees));
    const [lease7, lease8] = await Promise.all([first.begin(grant(7)), second.begin(grant(8))]);
    expect(arrivals).toBe(2);
    expect(lease7?.user_id).toBe(7);
    expect(lease8?.user_id).toBe(8);
    await expect(Promise.all([first.confirm(lease7!), second.confirm(lease8!)])).resolves.toMatchObject([
      { user_id: 7 }, { user_id: 8 },
    ]);

    const joinAtTenant = deferred();
    const releaseJoin = deferred();
    const joining = createPlainVideoAdmissionLeaseRepository(transaction(async (sql) => {
      if (sql.includes("FROM tenants") && sql.includes("FOR SHARE")) {
        joinAtTenant.release();
        await releaseJoin.promise;
      }
    })).begin(grant(7));
    await joinAtTenant.promise;
    const start = createChannelMeetingRepository(writeTransaction()).start({
      actorId: 7, tenantId: 41, channelId, selectedMemberIds: [8],
      requestId: "72345678-1234-4234-8234-123456789012",
      fingerprint: "b".repeat(64), meetingId: "82345678-1234-4234-8234-123456789012",
    });
    try { await waitForLock(pool, "FROM tenants"); }
    finally { releaseJoin.release(); }
    await expect(joining).resolves.toMatchObject({ user_id: 7 });
    await expect(start).resolves.toMatchObject({ invitedMemberIds: [8] });

    const joinAtMember = deferred();
    const releaseMember = deferred();
    const anotherJoin = createPlainVideoAdmissionLeaseRepository(transaction(async (sql) => {
      if (sql.includes("FOR KEY SHARE OF member")) {
        joinAtMember.release();
        await releaseMember.promise;
      }
    })).begin(grant(8));
    await joinAtMember.promise;
    const adminEdit = createChannelMeetingAdminRepository(writeTransaction()).setHostPermission(
      7, { tenantId: 41, channelId, userId: 8, canStartMeeting: true }, true);
    try { await waitForLock(pool, "FROM phone11_chat_members"); }
    finally { releaseMember.release(); }
    await expect(anotherJoin).resolves.toMatchObject({ user_id: 8 });
    await expect(adminEdit).resolves.toMatchObject({ userId: 8, canStartMeeting: true });

    const adminAtUpdate = deferred();
    const releaseAdmin = deferred();
    const holdingAdmin = createChannelMeetingAdminRepository(writeTransaction(async (sql) => {
      if (sql.includes("UPDATE phone11_chat_members SET can_start_meeting")) {
        adminAtUpdate.release();
        await releaseAdmin.promise;
      }
    })).setHostPermission(7, { tenantId: 41, channelId, userId: 8, canStartMeeting: false }, true);
    await adminAtUpdate.promise;
    const followingStart = createChannelMeetingRepository(writeTransaction()).start({
      actorId: 7, tenantId: 41, channelId, selectedMemberIds: [8],
      requestId: "c2345678-1234-4234-8234-123456789012",
      fingerprint: "d".repeat(64), meetingId: "b2345678-1234-4234-8234-123456789012",
    });
    try { await waitForLock(pool, "pg_advisory_xact_lock"); }
    finally { releaseAdmin.release(); }
    await expect(holdingAdmin).resolves.toMatchObject({ userId: 8, canStartMeeting: false });
    await expect(followingStart).resolves.toMatchObject({ invitedMemberIds: [8] });

    const otherTenantPending = await first.begin(grant(7));
    expect(otherTenantPending).not.toBeNull();
    const startAtIdentity = deferred();
    const releaseOtherStart = deferred();
    const otherTenantStart = createChannelMeetingRepository(writeTransaction(async (sql) => {
      if (sql.includes("FROM phone11_auth_identity identity") && sql.includes("FOR UPDATE OF identity")) {
        startAtIdentity.release();
        await releaseOtherStart.promise;
      }
    })).start({
      actorId: 7, tenantId: 42, channelId: otherChannelId, selectedMemberIds: [],
      requestId: "f2345678-1234-4234-8234-123456789012",
      fingerprint: "e".repeat(64), meetingId: "e2345678-1234-4234-8234-123456789012",
    });
    await within(startAtIdentity.promise, "other tenant identity lock");
    const confirmAtOtherExtension = deferred();
    const releaseOtherConfirm = deferred();
    const otherTenantConfirm = createPlainVideoAdmissionLeaseRepository(transaction(async (sql) => {
      if (sql.includes("FROM extensions") && sql.includes("FOR SHARE")) {
        confirmAtOtherExtension.release();
        await releaseOtherConfirm.promise;
      }
    })).confirm(otherTenantPending!);
    await within(confirmAtOtherExtension.promise, "tenant-scoped assignment and extension locks");
    releaseOtherStart.release();
    try {
      await expect(within(otherTenantStart, "independent tenant start")).resolves.toMatchObject({ invitedMemberIds: [] });
    } finally { releaseOtherConfirm.release(); }
    await expect(otherTenantConfirm).resolves.toMatchObject({ user_id: 7 });

    const assignmentPending = await first.begin(grant(7));
    expect(assignmentPending).not.toBeNull();
    const confirmAtExtension = deferred();
    const releaseConfirm = deferred();
    const confirming = createPlainVideoAdmissionLeaseRepository(transaction(async (sql) => {
      if (sql.includes("FROM extensions") && sql.includes("FOR SHARE")) {
        confirmAtExtension.release();
        await releaseConfirm.promise;
      }
    })).confirm(assignmentPending!);
    await confirmAtExtension.promise;
    const removeAssignment = pool.query("DELETE FROM user_extensions WHERE user_id=7");
    try { await waitForLock(pool, "DELETE FROM user_extensions"); }
    finally { releaseConfirm.release(); }
    await expect(confirming).resolves.toMatchObject({ user_id: 7 });
    await removeAssignment;
    await expect(first.begin(grant(7))).resolves.toBeNull();
    await pool.query("INSERT INTO user_extensions VALUES(3,7,107)");

    const extensionPending = await first.begin(grant(7));
    expect(extensionPending).not.toBeNull();
    const revoker = await pool.connect();
    try {
      await revoker.query("BEGIN");
      await revoker.query("UPDATE extensions SET status='inactive' WHERE id=107");
      const blockedConfirm = first.confirm(extensionPending!);
      await waitForLock(pool, "FROM extensions");
      await revoker.query("COMMIT");
      await expect(blockedConfirm).resolves.toBeNull();
    } finally {
      await revoker.query("ROLLBACK");
      revoker.release();
    }
    const extensionLease = await pool.query("SELECT state FROM phone11_plain_video_admission_leases WHERE id=$1", [extensionPending!.leaseId]);
    expect(extensionLease.rows).toEqual([{ state: "pending" }]);
    await pool.query("UPDATE extensions SET status='active' WHERE id=107");

    const pending = await first.begin(grant(8));
    expect(pending).not.toBeNull();
    await pool.query("DELETE FROM phone11_chat_members WHERE tenant_id=41 AND conversation_id=$1 AND user_id=8", [channelId]);
    await expect(first.confirm(pending!)).resolves.toBeNull();
    await expect(first.begin(grant(8))).resolves.toBeNull();
    const state = await pool.query("SELECT state FROM phone11_plain_video_admission_leases WHERE id=$1", [pending!.leaseId]);
    expect(state.rows).toEqual([{ state: "pending" }]);
    await expect(createChannelMeetingRepository(writeTransaction()).start({
      actorId: 7, tenantId: 41, channelId, selectedMemberIds: [8],
      requestId: "92345678-1234-4234-8234-123456789012",
      fingerprint: "c".repeat(64), meetingId: "a2345678-1234-4234-8234-123456789012",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createChannelMeetingAdminRepository(writeTransaction()).setHostPermission(
      7, { tenantId: 41, channelId, userId: 8, canStartMeeting: true }, true,
    )).rejects.toMatchObject({ code: "FORBIDDEN" });

    const tenantPending = await first.begin(grant(7));
    expect(tenantPending).not.toBeNull();
    await pool.query("UPDATE tenants SET status='suspended' WHERE id=41");
    await expect(first.confirm(tenantPending!)).resolves.toBeNull();
    await expect(first.begin(grant(7))).resolves.toBeNull();
    const tenantLease = await pool.query("SELECT state FROM phone11_plain_video_admission_leases WHERE id=$1", [tenantPending!.leaseId]);
    expect(tenantLease.rows).toEqual([{ state: "pending" }]);
  }, 15_000);
});
