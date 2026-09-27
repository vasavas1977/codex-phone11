import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { TRPCError } from "@trpc/server";
import type { Pool, PoolClient } from "pg";
import type { InvitationInspection, InvitationRole, InvitationSummary } from "../../shared/invitations";
import { invitationEmail, invitationURL, type InvitationConfig } from "./mailer";

const MAX_LIST = 100;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const INVITE_LIFETIME = "48 hours";

type InviteRow = {
  id: string; tenant_id: number; email: string; role: InvitationRole; issuer_user_id: number;
  expires_at: Date; status: "pending" | "accepted" | "revoked"; created_at: Date;
  delivery_status: "pending" | "sent" | "failed"; delivery_error: string | null;
  tenant_name?: string;
};
export type InvitationActor = { canonicalUserId: number; authUserId: string; sessionId: string };

function error(code: "PRECONDITION_FAILED" | "FORBIDDEN" | "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND", message: string): TRPCError {
  return new TRPCError({ code, message });
}
function invalid(): TRPCError { return error("BAD_REQUEST", "Invitation is unavailable or expired"); }
function digest(token: string): Buffer {
  if (!TOKEN_RE.test(token)) throw invalid();
  return createHash("sha256").update(token, "utf8").digest();
}
function summary(row: InviteRow): InvitationSummary {
  return {
    id: row.id, email: row.email, role: row.role,
    status: row.status === "pending" && new Date(row.expires_at).getTime() <= Date.now() ? "expired" : row.status,
    expiresAt: new Date(row.expires_at).toISOString(), createdAt: new Date(row.created_at).toISOString(),
    deliveryStatus: row.delivery_status, deliveryError: row.delivery_error,
  };
}
async function transaction<T>(database: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (cause) {
    await client.query("ROLLBACK");
    throw cause;
  } finally { client.release(); }
}
async function tenantLock(client: PoolClient, tenantId: number): Promise<void> {
  // Shared with tenant.updateMember, including issuer demotion/revocation.
  await client.query("SELECT pg_advisory_xact_lock($1)", [tenantId]);
}
async function emailLock(client: PoolClient, email: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 11012::bigint))", [`phone11:invitation-email:${email}`]);
}
async function audit(client: PoolClient, row: InviteRow, actorId: number, action: "created" | "resent" | "revoked" | "accepted"): Promise<void> {
  await client.query(`INSERT INTO phone11_workspace_invitation_events
    (id,invitation_id,tenant_id,actor_user_id,action) VALUES ($1,$2,$3,$4,$5)`,
    [randomUUID(), row.id, row.tenant_id, actorId, action]);
}
async function authority(client: PoolClient, tenantId: number, actorId: number, role?: InvitationRole): Promise<string> {
  const result = await client.query(
    `SELECT tm.role, t.name FROM tenant_memberships tm JOIN tenants t ON t.id=tm.tenant_id
     JOIN phone11_auth_identity issuer ON issuer.legacy_user_id=tm.user_id AND issuer.disabled_at IS NULL
     WHERE tm.tenant_id=$1 AND tm.user_id=$2 AND tm.status='active' AND t.status='active'
     FOR UPDATE OF tm, t, issuer`, [tenantId, actorId],
  );
  const actor = result.rows[0] as { role: string; name: string } | undefined;
  if (!actor || !["owner", "admin"].includes(actor.role) || role === "admin" && actor.role !== "owner") {
    throw error("FORBIDDEN", "Workspace administrator access is required");
  }
  return actor.name;
}
async function inviteById(client: PoolClient, tenantId: number, invitationId: string, lock = false): Promise<InviteRow> {
  const result = await client.query(
    `SELECT * FROM phone11_workspace_invitations WHERE tenant_id=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`,
    [tenantId, invitationId],
  );
  if (!result.rows[0]) throw error("NOT_FOUND", "Invitation not found");
  return result.rows[0] as InviteRow;
}
async function recipientState(client: PoolClient, email: string): Promise<{ mode: "create_account" | "sign_in"; userId?: number }> {
  const users = await client.query(`SELECT id FROM users WHERE lower(trim(email))=$1 LIMIT 2`, [email]);
  const auth = await client.query(`SELECT id FROM phone11_auth_user WHERE lower(trim(email))=$1 LIMIT 2`, [email]);
  if (users.rows.length > 1 || auth.rows.length > 1) throw invalid();
  if (!users.rows.length && !auth.rows.length) return { mode: "create_account" };
  if (users.rows.length !== 1 || auth.rows.length !== 1) throw invalid();
  const identity = await client.query(
    `SELECT 1 FROM phone11_auth_identity WHERE legacy_user_id=$1 AND auth_user_id=$2 AND disabled_at IS NULL`,
    [users.rows[0].id, auth.rows[0].id],
  );
  if (identity.rows.length !== 1) throw invalid();
  return { mode: "sign_in", userId: users.rows[0].id as number };
}
async function requireSingleWorkspaceRecipient(client: PoolClient, tenantId: number, userId: number): Promise<void> {
  // A canonical-user row lock conflicts with the FK's KEY SHARE lock on any
  // concurrent membership insert, including an insert from a different API.
  // Invitation accepts for the same email also share the email advisory lock.
  const canonical = await client.query(`SELECT id FROM users WHERE id=$1 FOR UPDATE`, [userId]);
  if (canonical.rows.length !== 1) throw invalid();
  const memberships = await client.query(`SELECT tenant_id,status FROM tenant_memberships
    WHERE user_id=$1 FOR UPDATE`, [userId]);
  if (memberships.rows.some(row => row.tenant_id !== tenantId && row.status === "active")) {
    throw error("CONFLICT", "This account already belongs to another workspace; multi-workspace invitations are not available yet");
  }
  if (memberships.rows.some(row => row.tenant_id === tenantId)) {
    throw error("CONFLICT", "This account already has a workspace membership");
  }
}
async function validPending(client: PoolClient, tokenHash: Buffer, lock: boolean): Promise<InviteRow> {
  const row = (await client.query(
    `SELECT i.*, t.name AS tenant_name FROM phone11_workspace_invitations i JOIN tenants t ON t.id=i.tenant_id
     WHERE i.token_digest=$1
     ${lock ? "FOR UPDATE OF i" : ""}`, [tokenHash],
  )).rows[0] as InviteRow | undefined;
  if (!row) throw invalid();
  // PostgreSQL can evaluate a volatile WHERE predicate before waiting for a
  // row lock. Check the database clock only after the lock has been obtained.
  const fresh = await client.query(`SELECT 1 FROM phone11_workspace_invitations
    WHERE id=$1 AND status='pending' AND expires_at>clock_timestamp()`, [row.id]);
  if (fresh.rows.length !== 1) throw invalid();
  if (!(await client.query(`SELECT 1 FROM tenants WHERE id=$1 AND status='active'`, [row.tenant_id])).rows.length) throw invalid();
  try { await authority(client, row.tenant_id, row.issuer_user_id, row.role); }
  catch { throw invalid(); }
  return row;
}

