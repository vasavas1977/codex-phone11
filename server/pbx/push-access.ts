import { TRPCError } from "@trpc/server";
import { query } from "./db";

export interface PushOwner { userId: number; tenantId: number; extensionId: number; sipUri: string; }

export async function assignedPushOwners(sipUri: string, userId?: number): Promise<PushOwner[]> {
  const match = /^sip:([A-Za-z0-9_.+-]{1,128})@([A-Za-z0-9.-]{1,253})$/.exec(sipUri);
  if (!match) return [];
  const result = await query(
    `SELECT ue.user_id, e.tenant_id, e.id AS extension_id, sa.sip_username, sa.sip_domain
     FROM user_extensions ue JOIN extensions e ON e.id = ue.extension_id
     JOIN tenants t ON t.id = e.tenant_id AND t.status = 'active'
     JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = e.tenant_id
     WHERE sa.sip_username = $1 AND lower(sa.sip_domain) = $2
       AND ($3::integer IS NULL OR ue.user_id = $3)
       AND e.status = 'active' AND e.deleted_at IS NULL
       AND sa.status = 'active' AND sa.deleted_at IS NULL`,
    [match[1], match[2].toLowerCase(), userId ?? null],
  );
  return result.rows.map(row => ({ userId: Number(row.user_id), tenantId: Number(row.tenant_id), extensionId: Number(row.extension_id), sipUri: `sip:${row.sip_username}@${String(row.sip_domain).toLowerCase()}` }));
}

export async function requirePushOwner(userId: number, sipUri: string): Promise<PushOwner> {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new TRPCError({ code: "UNAUTHORIZED" });
  const owners = await assignedPushOwners(sipUri, userId);
  if (owners.length !== 1) throw new TRPCError({ code: "FORBIDDEN", message: "This phone account is not assigned to you" });
  return owners[0];
}
