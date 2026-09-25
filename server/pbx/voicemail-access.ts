import { query } from "./db";
import { access, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { VoicemailStorageUnavailableError, requireVoicemailStorage } from "./cdr-processor";

/** Read-only checks. A writable directory does not prove the mount is durable. */
export async function voicemailStorageStatus() {
  let schemaReady = false;
  try {
    await requireVoicemailStorage();
    schemaReady = true;
  } catch (error) {
    if (!(error instanceof VoicemailStorageUnavailableError)) throw error;
  }

  let mediaDirectoryWritable = false;
  try {
    const directory = process.env.VOICEMAIL_PATH || "/opt/phone11ai/voicemail";
    const stat = await lstat(directory);
    if (stat.isDirectory()) {
      await access(directory, constants.W_OK);
      mediaDirectoryWritable = true;
    }
  } catch { /* Missing or unwritable paths remain unavailable. */ }

  return { schemaReady, mediaDirectoryWritable };
}

/** Mutations require the deposit-time owner and an active tenant membership. */
export async function markVoicemailRead(tenantId: number, ownerUserId: number, id: number): Promise<boolean> {
  const result = await query(
    `UPDATE voicemail_messages vm
     SET status = 'read', read_at = NOW()
     FROM tenant_memberships tm
     JOIN tenants t ON t.id = tm.tenant_id AND t.status = 'active'
     WHERE vm.id = $1 AND vm.tenant_id = $2 AND vm.status = 'new'
       AND vm.owner_user_id = $3
       AND tm.user_id = $3 AND tm.tenant_id = vm.tenant_id AND tm.status = 'active'
     RETURNING vm.id`,
    [id, tenantId, ownerUserId],
  );
  return result.rows.length === 1;
}

export async function deleteVoicemail(tenantId: number, ownerUserId: number, id: number): Promise<boolean> {
  const result = await query(
    `UPDATE voicemail_messages vm
     SET status = 'deleted', deleted_at = COALESCE(deleted_at, NOW())
     FROM tenant_memberships tm
     JOIN tenants t ON t.id = tm.tenant_id AND t.status = 'active'
     WHERE vm.id = $1 AND vm.tenant_id = $2 AND vm.status != 'deleted'
       AND vm.owner_user_id = $3
       AND tm.user_id = $3 AND tm.tenant_id = vm.tenant_id AND tm.status = 'active'
     RETURNING vm.id`,
    [id, tenantId, ownerUserId],
  );
  return result.rows.length === 1;
}

export async function countVoicemails(tenantId: number, ownerUserId: number, extension?: string) {
  const conditions = ["vm.tenant_id = $1", "vm.owner_user_id = $2", "vm.status != 'deleted'"];
  const values: Array<number | string> = [tenantId, ownerUserId];
  if (extension) {
    conditions.push("e.extension_number = $3");
    values.push(extension);
  }
  const result = await query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE vm.status = 'new') AS unread
     FROM voicemail_messages vm
     LEFT JOIN extensions e ON e.id = vm.extension_id AND e.tenant_id = vm.tenant_id
     JOIN tenant_memberships tm
       ON tm.user_id = vm.owner_user_id AND tm.tenant_id = vm.tenant_id AND tm.status = 'active'
     JOIN tenants t ON t.id = vm.tenant_id AND t.status = 'active'
     WHERE ${conditions.join(" AND ")}`,
    values,
  );
  return {
    total: Number(result.rows[0]?.total ?? 0),
    unread: Number(result.rows[0]?.unread ?? 0),
  };
}
