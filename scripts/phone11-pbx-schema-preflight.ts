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
  trigger_name: string;
};

const integer = ["integer"];
const text = ["text", "character varying"];
const boolean = ["boolean"];
const timestamp = ["timestamp with time zone"];

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
  ["ring_group_members", "phone11_ring_group_member_tenant"],
  ["queue_agents", "phone11_queue_agent_tenant"],
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
  const allTables = [
    ...Object.keys(baseSchema),
    ...Object.keys(advancedSchema),
  ];
  let transactionStarted = false;
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    transactionStarted = true;
    const columnsResult = await client.query<ColumnRow>(
      `
        SELECT table_name,column_name,data_type,udt_name,is_nullable
        FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name=ANY($1::text[])
        ORDER BY table_name,ordinal_position`,
      [allTables],
    );
    const foreignKeysResult = await client.query<ForeignKeyRow>(
      `
        SELECT tc.table_name,kcu.column_name,ccu.table_name AS foreign_table_name,
               ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_catalog=kcu.constraint_catalog AND tc.constraint_schema=kcu.constraint_schema
         AND tc.constraint_name=kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_catalog=ccu.constraint_catalog AND tc.constraint_schema=ccu.constraint_schema
         AND tc.constraint_name=ccu.constraint_name
        WHERE tc.constraint_schema=current_schema() AND tc.constraint_type='FOREIGN KEY'
          AND tc.table_name=ANY($1::text[])`,
      [Object.keys(advancedSchema)],
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
        SELECT DISTINCT event_object_table AS table_name,trigger_name
        FROM information_schema.triggers
        WHERE trigger_schema=current_schema() AND event_object_table=ANY($1::text[])`,
      [Object.keys(advancedSchema)],
    );

    const rows = columnsResult.rows;
    const baseIssues = checkColumns(rows, baseSchema);
    const presentTables = Object.keys(advancedSchema).filter((table) =>
      rows.some((row) => row.table_name === table),
    );
    const missingTables = Object.keys(advancedSchema).filter(
      (table) => !presentTables.includes(table),
    );
    const advancedIssues: string[] = [];

    if (presentTables.length > 0) {
      advancedIssues.push(...checkColumns(rows, advancedSchema));
      advancedIssues.push(
        ...checkColumns(rows, { extensions: advancedExtensionColumns }),
      );
      const foreignKeys = new Set(
        foreignKeysResult.rows.map(
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
      const triggers = new Set(
        triggersResult.rows.map(
          (row) => `${row.table_name}.${row.trigger_name}`,
        ),
      );
      for (const [table, trigger] of requiredTriggers) {
        if (!triggers.has(`${table}.${trigger}`))
          advancedIssues.push(`${table}:${trigger}`);
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
      baseStatus === "incompatible" || advancedStatus === "incompatible"
        ? "incompatible"
        : advancedStatus === "absent"
          ? "ready_for_migration"
          : "compatible";
    return {
      event: "phone11.pbx.schema.preflight",
      readOnly: true,
      overall,
      base: { status: baseStatus, issues: baseIssues },
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
