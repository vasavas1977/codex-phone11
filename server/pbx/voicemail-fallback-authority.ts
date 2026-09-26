import type { PoolClient } from "pg";
import { withTransaction } from "./db";

/** These fields must come from an authenticated, trusted proxy transaction. This
 * resolver does not authenticate the proxy or establish the SIP terminal cause. */
export interface LocalVoicemailFallbackInput {
  authenticatedCallerUsername: unknown;
  authenticatedCallerRealm: unknown;
  canonicalTargetUsername: unknown;
  canonicalTargetDomain: unknown;
  terminalCause: unknown;
}

export interface LocalVoicemailFallbackIdentity {
  tenantId: number;
  caller: { extensionId: number; userId: number; sipUsername: string; sipDomain: string };
  target: {
    extensionId: number;
    ownerUserId: number;
    ownerEpoch: string;
    extensionNumber: string;
    sipUsername: string;
    sipDomain: string;
  };
}

export type LocalVoicemailFallbackAuthority =
  | { allowed: false }
  | { allowed: true; identity: LocalVoicemailFallbackIdentity };

const DENIED: LocalVoicemailFallbackAuthority = Object.freeze({ allowed: false });
const sipUsername = /^[A-Za-z0-9_.+-]{1,64}$/;
const sipDomain = /^(?=.{1,128}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const extensionNumber = /^[1-9][0-9]{0,15}$/;
const epoch = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type ActiveAccount = {
  account_id: number;
  account_user_id: number | null;
  extension_id: number;
  extension_user_id: number | null;
  tenant_id: number;
  extension_type: string;
  extension_number: string;
  voicemail_enabled: boolean;
  voicemail_owner_epoch: string;
  sip_username: string;
  sip_domain: string;
};

async function uniqueActiveAccount(client: PoolClient, username: string, domain: string): Promise<ActiveAccount | null> {
  // Do not filter by membership or voicemail flag here: a second active URI is
  // globally ambiguous even when that account cannot itself use this feature.
  const found = await client.query<ActiveAccount>(`
    SELECT sa.id AS account_id, sa.user_id AS account_user_id,
           e.id AS extension_id, e.user_id AS extension_user_id,
           e.tenant_id, e.type AS extension_type, e.extension_number,
           e.voicemail_enabled, e.voicemail_owner_epoch,
           sa.sip_username, sa.sip_domain
      FROM sip_accounts sa
      JOIN extensions e ON e.id = sa.extension_id AND e.tenant_id = sa.tenant_id
      JOIN tenants t ON t.id = e.tenant_id
     WHERE sa.sip_username = $1 AND lower(sa.sip_domain) = $2
       AND sa.status = 'active' AND sa.deleted_at IS NULL
       AND e.status = 'active' AND e.deleted_at IS NULL
       AND t.status = 'active'
     LIMIT 2 FOR SHARE OF sa, e, t`, [username, domain]);
  return found.rows.length === 1 ? found.rows[0] : null;
}

function validOwner(account: ActiveAccount): boolean {
  const accountUser = Number(account.account_user_id);
  const extensionUser = Number(account.extension_user_id);
  return account.extension_type === "user" &&
    Number.isSafeInteger(accountUser) && accountUser > 0 &&
    Number.isSafeInteger(extensionUser) && extensionUser === accountUser &&
    Number.isSafeInteger(Number(account.extension_id)) && Number(account.extension_id) > 0 &&
    Number.isSafeInteger(Number(account.tenant_id)) && Number(account.tenant_id) > 0;
}

async function activeAssignedOwner(client: PoolClient, account: ActiveAccount): Promise<boolean> {
  const found = await client.query(`
    SELECT 1 FROM user_extensions ue
      JOIN tenant_memberships tm ON tm.user_id = ue.user_id
       AND tm.tenant_id = $3 AND tm.status = 'active'
     WHERE ue.extension_id = $1 AND ue.user_id = $2
     LIMIT 2 FOR SHARE OF ue, tm`,
  [account.extension_id, account.extension_user_id, account.tenant_id]);
  return found.rows.length === 1;
}

/** Resolve a local no-answer mailbox without a caller-supplied tenant ID.
 * No route, token, admission or SIP-state record is created. A later one-use
 * redemption must recheck the current owner epoch and assignment. */
export async function resolveLocalVoicemailFallbackAuthority(
  input: LocalVoicemailFallbackInput | null | undefined,
): Promise<LocalVoicemailFallbackAuthority> {
  if (!input) return DENIED;
  if (input.terminalCause !== "no-answer" && input.terminalCause !== "timeout") return DENIED;
  const callerUsername = input.authenticatedCallerUsername;
  const callerRealm = input.authenticatedCallerRealm;
  const targetUsername = input.canonicalTargetUsername;
  const targetDomain = input.canonicalTargetDomain;
  if (typeof callerUsername !== "string" || !sipUsername.test(callerUsername) ||
      typeof callerRealm !== "string" || !sipDomain.test(callerRealm) ||
      typeof targetUsername !== "string" || !sipUsername.test(targetUsername) ||
      typeof targetDomain !== "string" || !sipDomain.test(targetDomain) ||
      targetDomain !== targetDomain.toLowerCase()) return DENIED;

  return withTransaction(async client => {
    await client.query("SET LOCAL statement_timeout = '3000ms'");
    await client.query("SET LOCAL lock_timeout = '2000ms'");
    const caller = await uniqueActiveAccount(client, callerUsername, callerRealm.toLowerCase());
    if (!caller || !validOwner(caller) || !await activeAssignedOwner(client, caller)) return DENIED;
    const target = await uniqueActiveAccount(client, targetUsername, targetDomain);
    if (!target || Number(target.tenant_id) !== Number(caller.tenant_id) ||
        !validOwner(target) || target.voicemail_enabled !== true ||
        !extensionNumber.test(target.extension_number) ||
        typeof target.voicemail_owner_epoch !== "string" || !epoch.test(target.voicemail_owner_epoch) ||
        !await activeAssignedOwner(client, target)) return DENIED;
    return {
      allowed: true,
      identity: {
        tenantId: Number(caller.tenant_id),
        caller: {
          extensionId: Number(caller.extension_id),
          userId: Number(caller.extension_user_id),
          sipUsername: caller.sip_username,
          sipDomain: caller.sip_domain.toLowerCase(),
        },
        target: {
          extensionId: Number(target.extension_id),
          ownerUserId: Number(target.extension_user_id),
          ownerEpoch: target.voicemail_owner_epoch,
          extensionNumber: target.extension_number,
          sipUsername: target.sip_username,
          sipDomain: target.sip_domain.toLowerCase(),
        },
      },
    };
  });
}
