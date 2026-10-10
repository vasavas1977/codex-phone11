#!/usr/bin/env node
// Read-only operator utility for a protected clone. It is intentionally not
// imported by the server and never reads or executes the migration SQL file.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Pool, type QueryResult, type QueryResultRow } from "pg";

export const DATABASE_URL_ENV = "PHONE11_PLAIN_VIDEO_ADMISSION_DATABASE_URL";

type ColumnSpec = {
  types: readonly string[];
  nullable?: boolean;
};

type SchemaSpec = Record<string, Record<string, ColumnSpec>>;

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
  is_nullable: "YES" | "NO";
};

type TableRow = { table_name: string };
type IndexRow = { indexname: string; tablename: string; indexdef: string };
type ForeignKeyRow = {
  constraint_oid: string;
  local_schema: string;
  table_name: string;
  columns: string[];
  foreign_schema: string;
  foreign_table_name: string;
  foreign_columns: string[];
};
type PrimaryKeyRow = { table_name: string; columns: string[] };
type TriggerRow = {
  table_name: string;
  trigger_name: string;
  trigger_type: number;
  enabled: string;
  trigger_columns: string;
  has_when: boolean;
  argument_count: number;
  function_oid: string;
};
type RoutineRow = {
  routine_oid: string;
  routine_name: string;
  language_name: string;
  return_type: string;
  argument_count: number;
  security_definer: boolean;
  has_config: boolean;
  source: string;
};

const integer = ["integer"];
const text = ["text", "character varying"];
const uuid = ["uuid"];
const timestamp = ["timestamp with time zone"];

/** Existing tables and columns required by the plain-video resolver and FKs. */
export const prerequisiteSchema: SchemaSpec = {
  users: {
    id: { types: integer, nullable: false },
  },
  tenants: {
    id: { types: integer, nullable: false },
    status: { types: text, nullable: false },
  },
  tenant_memberships: {
    user_id: { types: integer, nullable: false },
    tenant_id: { types: integer, nullable: false },
    status: { types: text, nullable: false },
  },
  phone11_auth_identity: {
    auth_user_id: { types: text, nullable: false },
    legacy_user_id: { types: integer, nullable: false },
    disabled_at: { types: timestamp },
  },
};

export const targetSchema: SchemaSpec = {
  phone11_plain_video_admission_rooms: {
    id: { types: uuid, nullable: false },
    tenant_id: { types: integer, nullable: false },
    state: { types: text, nullable: false },
    revision: { types: uuid, nullable: false },
    ended_at: { types: timestamp },
    created_at: { types: timestamp, nullable: false },
    updated_at: { types: timestamp, nullable: false },
  },
  phone11_plain_video_admission_members: {
    meeting_id: { types: uuid, nullable: false },
    tenant_id: { types: integer, nullable: false },
    user_id: { types: integer, nullable: false },
    participant_id: { types: ["character varying"], nullable: false },
    grant_profile: { types: text, nullable: false },
    lobby_state: { types: text, nullable: false },
    revision: { types: uuid, nullable: false },
    revoked_at: { types: timestamp },
    created_at: { types: timestamp, nullable: false },
    updated_at: { types: timestamp, nullable: false },
  },
  phone11_plain_video_admission_leases: {
    id: { types: uuid, nullable: false },
    tenant_id: { types: integer, nullable: false },
    meeting_id: { types: uuid, nullable: false },
    user_id: { types: integer, nullable: false },
    participant_id: { types: ["character varying"], nullable: false },
    room_revision: { types: uuid, nullable: false },
    member_revision: { types: uuid, nullable: false },
    state: { types: text, nullable: false },
    expires_at: { types: timestamp, nullable: false },
    revoked_at: { types: timestamp },
    created_at: { types: timestamp, nullable: false },
  },
  phone11_plain_video_eviction_operations: {
    id: { types: uuid, nullable: false },
    tenant_id: { types: integer, nullable: false },
    meeting_id: { types: uuid, nullable: false },
    user_id: { types: integer, nullable: false },
    participant_id: { types: ["character varying"], nullable: false },
    idempotency_key: { types: ["character varying"], nullable: false },
    state: { types: text, nullable: false },
    provider_eviction_id: { types: uuid },
    revoke_token_ts: { types: ["bigint"] },
    provider_created_at: { types: timestamp },
    provider_completed_at: { types: timestamp },
    created_at: { types: timestamp, nullable: false },
    updated_at: { types: timestamp, nullable: false },
  },
};