export class InvitationService {
  constructor(private readonly database: Pool, private readonly config: InvitationConfig) {}

  async available(): Promise<boolean> {
    if (!this.config.enabled || !this.config.origin || !this.config.mailer) return false;
    try {
      const result = await this.database.query(
        `SELECT to_regclass('phone11_workspace_invitations') IS NOT NULL AS ready,
                to_regclass('phone11_workspace_invitation_events') IS NOT NULL AS events_ready,
                to_regclass('phone11_auth_identity') IS NOT NULL AS identity_ready,
                (SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema()
                 AND table_name='phone11_workspace_invitations' AND column_name=ANY(ARRAY[
                  'id','tenant_id','email','role','issuer_user_id','token_digest','expires_at','status',
                  'accepted_user_id','accepted_at','revoked_at','delivery_status','delivery_error',
                  'provider_message_id','created_at','updated_at'])) AS column_count,
                (SELECT count(*) FROM pg_index ix
                   JOIN pg_class idx ON idx.oid=ix.indexrelid
                   JOIN pg_class tbl ON tbl.oid=ix.indrelid
                   JOIN pg_namespace ns ON ns.oid=tbl.relnamespace
                   WHERE ns.nspname=current_schema() AND ix.indisunique AND ix.indisvalid AND ix.indisready
                     AND ((idx.relname='phone11_users_normalized_email_unique' AND tbl.relname='users'
                           AND ix.indnkeyatts=1 AND ix.indnatts=1
                           AND pg_get_indexdef(ix.indexrelid,1,true)='lower(TRIM(BOTH FROM email))'
                           AND (pg_get_expr(ix.indpred,ix.indrelid)='(email IS NOT NULL)' OR ix.indpred IS NULL))
                       OR (idx.relname='phone11_workspace_invitations_one_pending_email'
                           AND tbl.relname='phone11_workspace_invitations' AND ix.indnkeyatts=2 AND ix.indnatts=2
                           AND pg_get_indexdef(ix.indexrelid,1,true)='tenant_id'
                           AND pg_get_indexdef(ix.indexrelid,2,true)='email'
                           AND pg_get_expr(ix.indpred,ix.indrelid)='(status = ''pending''::text)')
                       OR (idx.relname='phone11_workspace_invitations_token_digest_key'
                           AND tbl.relname='phone11_workspace_invitations' AND ix.indnkeyatts=1 AND ix.indnatts=1
                           AND pg_get_indexdef(ix.indexrelid,1,true)='token_digest' AND ix.indpred IS NULL))) AS index_count`,
      );
      return result.rows[0]?.ready === true && result.rows[0]?.events_ready === true && result.rows[0]?.identity_ready === true &&
        Number(result.rows[0]?.column_count) === 16 && Number(result.rows[0]?.index_count) === 3;
    } catch { return false; }
  }
  private async requireAvailable(): Promise<void> {
    if (!(await this.available())) throw error("PRECONDITION_FAILED", "Workspace invitations are unavailable");
  }

