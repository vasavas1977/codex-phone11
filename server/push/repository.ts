import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "../pbx/db";
import type { PushToken } from "../push-gateway";

type Transaction = <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;
export type SavedPushToken = PushToken & { revision: string };
const assignmentJoin = `JOIN phone11_auth_session auths ON auths.id=p.session_id AND auths."expiresAt">NOW()
 JOIN phone11_auth_identity ai ON ai.auth_user_id=auths."userId" AND ai.legacy_user_id=p.user_id AND ai.disabled_at IS NULL
 JOIN user_extensions ue ON ue.user_id = p.user_id AND ue.extension_id = p.extension_id
 JOIN extensions e ON e.id = p.extension_id AND e.tenant_id = p.tenant_id AND e.status = 'active' AND e.deleted_at IS NULL
 JOIN tenants t ON t.id = p.tenant_id AND t.status = 'active'
 JOIN sip_accounts sa ON sa.extension_id = p.extension_id AND sa.tenant_id = p.tenant_id
 AND sa.status = 'active' AND sa.deleted_at IS NULL
 AND ('sip:' || sa.sip_username || '@' || lower(sa.sip_domain)) = p.sip_uri`;
function fromRow(row: any): SavedPushToken {
  return { sessionId: row.session_id, owner: { userId: Number(row.user_id), tenantId: Number(row.tenant_id), extensionId: Number(row.extension_id), sipUri: row.sip_uri },
    sipUri: row.sip_uri, deviceId: row.device_id, platform: row.platform, bundleId: row.bundle_id,
    sandbox: row.sandbox, tokenType: row.token_type, token: row.token, appVersion: row.app_version ?? undefined,
    revision: row.revision, registeredAt: new Date(row.registered_at).getTime(), lastUsed: row.last_used ? new Date(row.last_used).getTime() : undefined };
}
/** No memory fallback: unavailable/missing database migration is a failed registration. */
export function createPushRepository(transaction: Transaction = withTransaction) {
  return {
    async put(token: PushToken) {
      if (!token.sessionId) throw new Error("An authenticated session is required");
      return transaction(async client => {
        const hash = createHash("sha256").update(token.token).digest("hex");
        // Serialize token handover and each owner's quota across all server processes.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`phone11-push-token:${token.platform}:${token.bundleId}:${!!token.sandbox}:${hash}`]);
        await client.query("SELECT pg_advisory_xact_lock(731102, $1)", [token.owner.userId]);
        const assignment = await client.query(`SELECT ue.user_id FROM user_extensions ue
          JOIN extensions e ON e.id = ue.extension_id JOIN tenants t ON t.id = e.tenant_id
          JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = e.tenant_id
          JOIN phone11_auth_identity ai ON ai.legacy_user_id=ue.user_id AND ai.disabled_at IS NULL
          JOIN phone11_auth_session auths ON auths."userId"=ai.auth_user_id AND auths.id=$5 AND auths."expiresAt">NOW()
          WHERE ue.user_id = $1 AND e.tenant_id = $2 AND e.id = $3
            AND ('sip:' || sa.sip_username || '@' || lower(sa.sip_domain)) = $4
            AND t.status = 'active' AND e.status = 'active' AND e.deleted_at IS NULL
            AND sa.status = 'active' AND sa.deleted_at IS NULL FOR SHARE OF ue, e, t, sa, ai, auths`,
          [token.owner.userId, token.owner.tenantId, token.owner.extensionId, token.sipUri, token.sessionId]);
        if (assignment.rows.length !== 1) throw new Error("This phone account is not assigned to you");
        // Expired/disabled sessions must not permanently consume this owner's quota.
        await client.query(`DELETE FROM phone11_push_devices p WHERE p.user_id=$1 AND NOT EXISTS (
          SELECT 1 FROM phone11_auth_session auths JOIN phone11_auth_identity ai ON ai.auth_user_id=auths."userId"
          WHERE auths.id=p.session_id AND auths."expiresAt">clock_timestamp()
            AND ai.legacy_user_id=p.user_id AND ai.disabled_at IS NULL)`, [token.owner.userId]);
        const identity = [token.owner.userId, token.owner.tenantId, token.owner.extensionId, token.deviceId, token.platform];
        const current = await client.query(`SELECT 1 FROM phone11_push_devices WHERE user_id=$1 AND tenant_id=$2 AND extension_id=$3 AND device_id=$4 AND platform=$5`, identity);
        const count = await client.query("SELECT count(*)::integer AS n FROM phone11_push_devices WHERE user_id=$1", [token.owner.userId]);
        if (!current.rows.length && Number(count.rows[0].n) >= 10) throw new Error("Too many registered devices");
        // A provider token must not keep receiving calls for a previous signed-in owner.
        // Keep this identity for an atomic UPDATE. A wake grant can follow a same-session
        // token refresh while provider-response revision protection still advances.
        await client.query(`DELETE FROM phone11_push_devices WHERE platform=$1 AND bundle_id=$2 AND sandbox=$3 AND token_hash=$4
          AND NOT (user_id=$5 AND tenant_id=$6 AND extension_id=$7 AND device_id=$8)`,
          [token.platform,token.bundleId,!!token.sandbox,hash,token.owner.userId,token.owner.tenantId,token.owner.extensionId,token.deviceId]);
        await client.query(`INSERT INTO phone11_push_devices
          (user_id,tenant_id,extension_id,device_id,platform,bundle_id,sandbox,token_type,token,token_hash,sip_uri,app_version,revision,session_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (user_id,tenant_id,extension_id,device_id,platform) DO UPDATE SET
          session_id=EXCLUDED.session_id,bundle_id=EXCLUDED.bundle_id,sandbox=EXCLUDED.sandbox,token_type=EXCLUDED.token_type,
          token=EXCLUDED.token,token_hash=EXCLUDED.token_hash,sip_uri=EXCLUDED.sip_uri,app_version=EXCLUDED.app_version,
          revision=EXCLUDED.revision,registered_at=clock_timestamp(),last_used=NULL`,
          [...identity, token.bundleId, !!token.sandbox, token.tokenType, token.token, hash, token.sipUri, token.appVersion ?? null, randomUUID(), token.sessionId]);
      });
    },
    async remove(userId: number, data: { deviceId: string; token: string; platform: string }, sessionId: string) {
      await transaction(client => client.query("DELETE FROM phone11_push_devices WHERE user_id=$1 AND device_id=$2 AND token=$3 AND platform=$4 AND session_id=$5", [userId, data.deviceId, data.token, data.platform, sessionId]));
    },
    async list(sipUri: string): Promise<SavedPushToken[]> {
      return transaction(async client => (await client.query(`SELECT DISTINCT p.* FROM phone11_push_devices p ${assignmentJoin} WHERE p.sip_uri=$1`, [sipUri])).rows.map(fromRow));
    },
    async isCurrent(token: SavedPushToken): Promise<boolean> {
      return transaction(async client => (await client.query(`SELECT 1 FROM phone11_push_devices p ${assignmentJoin} WHERE p.revision=$1 AND p.user_id=$2 AND p.tenant_id=$3 AND p.extension_id=$4`,
        [token.revision, token.owner.userId, token.owner.tenantId, token.owner.extensionId])).rows.length > 0);
    },
    async removeInvalid(token: SavedPushToken) {
      await transaction(client => client.query("DELETE FROM phone11_push_devices WHERE revision=$1 AND user_id=$2 AND tenant_id=$3 AND extension_id=$4", [token.revision, token.owner.userId, token.owner.tenantId, token.owner.extensionId]));
    },
    async markUsed(token: SavedPushToken) {
      await transaction(client => client.query("UPDATE phone11_push_devices SET last_used=clock_timestamp() WHERE revision=$1 AND user_id=$2 AND tenant_id=$3 AND extension_id=$4", [token.revision, token.owner.userId, token.owner.tenantId, token.owner.extensionId]));
    },
    async stats() {
      return transaction(async client => {
        const { rows: [r] } = await client.query(`SELECT count(DISTINCT user_id)::integer AS users, count(*)::integer AS devices,
          count(*) FILTER (WHERE platform='ios')::integer AS ios, count(*) FILTER (WHERE platform='android')::integer AS android FROM phone11_push_devices`);
        return { totalUsers: r.users, totalDevices: r.devices, byPlatform: { ios: r.ios, android: r.android } };
      });
    },
  };
}
export const pushRepository = createPushRepository();
