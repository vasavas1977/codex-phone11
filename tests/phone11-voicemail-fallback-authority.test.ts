import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { URL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as Pool | null, transactions: 0 }));
vi.mock("../server/pbx/db", () => ({
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    state.transactions++;
    const client = await state.pool!.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
}));

import { resolveLocalVoicemailFallbackAuthority } from "../server/pbx/voicemail-fallback-authority";

const socket = process.env.PHONE11_VOICEMAIL_TEST_SOCKET;
const schema = `phone11_fallback_${randomUUID().replaceAll("-", "")}`;
const request = {
  authenticatedCallerUsername: "3001",
  authenticatedCallerRealm: "phone11.invalid",
  canonicalTargetUsername: "1020",
  canonicalTargetDomain: "phone11.invalid",
  terminalCause: "no-answer",
};

describe("voicemail fallback early denial", () => {
  it.each(["busy", "cancelled", "answered", "486", "other", "NO_ANSWER"])(
    "denies %s before opening a database transaction", async cause => {
      const before = state.transactions;
      expect(await resolveLocalVoicemailFallbackAuthority({ ...request, terminalCause: cause }))
        .toEqual({ allowed: false });
      expect(state.transactions).toBe(before);
    },
  );

  it("denies malformed or noncanonical SIP identities before database access", async () => {
    const before = state.transactions;
    expect(await resolveLocalVoicemailFallbackAuthority(null)).toEqual({ allowed: false });
    for (const edit of [
      { authenticatedCallerUsername: "3001;tenant=12" },
      { authenticatedCallerRealm: "bad..domain" },
      { canonicalTargetDomain: "PHONE11.INVALID" },
      { canonicalTargetUsername: "1020@example.invalid" },
    ]) {
      expect(await resolveLocalVoicemailFallbackAuthority({ ...request, ...edit }))
        .toEqual({ allowed: false });
    }
    expect(state.transactions).toBe(before);
  });
});