  async list(tenantId: number, actorId: number): Promise<InvitationSummary[]> {
    await this.requireAvailable();
    return transaction(this.database, async client => {
      await tenantLock(client, tenantId);
      await authority(client, tenantId, actorId);
      const result = await client.query(
        `SELECT * FROM phone11_workspace_invitations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT ${MAX_LIST}`,
        [tenantId],
      );
      return (result.rows as InviteRow[]).map(summary);
    });
  }

  private async deliver(row: InviteRow, token: string, workspaceName: string): Promise<InvitationSummary> {
    let status: "sent" | "failed" = "sent";
    let providerId: string | null = null;
    try {
      providerId = await this.config.mailer!.send({
        email: row.email, workspaceName, url: invitationURL(this.config.origin!, token),
        idempotencyKey: `phone11-invitation/${row.id}/${createHash("sha256").update(token).digest("hex")}`,
      });
    } catch { status = "failed"; }
    const result = await this.database.query(
      `UPDATE phone11_workspace_invitations SET delivery_status=$1, delivery_error=$2,
       provider_message_id=$3, updated_at=now() WHERE id=$4 AND token_digest=$5 AND status='pending' RETURNING *`,
      [status, status === "failed" ? "Email provider rejected or timed out; resend to retry" : null, providerId, row.id, digest(token)],
    );
    if (result.rows[0]) return summary(result.rows[0] as InviteRow);
    // A revoke or resend may win while the provider call is in flight. Report the
    // committed state and never imply the stale token is still redeemable.
    const current = await this.database.query(`SELECT * FROM phone11_workspace_invitations WHERE id=$1`, [row.id]);
    return summary(current.rows[0] as InviteRow);
  }

