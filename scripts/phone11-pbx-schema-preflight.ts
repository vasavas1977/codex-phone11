#!/usr/bin/env node
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { getPool } from "../server/pbx/db";

type ColumnSpec = {
  types: readonly string[];
  udtNames?: readonly string[];
  nullable?: boolean;
};

type TableSpec = Record<string, ColumnSpec>;

type PreflightClient = {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
};

type ForeignKeyRow = {
  valid_shape: boolean | null;
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
};

type PrimaryKeyRow = {
  table_name: string;
  columns: string[];
};

type TriggerRow = {
  table_name: string;
  table_schema: string;
  trigger_name: string;
  enabled: string;
  trigger_type: number;
  function_name: string;
  function_schema: string;
  volatility: string;
  function_config: string[] | null;
  update_columns: string;
  definition: string;
};

type RelationRow = {
  table_name: string;
  relkind: string;
  relpersistence: string;
  relispartition: boolean;
  has_inheritance: boolean;
};

type BasePrerequisiteRow = {
  tenant_column_ready: boolean | null;
  primary_keys_ready: boolean | null;
  tenant_fk_ready: boolean | null;
  origin_session_ready: boolean | null;
};

type RoutingIndexRow = {
  table_name: string;
  index_name: string;
  valid_shape: boolean | null;
};

const integer = ["integer"];
const text = ["text", "character varying"];
const boolean = ["boolean"];
const timestamp = ["timestamp with time zone"];
const bytes = ["bytea"];

export const baseSchema: Record<string, TableSpec> = {
  tenants: {
    id: { types: integer, nullable: false },
  },
  extensions: {
    id: { types: integer, nullable: false },
    tenant_id: { types: integer, nullable: false },
    extension_number: { types: text, nullable: false },
    display_name: { types: text },
    deleted_at: { types: timestamp },
  },
};

// Tables and columns read by phone.getConfig. Keep this separate from the
// advanced-routing migration check so a release can reject an incomplete
// provisioning schema even when its routing tables are otherwise compatible.
export const phoneConfigSchema: Record<string, TableSpec> = {
  tenant_memberships: {
    user_id: { types: integer }, tenant_id: { types: integer }, status: { types: text },
  },
  tenants: {
    id: { types: integer }, status: { types: text }, name: { types: text }, plan: { types: text },
  },
  extensions: {
    id: { types: integer }, org_id: { types: integer }, tenant_id: { types: integer },
    user_id: { types: integer }, extension_number: { types: text }, display_name: { types: text },
    type: { types: text }, sip_username: { types: text }, sip_domain: { types: text },
    sip_password: { types: text }, caller_id_name: { types: text }, caller_id_number: { types: text },
    transport: { types: text }, status: { types: text }, deleted_at: { types: timestamp },
  },
  user_extensions: {
    user_id: { types: integer }, extension_id: { types: integer }, is_primary: { types: boolean },
  },
  organizations: {
    id: { types: integer }, name: { types: text }, plan: { types: text },
  },
  sip_accounts: {
    id: { types: integer }, extension_id: { types: integer }, tenant_id: { types: integer },
    user_id: { types: integer }, sip_username: { types: text }, sip_domain: { types: text },
    ha1: { types: text }, ha1b: { types: text }, secret_ciphertext: { types: bytes },
    secret_iv: { types: bytes }, secret_tag: { types: bytes }, transport_preference: { types: text },
    status: { types: text }, deleted_at: { types: timestamp },
  },
  subscriber: {
    username: { types: text }, domain: { types: text }, password: { types: text },
    ha1: { types: text }, ha1b: { types: text },
  },
  did_numbers: {
    tenant_id: { types: integer }, destination_type: { types: text },
    destination_value: { types: text }, status: { types: text },
    number: { types: text }, description: { types: text },
  },
};

