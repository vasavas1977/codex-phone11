/** Minimum known maintained-vs-legacy schema blockers; not a full ACL proof. */
import { getPool } from "phone11-maintained/db";
export async function assertWorkerSchema(input: { chat: boolean; analysis: boolean; retention: boolean; capture: boolean }): Promise<void> {
  const result = await getPool().query({
    text: `WITH profile AS (SELECT (
        to_regclass('public.phone11_workspace_profile_status') IS NOT NULL
        AND to_regclass('public.phone11_workspace_profile_status_settings') IS NOT NULL
        AND EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=to_regclass('public.phone11_workspace_profile_status_settings') AND attname='dnd_enabled' AND NOT attisdropped)) AS supported),
      dnd_columns AS (SELECT * FROM (VALUES
        ('phone11_workspace_profile_status','tenant_id'),('phone11_workspace_profile_status','user_id'),
        ('phone11_workspace_profile_status','manual_availability'),('phone11_workspace_profile_status','manual_availability_expires_at'),
        ('phone11_workspace_profile_status_settings','tenant_id'),('phone11_workspace_profile_status_settings','enabled'),('phone11_workspace_profile_status_settings','dnd_enabled')) v(relation,column_name))
      SELECT
      (NOT $1::boolean OR NOT (SELECT supported FROM profile) OR
        (SELECT bool_and(CASE WHEN a.attnum IS NULL THEN false ELSE has_column_privilege(current_user,a.attrelid,a.attnum,'SELECT') END)
          FROM dnd_columns d LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=to_regclass('public.'||d.relation) AND a.attname=d.column_name AND NOT a.attisdropped)) AS approved_chat_scope,
      (NOT $2::boolean OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=to_regclass('public.phone11_cloud_recordings') AND attname='speaker_identity' AND atttypid=3802 AND NOT attisdropped AND has_column_privilege(current_user,attrelid,attnum,'UPDATE'))) AS retention_schema,
      (NOT $3::boolean OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=to_regclass('public.phone11_cloud_recordings') AND attname='capture_stop_requested_at' AND atttypid=1184 AND NOT attisdropped AND has_column_privilege(current_user,attrelid,attnum,'SELECT') AND has_column_privilege(current_user,attrelid,attnum,'UPDATE'))) AS capture_schema,
      (NOT ($2::boolean OR $3::boolean OR $4::boolean) OR
        (SELECT count(*) BETWEEN 1 AND 64 AND bool_and(has_column_privilege(current_user,attrelid,attnum,'SELECT')) FROM pg_catalog.pg_attribute WHERE attrelid=to_regclass('public.phone11_cloud_recordings') AND attnum>0 AND NOT attisdropped)) AS cloud_star_select`,
    values: [input.chat, input.retention, input.capture, input.analysis],
  });
  const keys = ["approved_chat_scope", "retention_schema", "capture_schema", "cloud_star_select"];
  if (result.rows.length !== 1 || Object.keys(result.rows[0]).length !== keys.length
    || keys.some(key => result.rows[0][key] !== true)) throw new Error("WORKER_SCHEMA_SCOPE_UNQUALIFIED");
}
