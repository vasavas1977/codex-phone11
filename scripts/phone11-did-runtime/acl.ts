/** Exact qualified DID read scope. No role/grant/schema mutation. */
import { getPool } from "phone11-maintained/db";
export const didColumns = Object.freeze({
  phone_numbers: ["number_e164", "status", "deleted_at", "tenant_id", "assigned_route_type", "assigned_route_id"],
  tenants: ["id", "status"],
  extensions: ["id", "tenant_id", "extension_number", "status", "deleted_at"],
  sip_accounts: ["extension_id", "tenant_id", "sip_username", "sip_domain", "status", "deleted_at"],
  ivr_menus: ["id", "tenant_id", "is_active"], ring_groups: ["id", "tenant_id", "is_active"],
  call_queues: ["id", "tenant_id", "is_active"], time_conditions: ["id", "tenant_id"],
});
export async function attestDidReadScope(): Promise<void> {
  const result = await getPool().query({
    text: `WITH expected AS (SELECT e.key AS relation,jsonb_array_elements_text(e.value) AS attribute FROM jsonb_each($1::jsonb)e),
      columns AS (SELECT c.oid,c.relname,a.attnum,a.attname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname='public' AND c.relkind IN('r','p','v','m','f'))
    SELECT
      (SELECT count(*)=8 AND bool_and(c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_rewrite w WHERE w.ev_class=c.oid)) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN(SELECT DISTINCT relation FROM expected)) AS relations,
      NOT EXISTS(SELECT 1 FROM expected e WHERE NOT EXISTS(SELECT 1 FROM columns c WHERE c.relname=e.relation AND c.attname=e.attribute)) AS expected_columns,
      (SELECT coalesce(bool_and(has_column_privilege(current_user,c.oid,c.attnum,'SELECT')=EXISTS(SELECT 1 FROM expected e WHERE e.relation=c.relname AND e.attribute=c.attname) AND NOT has_column_privilege(current_user,c.oid,c.attnum,'INSERT,UPDATE,REFERENCES')),false) FROM columns c) AS columns,
      NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p','v','m','f') AND has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER')) AS tables,
      NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S' AND has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE')) AS sequences,
      NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS definer`,
    values: [JSON.stringify(didColumns)],
  });
  const keys = ["relations", "expected_columns", "columns", "tables", "sequences", "definer"];
  if (result.rows.length !== 1 || Object.keys(result.rows[0]).length !== keys.length
    || keys.some(key => result.rows[0][key] !== true)) throw new Error("DID_READ_SCOPE_REFUSED");
}