const targetTables = Object.keys(targetSchema);
const allTables = [...Object.keys(prerequisiteSchema), ...targetTables];

const requiredIndexes = [
  {
    name: "phone11_plain_video_admission_rooms_tenant",
    table: "phone11_plain_video_admission_rooms",
    shape: "(tenant_id, state, created_at DESC)",
    predicate: "",
  },
  {
    name: "phone11_plain_video_admission_members_lookup",
    table: "phone11_plain_video_admission_members",
    shape: "(tenant_id, user_id, meeting_id)",
    predicate: "where (revoked_at IS NULL)",
  },
  {
    name: "phone11_plain_video_admission_leases_pending",
    table: "phone11_plain_video_admission_leases",
    shape: "(tenant_id, meeting_id, user_id, expires_at)",
    predicate: "where (state = 'pending')",
  },
  {
    name: "phone11_plain_video_eviction_operations_pending",
    table: "phone11_plain_video_eviction_operations",
    shape: "(tenant_id, meeting_id, user_id, created_at)",
    predicate: "where (state = 'pending')",
  },
] as const;

type ForeignKeySpec = readonly [string, readonly string[], string, readonly string[]];
const requiredForeignKeys: readonly ForeignKeySpec[] = [
  ["tenant_memberships", ["user_id"], "users", ["id"]],
  ["tenant_memberships", ["tenant_id"], "tenants", ["id"]],
  ["phone11_auth_identity", ["legacy_user_id"], "users", ["id"]],
  ["phone11_plain_video_admission_rooms", ["tenant_id"], "tenants", ["id"]],
  ["phone11_plain_video_admission_members", ["user_id"], "users", ["id"]],
  ["phone11_plain_video_admission_members", ["meeting_id", "tenant_id"], "phone11_plain_video_admission_rooms", ["id", "tenant_id"]],
  ["phone11_plain_video_admission_members", ["user_id", "tenant_id"], "tenant_memberships", ["user_id", "tenant_id"]],
  ["phone11_plain_video_admission_leases", ["meeting_id", "tenant_id", "user_id", "participant_id"], "phone11_plain_video_admission_members", ["meeting_id", "tenant_id", "user_id", "participant_id"]],
  ["phone11_plain_video_eviction_operations", ["meeting_id", "tenant_id", "user_id", "participant_id"], "phone11_plain_video_admission_members", ["meeting_id", "tenant_id", "user_id", "participant_id"]],
] as const;

const requiredPrimaryKeys: Record<string, readonly string[]> = {
  users: ["id"],
  tenants: ["id"],
  tenant_memberships: ["user_id", "tenant_id"],
  phone11_auth_identity: ["auth_user_id"],
  phone11_plain_video_admission_rooms: ["id"],
  phone11_plain_video_admission_members: ["meeting_id", "user_id"],
  phone11_plain_video_admission_leases: ["id"],
  phone11_plain_video_eviction_operations: ["id"],
};

const requiredTriggers = [
  [
    "phone11_plain_video_admission_rooms",
    "phone11_plain_video_admission_room_revision",
  ],
  [
    "phone11_plain_video_admission_members",
    "phone11_plain_video_admission_member_revision",
  ],
] as const;

const requiredRoutines = [
  "phone11_plain_video_admission_touch_revision",
] as const;

// Exact PL/pgSQL body from plain-video-admission-migration.sql. A catalog
// name/signature match cannot establish that a revision guard still works.
const revisionGuardSource = `
BEGIN
  IF NEW.revision = OLD.revision THEN
    RAISE EXCEPTION 'plain-video admission revision must change on update';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
`.trim();

