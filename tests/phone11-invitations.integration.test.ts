import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { URL } from "node:url";
import { applyAuthMigration, createExistingUserIdentity } from "../server/_core/phone11-auth-admin";
import { createPhone11Auth, readAuthConfig } from "../server/_core/phone11-auth";
import { InvitationService } from "../server/invitations/service";
import type { InvitationMailer } from "../server/invitations/mailer";

const socket = process.env.PHONE11_AUTH_TEST_SOCKET;
const suite = socket?.includes("/phone11-auth-test-") ? describe : describe.skip;

suite("Phone11 workspace invitations on real PostgreSQL", () => {
  let database: Pool;
  let service: InvitationService;
  let auth: ReturnType<typeof createPhone11Auth>;
  const delivered: Array<{ email: string; token: string }> = [];
  const mailer: InvitationMailer = { async send(message) {
    delivered.push({ email: message.email, token: new URLSearchParams(new URL(message.url).hash.slice(1)).get("token")! });
    return "test-delivery";
  } };
  const owner = 17;
  const admin = 18;
  const user = 19;
  const unassigned = 20;
  const tenantId = 41;
  let nextEmail = 0;
  let unassignedActor: { canonicalUserId: number; authUserId: string; sessionId: string };
  const email = () => `invite${++nextEmail}@example.test`;
  const tokenFor = (address: string) => delivered.findLast(item => item.email === address)!.token;

  beforeAll(async () => {
    const adminPool = new Pool({ host: socket, database: "phone11_auth_test", user: "phone11_test" });
    await adminPool.query("CREATE SCHEMA invitations_test");
    await adminPool.end();
    database = new Pool({ host: socket, database: "phone11_auth_test", user: "phone11_test", options: "-c search_path=invitations_test" });
    await database.query(`CREATE TABLE users (
      id SERIAL PRIMARY KEY, "openId" TEXT UNIQUE NOT NULL, name TEXT, email VARCHAR(320), "loginMethod" TEXT,
      role TEXT NOT NULL DEFAULT 'user', "createdAt" TIMESTAMPTZ DEFAULT now(),
      "updatedAt" TIMESTAMPTZ DEFAULT now(), "lastSignedIn" TIMESTAMPTZ DEFAULT now());
      CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE tenant_memberships (user_id INTEGER NOT NULL REFERENCES users(id),
        tenant_id INTEGER NOT NULL REFERENCES tenants(id), role TEXT NOT NULL, status TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (user_id,tenant_id));
      INSERT INTO users(id,"openId",name,email,role) VALUES
        (17,'owner','Owner','owner@example.test','admin'),
        (18,'admin','Admin','admin@example.test','user'),
        (19,'member','Member','member@example.test','user'),
        (20,'unassigned','Unassigned','unassigned@example.test','user'),
        (21,'spare','Spare','spare@example.test','user'),
        (22,'race','Race','race@example.test','user');
      INSERT INTO tenants VALUES (41,'Acme','active'),(42,'Other','active');
      INSERT INTO tenant_memberships(user_id,tenant_id,role,status) VALUES
        (17,41,'owner','active'),(18,41,'admin','active'),(19,41,'user','active'),
        (17,42,'owner','active');`);
    const config = readAuthConfig({
      NODE_ENV: "test", PHONE11_AUTH_BASE_URL: "http://127.0.0.1:8089",
      PHONE11_AUTH_SECRET: randomBytes(40).toString("base64url"),
    });
    await applyAuthMigration(database, config);
    auth = createPhone11Auth(database, config);
    await createExistingUserIdentity(database, { userId: owner, email: "owner@example.test", password: "owner-password-12345" });
    await createExistingUserIdentity(database, { userId: admin, email: "admin@example.test", password: "admin-password-12345" });
    await createExistingUserIdentity(database, { userId: user, email: "member@example.test", password: "member-password-12345" });
    await createExistingUserIdentity(database, { userId: unassigned, email: "unassigned@example.test", password: "unassigned-password-12345" });
    await createExistingUserIdentity(database, { userId: 21, email: "spare@example.test", password: "spare-password-12345" });
    await createExistingUserIdentity(database, { userId: 22, email: "race@example.test", password: "race-password-12345" });
    const unassignedAuth = (await database.query("SELECT auth_user_id FROM phone11_auth_identity WHERE legacy_user_id=$1", [unassigned])).rows[0].auth_user_id as string;
    const sessionId = randomUUID();
    await database.query(`INSERT INTO phone11_auth_session
      (id,"userId",token,"expiresAt","createdAt","updatedAt")
      VALUES ($1,$2,$3,now()+interval '1 day',now(),now())`, [sessionId, unassignedAuth, randomUUID()]);
    unassignedActor = { canonicalUserId: unassigned, authUserId: unassignedAuth, sessionId };
    await database.query(await readFile(new URL("../server/invitations/migration.sql", import.meta.url), "utf8"));
    service = new InvitationService(database, { enabled: true, origin: "http://127.0.0.1:8089", mailer });
    expect(await service.available()).toBe(true);
  }, 30_000);
  beforeEach(() => { delivered.length = 0; });
  afterAll(async () => { await database?.end(); });

  it("requires fresh tenant authority and prevents an admin issuing admin role", async () => {
    await expect(service.create(42, admin, email(), "user")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.create(41, admin, email(), "admin")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.create(41, user, email(), "user")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const invited = email();
    await service.create(41, admin, invited, "user");
    await database.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=18 AND tenant_id=41");
    await expect(service.create(41, admin, email(), "user")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.inspect(tokenFor(invited))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await database.query("UPDATE tenant_memberships SET status='active' WHERE user_id=18 AND tenant_id=41");
  });

  it("creates no access before acceptance, then atomically creates identity and membership once", async () => {
    const address = email();
    const invite = await service.create(41, owner, address, "user");
    expect(invite.deliveryStatus).toBe("sent");
    expect(JSON.stringify(invite)).not.toContain(tokenFor(address));
    const before = await database.query(`SELECT 1 FROM users WHERE email=$1`, [address]);
    expect(before.rowCount).toBe(0);
    expect(await service.inspect(tokenFor(address))).toMatchObject({ email: address, mode: "create_account", role: "user" });
    expect(await service.accept(tokenFor(address), undefined, "New Person", "secure-password-1234")).toEqual({ accepted: true });
    const complete = await database.query(`SELECT u.id,tm.role,i.auth_user_id FROM users u
      JOIN tenant_memberships tm ON tm.user_id=u.id
      JOIN phone11_auth_identity i ON i.legacy_user_id=u.id WHERE u.email=$1`, [address]);
    expect(complete.rows).toHaveLength(1);
    expect(complete.rows[0].role).toBe("user");
    expect((await database.query(`SELECT action FROM phone11_workspace_invitation_events
      WHERE invitation_id=$1 ORDER BY created_at`, [invite.id])).rows.map(row => row.action)).toEqual(["created", "accepted"]);
    const signedIn = await auth.api.signInEmail({ body: { email: address, password: "secure-password-1234" }, headers: new Headers() });
    expect(signedIn.user.id).toBe(complete.rows[0].auth_user_id);
    await expect(service.accept(tokenFor(address), undefined, "New Person", "secure-password-1234")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await database.query(`SELECT count(*)::int AS n FROM users WHERE email=$1`, [address])).rows[0].n).toBe(1);
  });

  it("requires exact mapped signed-in identity for existing accounts", async () => {
    const invite = await service.create(42, owner, "unassigned@example.test", "user");
    const token = tokenFor("unassigned@example.test");
    const credentialBefore = (await database.query(`SELECT a.password FROM phone11_auth_account a
      JOIN phone11_auth_identity i ON i.auth_user_id=a."userId" WHERE i.legacy_user_id=$1`, [unassigned])).rows[0].password;
    expect(await service.inspect(token)).toMatchObject({ mode: "sign_in" });
    await expect(service.accept(token, { ...unassignedActor, canonicalUserId: owner })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.accept(token, unassignedActor, undefined, "new-password-1234")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.accept(token, { ...unassignedActor, authUserId: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await database.query(`UPDATE phone11_auth_session SET "expiresAt"=clock_timestamp()-interval '1 second' WHERE id=$1`, [unassignedActor.sessionId]);
    await expect(service.accept(token, unassignedActor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await database.query(`UPDATE phone11_auth_session SET "expiresAt"=clock_timestamp()+interval '1 day' WHERE id=$1`, [unassignedActor.sessionId]);
    expect(await service.accept(token, unassignedActor)).toEqual({ accepted: true });
    expect((await database.query(`SELECT role FROM tenant_memberships WHERE tenant_id=42 AND user_id=$1`, [unassigned])).rows[0].role).toBe("user");
    const credentialAfter = (await database.query(`SELECT a.password FROM phone11_auth_account a
      JOIN phone11_auth_identity i ON i.auth_user_id=a."userId" WHERE i.legacy_user_id=$1`, [unassigned])).rows[0].password;
    expect(credentialAfter).toBe(credentialBefore);
    expect(invite.email).toBe("unassigned@example.test");
  });

  it("blocks cross-workspace create and redemption without changing an existing account", async () => {
    await expect(service.create(42, owner, "member@example.test", "user")).rejects.toMatchObject({
      code: "CONFLICT", message: "This account already belongs to another workspace; multi-workspace invitations are not available yet",
    });
    expect(delivered).toHaveLength(0);
    await database.query(`UPDATE tenant_memberships SET status='inactive' WHERE tenant_id=41 AND user_id=$1`, [user]);
    const invite = await service.create(42, owner, "member@example.test", "user");
    await database.query(`UPDATE tenant_memberships SET status='active' WHERE tenant_id=41 AND user_id=$1`, [user]);
    const token = tokenFor("member@example.test");
    const memberAuth = (await database.query(`SELECT auth_user_id FROM phone11_auth_identity WHERE legacy_user_id=$1`, [user])).rows[0].auth_user_id;
    const sessionId = randomUUID();
    await database.query(`INSERT INTO phone11_auth_session (id,"userId",token,"expiresAt","createdAt","updatedAt")
      VALUES ($1,$2,$3,now()+interval '1 day',now(),now())`, [sessionId, memberAuth, randomUUID()]);
    const originalRole = (await database.query(`SELECT role FROM tenant_memberships WHERE tenant_id=41 AND user_id=$1`, [user])).rows[0].role;
    await expect(service.accept(token, { canonicalUserId: user, authUserId: memberAuth, sessionId })).rejects.toMatchObject({
      code: "CONFLICT", message: "This account already belongs to another workspace; multi-workspace invitations are not available yet",
    });
    await expect(service.resend(42, owner, invite.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await database.query(`SELECT 1 FROM tenant_memberships WHERE tenant_id=42 AND user_id=$1`, [user])).rowCount).toBe(0);
    expect((await database.query(`SELECT role FROM tenant_memberships WHERE tenant_id=41 AND user_id=$1`, [user])).rows[0].role).toBe(originalRole);
    expect((await database.query(`SELECT status FROM phone11_workspace_invitations WHERE id=$1`, [invite.id])).rows[0].status).toBe("pending");
  });

  it("serializes concurrent cross-workspace acceptance for the same mapped account", async () => {
    const address = "race@example.test";
    await service.create(41, owner, address, "user");
    const firstToken = tokenFor(address);
    await service.create(42, owner, address, "user");
    const secondToken = tokenFor(address);
    const authUserId = (await database.query(`SELECT auth_user_id FROM phone11_auth_identity WHERE legacy_user_id=22`)).rows[0].auth_user_id as string;
    const sessionId = randomUUID();
    await database.query(`INSERT INTO phone11_auth_session (id,"userId",token,"expiresAt","createdAt","updatedAt")
      VALUES ($1,$2,$3,now()+interval '1 day',now(),now())`, [sessionId, authUserId, randomUUID()]);
    const actor = { canonicalUserId: 22, authUserId, sessionId };
    const outcomes = await Promise.allSettled([service.accept(firstToken, actor), service.accept(secondToken, actor)]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected").map(result =>
      (result as PromiseRejectedResult).reason.code)).toEqual(["CONFLICT"]);
    const memberships = await database.query(`SELECT tenant_id,role FROM tenant_memberships WHERE user_id=22 AND status='active'`);
    expect(memberships.rows).toHaveLength(1);
    expect(memberships.rows[0].role).toBe("user");
  });

  it("revocation, resend rotation, expiry and concurrent redemption fail safely", async () => {
    const address = email();
    const invite = await service.create(41, owner, address, "user");
    const oldToken = tokenFor(address);
    await service.resend(41, owner, invite.id);
    const newToken = tokenFor(address);
    expect(newToken).not.toBe(oldToken);
    await expect(service.inspect(oldToken)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const attempts = await Promise.allSettled([
      service.accept(newToken, undefined, "Race", "password-secure-1234"),
      service.accept(newToken, undefined, "Race", "password-secure-1234"),
    ]);
    expect(attempts.filter(a => a.status === "fulfilled")).toHaveLength(1);
    const revokedAddress = email();
    const revoked = await service.create(41, owner, revokedAddress, "user");
    await service.revoke(41, owner, revoked.id);
    await expect(service.accept(tokenFor(revokedAddress), undefined, "No", "password-secure-1234")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const expiredAddress = email();
    const expired = await service.create(41, owner, expiredAddress, "user");
    await database.query("UPDATE phone11_workspace_invitations SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.id]);
    await expect(service.inspect(tokenFor(expiredAddress))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rolls back canonical and auth creation when membership insert fails", async () => {
    const address = email();
    await service.create(41, owner, address, "user");
    await database.query(`CREATE FUNCTION reject_invitation_membership() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected membership failure'; END $$;
      CREATE TRIGGER reject_invitation_membership BEFORE INSERT ON tenant_memberships
      FOR EACH ROW EXECUTE FUNCTION reject_invitation_membership();`);
    try {
      await expect(service.accept(tokenFor(address), undefined, "Rollback", "password-secure-1234")).rejects.toThrow("injected membership failure");
      expect((await database.query("SELECT 1 FROM users WHERE email=$1", [address])).rowCount).toBe(0);
      expect((await database.query("SELECT 1 FROM phone11_auth_user WHERE email=$1", [address])).rowCount).toBe(0);
      expect(await service.inspect(tokenFor(address))).toMatchObject({ mode: "create_account" });
    } finally { await database.query("DROP TRIGGER reject_invitation_membership ON tenant_memberships; DROP FUNCTION reject_invitation_membership()"); }
  });

  it("records delivery failure without granting access, then rotates and retries", async () => {
    const address = email();
    const failing = new InvitationService(database, {
      enabled: true, origin: "http://127.0.0.1:8089",
      mailer: { async send() { throw new Error("provider unavailable"); } },
    });
    const issued = await failing.create(41, owner, address, "user");
    expect(issued.deliveryStatus).toBe("failed");
    expect(issued.deliveryError).toMatch(/retry/i);
    expect((await database.query("SELECT 1 FROM users WHERE email=$1", [address])).rowCount).toBe(0);
    const retried = await service.resend(41, owner, issued.id);
    expect(retried.deliveryStatus).toBe("sent");
    expect((await service.list(41, owner)).find(row => row.id === issued.id)?.deliveryStatus).toBe("sent");
  });

  it("fails closed against same-named malformed uniqueness indexes", async () => {
    await database.query(`ALTER INDEX phone11_users_normalized_email_unique RENAME TO phone11_users_normalized_email_original`);
    try {
      await database.query(`CREATE UNIQUE INDEX phone11_users_normalized_email_unique
        ON users (lower(trim(email)), id) WHERE email IS NOT NULL`);
      expect(await service.available()).toBe(false);
    } finally {
      await database.query(`DROP INDEX IF EXISTS phone11_users_normalized_email_unique`);
      await database.query(`ALTER INDEX phone11_users_normalized_email_original RENAME TO phone11_users_normalized_email_unique`);
    }
    await database.query(`ALTER INDEX phone11_workspace_invitations_one_pending_email
      RENAME TO phone11_workspace_invitations_one_pending_email_original`);
    try {
      await database.query(`CREATE UNIQUE INDEX phone11_workspace_invitations_one_pending_email
        ON phone11_workspace_invitations(tenant_id,email) WHERE status='pending' AND false`);
      expect(await service.available()).toBe(false);
    } finally {
      await database.query(`DROP INDEX IF EXISTS phone11_workspace_invitations_one_pending_email`);
      await database.query(`ALTER INDEX phone11_workspace_invitations_one_pending_email_original
        RENAME TO phone11_workspace_invitations_one_pending_email`);
    }
    expect(await service.available()).toBe(true);
  });

  it("rejects an invitation that expires while redemption waits on its row lock", async () => {
    const address = "spare@example.test";
    const issued = await service.create(42, owner, address, "user");
    await database.query(`UPDATE phone11_workspace_invitations
      SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1`, [issued.id]);
    const blocker = await database.connect();
    await blocker.query("BEGIN");
    try {
      await blocker.query(`SELECT 1 FROM phone11_workspace_invitations WHERE id=$1 FOR UPDATE`, [issued.id]);
      const attempt = service.accept(tokenFor(address));
      const rejection = expect(attempt).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await new Promise(resolve => setTimeout(resolve, 1300));
      await blocker.query("COMMIT");
      await rejection;
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
});