describe.skipIf(!socket)("voicemail fallback authority against isolated PostgreSQL", () => {
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
        user_id integer REFERENCES users(id), extension_number text NOT NULL,
        type text NOT NULL DEFAULT 'user', status text NOT NULL,
        deleted_at timestamptz, voicemail_enabled boolean NOT NULL DEFAULT false
      );
      CREATE TABLE sip_accounts (
        id integer PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id),
        extension_id integer NOT NULL REFERENCES extensions(id), user_id integer REFERENCES users(id),
        sip_username text NOT NULL, sip_domain text NOT NULL, ha1 text,
        status text NOT NULL, deleted_at timestamptz
      );
      CREATE TABLE user_extensions (user_id integer NOT NULL, extension_id integer NOT NULL REFERENCES extensions(id));
      CREATE TABLE tenant_memberships (user_id integer NOT NULL, tenant_id integer NOT NULL REFERENCES tenants(id), status text NOT NULL);
    `);
    await state.pool.query(await readFile(new URL("../server/pbx/voicemail-storage-migration.sql", import.meta.url), "utf8"));
  });

  beforeEach(async () => {
    await state.pool!.query(`
      TRUNCATE voicemail_messages, voicemail_deposit_admissions, user_extensions,
        tenant_memberships, sip_accounts, extensions, tenants, users CASCADE;
      INSERT INTO users VALUES (17), (18), (19);
      INSERT INTO tenants VALUES (12, 'active'), (13, 'active');
      INSERT INTO extensions (id, tenant_id, user_id, extension_number, status, voicemail_enabled)
        VALUES (41, 12, 17, '3001', 'active', false),
               (42, 12, 18, '1020', 'active', true),
               (43, 13, 19, '4001', 'active', true);
      INSERT INTO sip_accounts (id, tenant_id, extension_id, user_id, sip_username, sip_domain, ha1, status)
        VALUES (51, 12, 41, 17, '3001', 'phone11.invalid', 'private-ha1', 'active'),
               (52, 12, 42, 18, '1020', 'phone11.invalid', 'private-ha1', 'active'),
               (53, 13, 43, 19, '4001', 'phone11.invalid', 'private-ha1', 'active');
      INSERT INTO user_extensions VALUES (17, 41), (18, 42), (19, 43);
      INSERT INTO tenant_memberships VALUES (17, 12, 'active'), (18, 12, 'active'), (19, 13, 'active');
    `);
  });

  afterAll(async () => {
    if (state.pool) {
      await state.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await state.pool.end();
    }
  });

  it("returns only the canonical same-tenant identity and current owner epoch", async () => {
    const result = await resolveLocalVoicemailFallbackAuthority(request);
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("expected authority");
    const epoch = (await state.pool!.query("SELECT voicemail_owner_epoch FROM extensions WHERE id=42"))
      .rows[0].voicemail_owner_epoch;
    expect(result.identity).toEqual({
      tenantId: 12,
      caller: { extensionId: 41, userId: 17, sipUsername: "3001", sipDomain: "phone11.invalid" },
      target: { extensionId: 42, ownerUserId: 18, ownerEpoch: epoch,
        extensionNumber: "1020", sipUsername: "1020", sipDomain: "phone11.invalid" },
    });
    expect(JSON.stringify(result)).not.toContain("private-ha1");
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("accepts only the other pilot-eligible timeout cause", async () => {
    const result = await resolveLocalVoicemailFallbackAuthority({ ...request, terminalCause: "timeout" });
    expect(result.allowed).toBe(true);
  });

  it("derives tenant exclusively from the authenticated SIP account", async () => {
    const forged = { ...request, tenantId: 13 };
    const result = await resolveLocalVoicemailFallbackAuthority(forged);
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.identity.tenantId).toBe(12);
  });

  it("denies a valid target in another tenant", async () => {
    expect(await resolveLocalVoicemailFallbackAuthority({
      ...request, canonicalTargetUsername: "4001",
    })).toEqual({ allowed: false });
  });

  it("denies globally duplicated caller or target SIP URIs, even if duplicate is ineligible", async () => {
    await state.pool!.query(`UPDATE sip_accounts SET sip_username='3001' WHERE id=53`);
    await state.pool!.query(`UPDATE tenant_memberships SET status='inactive' WHERE user_id=19 AND tenant_id=13`);
    expect(await resolveLocalVoicemailFallbackAuthority(request)).toEqual({ allowed: false });
    await state.pool!.query(`UPDATE sip_accounts SET sip_username='1020' WHERE id=53`);
    await state.pool!.query(`UPDATE extensions SET voicemail_enabled=false WHERE id=43`);
    expect(await resolveLocalVoicemailFallbackAuthority(request)).toEqual({ allowed: false });
  });

  it("denies revoked assignment, membership, or changed SIP credential owner", async () => {
    await state.pool!.query("DELETE FROM user_extensions WHERE extension_id=42");
    expect(await resolveLocalVoicemailFallbackAuthority(request)).toEqual({ allowed: false });
    await state.pool!.query("INSERT INTO user_extensions VALUES (18,42)");
    await state.pool!.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=18");
    expect(await resolveLocalVoicemailFallbackAuthority(request)).toEqual({ allowed: false });
    await state.pool!.query("UPDATE tenant_memberships SET status='active' WHERE user_id=18");
    await state.pool!.query("UPDATE sip_accounts SET user_id=17 WHERE id=52");
    expect(await resolveLocalVoicemailFallbackAuthority(request)).toEqual({ allowed: false });
    await state.pool!.query("UPDATE sip_accounts SET user_id=18 WHERE id=52");
    await state.pool!.query("UPDATE extensions SET user_id=19 WHERE id=42");
    expect(await resolveLocalVoicemailFallbackAuthority(request)).toEqual({ allowed: false });
  });

  it("denies an unauthoritative authenticated caller account", async () => {
    await state.pool!.query("UPDATE sip_accounts SET user_id=NULL WHERE id=51");
    expect(await resolveLocalVoicemailFallbackAuthority(request)).toEqual({ allowed: false });
    await state.pool!.query("UPDATE sip_accounts SET user_id=17 WHERE id=51");
    await state.pool!.query("DELETE FROM user_extensions WHERE extension_id=41");
    expect(await resolveLocalVoicemailFallbackAuthority(request)).toEqual({ allowed: false });
    await state.pool!.query("INSERT INTO user_extensions VALUES (17,41)");
    await state.pool!.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=17 AND tenant_id=12");
    expect(await resolveLocalVoicemailFallbackAuthority(request)).toEqual({ allowed: false });
  });

  it.each([
    ["inactive SIP account", "UPDATE sip_accounts SET status='inactive' WHERE id=52"],
    ["inactive extension", "UPDATE extensions SET status='inactive' WHERE id=42"],
    ["deleted extension", "UPDATE extensions SET deleted_at=now() WHERE id=42"],
    ["inactive tenant", "UPDATE tenants SET status='inactive' WHERE id=12"],
    ["non-user extension", "UPDATE extensions SET type='group' WHERE id=42"],
    ["disabled voicemail", "UPDATE extensions SET voicemail_enabled=false WHERE id=42"],
  ])("denies %s", async (_label, sql) => {
    await state.pool!.query(sql);
    expect(await resolveLocalVoicemailFallbackAuthority(request)).toEqual({ allowed: false });
  });

  it("returns a new epoch after voicemail is disabled and re-enabled", async () => {
    const before = await resolveLocalVoicemailFallbackAuthority(request);
    expect(before.allowed).toBe(true);
    await state.pool!.query("UPDATE extensions SET voicemail_enabled=false WHERE id=42");
    expect(await resolveLocalVoicemailFallbackAuthority(request)).toEqual({ allowed: false });
    await state.pool!.query("UPDATE extensions SET voicemail_enabled=true WHERE id=42");
    const after = await resolveLocalVoicemailFallbackAuthority(request);
    expect(after.allowed).toBe(true);
    if (before.allowed && after.allowed) expect(after.identity.target.ownerEpoch)
      .not.toBe(before.identity.target.ownerEpoch);
  });

  it("uses a rotated epoch and new owner only after complete reassignment", async () => {
    const prior = await resolveLocalVoicemailFallbackAuthority(request);
    if (!prior.allowed) throw new Error("expected prior authority");
    await state.pool!.query("UPDATE extensions SET user_id=19 WHERE id=42");
    expect(await resolveLocalVoicemailFallbackAuthority(request)).toEqual({ allowed: false });
    await state.pool!.query("UPDATE sip_accounts SET user_id=19 WHERE id=52");
    await state.pool!.query("DELETE FROM user_extensions WHERE extension_id=42");
    await state.pool!.query("INSERT INTO user_extensions VALUES (19,42)");
    await state.pool!.query("INSERT INTO tenant_memberships VALUES (19,12,'active')");
    const next = await resolveLocalVoicemailFallbackAuthority(request);
    expect(next.allowed).toBe(true);
    if (next.allowed) {
      expect(next.identity.target.ownerUserId).toBe(19);
      expect(next.identity.target.ownerEpoch).not.toBe(prior.identity.target.ownerEpoch);
    }
  });
});
