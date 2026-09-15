import { TRPCError } from "@trpc/server";
import { query } from "./db";

/** An explicit assigned extension on this call is required; tenant membership alone is insufficient. */
export async function findOwnedRecording(userId: number, callUuid: string): Promise<{ recording_url: string | null; tenant_id: number } | null> {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !/^[a-zA-Z0-9_-]{1,128}$/.test(callUuid)) return null;
  try {
    const result = await query(
      `SELECT cr.recording_url, cr.tenant_id FROM call_records cr
       WHERE cr.call_uuid = $2 AND EXISTS (
         SELECT 1 FROM call_legs cl
         JOIN extensions e ON e.id = cl.extension_id AND e.tenant_id = cr.tenant_id
         JOIN user_extensions ue ON ue.extension_id = e.id AND ue.user_id = $1
         JOIN tenants t ON t.id = e.tenant_id AND t.status = 'active'
         WHERE cl.call_record_id = cr.id AND cl.tenant_id = cr.tenant_id
           AND e.status = 'active' AND e.deleted_at IS NULL
       ) LIMIT 1`, [userId, callUuid],
    );
    const record = result.rows[0] ?? null;
    if (!record) return null;
    // Legacy recordings retain their existing authorization. Once a cloud row
    // exists, its retention also gate every media request.
    const schema = await query("SELECT to_regclass('public.phone11_cloud_recordings') AS name");
    if (schema.rows[0]?.name) {
      const cloud = await query(`SELECT r.expires_at>clock_timestamp() AND r.recording_status='ready'
        AS allowed FROM phone11_cloud_recordings r
        LEFT JOIN phone11_recording_policies p ON p.tenant_id=r.tenant_id
        WHERE r.call_uuid=$1 AND r.tenant_id=$2`, [callUuid,record.tenant_id]);
      if (cloud.rows.length && cloud.rows[0].allowed !== true) return null;
    }
    return record;
  } catch (error) {
    if ((error as { code?: string })?.code === "42P01") {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Call recording storage is not available on this server" });
    }
    throw error;
  }
}
