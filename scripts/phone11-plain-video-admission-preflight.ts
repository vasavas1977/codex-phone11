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
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
};
type PrimaryKeyRow = { table_name: string; columns: string[] };
type TriggerRow = { table_name: string; trigger_name: string };
type RoutineRow = { routine_name: string };

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

const requiredForeignKeys = [
  ["tenant_memberships", "user_id", "users", "id"],
  ["tenant_memberships", "tenant_id", "tenants", "id"],
  ["phone11_auth_identity", "legacy_user_id", "users", "id"],
  ["phone11_plain_video_admission_rooms", "tenant_id", "tenants", "id"],
  ["phone11_plain_video_admission_members", "user_id", "users", "id"],
  [
    "phone11_plain_video_admission_members",
    "meeting_id",
    "phone11_plain_video_admission_rooms",
    "id",
  ],
  [
    "phone11_plain_video_admission_members",
    "tenant_id",
    "phone11_plain_video_admission_rooms",
    "tenant_id",
  ],
  [
    "phone11_plain_video_admission_members",
    "user_id",
    "tenant_memberships",
    "user_id",
  ],
  [
    "phone11_plain_video_admission_members",
    "tenant_id",
    "tenant_memberships",
    "tenant_id",
  ],
  [
    "phone11_plain_video_admission_leases",
    "meeting_id",
    "phone11_plain_video_admission_members",
    "meeting_id",
  ],
  [
    "phone11_plain_video_admission_leases",
    "tenant_id",
    "phone11_plain_video_admission_members",
    "tenant_id",
  ],
  [
    "phone11_plain_video_admission_leases",
    "user_id",
    "phone11_plain_video_admission_members",
    "user_id",
  ],
  [
    "phone11_plain_video_admission_leases",
    "participant_id",
    "phone11_plain_video_admission_members",
    "participant_id",
  ],
  [
    "phone11_plain_video_eviction_operations",
    "meeting_id",
    "phone11_plain_video_admission_members",
    "meeting_id",
  ],
  [
    "phone11_plain_video_eviction_operations",
    "tenant_id",
    "phone11_plain_video_admission_members",
    "tenant_id",
  ],
  [
    "phone11_plain_video_eviction_operations",
    "user_id",
    "phone11_plain_video_admission_members",
    "user_id",
  ],
  [
    "phone11_plain_video_eviction_operations",
    "participant_id",
    "phone11_plain_video_admission_members",
    "participant_id",
  ],
] as const;

const requiredPrimaryKeys: Record<string, readonly string[]> = {
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
  expectedForeignKeys: readonly (readonly [
    string,
    string,
    string,
    string,
  ])[] = requiredForeignKeys,
): string[] {
  const actual = new Set(
    rows.map(
      (row) =>
        `${row.table_name}.${row.column_name}->${row.foreign_table_name}.${row.foreign_column_name}`,
    ),
  );
  return expectedForeignKeys
    .map(
      ([table, column, foreignTable, foreignColumn]) =>
        `${table}.${column}->${foreignTable}.${foreignColumn}`,
    )
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

function checkIndexes(rows: IndexRow[]): string[] {
  const actual = new Map(rows.map((row) => [row.indexname, row]));
  const issues: string[] = [];
  for (const expected of requiredIndexes) {
    const actualIndex = actual.get(expected.name);
    if (!actualIndex) {
      issues.push(`${expected.name}:missing`);
      continue;
    }
    const definition = normalizeDefinition(actualIndex.indexdef);
    if (
      actualIndex.tablename !== expected.table ||
      !definition.includes(expected.shape.toLowerCase()) ||
      (expected.predicate &&
        !definition.includes(expected.predicate.toLowerCase()))
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
  let transactionStarted = false;
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    transactionStarted = true;
    const [
      tablesResult,
      columnsResult,
      indexesResult,
      foreignKeysResult,
      primaryKeysResult,
      triggersResult,
      routinesResult,
    ] = await Promise.all([
      client.query<TableRow>(
        `SELECT table_name FROM information_schema.tables
           WHERE table_schema=current_schema() AND table_type='BASE TABLE'
             AND table_name=ANY($1::text[])`,
        [allTables],
      ),
      client.query<ColumnRow>(
        `SELECT table_name,column_name,data_type,is_nullable
           FROM information_schema.columns
           WHERE table_schema=current_schema() AND table_name=ANY($1::text[])
           ORDER BY table_name,ordinal_position`,
        [allTables],
      ),
      client.query<IndexRow>(
        `SELECT indexname,tablename,indexdef FROM pg_indexes
           WHERE schemaname=current_schema() AND indexname=ANY($1::text[])`,
        [requiredIndexes.map((index) => index.name)],
      ),
      client.query<ForeignKeyRow>(
        `SELECT tc.table_name,kcu.column_name,ccu.table_name AS foreign_table_name,
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
        [allTables],
      ),
      client.query<PrimaryKeyRow>(
        `SELECT tc.table_name,array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position) AS columns
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_catalog=kcu.constraint_catalog AND tc.constraint_schema=kcu.constraint_schema
            AND tc.constraint_name=kcu.constraint_name
           WHERE tc.constraint_schema=current_schema() AND tc.constraint_type='PRIMARY KEY'
             AND tc.table_name=ANY($1::text[])
           GROUP BY tc.table_name`,
        [allTables],
      ),
      client.query<TriggerRow>(
        `SELECT DISTINCT event_object_table AS table_name,trigger_name
           FROM information_schema.triggers
           WHERE trigger_schema=current_schema() AND trigger_name=ANY($1::text[])`,
        [requiredTriggers.map(([, trigger]) => trigger)],
      ),
      client.query<RoutineRow>(
        `SELECT routine_name FROM information_schema.routines
           WHERE routine_schema=current_schema() AND routine_name=ANY($1::text[])`,
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
          ...requiredTriggers
            .filter(
              ([table, trigger]) =>
                !triggersResult.rows.some(
                  (row) =>
                    row.table_name === table && row.trigger_name === trigger,
                ),
            )
            .map(([table, trigger]) => `${table}:${trigger}:missing`),
          ...requiredRoutines
            .filter(
              (routine) =>
                !routinesResult.rows.some(
                  (row) => row.routine_name === routine,
                ),
            )
            .map((routine) => `${routine}:missing`),
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
  const connectionString = process.env[DATABASE_URL_ENV];
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