function checkColumns(rows: ColumnRow[], schema: SchemaSpec): string[] {
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
      if (expected.nullable === false && actual.is_nullable !== "NO")
        issues.push(`${table}.${column}:nullable`);
    }
  }
  return issues;
}

function checkForeignKeys(
  rows: ForeignKeyRow[],
  expectedForeignKeys: readonly ForeignKeySpec[] = requiredForeignKeys,
): string[] {
  const key = (table: string, columns: readonly string[], foreignTable: string, foreignColumns: readonly string[]) =>
    `${table}.(${columns.join(",")})->${foreignTable}.(${foreignColumns.join(",")})`;
  const actual = new Set(rows.filter((row) =>
    row.constraint_oid && row.local_schema === "public" && row.foreign_schema === "public" &&
    Array.isArray(row.columns) && Array.isArray(row.foreign_columns),
  ).map((row) => key(row.table_name, row.columns, row.foreign_table_name, row.foreign_columns)));
  return expectedForeignKeys
    .map(([table, columns, foreignTable, foreignColumns]) => key(table, columns, foreignTable, foreignColumns))
    .filter((key) => !actual.has(key))
    .map((key) => `${key}:foreign_key`);
}

function checkPrimaryKeys(
  rows: PrimaryKeyRow[],
  expectedPrimaryKeys: Record<string, readonly string[]> = requiredPrimaryKeys,
): string[] {
  const actual = new Map(rows.map((row) => [row.table_name, row.columns]));
  return Object.entries(expectedPrimaryKeys)
    .filter(
      ([table, columns]) =>
        JSON.stringify(actual.get(table)) !== JSON.stringify(columns),
    )
    .map(([table]) => `${table}:primary_key`);
}

function normalizeDefinition(definition: string): string {
  return definition.toLowerCase().replace(/\s+/g, " ").trim();
}

export function checkIndexes(rows: IndexRow[]): string[] {
  const actual = new Map(rows.map((row) => [row.indexname, row]));
  const issues: string[] = [];
  for (const expected of requiredIndexes) {
    const actualIndex = actual.get(expected.name);
    if (!actualIndex) {
      issues.push(`${expected.name}:missing`);
      continue;
    }
    const definition = normalizeDefinition(actualIndex.indexdef);
    // PostgreSQL 17 deparses text comparisons with an explicit ::text cast.
    // Compare the whole predicate so a broader or different partial index
    // cannot satisfy the fail-closed catalog check.
    const actualPredicate = definition.match(/\bwhere\s+(.+)$/)?.[1]
      ?.replace(/'pending'::text\b/g, "'pending'") ?? "";
    const expectedPredicate = expected.predicate.toLowerCase().replace(/^where\s+/, "");
    if (
      actualIndex.tablename !== expected.table ||
      !definition.includes(expected.shape.toLowerCase()) ||
      actualPredicate !== expectedPredicate
    ) {
      issues.push(`${expected.name}:definition`);
    }
  }
  return issues;
}

export type PlainVideoAdmissionPreflight = {
  event: "phone11.plain_video_admission.preflight";
  readOnly: true;
  pass: boolean;
  outcome: "ready_for_migration" | "already_applied" | "blocked";
  prerequisites: { status: "compatible" | "incompatible"; issues: string[] };
  migration: {
    state: "not_applied" | "applied" | "partial_or_incompatible";
    presentTables: string[];
    issues: string[];
  };
  note: "migration_not_executed";
};