  async create(tenantId: number, actorId: number, emailInput: string, role: InvitationRole): Promise<InvitationSummary> {
    await this.requireAvailable();
    const email = invitationEmail(emailInput);
    const token = randomBytes(32).toString("base64url");
    const { row, workspaceName } = await transaction(this.database, async client => {
      await tenantLock(client, tenantId);
      await emailLock(client, email);
      const workspaceName = await authority(client, tenantId, actorId, role);
      const recipient = await recipientState(client, email); // Ambiguous or half-provisioned identity fails closed.
      if (recipient.userId) await requireSingleWorkspaceRecipient(client, tenantId, recipient.userId);
      await client.query(`UPDATE phone11_workspace_invitations SET status='revoked', revoked_at=now(), updated_at=now()
        WHERE tenant_id=$1 AND email=$2 AND status='pending'`, [tenantId, email]);
      const result = await client.query(`INSERT INTO phone11_workspace_invitations
        (id,tenant_id,email,role,issuer_user_id,token_digest,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,now()+interval '${INVITE_LIFETIME}') RETURNING *`,
        [randomUUID(), tenantId, email, role, actorId, digest(token)]);
      const row = result.rows[0] as InviteRow;
      await audit(client, row, actorId, "created");
      return { row, workspaceName };
    });
    return this.deliver(row, token, workspaceName);
  }

  async resend(tenantId: number, actorId: number, invitationId: string): Promise<InvitationSummary> {
    await this.requireAvailable();
    const token = randomBytes(32).toString("base64url");
    const { row, workspaceName } = await transaction(this.database, async client => {
      await tenantLock(client, tenantId);
      const current = await inviteById(client, tenantId, invitationId);
      await emailLock(client, current.email);
      const locked = await inviteById(client, tenantId, invitationId, true);
      const workspaceName = await authority(client, tenantId, actorId, locked.role);
      if (current.status !== "pending") throw error("CONFLICT", "Only a pending invitation can be resent");
      const recipient = await recipientState(client, current.email);
      if (recipient.userId) await requireSingleWorkspaceRecipient(client, tenantId, recipient.userId);
      const result = await client.query(`UPDATE phone11_workspace_invitations SET token_digest=$1,
        expires_at=now()+interval '${INVITE_LIFETIME}', issuer_user_id=$2, delivery_status='pending',
        delivery_error=NULL, provider_message_id=NULL, updated_at=now() WHERE id=$3 RETURNING *`,
        [digest(token), actorId, invitationId]);
      const row = result.rows[0] as InviteRow;
      await audit(client, row, actorId, "resent");
      return { row, workspaceName };
    });
    return this.deliver(row, token, workspaceName);
  }

  async revoke(tenantId: number, actorId: number, invitationId: string): Promise<InvitationSummary> {
    await this.requireAvailable();
    return transaction(this.database, async client => {
      await tenantLock(client, tenantId);
      await authority(client, tenantId, actorId);
      const row = await inviteById(client, tenantId, invitationId, true);
      if (row.status === "accepted") throw error("CONFLICT", "Accepted invitations cannot be revoked");
      if (row.status === "revoked") return summary(row);
      const result = await client.query(`UPDATE phone11_workspace_invitations SET status='revoked', revoked_at=now(), updated_at=now()
        WHERE id=$1 RETURNING *`, [invitationId]);
      const revoked = result.rows[0] as InviteRow;
      await audit(client, revoked, actorId, "revoked");
      return summary(revoked);
    });
  }

  async inspect(token: string): Promise<InvitationInspection> {
    await this.requireAvailable();
    const tokenHash = digest(token);
    return transaction(this.database, async client => {
      const row = await validPending(client, tokenHash, false);
      const recipient = await recipientState(client, row.email);
      return { workspaceName: row.tenant_name!, email: row.email, role: row.role,
        expiresAt: new Date(row.expires_at).toISOString(), mode: recipient.mode };
    });
  }

