import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { URL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("../server/pbx/db", () => ({
  query: (sql: string, values?: unknown[]) => state.pool!.query(sql, values),
}));

import { getVoicemails, requireVoicemailStorage, VoicemailStorageUnavailableError } from "../server/pbx/cdr-processor";
import { findOwnedVoicemail } from "../server/pbx/media-access";
import { countVoicemails, deleteVoicemail, markVoicemailRead } from "../server/pbx/voicemail-access";

const socket = process.env.PHONE11_VOICEMAIL_TEST_SOCKET;
const schema = `phone11_voicemail_${randomUUID().replaceAll("-", "")}`;

describe.skipIf(!socket)("voicemail isolated PostgreSQL", () => {
  beforeAll(async () => {
    state.pool = new Pool({
      host: socket,
      port: Number(process.env.PHONE11_VOICEMAIL_TEST_PORT ?? 55439),
      user: "phone11_test",
      database: "phone11_voicemail_test",
      ssl: false,
      options: `-c search_path=${schema}`,
    });
    await state.pool.query(`CREATE SCHEMA ${schema}`);
    await state.pool.query(`
      CREATE TABLE users (id integer PRIMARY KEY);
      CREATE TABLE tenants (id integer PRIMARY KEY, status text NOT NULL);
      CREATE TABLE extensions (
        id integer PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id),
        user_id integer REFERENCES users(id), extension_number text NOT NULL, status text NOT NULL,
        deleted_at timestamptz, voicemail_enabled boolean NOT NULL DEFAULT false
      );
      CREATE TABLE user_extensions (user_id integer NOT NULL, extension_id integer NOT NULL REFERENCES extensions(id));
      CREATE TABLE tenant_memberships (user_id integer NOT NULL, tenant_id integer NOT NULL REFERENCES tenants(id), status text NOT NULL);
    `);
    await state.pool.query(await readFile(new URL("../server/pbx/voicemail-storage-migration.sql", import.meta.url), "utf8"));
  });

  beforeEach(async () => {
    await state.pool!.query(`
      TRUNCATE voicemail_messages, voicemail_deposit_admissions, user_extensions, tenant_memberships, extensions, tenants, users CASCADE;
      INSERT INTO users VALUES (17), (18), (19);
      INSERT INTO tenants VALUES (12, 'active'), (13, 'active');
      INSERT INTO extensions (id, tenant_id, user_id, extension_number, status, voicemail_enabled)
        VALUES (42, 12, 17, '3001', 'active', true), (43, 13, 18, '3001', 'active', true);
      INSERT INTO user_extensions VALUES (17, 42), (18, 43);
      INSERT INTO tenant_memberships VALUES (17, 12, 'active'), (18, 13, 'active');
      INSERT INTO voicemail_deposit_admissions
        (message_uuid, tenant_id, extension_id, owner_user_id, owner_epoch)
        SELECT 'vm-9', 12, id, user_id, voicemail_owner_epoch FROM extensions WHERE id = 42;
      INSERT INTO voicemail_messages
        (id, tenant_id, extension_id, owner_user_id, owner_epoch, message_uuid, caller_number, storage_path, storage_size_bytes)
        SELECT 9, 12, id, user_id, voicemail_owner_epoch, 'vm-9', '+6620303001', '/private/12/vm-9.wav', 10
        FROM extensions WHERE id = 42;
    `);
  });

  afterAll(async () => {
    if (state.pool) {
      await state.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await state.pool.end();
    }
  });

  it("guards the extension tenant and active state at the database boundary", async () => {
    await expect(state.pool!.query(
      `INSERT INTO voicemail_messages
       (tenant_id, extension_id, owner_user_id, owner_epoch, message_uuid, storage_path, storage_size_bytes)
       SELECT 12, id, 17, voicemail_owner_epoch, 'foreign', '/private/12/foreign.wav', 10 FROM extensions WHERE id = 43`,
    )).rejects.toThrow("Voicemail extension is not active in this tenant");
    await state.pool!.query("UPDATE extensions SET status = 'suspended' WHERE id = 42");
    await expect(state.pool!.query(
      `INSERT INTO voicemail_messages
       (tenant_id, extension_id, owner_user_id, owner_epoch, message_uuid, storage_path, storage_size_bytes)
       SELECT 12, id, 17, voicemail_owner_epoch, 'inactive', '/private/12/inactive.wav', 10 FROM extensions WHERE id = 42`,
    )).rejects.toThrow("Voicemail extension is not active in this tenant");
    await state.pool!.query("UPDATE extensions SET status = 'active' WHERE id = 42");
    await expect(state.pool!.query(
      `INSERT INTO voicemail_messages
       (tenant_id, extension_id, owner_user_id, owner_epoch, message_uuid, storage_path, storage_size_bytes)
       SELECT 12, id, 19, voicemail_owner_epoch, 'wrong-owner', '/private/12/wrong-owner.wav', 10 FROM extensions WHERE id = 42`,
    )).rejects.toThrow("Voicemail extension is not active in this tenant");
    await expect(state.pool!.query(
      `INSERT INTO voicemail_messages
       (tenant_id, extension_id, owner_user_id, owner_epoch, message_uuid, storage_path, storage_size_bytes)
       SELECT 12, id, 17, voicemail_owner_epoch, 'no-admission', '/private/12/no-admission.wav', 10 FROM extensions WHERE id = 42`,
    )).rejects.toThrow("Voicemail deposit admission is missing or mismatched");
    expect((await state.pool!.query("SELECT id FROM voicemail_messages")).rows).toEqual([{ id: 9 }]);
  });

  it("requires both database ownership triggers before reporting storage ready", async () => {
    await expect(requireVoicemailStorage()).resolves.toBeUndefined();
    await state.pool!.query("ALTER TABLE voicemail_messages DISABLE TRIGGER phone11_voicemail_extension_tenant_guard");
    await expect(requireVoicemailStorage()).rejects.toBeInstanceOf(VoicemailStorageUnavailableError);
    await state.pool!.query("ALTER TABLE voicemail_messages ENABLE TRIGGER phone11_voicemail_extension_tenant_guard");
    await state.pool!.query("ALTER TABLE extensions DISABLE TRIGGER phone11_voicemail_owner_epoch_rotate");
    await expect(requireVoicemailStorage()).rejects.toBeInstanceOf(VoicemailStorageUnavailableError);
    await state.pool!.query("ALTER TABLE extensions ENABLE TRIGGER phone11_voicemail_owner_epoch_rotate");
  });

  it("rotates the admission epoch across a voicemail disable and re-enable", async () => {
    const before = (await state.pool!.query("SELECT voicemail_owner_epoch FROM extensions WHERE id=42")).rows[0].voicemail_owner_epoch;
    await state.pool!.query(`INSERT INTO voicemail_deposit_admissions
      (message_uuid,tenant_id,extension_id,owner_user_id,owner_epoch)
      VALUES('stale-toggle',12,42,17,$1)`, [before]);
    await state.pool!.query("UPDATE extensions SET voicemail_enabled=false WHERE id=42");
    await state.pool!.query("UPDATE extensions SET voicemail_enabled=true WHERE id=42");
    const after = (await state.pool!.query("SELECT voicemail_owner_epoch FROM extensions WHERE id=42")).rows[0].voicemail_owner_epoch;
    expect(after).not.toBe(before);
    await expect(state.pool!.query(`INSERT INTO voicemail_messages
      (tenant_id,extension_id,owner_user_id,owner_epoch,message_uuid,storage_path,storage_size_bytes)
      VALUES(12,42,17,$1,'stale-toggle','/private/12/stale-toggle.wav',10)`, [before]))
      .rejects.toThrow("Voicemail extension is not active in this tenant");
  });

  it("limits list and playback to an active assigned member of the same tenant", async () => {
    expect((await getVoicemails(12, 17)).map(row => row.id)).toEqual([9]);
    expect(await getVoicemails(13, 17)).toEqual([]);
    expect(await getVoicemails(12, 18)).toEqual([]);
    expect(await findOwnedVoicemail(18, 9)).toBeNull();
    expect(await findOwnedVoicemail(17, 9)).toEqual({ tenant_id: 12, storage_path: "/private/12/vm-9.wav" });
    await state.pool!.query("UPDATE tenant_memberships SET status = 'suspended' WHERE user_id = 17");
    expect(await getVoicemails(12, 17)).toEqual([]);
    expect(await findOwnedVoicemail(17, 9)).toBeNull();
  });

  it("keeps old voicemail with its deposit-time owner after reassignment", async () => {
    const oldEpoch = (await state.pool!.query("SELECT voicemail_owner_epoch FROM extensions WHERE id = 42")).rows[0].voicemail_owner_epoch;
    await state.pool!.query("DELETE FROM user_extensions WHERE extension_id = 42");
    await state.pool!.query("INSERT INTO user_extensions VALUES (19, 42)");
    await state.pool!.query("INSERT INTO tenant_memberships VALUES (19, 12, 'active')");
    await state.pool!.query("UPDATE extensions SET user_id = 19 WHERE id = 42");
    const newEpoch = (await state.pool!.query("SELECT voicemail_owner_epoch FROM extensions WHERE id = 42")).rows[0].voicemail_owner_epoch;
    expect(newEpoch).not.toBe(oldEpoch);
    expect((await getVoicemails(12, 17)).map(row => row.id)).toEqual([9]);
    expect(await findOwnedVoicemail(17, 9)).toEqual({ tenant_id: 12, storage_path: "/private/12/vm-9.wav" });
    expect(await getVoicemails(12, 19)).toEqual([]);
    expect(await findOwnedVoicemail(19, 9)).toBeNull();
    expect(await countVoicemails(12, 19)).toEqual({ total: 0, unread: 0 });
    expect(await markVoicemailRead(12, 19, 9)).toBe(false);
    expect(await deleteVoicemail(12, 19, 9)).toBe(false);
    expect(await countVoicemails(12, 17)).toEqual({ total: 1, unread: 1 });
    expect(await markVoicemailRead(12, 17, 9)).toBe(true);
    expect(await countVoicemails(12, 17)).toEqual({ total: 1, unread: 0 });
    expect(await deleteVoicemail(12, 17, 9)).toBe(true);
    expect(await findOwnedVoicemail(17, 9)).toBeNull();
    expect(await countVoicemails(12, 17)).toEqual({ total: 0, unread: 0 });
  });

  it("denies read and delete to a foreign tenant or inactive member", async () => {
    expect(await markVoicemailRead(13, 17, 9)).toBe(false);
    expect(await deleteVoicemail(13, 17, 9)).toBe(false);
    expect(await markVoicemailRead(12, 18, 9)).toBe(false);
    expect(await deleteVoicemail(12, 18, 9)).toBe(false);
    await state.pool!.query("UPDATE tenant_memberships SET status = 'suspended' WHERE user_id = 17");
    expect(await markVoicemailRead(12, 17, 9)).toBe(false);
    expect(await deleteVoicemail(12, 17, 9)).toBe(false);
    expect((await state.pool!.query("SELECT status, read_at, deleted_at FROM voicemail_messages WHERE id = 9")).rows[0])
      .toEqual({ status: "new", read_at: null, deleted_at: null });
  });

  it("serializes pre-record admission with a concurrent owner reassignment", async () => {
    const updater = await state.pool!.connect();
    const admitter = await state.pool!.connect();
    try {
      await updater.query("BEGIN");
      await updater.query("UPDATE extensions SET user_id = 19 WHERE id = 42");
      let settled = false;
      const admission = admitter.query("SELECT user_id, voicemail_owner_epoch FROM extensions WHERE id = 42 FOR SHARE")
        .then(result => { settled = true; return result; });
      await new Promise(resolve => setTimeout(resolve, 35));
      expect(settled).toBe(false);
      await updater.query("COMMIT");
      const result = await admission;
      expect(result.rows[0].user_id).toBe(19);
      expect(result.rows[0].voicemail_owner_epoch).not.toBeNull();
    } finally {
      await updater.query("ROLLBACK").catch(() => undefined);
      updater.release();
      admitter.release();
    }
  });
});