export async function inspectPlainVideoAdmissionSchema(
  client: PreflightClient,
): Promise<PlainVideoAdmissionPreflight> {
  // A Pool.query call after BEGIN may run on a different connection. Bind the
  // entire read-only inspection to one acquired client when given a Pool.
  const maybePool = client as PreflightClient & {
    connect?: () => Promise<PreflightClient & { release(): void }>;
    release?: () => void;
  };
  if (typeof maybePool.connect === "function" && typeof maybePool.release !== "function") {
    const connection = await maybePool.connect();
    try {
      return await inspectPlainVideoAdmissionSchema(connection);
    } finally {
      connection.release();
    }
  }
  let transactionStarted = false;
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    transactionStarted = true;
    // pg clients must not receive concurrent queries in one transaction.
    let previous = Promise.resolve();
    let failed = false;
    let failure: unknown;
    const catalogQuery = <R extends QueryResultRow = QueryResultRow>(
      sql: string, values?: unknown[],
    ): Promise<QueryResult<R>> => {
      const next = previous.then(() => {
        if (failed) throw failure;
        return client.query<R>(sql, values);
      });
      previous = next.then(() => undefined, (error: unknown) => {
        failed = true;
        failure = error;
      });
      return next;
    };
    const [
      contextResult,
      tablesResult,
      columnsResult,
      indexesResult,
      foreignKeysResult,
      primaryKeysResult,
      triggersResult,
      routinesResult,
    ] = await Promise.all([
      catalogQuery<{ schema_name: string }>("SELECT current_schema() AS schema_name"),
      catalogQuery<TableRow>(
        `SELECT c.relname AS table_name
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname=current_schema() AND c.relkind='r'
             AND c.relname=ANY($1::text[])`,
        [allTables],
      ),
      catalogQuery<ColumnRow>(
        `SELECT c.relname AS table_name,a.attname AS column_name,
                pg_catalog.format_type(a.atttypid,NULL) AS data_type,
                CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable
           FROM pg_catalog.pg_attribute a
           JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
           JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname=current_schema() AND c.relkind='r'
             AND c.relname=ANY($1::text[])
             AND a.attnum>0 AND NOT a.attisdropped
           ORDER BY c.relname,a.attnum`,
        [allTables],
      ),
      catalogQuery<IndexRow>(
        `SELECT index_rel.relname AS indexname,table_rel.relname AS tablename,
                pg_catalog.pg_get_indexdef(idx.indexrelid) AS indexdef
           FROM pg_catalog.pg_index idx
           JOIN pg_catalog.pg_class index_rel ON index_rel.oid=idx.indexrelid
           JOIN pg_catalog.pg_class table_rel ON table_rel.oid=idx.indrelid
           JOIN pg_catalog.pg_namespace n ON n.oid=table_rel.relnamespace
           WHERE n.nspname=current_schema()
             AND index_rel.relname=ANY($1::text[])
             AND idx.indisvalid AND idx.indisready`,
        [requiredIndexes.map((index) => index.name)],
      ),
      catalogQuery<ForeignKeyRow>(
        `SELECT con.oid::text AS constraint_oid,
                local_ns.nspname AS local_schema,local_rel.relname AS table_name,
                array_agg(local_col.attname::text ORDER BY local_key.position) AS columns,
                foreign_ns.nspname AS foreign_schema,foreign_rel.relname AS foreign_table_name,
                array_agg(foreign_col.attname::text ORDER BY local_key.position) AS foreign_columns
           FROM pg_catalog.pg_constraint con
           JOIN pg_catalog.pg_class local_rel ON local_rel.oid=con.conrelid
           JOIN pg_catalog.pg_class foreign_rel ON foreign_rel.oid=con.confrelid
           JOIN pg_catalog.pg_namespace local_ns ON local_ns.oid=local_rel.relnamespace
           JOIN pg_catalog.pg_namespace foreign_ns ON foreign_ns.oid=foreign_rel.relnamespace
           JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS local_key(attnum,position) ON TRUE
           JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS foreign_key(attnum,position)
             ON foreign_key.position=local_key.position
           JOIN pg_catalog.pg_attribute local_col
             ON local_col.attrelid=local_rel.oid AND local_col.attnum=local_key.attnum
           JOIN pg_catalog.pg_attribute foreign_col
             ON foreign_col.attrelid=foreign_rel.oid AND foreign_col.attnum=foreign_key.attnum
           WHERE local_ns.nspname=current_schema() AND con.contype='f'
             AND con.convalidated AND local_rel.relname=ANY($1::text[])
           GROUP BY con.oid,local_ns.nspname,local_rel.relname,
                    foreign_ns.nspname,foreign_rel.relname`,
        [allTables],
      ),
      catalogQuery<PrimaryKeyRow>(
        `SELECT c.relname AS table_name,
                array_agg(a.attname::text ORDER BY key.position) AS columns
           FROM pg_catalog.pg_constraint con
           JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
           JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
           JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS key(attnum,position) ON TRUE
           JOIN pg_catalog.pg_attribute a
             ON a.attrelid=c.oid AND a.attnum=key.attnum
           WHERE n.nspname=current_schema() AND con.contype='p'
             AND c.relname=ANY($1::text[])
           GROUP BY c.relname`,
        [allTables],
      ),
      catalogQuery<TriggerRow>(
        `SELECT c.relname AS table_name,tg.tgname AS trigger_name,
                tg.tgtype::integer AS trigger_type,tg.tgenabled AS enabled,
                tg.tgattr::text AS trigger_columns,tg.tgqual IS NOT NULL AS has_when,
                tg.tgnargs::integer AS argument_count,tg.tgfoid::text AS function_oid
           FROM pg_catalog.pg_trigger tg
           JOIN pg_catalog.pg_class c ON c.oid=tg.tgrelid
           JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname=current_schema() AND NOT tg.tgisinternal
             AND tg.tgname=ANY($1::text[])`,
        [requiredTriggers.map(([, trigger]) => trigger)],
      ),
      catalogQuery<RoutineRow>(
        `SELECT p.oid::text AS routine_oid,p.proname AS routine_name,
                lang.lanname AS language_name,p.prorettype::regtype::text AS return_type,
                p.pronargs::integer AS argument_count,p.prosecdef AS security_definer,
                p.proconfig IS NOT NULL AS has_config,p.prosrc AS source
           FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
           JOIN pg_catalog.pg_language lang ON lang.oid=p.prolang
           WHERE n.nspname=current_schema() AND p.prokind='f'
             AND p.proname=ANY($1::text[])`,
        [requiredRoutines],
      ),
    ]);

    const columns = columnsResult.rows;
    const prerequisiteForeignKeys = requiredForeignKeys.filter(([table]) =>
      Object.keys(prerequisiteSchema).includes(table),
    );
    const prerequisitePrimaryKeys = Object.fromEntries(
      Object.entries(requiredPrimaryKeys).filter(([table]) =>
        Object.keys(prerequisiteSchema).includes(table),
      ),
    );
    const prerequisiteIssues = [
      ...(contextResult.rows[0]?.schema_name === "public" ? [] : ["schema:public_required"]),
      ...checkColumns(columns, prerequisiteSchema),
      ...checkForeignKeys(foreignKeysResult.rows, prerequisiteForeignKeys),
      ...checkPrimaryKeys(primaryKeysResult.rows, prerequisitePrimaryKeys),
    ];
    const presentTables = targetTables.filter((table) =>
      tablesResult.rows.some((row) => row.table_name === table),
    );
    const targetObjectCount =
      presentTables.length +
      indexesResult.rows.length +
      triggersResult.rows.length +
      routinesResult.rows.length;
    const targetObjectsPresent = targetObjectCount > 0;
    const migrationIssues = targetObjectsPresent
      ? [
          ...checkColumns(columns, targetSchema),
          ...checkIndexes(indexesResult.rows),
          ...checkForeignKeys(foreignKeysResult.rows),
          ...checkPrimaryKeys(primaryKeysResult.rows),
          ...requiredRoutines
            .filter(
              (routine) =>
                !routinesResult.rows.some(
                  (row) => row.routine_name === routine,
                ),
            )
            .map((routine) => `${routine}:missing`),
          ...requiredRoutines.flatMap((routine) => {
            const row = routinesResult.rows.find((candidate) => candidate.routine_name === routine);
            return row && (
              !row.routine_oid || row.language_name !== "plpgsql" ||
              row.return_type !== "trigger" || row.argument_count !== 0 ||
              row.security_definer !== false || row.has_config !== false ||
              row.source?.trim() !== revisionGuardSource
            ) ? [`${routine}:definition`] : [];
          }),
          ...requiredTriggers.flatMap(([table, trigger]) => {
            const row = triggersResult.rows.find((candidate) =>
              candidate.table_name === table && candidate.trigger_name === trigger);
            if (!row) return [`${table}:${trigger}:missing`];
            const routine = routinesResult.rows.find((candidate) =>
              candidate.routine_name === requiredRoutines[0]);
            return row.trigger_type === 19 && row.enabled === "O" &&
              row.trigger_columns === "" && row.has_when === false &&
              row.argument_count === 0 && row.function_oid &&
              row.function_oid === routine?.routine_oid
              ? [] : [`${table}:${trigger}:definition`];
          }),
        ]
      : [];
    const migrationState =
      targetObjectCount === 0
        ? "not_applied"
        : migrationIssues.length === 0 &&
            presentTables.length === targetTables.length
          ? "applied"
          : "partial_or_incompatible";
    const prerequisiteStatus =
      prerequisiteIssues.length === 0 ? "compatible" : "incompatible";
    const pass =
      prerequisiteStatus === "compatible" &&
      migrationState !== "partial_or_incompatible";
    return {
      event: "phone11.plain_video_admission.preflight",
      readOnly: true,
      pass,
      outcome: pass
        ? migrationState === "not_applied"
          ? "ready_for_migration"
          : "already_applied"
        : "blocked",
      prerequisites: {
        status: prerequisiteStatus,
        issues: [...new Set(prerequisiteIssues)].sort(),
      },
      migration: {
        state: migrationState,
        presentTables,
        issues: [...new Set(migrationIssues)].sort(),
      },
      note: "migration_not_executed",
    };
  } finally {
    if (transactionStarted) await client.query("ROLLBACK");
  }
}

