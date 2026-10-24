/** Runtime connections validate commissioned schema; they never create or migrate it. */
import type { Pool } from "pg";

// PostgreSQL built-in type OIDs, derived from the commissioned provisioning contract.
// text and varchar remain interchangeable, matching the existing schema preflight.
// Additional columns are allowed. A migration owns changes to this contract.
export const phoneProvisioningColumns = {
  "subscriber": {
    "id": 23,
    "username": 1043,
    "domain": 1043,
    "password": 1043,
    "ha1": 1043,
    "ha1b": 1043,
    "email_address": 1043,
    "rpid": 1043
  },
  "organizations": {
    "id": 23,
    "name": 1043,
    "plan": 1043,
    "created_at": 1184,
    "updated_at": 1184
  },
  "tenants": {
    "id": 23,
    "name": 1043,
    "plan": 1043,
    "status": 1043,
    "created_at": 1184,
    "updated_at": 1184
  },
  "extensions": {
    "id": 23,
    "org_id": 23,
    "tenant_id": 23,
    "user_id": 23,
    "extension_number": 1043,
    "display_name": 1043,
    "type": 1043,
    "sip_username": 1043,
    "sip_domain": 1043,
    "sip_password": 1043,
    "caller_id_name": 1043,
    "caller_id_number": 1043,
    "transport": 1043,
    "status": 1043,
    "voicemail_enabled": 16,
    "deleted_at": 1184,
    "created_at": 1184,
    "updated_at": 1184,
    "voicemail_owner_epoch": 2950,
    "first_name": 1043,
    "last_name": 1043
  },
  "user_extensions": {
    "id": 23,
    "user_id": 23,
    "extension_id": 23,
    "is_primary": 16,
    "created_at": 1184
  },
  "sip_accounts": {
    "id": 23,
    "tenant_id": 23,
    "org_id": 23,
    "extension_id": 23,
    "user_id": 23,
    "sip_username": 1043,
    "sip_domain": 1043,
    "ha1": 1043,
    "ha1b": 1043,
    "secret_ciphertext": 17,
    "secret_iv": 17,
    "secret_tag": 17,
    "dek_id": 1043,
    "transport_preference": 1043,
    "status": 1043,
    "last_registered_at": 1184,
    "last_registered_contact": 25,
    "deleted_at": 1184,
    "created_at": 1184,
    "updated_at": 1184
  },
  "did_numbers": {
    "id": 23,
    "org_id": 23,
    "tenant_id": 23,
    "number": 1043,
    "description": 25,
    "destination_type": 1043,
    "destination_value": 1043,
    "status": 1043,
    "created_at": 1184,
    "updated_at": 1184
  }
} as const;

const expectedColumns = Object.entries(phoneProvisioningColumns).flatMap(([table_name, columns]) =>
  Object.entries(columns).map(([column_name, type_oid]) => ({ table_name, column_name, type_oid })),
);

export async function assertPhoneProvisioningSchema(db: Pick<Pool, "query">): Promise<void> {
  const result = await db.query(`
    WITH expected AS (
      SELECT * FROM pg_catalog.jsonb_to_recordset($1::jsonb)
        AS x(table_name text, column_name text, type_oid oid)
    )
    SELECT expected.table_name, expected.column_name
    FROM expected
    LEFT JOIN pg_catalog.pg_namespace ns ON ns.nspname = 'public'
    LEFT JOIN pg_catalog.pg_class relation
      ON relation.relnamespace = ns.oid AND relation.relname = expected.table_name
    LEFT JOIN pg_catalog.pg_attribute attribute
      ON attribute.attrelid = relation.oid AND attribute.attname = expected.column_name
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
    WHERE relation.oid IS NULL OR relation.relkind <> 'r'
      OR pg_catalog.to_regclass(expected.table_name) IS DISTINCT FROM relation.oid
      OR attribute.attnum IS NULL
      OR (attribute.atttypid <> expected.type_oid
        AND NOT (expected.type_oid IN (25, 1043) AND attribute.atttypid IN (25, 1043)))
      OR attribute.attgenerated <> ''
  `, [JSON.stringify(expectedColumns)]);
  if (result.rows.length !== 0) {
    throw Object.assign(new Error("Phone provisioning schema is not ready. Apply the reviewed database migration."), {
      code: "PHONE_PROVISIONING_SCHEMA_UNAVAILABLE",
    });
  }
}