export const advancedSchema: Record<string, TableSpec> = {
  ivr_menus: {
    id: { types: integer, nullable: false },
    tenant_id: { types: integer, nullable: false },
    name: { types: text, nullable: false },
    description: { types: text },
    greeting_file: { types: text },
    greeting_tts: { types: text },
    timeout_ms: { types: integer, nullable: false },
    max_retries: { types: integer, nullable: false },
    digit_timeout_ms: { types: integer, nullable: false },
    invalid_sound: { types: text },
    exit_action: { types: text, nullable: false },
    exit_target: { types: text },
    is_active: { types: boolean, nullable: false },
    created_at: { types: timestamp, nullable: false },
    updated_at: { types: timestamp, nullable: false },
  },
  ivr_actions: {
    id: { types: integer, nullable: false },
    menu_id: { types: integer, nullable: false },
    digit: { types: text, nullable: false },
    action_type: { types: text, nullable: false },
    target: { types: text },
    description: { types: text },
    sort_order: { types: integer, nullable: false },
    created_at: { types: timestamp, nullable: false },
  },
  ring_groups: {
    id: { types: integer, nullable: false },
    tenant_id: { types: integer, nullable: false },
    name: { types: text, nullable: false },
    description: { types: text },
    extension: { types: text },
    strategy: { types: text, nullable: false },
    ring_timeout: { types: integer, nullable: false },
    caller_id_mode: { types: text, nullable: false },
    caller_id_name: { types: text },
    caller_id_number: { types: text },
    skip_busy: { types: boolean, nullable: false },
    skip_offline: { types: boolean, nullable: false },
    enable_pickup: { types: boolean, nullable: false },
    fallback_action: { types: text, nullable: false },
    fallback_target: { types: text },
    moh_file: { types: text },
    is_active: { types: boolean, nullable: false },
    created_at: { types: timestamp, nullable: false },
    updated_at: { types: timestamp, nullable: false },
  },
  ring_group_members: {
    ring_group_id: { types: integer, nullable: false },
    extension_id: { types: integer, nullable: false },
    priority: { types: integer, nullable: false },
    delay_seconds: { types: integer, nullable: false },
    is_active: { types: boolean, nullable: false },
    created_at: { types: timestamp, nullable: false },
  },
  call_queues: {
    id: { types: integer, nullable: false },
    tenant_id: { types: integer, nullable: false },
    name: { types: text, nullable: false },
    description: { types: text },
    extension: { types: text },
    strategy: { types: text, nullable: false },
    max_wait_time: { types: integer, nullable: false },
    max_callers: { types: integer, nullable: false },
    wrap_up_time: { types: integer, nullable: false },
    announce_position: { types: boolean, nullable: false },
    announce_frequency: { types: integer, nullable: false },
    moh_file: { types: text },
    join_announcement: { types: text },
    agent_announcement: { types: text },
    overflow_action: { types: text, nullable: false },
    overflow_target: { types: text },
    service_level_secs: { types: integer, nullable: false },
    record_calls: { types: boolean, nullable: false },
    is_active: { types: boolean, nullable: false },
    created_at: { types: timestamp, nullable: false },
    updated_at: { types: timestamp, nullable: false },
  },
  queue_agents: {
    queue_id: { types: integer, nullable: false },
    extension_id: { types: integer, nullable: false },
    priority: { types: integer, nullable: false },
    skills: { types: ["jsonb"], nullable: false },
    max_no_answer: { types: integer, nullable: false },
    is_logged_in: { types: boolean, nullable: false },
    last_call_at: { types: timestamp },
    created_at: { types: timestamp, nullable: false },
    updated_at: { types: timestamp, nullable: false },
  },
  queue_stats: {
    queue_id: { types: integer, nullable: false },
    interval_start: { types: timestamp, nullable: false },
    interval_end: { types: timestamp, nullable: false },
    offered_calls: { types: integer, nullable: false },
    answered_calls: { types: integer, nullable: false },
    abandoned_calls: { types: integer, nullable: false },
    overflowed_calls: { types: integer, nullable: false },
    service_level_calls: { types: integer, nullable: false },
    total_wait_seconds: { types: ["bigint"], nullable: false },
    total_talk_seconds: { types: ["bigint"], nullable: false },
  },
  time_conditions: {
    id: { types: integer, nullable: false },
    tenant_id: { types: integer, nullable: false },
    name: { types: text, nullable: false },
    description: { types: text },
    timezone: { types: text, nullable: false },
    match_action: { types: text, nullable: false },
    match_target: { types: text },
    nomatch_action: { types: text, nullable: false },
    nomatch_target: { types: text },
    created_at: { types: timestamp, nullable: false },
    updated_at: { types: timestamp, nullable: false },
  },
  time_condition_rules: {
    id: { types: integer, nullable: false },
    time_condition_id: { types: integer, nullable: false },
    day_of_week: { types: ["ARRAY"], udtNames: ["_int4"] },
    start_time: { types: ["time without time zone"] },
    end_time: { types: ["time without time zone"] },
    start_date: { types: ["date"] },
    end_date: { types: ["date"] },
    is_holiday: { types: boolean, nullable: false },
    label: { types: text },
    sort_order: { types: integer, nullable: false },
    created_at: { types: timestamp, nullable: false },
  },
};