  async accept(token: string, actor?: InvitationActor, name?: string, password?: string): Promise<{ accepted: true }> {
    await this.requireAvailable();
    const tokenHash = digest(token);
    if (password !== undefined && (password.length < 12 || password.length > 128)) throw error("BAD_REQUEST", "Choose a password of 12 to 128 characters");
    // Avoid an expensive password hash for a syntactically valid but nonexistent
    // bearer token. The authoritative state is still rechecked under locks.
    const candidate = await this.database.query(
      `SELECT 1 FROM phone11_workspace_invitations WHERE token_digest=$1
       AND status='pending' AND expires_at>clock_timestamp()`, [tokenHash]);
    if (candidate.rows.length !== 1) throw invalid();
    // Password hashing must happen before any database lock. Existing accounts cannot replace credentials here.
    const passwordHash = password === undefined ? undefined : await hashPassword(password);
    return transaction(this.database, async client => {
      const initial = await client.query(`SELECT tenant_id,email FROM phone11_workspace_invitations WHERE token_digest=$1`, [tokenHash]);
      if (!initial.rows[0]) throw invalid();
      const tenantId = initial.rows[0].tenant_id as number;
      await tenantLock(client, tenantId);
      await emailLock(client, initial.rows[0].email as string);
      const row = await validPending(client, tokenHash, true);
      const recipient = await recipientState(client, row.email);
      let userId: number;
      if (recipient.mode === "sign_in") {
        if (!actor || actor.canonicalUserId !== recipient.userId || password !== undefined || name !== undefined) throw error("FORBIDDEN", "Sign in with the invited account to accept");
        const currentBridge = await client.query(`SELECT 1 FROM users u
          JOIN phone11_auth_identity i ON i.legacy_user_id=u.id AND i.disabled_at IS NULL
          JOIN phone11_auth_user a ON a.id=i.auth_user_id
          JOIN phone11_auth_session s ON s."userId"=a.id
          WHERE u.id=$1 AND i.auth_user_id=$2 AND s.id=$3
            AND lower(trim(u.email))=$4 AND lower(trim(a.email))=$4
          FOR SHARE OF u,i,a,s`, [actor.canonicalUserId, actor.authUserId, actor.sessionId, row.email]);
        if (currentBridge.rows.length !== 1) throw error("FORBIDDEN", "Invited account identity is unavailable");
        const liveSession = await client.query(`SELECT 1 FROM phone11_auth_session
          WHERE id=$1 AND "userId"=$2 AND "expiresAt">clock_timestamp()`, [actor.sessionId, actor.authUserId]);
        if (liveSession.rows.length !== 1) throw error("FORBIDDEN", "Invited account session has expired");
        userId = recipient.userId!;
        await requireSingleWorkspaceRecipient(client, tenantId, userId);
      } else {
        if (actor || !passwordHash || !name?.trim() || name.trim().length > 128) throw error("BAD_REQUEST", "Enter a name and password to create your account");
        const authId = randomUUID();
        const canonical = await client.query(`INSERT INTO users ("openId",name,email,"loginMethod",role)
          VALUES ($1,$2,$3,'phone11','user') RETURNING id`, [`phone11:user:${randomUUID()}`, name.trim(), row.email]);
        userId = canonical.rows[0].id as number;
        await client.query(`INSERT INTO phone11_auth_user (id,name,email,"emailVerified","createdAt","updatedAt")
          VALUES ($1,$2,$3,false,now(),now())`, [authId, name.trim(), row.email]);
        await client.query(`INSERT INTO phone11_auth_account
          (id,"accountId","providerId","userId",password,"createdAt","updatedAt")
          VALUES ($1,$2,'credential',$2,$3,now(),now())`, [randomUUID(), authId, passwordHash]);
        await client.query(`INSERT INTO phone11_auth_identity (auth_user_id,legacy_user_id) VALUES ($1,$2)`, [authId, userId]);
      }
      if (recipient.mode === "create_account") await requireSingleWorkspaceRecipient(client, tenantId, userId);
      await client.query(`INSERT INTO tenant_memberships (tenant_id,user_id,role,status)
        VALUES ($1,$2,$3,'active')`, [tenantId, userId, row.role]);
      await client.query(`UPDATE phone11_workspace_invitations SET status='accepted', accepted_user_id=$1,
        accepted_at=now(), updated_at=now() WHERE id=$2 AND status='pending'`, [userId, row.id]);
      await audit(client, row, userId, "accepted");
      return { accepted: true as const };
    });
  }
}
