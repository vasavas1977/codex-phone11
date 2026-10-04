import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createMeetingHostEvictionRepository } from "./meeting-host-eviction-repository";
import { createPlainVideoEvictionPostgresTransaction } from "./plain-video-eviction-repository";
import {
  createPlainVideoAdmissionLeaseRepository,
  createPlainVideoPostgresIssuanceTransaction,
} from "./plain-video-admission-lease-repository";

const socket = "/tmp/phone11-host-eviction-candidate-pg/socket";
const enabled =
  process.env.PHONE11_TEST_DISPOSABLE_PG === "YES" &&
  process.env.PHONE11_TEST_PG_SOCKET === socket;
const meetingId = "12345678-1234-4234-8234-123456789012";
const channelId = "22345678-1234-4234-8234-123456789012";
const roomRevision = "42345678-1234-4234-8234-123456789012";
const memberRevision = "52345678-1234-4234-8234-123456789012";
const input = { meetingId, tenantId: 41, targetUserId: 8, expectedParticipantId: "stable_target",
  expectedRoomRevision: roomRevision, expectedMemberRevision: memberRevision };

describe.runIf(enabled)(
  "meeting host control on disposable PostgreSQL 17",
  () => {
    let pool: Pool;
    let repository: ReturnType<typeof createMeetingHostEvictionRepository>;
    beforeAll(async () => {
      pool = new Pool({
        host: socket,
        port: 55441,
        database: "phone11_host_eviction_candidate",
        user: process.env.USER,
        max: 8,
      });
      const identity =
        await pool.query(`SELECT current_database() AS db, inet_server_addr() IS NULL AS socket_only,
      current_setting('server_version_num')::integer AS version`);
      if (
        identity.rows[0]?.db !== "phone11_host_eviction_candidate" ||
        identity.rows[0]?.socket_only !== true ||
        identity.rows[0]?.version < 170000 ||
        identity.rows[0]?.version >= 180000
      )
        throw new Error("Refusing non-disposable PostgreSQL 17");
      await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
      await pool.query(`CREATE TABLE users(id integer PRIMARY KEY, name text);
      CREATE TABLE tenants(id integer PRIMARY KEY, status text);
      CREATE TABLE tenant_memberships(tenant_id integer,user_id integer,status text,PRIMARY KEY(user_id,tenant_id));
      CREATE TABLE phone11_auth_identity(legacy_user_id integer PRIMARY KEY,disabled_at timestamptz);
      CREATE TABLE extensions(id integer PRIMARY KEY,tenant_id integer,status text,deleted_at timestamptz);
      CREATE TABLE user_extensions(id integer PRIMARY KEY,user_id integer,extension_id integer);
      CREATE TABLE phone11_chat_conversations(id uuid PRIMARY KEY,tenant_id integer,kind text,name text,UNIQUE(tenant_id,id));
      CREATE TABLE phone11_chat_members(tenant_id integer,conversation_id uuid,user_id integer REFERENCES users(id),
        PRIMARY KEY(tenant_id,conversation_id,user_id),FOREIGN KEY(tenant_id,conversation_id) REFERENCES phone11_chat_conversations(tenant_id,id));
      CREATE TABLE phone11_chat_blocks(tenant_id integer,blocker_id integer,blocked_id integer,PRIMARY KEY(tenant_id,blocker_id,blocked_id));`);
      for (const migration of [
        "plain-video-admission-migration.sql",
        "channel-meeting-migration.sql",
        "direct-meeting-migration.sql",
      ]) {
        await pool.query(
          await readFile(fileURLToPath(new URL(migration, import.meta.url).toString()), "utf8"),
        );
      }
      repository = createMeetingHostEvictionRepository(
        createPlainVideoEvictionPostgresTransaction(pool),
      );
    });
    beforeEach(async () => {
      await pool.query(`TRUNCATE tenants,users,tenant_memberships,phone11_auth_identity,extensions,user_extensions,
      phone11_chat_conversations,phone11_chat_members,phone11_chat_blocks,phone11_plain_video_admission_rooms CASCADE;
      INSERT INTO users VALUES(7,'Host'),(8,'Participant'),(9,'Nonhost');
      INSERT INTO tenants VALUES(41,'active'),(42,'active');
      INSERT INTO tenant_memberships VALUES(41,7,'active'),(41,8,'active'),(41,9,'active'),(42,7,'active');
      INSERT INTO phone11_auth_identity VALUES(7,NULL),(8,NULL),(9,NULL);
      INSERT INTO extensions VALUES(107,41,'active',NULL),(108,41,'active',NULL),(109,41,'active',NULL);
      INSERT INTO user_extensions VALUES(1,7,107),(2,8,108),(3,9,109);
      INSERT INTO phone11_chat_conversations VALUES('${channelId}',41,'channel','Test');
      INSERT INTO phone11_chat_members(tenant_id,conversation_id,user_id,can_start_meeting)
        VALUES(41,'${channelId}',7,true),(41,'${channelId}',8,false),(41,'${channelId}',9,true);
      INSERT INTO phone11_plain_video_admission_rooms(id,tenant_id,state,revision) VALUES('${meetingId}',41,'open','${roomRevision}');
      INSERT INTO phone11_plain_video_admission_members(meeting_id,tenant_id,user_id,participant_id,grant_profile,lobby_state,revision)
        VALUES('${meetingId}',41,7,'stable_host','interactive','admitted',gen_random_uuid()),
          ('${meetingId}',41,8,'stable_target','interactive','admitted','${memberRevision}'),
          ('${meetingId}',41,9,'stable_other','interactive','admitted',gen_random_uuid());
      INSERT INTO phone11_channel_meetings(meeting_id,tenant_id,channel_id,created_by,request_id,selection_fingerprint)
        VALUES('${meetingId}',41,'${channelId}',7,gen_random_uuid(),'${"a".repeat(64)}');`);
    });
    afterAll(async () => {
      await pool?.end();
    });

    it("refuses nonhost, cross-tenant, self and legacy room before any local denial", async () => {
      await expect(repository.begin(9, input)).resolves.toBeNull();
      await expect(
        repository.begin(7, { ...input, tenantId: 42 }),
      ).resolves.toBeNull();
      await expect(
        repository.begin(7, { ...input, targetUserId: 7 }),
      ).resolves.toBeNull();
      await pool.query("DELETE FROM phone11_channel_meetings");
      await expect(repository.begin(7, input)).resolves.toBeNull();
      expect(
        (
          await pool.query(
            "SELECT 1 FROM phone11_plain_video_eviction_operations",
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT 1 FROM phone11_plain_video_admission_members WHERE revoked_at IS NOT NULL",
          )
        ).rowCount,
      ).toBe(0);
    });
    it.each([
      "UPDATE tenant_memberships SET status='revoked' WHERE user_id=7 AND tenant_id=41",
      "UPDATE phone11_auth_identity SET disabled_at=clock_timestamp() WHERE legacy_user_id=7",
      "UPDATE phone11_chat_members SET can_start_meeting=false WHERE user_id=7",
      "UPDATE extensions SET status='inactive' WHERE id=107",
      "UPDATE phone11_plain_video_admission_members SET revoked_at=clock_timestamp(),revision=gen_random_uuid() WHERE user_id=7",
      "UPDATE phone11_plain_video_admission_members SET revoked_at=clock_timestamp(),revision=gen_random_uuid() WHERE user_id=8",
      "DELETE FROM phone11_chat_members WHERE user_id=7",
      "UPDATE phone11_channel_meetings SET expires_at=clock_timestamp()-INTERVAL '1 second',created_at=clock_timestamp()-INTERVAL '2 hours'",
    ])(
      "refuses revoked authority or an unrelated revoked target: %s",
      async (sql) => {
        await pool.query(sql);
        await expect(repository.begin(7, input)).resolves.toBeNull();
        expect(
          (
            await pool.query(
              "SELECT 1 FROM phone11_plain_video_eviction_operations",
            )
          ).rowCount,
        ).toBe(0);
      },
    );
    it("commits local remint denial and exact lease invalidation; replays/polls retain identity", async () => {
      const leases = createPlainVideoAdmissionLeaseRepository(
        createPlainVideoPostgresIssuanceTransaction(pool),
      );
      const grant = { meetingId, tenantId: 41, userId: 8 };
      const lease = await leases.begin(grant);
      expect(lease).not.toBeNull();
      const operation = await repository.begin(7, input);
      expect(operation?.target.participantId).toBe("stable_target");
      expect((await pool.query("SELECT revision FROM phone11_plain_video_admission_members WHERE user_id=8")).rows[0].revision).toBe(operation!.id);
      const pending = (await repository.snapshot(7, meetingId, [41])).members.find(member => member.userId === 8)!;
      expect(pending).toMatchObject({ expectedRoomRevision: roomRevision, expectedMemberRevision: operation!.id, state: "pending" });
      const refreshedInput = { ...input, expectedMemberRevision: pending.expectedMemberRevision };
      await expect(repository.get(7, refreshedInput)).resolves.toEqual(operation);
      await expect(repository.begin(7, input)).resolves.toEqual(operation);
      await expect(repository.get(7, input)).resolves.toEqual(operation);
      await expect(leases.begin(grant)).resolves.toBeNull();
      await expect(leases.confirm(lease!)).resolves.toBeNull();
      expect(
        (
          await pool.query(
            "SELECT state FROM phone11_plain_video_admission_leases WHERE id=$1",
            [lease!.leaseId],
          )
        ).rows[0].state,
      ).toBe("revoked");
      expect(
        (
          await pool.query(
            "SELECT 1 FROM phone11_plain_video_eviction_operations",
          )
        ).rowCount,
      ).toBe(1);
      await pool.query(
        "UPDATE phone11_chat_members SET can_start_meeting=false WHERE user_id=7",
      );
      await expect(repository.get(7, input)).resolves.toBeNull();
    });
    it("concurrent requests serialize on authority rows and share one operation", async () => {
      const [first, second] = await Promise.all([
        repository.begin(7, input),
        repository.begin(7, input),
      ]);
      expect(first).not.toBeNull();
      expect(first).toEqual(second);
      expect(
        (
          await pool.query(
            "SELECT 1 FROM phone11_plain_video_eviction_operations",
          )
        ).rowCount,
      ).toBe(1);
    });
    it("supports only an exact unblocked direct pair", async () => {
      await pool.query(`DELETE FROM phone11_chat_members WHERE user_id=9;
      UPDATE phone11_chat_conversations SET kind='direct';
      UPDATE phone11_channel_meetings SET origin_kind='direct';`);
      await expect(repository.begin(7, input)).resolves.toMatchObject({
        target: { participantId: "stable_target" },
      });
      await pool.query("INSERT INTO phone11_chat_blocks VALUES(41,7,8)");
      await expect(repository.get(7, input)).resolves.toBeNull();
    });
    it("a direct creator loses control when current host-start permission is revoked", async () => {
      await pool.query(`DELETE FROM phone11_chat_members WHERE user_id=9;
      UPDATE phone11_chat_conversations SET kind='direct';
      UPDATE phone11_channel_meetings SET origin_kind='direct';
      UPDATE phone11_chat_members SET can_start_meeting=false WHERE user_id=7;`);
      await expect(repository.begin(7, input)).resolves.toBeNull();
      expect(
        (
          await pool.query(
            "SELECT 1 FROM phone11_plain_video_eviction_operations",
          )
        ).rowCount,
      ).toBe(0);
    });
    it("a membership revocation committed first wins the removal race", async () => {
      const client = await pool.connect();
      await client.query("BEGIN");
      await client.query(
        "UPDATE tenant_memberships SET status='revoked' WHERE tenant_id=41 AND user_id=7",
      );
      const pending = repository.begin(7, input);
      const deadline = Date.now() + 2000;
      let waiting = false;
      while (Date.now() < deadline && !waiting) {
        const lock =
          await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
        AND wait_event_type='Lock' AND query LIKE 'SELECT r.id AS meeting_id,%'`);
        waiting = lock.rowCount === 1;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      try {
        expect(waiting).toBe(true);
        await client.query("COMMIT");
        await expect(pending).resolves.toBeNull();
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
    it("reads the actual channel admitted roster without local revocation or provider identity guesses", async () => {
      const snapshot = await repository.snapshot(7, meetingId, [41]);
      expect(snapshot).toMatchObject({ available: true, tenantId: 41, meetingId,
        members: [{ userId: 8, expectedParticipantId: "stable_target", name: "Participant", state: "admitted" },
          { userId: 9, expectedParticipantId: "stable_other", name: "Nonhost", state: "admitted" }] });
      expect((await pool.query("SELECT 1 FROM phone11_plain_video_eviction_operations")).rowCount).toBe(0);
      expect((await pool.query("SELECT 1 FROM phone11_plain_video_admission_members WHERE revoked_at IS NOT NULL")).rowCount).toBe(0);
    });
    it.each([
      "UPDATE phone11_chat_members SET can_start_meeting=false WHERE user_id=7",
      "UPDATE phone11_plain_video_admission_members SET revoked_at=clock_timestamp(),revision=gen_random_uuid() WHERE user_id=7",
      "UPDATE phone11_auth_identity SET disabled_at=clock_timestamp() WHERE legacy_user_id=7",
      "UPDATE phone11_channel_meetings SET expires_at=clock_timestamp()-INTERVAL '1 second',created_at=clock_timestamp()-INTERVAL '2 hours'",
    ])("snapshot refuses current host authority loss without exposing names: %s", async sql => {
      await pool.query(sql);
      expect(await repository.snapshot(7, meetingId, [41])).toEqual({ available: false, meetingId, members: [] });
    });
    it("snapshot refuses another member and unmapped tenant without exposing names", async () => {
      expect(await repository.snapshot(9, meetingId, [41])).toEqual({ available: false, meetingId, members: [] });
      expect(await repository.snapshot(7, meetingId, [42])).toEqual({ available: false, meetingId, members: [] });
    });
    it("snapshot excludes unrelated revoked targets but retains exact durable pending/completed access", async () => {
      await pool.query("UPDATE phone11_plain_video_admission_members SET revoked_at=clock_timestamp(),revision=gen_random_uuid() WHERE user_id=9");
      const operation = await repository.begin(7, { ...input, expectedParticipantId: "stable_target" });
      expect(operation).not.toBeNull();
      expect((await repository.snapshot(7, meetingId, [41])).members).toMatchObject([
        { userId: 8, expectedParticipantId: "stable_target", name: "Participant", state: "pending" },
      ]);
      await repository.record(operation!, { evictionId: "42345678-1234-4234-8234-123456789012",
        state: "completed", revokeTokenTs: Math.floor(Date.now() / 1000), createdAt: new Date(), completedAt: new Date() });
      expect((await repository.snapshot(7, meetingId, [41])).members[0].state).toBe("completed");
      expect((await pool.query("SELECT revoked_at IS NOT NULL AS revoked FROM phone11_plain_video_admission_members WHERE user_id=8")).rows[0].revoked).toBe(true);
    });
    it("snapshot covers only an exact eligible direct pair and closes after blocking", async () => {
      await pool.query(`DELETE FROM phone11_chat_members WHERE user_id=9;
        UPDATE phone11_chat_conversations SET kind='direct'; UPDATE phone11_channel_meetings SET origin_kind='direct'`);
      expect((await repository.snapshot(7, meetingId, [41])).members).toMatchObject([
        { userId: 8, expectedParticipantId: "stable_target", name: "Participant", state: "admitted" },
      ]);
      await pool.query("INSERT INTO phone11_chat_blocks VALUES(41,7,8)");
      expect(await repository.snapshot(7, meetingId, [41])).toEqual({ available: false, meetingId, members: [] });
    });
    it("current replaced target identity refuses both stale removal and stale poll before local writes", async () => {
      await pool.query("UPDATE phone11_plain_video_admission_members SET participant_id='replacement_target',revision=gen_random_uuid() WHERE user_id=8");
      const stale = { ...input, expectedParticipantId: "stable_target" };
      expect(await repository.begin(7, stale)).toBeNull(); expect(await repository.get(7, stale)).toBeNull();
      expect((await pool.query("SELECT 1 FROM phone11_plain_video_eviction_operations")).rowCount).toBe(0);
      expect((await pool.query("SELECT revoked_at FROM phone11_plain_video_admission_members WHERE user_id=8")).rows[0].revoked_at).toBeNull();
      expect((await repository.snapshot(7, meetingId, [41])).members[0].expectedParticipantId).toBe("replacement_target");
    });
    it.each(["member", "room"])("retained assertions reject a same-participant replacement %s revision before any denial", async kind => {
      const snapshot = await repository.snapshot(7, meetingId, [41]);
      const member = snapshot.members.find(member => member.userId === 8)!;
      const retained = { ...input, expectedRoomRevision: member.expectedRoomRevision, expectedMemberRevision: member.expectedMemberRevision };
      await pool.query(kind === "member" ?
        "UPDATE phone11_plain_video_admission_members SET revision=gen_random_uuid() WHERE user_id=8" :
        "UPDATE phone11_plain_video_admission_rooms SET revision=gen_random_uuid()");
      expect(await repository.begin(7, retained)).toBeNull(); expect(await repository.get(7, retained)).toBeNull();
      expect((await pool.query("SELECT 1 FROM phone11_plain_video_eviction_operations")).rowCount).toBe(0);
      expect((await pool.query("SELECT revoked_at FROM phone11_plain_video_admission_members WHERE user_id=8")).rows[0].revoked_at).toBeNull();
      const fresh = (await repository.snapshot(7, meetingId, [41])).members.find(member => member.userId === 8)!;
      expect(await repository.begin(7, { ...retained, expectedRoomRevision: fresh.expectedRoomRevision,
        expectedMemberRevision: fresh.expectedMemberRevision })).not.toBeNull();
    });
    it.each(["unrelated denial", "readmitted", "room replaced", "legacy key", "legacy marker"])("a historical operation cannot authorize %s through original or fresh assertions", async kind => {
      const operation = await repository.begin(7, input); expect(operation).not.toBeNull();
      if (kind === "unrelated denial" || kind === "legacy marker") await pool.query(
        "UPDATE phone11_plain_video_admission_members SET revision=gen_random_uuid() WHERE user_id=8");
      if (kind === "readmitted") await pool.query(
        "UPDATE phone11_plain_video_admission_members SET revoked_at=NULL,revision=gen_random_uuid() WHERE user_id=8");
      if (kind === "room replaced") await pool.query("UPDATE phone11_plain_video_admission_rooms SET revision=gen_random_uuid()");
      if (kind === "legacy key") await pool.query("UPDATE phone11_plain_video_eviction_operations SET idempotency_key=$1 WHERE id=$2", [
        `phone11_remove_${createHash("sha256").update(JSON.stringify([41, meetingId, "stable_target"])).digest("hex")}`, operation!.id]);
      expect(await repository.begin(7, input)).toBeNull(); expect(await repository.get(7, input)).toBeNull();
      expect((await repository.snapshot(7, meetingId, [41])).members.some(member => member.userId === 8)).toBe(false);
      const current = (await pool.query(`SELECT room.revision AS room_revision, member.revision AS member_revision
        FROM phone11_plain_video_admission_rooms room JOIN phone11_plain_video_admission_members member
          ON member.meeting_id=room.id AND member.tenant_id=room.tenant_id WHERE member.user_id=8`)).rows[0];
      const forgedFresh = { ...input, expectedRoomRevision: current.room_revision, expectedMemberRevision: current.member_revision };
      expect(await repository.begin(7, forgedFresh)).toBeNull(); expect(await repository.get(7, forgedFresh)).toBeNull();
      expect((await pool.query("SELECT 1 FROM phone11_plain_video_eviction_operations")).rowCount).toBe(1);
    });
    it("snapshot rechecks actual permission revoked while the member load was pending", async () => {
      let loaded!: () => void, resume!: () => void;
      const ready = new Promise<void>(resolve => { loaded = resolve; });
      const barrier = new Promise<void>(resolve => { resume = resolve; });
      const transaction = createPlainVideoEvictionPostgresTransaction(pool);
      const delayed = createMeetingHostEvictionRepository(fn => transaction(db => fn({ query: async (text: string, values?: unknown[]) => {
        const result = await db.query(text, values);
        if (typeof text === "string" && text.includes("LEFT JOIN phone11_plain_video_eviction_operations")) { loaded(); await barrier; }
        return result;
      } } as typeof db)));
      const pending = delayed.snapshot(7, meetingId, [41]); await ready;
      try {
        await pool.query("UPDATE phone11_chat_members SET can_start_meeting=false WHERE user_id=7");
      } finally { resume(); }
      expect(await pending).toEqual({ available: false, meetingId, members: [] });
    });
  },
);