const advancedExtensionColumns: TableSpec = {
  first_name: { types: text },
  last_name: { types: text },
};

const requiredForeignKeys = [
  ["ivr_menus", "tenant_id", "tenants", "id"],
  ["ivr_actions", "menu_id", "ivr_menus", "id"],
  ["ring_groups", "tenant_id", "tenants", "id"],
  ["ring_group_members", "ring_group_id", "ring_groups", "id"],
  ["ring_group_members", "extension_id", "extensions", "id"],
  ["call_queues", "tenant_id", "tenants", "id"],
  ["queue_agents", "queue_id", "call_queues", "id"],
  ["queue_agents", "extension_id", "extensions", "id"],
  ["queue_stats", "queue_id", "call_queues", "id"],
  ["time_conditions", "tenant_id", "tenants", "id"],
  ["time_condition_rules", "time_condition_id", "time_conditions", "id"],
] as const;

const requiredPrimaryKeys: Record<string, readonly string[]> = {
  ivr_menus: ["id"],
  ivr_actions: ["id"],
  ring_groups: ["id"],
  ring_group_members: ["ring_group_id", "extension_id"],
  call_queues: ["id"],
  queue_agents: ["queue_id", "extension_id"],
  queue_stats: ["queue_id", "interval_start"],
  time_conditions: ["id"],
  time_condition_rules: ["id"],
};

const requiredTriggers = [
  { table: "ring_group_members", name: "phone11_ring_group_member_tenant", functionName: "phone11_validate_advanced_pbx_member", type: 21 },
  { table: "queue_agents", name: "phone11_queue_agent_tenant", functionName: "phone11_validate_advanced_pbx_member", type: 21 },
  { table: "ring_groups", name: "phone11_ring_group_tenant_immutable", functionName: "phone11_advanced_pbx_tenant_immutable", type: 17, hasWhen: true },
  { table: "call_queues", name: "phone11_queue_tenant_immutable", functionName: "phone11_advanced_pbx_tenant_immutable", type: 17, hasWhen: true },
  { table: "extensions", name: "phone11_extension_member_tenant_move", functionName: "phone11_validate_advanced_pbx_extension_move", type: 17, hasWhen: true },
] as const;

function checkColumns(
  rows: ColumnRow[],
  schema: Record<string, TableSpec>,
): string[] {
  const issues: string[] = [];
  const columns = new Map(
    rows.map((row) => [`${row.table_name}.${row.column_name}`, row]),
  );
  for (const [table, expectedColumns] of Object.entries(schema)) {
    for (const [column, expected] of Object.entries(expectedColumns)) {
      const actual = columns.get(`${table}.${column}`);
      if (!actual) {
        issues.push(`${table}.${column}:missing`);
        continue;
      }
      if (!expected.types.includes(actual.data_type))
        issues.push(`${table}.${column}:type`);
      if (expected.udtNames && !expected.udtNames.includes(actual.udt_name))
        issues.push(`${table}.${column}:type`);
      if (expected.nullable === false && actual.is_nullable !== "NO")
        issues.push(`${table}.${column}:nullable`);
    }
  }
  return issues;
}