export function formatPreflightReport(
  result: PlainVideoAdmissionPreflight,
): string {
  const lines = [
    `${result.pass ? "PASS" : "FAIL"}: Phone11 plain-video admission schema preflight`,
    `Prerequisites: ${result.prerequisites.status}`,
    `Migration state: ${result.migration.state}`,
    `Outcome: ${result.outcome}`,
    "No migration SQL was executed.",
  ];
  if (result.prerequisites.issues.length)
    lines.push(
      `Prerequisite issues: ${result.prerequisites.issues.join(", ")}`,
    );
  if (result.migration.issues.length)
    lines.push(`Migration issues: ${result.migration.issues.join(", ")}`);
  return lines.join("\n");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const directInvocation = /phone11-plain-video-admission-preflight(?:\.ts|\.mjs)$/.test(
  invokedPath,
);

async function runPreflight() {
  const connectionString = process.env.PHONE11_PLAIN_VIDEO_ADMISSION_DATABASE_URL;
  if (!connectionString) {
    console.error(
      `FAIL: set ${DATABASE_URL_ENV} to an explicitly selected protected-clone PostgreSQL URL.`,
    );
    process.exitCode = 1;
    return;
  }
  const database = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  });
  let client: PreflightClient | undefined;
  try {
    client = await database.connect();
    const result = await inspectPlainVideoAdmissionSchema(client);
    console.info(formatPreflightReport(result));
    if (!result.pass) process.exitCode = 2;
  } catch {
    console.error(
      "FAIL: plain-video admission preflight could not inspect the selected database. No credentials were logged and no migration was executed.",
    );
    process.exitCode = 1;
  } finally {
    (client as { release?: () => void } | undefined)?.release?.();
    await database.end();
  }
}

if (directInvocation && invokedPath === fileURLToPath(import.meta.url))
  void runPreflight();