export type PbxSchemaPreflight = {
  event: "phone11.pbx.schema.preflight";
  readOnly: true;
  overall: "ready_for_migration" | "compatible" | "incompatible";
  base: { status: "compatible" | "incompatible"; issues: string[] };
  phoneConfig: { status: "compatible" | "incompatible"; issues: string[] };
  advanced: {
    status: "absent" | "compatible" | "incompatible";
    presentTables: string[];
    missingTables: string[];
    issues: string[];
  };
};

export async function inspectPbxSchema(
  client: PreflightClient,
): Promise<PbxSchemaPreflight> {
  const allTables = [...new Set([
    ...Object.keys(baseSchema),
    ...Object.keys(phoneConfigSchema),
    ...Object.keys(advancedSchema),
  ])];
  let transactionStarted = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionStarted = true;
    const columnsResult = await client.query<ColumnRow>(
      `
        SELECT table_name,column_name,data_type,udt_name,is_nullable
        FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name=ANY($1::text[])
        ORDER BY table_name,ordinal_position`,
      [allTables],
    );
    const relationsResult = await client.query<RelationRow>(
      `
        SELECT c.relname AS table_name,c.relkind AS relkind,
               c.relpersistence AS relpersistence,c.relispartition AS relispartition,
               EXISTS (SELECT 1 FROM pg_catalog.pg_inherits i
                 WHERE i.inhrelid=c.oid OR i.inhparent=c.oid) AS has_inheritance
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=pg_catalog.current_schema() AND c.relname=ANY($1::text[])`,
      [[...new Set([...Object.keys(baseSchema), ...Object.keys(advancedSchema)])]],
    );
    // One catalog snapshot; this observation does not reserve a future migration.
    const basePrerequisiteResult = await client.query<BasePrerequisiteRow>(
      `WITH base AS (
          SELECT e.oid AS extensions_oid,t.oid AS tenants_oid,
                 ei.attnum AS extension_id,ti.attnum AS tenants_id,et.attnum AS tenant_id,
                 et.attnotnull,et.attidentity,et.attgenerated
          FROM pg_catalog.pg_namespace n
          JOIN pg_catalog.pg_class e ON e.relnamespace=n.oid AND e.relname='extensions'
          JOIN pg_catalog.pg_class t ON t.relnamespace=n.oid AND t.relname='tenants'
          LEFT JOIN pg_catalog.pg_attribute ei ON ei.attrelid=e.oid AND ei.attname='id'
            AND NOT ei.attisdropped AND ei.atttypid='pg_catalog.int4'::pg_catalog.regtype
          LEFT JOIN pg_catalog.pg_attribute ti ON ti.attrelid=t.oid AND ti.attname='id'
            AND NOT ti.attisdropped AND ti.atttypid='pg_catalog.int4'::pg_catalog.regtype
          LEFT JOIN pg_catalog.pg_attribute et ON et.attrelid=e.oid AND et.attname='tenant_id'
            AND NOT et.attisdropped AND et.atttypid='pg_catalog.int4'::pg_catalog.regtype
          WHERE n.nspname=pg_catalog.current_schema()
        )
        SELECT b.tenant_id IS NOT NULL AND b.attnotnull
               AND b.attidentity='' AND b.attgenerated=''
               AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d
                 WHERE d.adrelid=b.extensions_oid AND d.adnum=b.tenant_id) AS tenant_column_ready,
               EXISTS (SELECT 1 FROM pg_catalog.pg_constraint p
                 JOIN pg_catalog.pg_index ix ON ix.indexrelid=p.conindid AND ix.indrelid=p.conrelid
                 WHERE p.conrelid=b.extensions_oid AND p.contype='p'
                   AND p.conkey=ARRAY[b.extension_id]::smallint[] AND p.convalidated AND NOT p.condeferrable
                   AND ix.indisunique AND ix.indimmediate AND ix.indisvalid AND ix.indisready AND ix.indislive
                   AND ix.indnkeyatts=1 AND ix.indexprs IS NULL AND ix.indpred IS NULL)
               AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint p
                 JOIN pg_catalog.pg_index ix ON ix.indexrelid=p.conindid AND ix.indrelid=p.conrelid
                 WHERE p.conrelid=b.tenants_oid AND p.contype='p'
                   AND p.conkey=ARRAY[b.tenants_id]::smallint[] AND p.convalidated AND NOT p.condeferrable
                   AND ix.indisunique AND ix.indimmediate AND ix.indisvalid AND ix.indisready AND ix.indislive
                   AND ix.indnkeyatts=1 AND ix.indexprs IS NULL AND ix.indpred IS NULL) AS primary_keys_ready,
               (SELECT count(*)=1 FROM pg_catalog.pg_constraint f
                 WHERE f.conrelid=b.extensions_oid AND f.contype='f' AND b.tenant_id=ANY(f.conkey))
               AND EXISTS (
                 SELECT 1 FROM pg_catalog.pg_constraint f
                 WHERE f.conrelid=b.extensions_oid AND f.contype='f'
                   AND f.confrelid=b.tenants_oid AND f.conkey=ARRAY[b.tenant_id]::smallint[]
                   AND f.confkey=ARRAY[b.tenants_id]::smallint[] AND f.convalidated
                   AND NOT f.condeferrable AND f.confupdtype='a' AND f.confdeltype='a'
                   AND (SELECT count(*)=4 AND pg_catalog.bool_and(
                     tr.tgisinternal AND tr.tgenabled IN ('O','A') AND pn.nspname='pg_catalog'
                     AND ((tr.tgrelid=b.extensions_oid AND tr.tgtype=5 AND fn.proname='RI_FKey_check_ins')
                       OR (tr.tgrelid=b.extensions_oid AND tr.tgtype=17 AND fn.proname='RI_FKey_check_upd')
                       OR (tr.tgrelid=b.tenants_oid AND tr.tgtype=9 AND fn.proname='RI_FKey_noaction_del')
                       OR (tr.tgrelid=b.tenants_oid AND tr.tgtype=17 AND fn.proname='RI_FKey_noaction_upd')))
                     FROM pg_catalog.pg_trigger tr
                     JOIN pg_catalog.pg_proc fn ON fn.oid=tr.tgfoid
                     JOIN pg_catalog.pg_namespace pn ON pn.oid=fn.pronamespace
                     WHERE tr.tgconstraint=f.oid)
               ) AS tenant_fk_ready,
               pg_catalog.current_setting('session_replication_role')='origin' AS origin_session_ready
        FROM base b`,
    );
    const routingIndexesResult = await client.query<RoutingIndexRow>(
      `
        SELECT required.table_name,required.index_name,
               idx.relkind='i' AND idx.relpersistence='p' AND NOT idx.relispartition
               AND ix.indrelid=tbl.oid AND ix.indisunique AND ix.indisvalid
               AND ix.indisready AND ix.indislive AND ix.indnkeyatts=2 AND ix.indnatts=2
               AND ix.indexprs IS NULL AND ix.indkey[0]=tenant_att.attnum
               AND ix.indkey[1]=extension_att.attnum
               AND pg_catalog.pg_get_expr(ix.indpred,ix.indrelid)='(extension IS NOT NULL)'
               AND am.amname='btree' AND ix.indoption::text='0 0' AS valid_shape
        FROM pg_catalog.pg_namespace n
        CROSS JOIN (VALUES
          ('ring_groups','ring_groups_tenant_extension'),
          ('call_queues','call_queues_tenant_extension')
        ) AS required(table_name,index_name)
        LEFT JOIN pg_catalog.pg_class tbl ON tbl.relnamespace=n.oid
          AND tbl.relname=required.table_name
        LEFT JOIN pg_catalog.pg_class idx ON idx.relnamespace=n.oid
          AND idx.relname=required.index_name
        LEFT JOIN pg_catalog.pg_index ix ON ix.indexrelid=idx.oid
        LEFT JOIN pg_catalog.pg_am am ON am.oid=idx.relam
        LEFT JOIN pg_catalog.pg_attribute tenant_att ON tenant_att.attrelid=tbl.oid
          AND tenant_att.attname='tenant_id' AND NOT tenant_att.attisdropped
        LEFT JOIN pg_catalog.pg_attribute extension_att ON extension_att.attrelid=tbl.oid
          AND extension_att.attname='extension' AND NOT extension_att.attisdropped
        WHERE n.nspname=pg_catalog.current_schema()`,
    );
    // A validated constraint is insufficient when its internal enforcement is disabled.
    const foreignKeysResult = await client.query<ForeignKeyRow>(
      `WITH required(table_name,column_name,foreign_table_name,foreign_column_name) AS (VALUES
          ('ivr_menus','tenant_id','tenants','id'),
          ('ivr_actions','menu_id','ivr_menus','id'),
          ('ring_groups','tenant_id','tenants','id'),
          ('ring_group_members','ring_group_id','ring_groups','id'),
          ('ring_group_members','extension_id','extensions','id'),
          ('call_queues','tenant_id','tenants','id'),
          ('queue_agents','queue_id','call_queues','id'),
          ('queue_agents','extension_id','extensions','id'),
          ('queue_stats','queue_id','call_queues','id'),
          ('time_conditions','tenant_id','tenants','id'),
          ('time_condition_rules','time_condition_id','time_conditions','id')
        ), bindings AS (
          SELECT required.*,child.oid AS child_oid,parent.oid AS parent_oid,
                 ca.attnum AS child_attnum,pa.attnum AS parent_attnum
          FROM required
          JOIN pg_catalog.pg_namespace n ON n.nspname=pg_catalog.current_schema()
          LEFT JOIN pg_catalog.pg_class child ON child.relnamespace=n.oid AND child.relname=required.table_name
          LEFT JOIN pg_catalog.pg_class parent ON parent.relnamespace=n.oid AND parent.relname=required.foreign_table_name
          LEFT JOIN pg_catalog.pg_attribute ca ON ca.attrelid=child.oid AND ca.attname=required.column_name AND NOT ca.attisdropped
          LEFT JOIN pg_catalog.pg_attribute pa ON pa.attrelid=parent.oid AND pa.attname=required.foreign_column_name AND NOT pa.attisdropped
        )
        SELECT b.table_name,b.column_name,b.foreign_table_name,b.foreign_column_name,
          (SELECT count(*)=1 FROM pg_catalog.pg_constraint f
           WHERE f.conrelid=b.child_oid AND f.contype='f' AND b.child_attnum=ANY(f.conkey))
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint f
            WHERE f.conrelid=b.child_oid AND f.confrelid=b.parent_oid AND f.contype='f'
              AND f.conkey=ARRAY[b.child_attnum]::smallint[] AND f.confkey=ARRAY[b.parent_attnum]::smallint[]
              AND f.convalidated AND NOT f.condeferrable AND NOT f.condeferred AND f.confmatchtype='s'
              AND f.confupdtype='a' AND f.confdeltype='c'
              AND (SELECT count(*)=4 AND count(DISTINCT (tr.tgrelid,tr.tgtype,fn.proname))=4
                AND pg_catalog.bool_and(tr.tgisinternal AND tr.tgenabled IN ('O','A')
                  AND NOT tr.tgdeferrable AND NOT tr.tginitdeferred AND tr.tgqual IS NULL
                  AND pn.nspname='pg_catalog'
                  AND ((tr.tgrelid=b.child_oid AND tr.tgconstrrelid=b.parent_oid AND tr.tgtype=5 AND fn.proname='RI_FKey_check_ins')
                    OR (tr.tgrelid=b.child_oid AND tr.tgconstrrelid=b.parent_oid AND tr.tgtype=17 AND fn.proname='RI_FKey_check_upd')
                    OR (tr.tgrelid=b.parent_oid AND tr.tgconstrrelid=b.child_oid AND tr.tgtype=9 AND fn.proname='RI_FKey_cascade_del')
                    OR (tr.tgrelid=b.parent_oid AND tr.tgconstrrelid=b.child_oid AND tr.tgtype=17 AND fn.proname='RI_FKey_noaction_upd')))
                FROM pg_catalog.pg_trigger tr
                JOIN pg_catalog.pg_proc fn ON fn.oid=tr.tgfoid
                JOIN pg_catalog.pg_namespace pn ON pn.oid=fn.pronamespace
                WHERE tr.tgconstraint=f.oid)
          ) AS valid_shape
        FROM bindings b`,
    );
    const primaryKeysResult = await client.query<PrimaryKeyRow>(
      `
        SELECT tc.table_name,array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position) AS columns
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_catalog=kcu.constraint_catalog AND tc.constraint_schema=kcu.constraint_schema
         AND tc.constraint_name=kcu.constraint_name
        WHERE tc.constraint_schema=current_schema() AND tc.constraint_type='PRIMARY KEY'
          AND tc.table_name=ANY($1::text[])
        GROUP BY tc.table_name`,
      [Object.keys(advancedSchema)],
    );
    const triggersResult = await client.query<TriggerRow>(
      `
        SELECT c.relname AS table_name,n.nspname AS table_schema,t.tgname AS trigger_name,
               t.tgenabled AS enabled,t.tgtype::integer AS trigger_type,
               p.proname AS function_name,pn.nspname AS function_schema,
               p.provolatile AS volatility,p.proconfig AS function_config,
               t.tgattr::text AS update_columns,
               pg_catalog.pg_get_triggerdef(t.oid) AS definition
        FROM pg_catalog.pg_trigger t
        JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
        JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
        WHERE n.nspname=current_schema() AND NOT t.tgisinternal
          AND c.relname=ANY($1::text[])`,
      [[...Object.keys(advancedSchema), "extensions"]],
    );

    const rows = columnsResult.rows;
    const baseIssues = checkColumns(rows, baseSchema);
    const prerequisite = basePrerequisiteResult.rows.length === 1
      ? basePrerequisiteResult.rows[0] : undefined;
    for (const [field, issue] of [
      ["tenant_column_ready", "extensions.tenant_id:prerequisite"],
      ["primary_keys_ready", "base:primary_keys"],
      ["tenant_fk_ready", "extensions.tenant_id:effective_foreign_key"],
      ["origin_session_ready", "base:session_replication_role"],
    ] as const) {
      if (prerequisite?.[field] !== true) baseIssues.push(issue);
    }
    const phoneConfigIssues = checkColumns(rows, phoneConfigSchema);
    const relations = new Map(relationsResult.rows.map((row) => [row.table_name, row]));
    const relationIssue = (table: string) => {
      const relation = relations.get(table);
      return !relation || relation.relkind !== "r" || relation.relpersistence !== "p" ||
        relation.relispartition || relation.has_inheritance;
    };
    for (const table of Object.keys(baseSchema)) {
      if (relationIssue(table)) baseIssues.push(`${table}:relation`);
    }
    const presentTables = Object.keys(advancedSchema).filter((table) =>
      relations.has(table) || rows.some((row) => row.table_name === table),
    );
    const missingTables = Object.keys(advancedSchema).filter(
      (table) => !presentTables.includes(table),
    );
    const advancedIssues: string[] = [];

    if (presentTables.length > 0) {
      for (const table of presentTables) {
        if (relationIssue(table)) advancedIssues.push(`${table}:relation`);
      }
      for (const index of routingIndexesResult.rows) {
        if (presentTables.includes(index.table_name) && index.valid_shape !== true)
          advancedIssues.push(`${index.index_name}:index`);
      }
      advancedIssues.push(...checkColumns(rows, advancedSchema));
      advancedIssues.push(
        ...checkColumns(rows, { extensions: advancedExtensionColumns }),
      );
      const foreignKeys = new Set(
        foreignKeysResult.rows.filter(row => row.valid_shape === true).map(
          (row) =>
            `${row.table_name}.${row.column_name}->${row.foreign_table_name}.${row.foreign_column_name}`,
        ),
      );
      for (const [
        table,
        column,
        foreignTable,
        foreignColumn,
      ] of requiredForeignKeys) {
        const key = `${table}.${column}->${foreignTable}.${foreignColumn}`;
        if (!foreignKeys.has(key))
          advancedIssues.push(`${table}.${column}:foreign_key`);
      }
      const primaryKeys = new Map(
        primaryKeysResult.rows.map((row) => [row.table_name, row.columns]),
      );
      for (const [table, expected] of Object.entries(requiredPrimaryKeys)) {
        if (JSON.stringify(primaryKeys.get(table)) !== JSON.stringify(expected))
          advancedIssues.push(`${table}:primary_key`);
      }
      const triggers = new Map(
        triggersResult.rows.map((row) => [`${row.table_name}.${row.trigger_name}`, row]),
      );
      for (const required of requiredTriggers) {
        const trigger = triggers.get(`${required.table}.${required.name}`);
        if (!trigger || !["O", "A"].includes(trigger.enabled) || trigger.trigger_type !== required.type ||
            trigger.function_name !== required.functionName || trigger.function_schema !== trigger.table_schema ||
            trigger.volatility !== "v" || trigger.update_columns !== "" ||
            !trigger.function_config?.includes("search_path=pg_catalog") ||
            ("hasWhen" in required && !/\bWHEN \(\(old\.tenant_id IS DISTINCT FROM new\.tenant_id\)\) EXECUTE FUNCTION /i.test(trigger.definition))) {
          advancedIssues.push(`${required.table}:${required.name}`);
        }
      }
    }

    const advancedStatus =
      presentTables.length === 0
        ? "absent"
        : missingTables.length === 0 && advancedIssues.length === 0
          ? "compatible"
          : "incompatible";
    const baseStatus = baseIssues.length === 0 ? "compatible" : "incompatible";
    const overall =
      baseStatus === "incompatible" || phoneConfigIssues.length > 0 || advancedStatus === "incompatible"
        ? "incompatible"
        : advancedStatus === "absent"
          ? "ready_for_migration"
          : "compatible";
    return {
      event: "phone11.pbx.schema.preflight",
      readOnly: true,
      overall,
      base: { status: baseStatus, issues: baseIssues },
      phoneConfig: {
        status: phoneConfigIssues.length === 0 ? "compatible" : "incompatible",
        issues: [...new Set(phoneConfigIssues)].sort(),
      },
      advanced: {
        status: advancedStatus,
        presentTables,
        missingTables,
        issues: [...new Set(advancedIssues)].sort(),
      },
    };
  } finally {
    if (transactionStarted) await client.query("ROLLBACK");
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
async function runPreflight() {
  const database = getPool();
  let client: PoolClient | undefined;
  try {
    client = await database.connect();
    const result = await inspectPbxSchema(client);
    console.info(JSON.stringify(result, null, 2));
    if (result.overall === "incompatible") process.exitCode = 2;
  } catch {
    console.error(
      "Phone11 PBX schema preflight failed. Check database connectivity, read permission, and schema compatibility. No credentials were logged.",
    );
    process.exitCode = 1;
  } finally {
    client?.release();
    await database.end();
  }
}

if (invokedPath === fileURLToPath(import.meta.url)) void runPreflight();
