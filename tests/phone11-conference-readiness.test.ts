import { describe, expect, it, vi } from "vitest";

import {
  formatConferenceReadinessReport,
  runConferenceReadinessProbe,
} from "../scripts/phone11-conference-readiness";
import {
  connect11PlainVideoTenantConfigEnvironment,
} from "../server/meetings/connect11-plain-video-config";
import {
  prerequisiteSchema,
  targetSchema,
} from "../scripts/phone11-plain-video-admission-preflight";

function columnRows(
  schema: Record<string, Record<string, { types: readonly string[]; nullable?: boolean }>>,
) {
  return Object.entries(schema).flatMap(([table_name, columns]) =>
    Object.entries(columns).map(([column_name, spec]) => ({
      table_name,
      column_name,
      data_type: spec.types[0],
      is_nullable: spec.nullable === false ? "NO" : "YES",
    })),
  );
}

function appliedDatabase() {
  const allColumns = columnRows({ ...prerequisiteSchema, ...targetSchema });
  const tables = Object.keys({ ...prerequisiteSchema, ...targetSchema }).map(
    (table_name) => ({ table_name }),
  );
  const foreignKeys = [
    ["tenant_memberships", "user_id", "users", "id"],
    ["tenant_memberships", "tenant_id", "tenants", "id"],
    ["phone11_auth_identity", "legacy_user_id", "users", "id"],
    ["phone11_plain_video_admission_rooms", "tenant_id", "tenants", "id"],
    ["phone11_plain_video_admission_members", "user_id", "users", "id"],
    ["phone11_plain_video_admission_members", "meeting_id", "phone11_plain_video_admission_rooms", "id"],
    ["phone11_plain_video_admission_members", "tenant_id", "phone11_plain_video_admission_rooms", "tenant_id"],
    ["phone11_plain_video_admission_members", "user_id", "tenant_memberships", "user_id"],
    ["phone11_plain_video_admission_members", "tenant_id", "tenant_memberships", "tenant_id"],
    ["phone11_plain_video_admission_leases", "meeting_id", "phone11_plain_video_admission_members", "meeting_id"],
    ["phone11_plain_video_admission_leases", "tenant_id", "phone11_plain_video_admission_members", "tenant_id"],
    ["phone11_plain_video_admission_leases", "user_id", "phone11_plain_video_admission_members", "user_id"],
    ["phone11_plain_video_admission_leases", "participant_id", "phone11_plain_video_admission_members", "participant_id"],
    ["phone11_plain_video_eviction_operations", "meeting_id", "phone11_plain_video_admission_members", "meeting_id"],
    ["phone11_plain_video_eviction_operations", "tenant_id", "phone11_plain_video_admission_members", "tenant_id"],
    ["phone11_plain_video_eviction_operations", "user_id", "phone11_plain_video_admission_members", "user_id"],
    ["phone11_plain_video_eviction_operations", "participant_id", "phone11_plain_video_admission_members", "participant_id"],
  ].map(([table_name, column_name, foreign_table_name, foreign_column_name]) => ({
    table_name,
    column_name,
    foreign_table_name,
    foreign_column_name,
  }));
  const primaryKeys = [
    ["tenant_memberships", ["user_id", "tenant_id"]],
    ["phone11_auth_identity", ["auth_user_id"]],
    ["phone11_plain_video_admission_rooms", ["id"]],
    ["phone11_plain_video_admission_members", ["meeting_id", "user_id"]],
    ["phone11_plain_video_admission_leases", ["id"]],
    ["phone11_plain_video_eviction_operations", ["id"]],
  ].map(([table_name, columns]) => ({ table_name, columns }));
  const indexes = [
  ["phone11_plain_video_admission_rooms_tenant", "phone11_plain_video_admission_rooms", "(tenant_id, state, created_at DESC)"],
    ["phone11_plain_video_admission_members_lookup", "phone11_plain_video_admission_members", "(tenant_id, user_id, meeting_id) WHERE (revoked_at IS NULL)"],
    ["phone11_plain_video_admission_leases_pending", "phone11_plain_video_admission_leases", "(tenant_id, meeting_id, user_id, expires_at) WHERE (state = 'pending')"],
    ["phone11_plain_video_eviction_operations_pending", "phone11_plain_video_eviction_operations", "(tenant_id, meeting_id, user_id, created_at) WHERE (state = 'pending')"],
  ].map(([indexname, tablename, shape]) => ({
    indexname,
    tablename,
    indexdef: `CREATE INDEX ${indexname} ON ${tablename} ${shape}`,
  }));
  const query = vi.fn(async (sql: string) => {
    if (sql === "BEGIN TRANSACTION READ ONLY" || sql === "ROLLBACK")
      return { rows: [] };
    if (sql.includes("information_schema.tables")) return { rows: tables };
    if (sql.includes("information_schema.columns")) return { rows: allColumns };
    if (sql.includes("FROM pg_indexes")) return { rows: indexes };
    if (sql.includes("constraint_type='FOREIGN KEY'")) return { rows: foreignKeys };
    if (sql.includes("constraint_type='PRIMARY KEY'")) return { rows: primaryKeys };
    if (sql.includes("information_schema.triggers")) {
      return {
        rows: [
          { table_name: "phone11_plain_video_admission_rooms", trigger_name: "phone11_plain_video_admission_room_revision" },
          { table_name: "phone11_plain_video_admission_members", trigger_name: "phone11_plain_video_admission_member_revision" },
        ],
      };
    }
    if (sql.includes("information_schema.routines"))
      return { rows: [{ routine_name: "phone11_plain_video_admission_touch_revision" }] };
    throw new Error(`unexpected query ${sql}`);
  });
  return { query };
}

const validEnvironment = {
  [connect11PlainVideoTenantConfigEnvironment]: JSON.stringify({
    enabled: true,
    tenants: [{
      tenantId: 41,
      customerKey: "customer_key_41",
      apiBaseUrl: "https://tenant-41.connect11.example",
      rtcUrl: "wss://media-41.connect11.example",
      statusCredential: "status-secret-value",
      joinCredential: "join-secret-value",
    }],
  }),
  DATABASE_URL: "postgres://db-user:db-secret@db.internal:5432/private",
};

describe("Phone11 conference readiness probe", () => {
  it("requires the mapping and reports only summaries when configuration is absent", async () => {
    const result = await runConferenceReadinessProbe({ env: {} });
    const output = formatConferenceReadinessReport(result);
    expect(result.pass).toBe(false);
    expect(result.configuration).toMatchObject({ present: false, valid: false, enabled: false });
    expect(result.providerCalls).toBe(0);
    expect(output).not.toMatch(/postgres|secret|tenant-41|media-41|customer_key|https?:|wss:/i);
  });

  it("uses strict parsing, checks metadata in a read-only transaction, and never mints", async () => {
    const database = appliedDatabase();
    const result = await runConferenceReadinessProbe({ env: validEnvironment, database: database as never });
    expect(result).toMatchObject({
      pass: true,
      readOnly: true,
      providerCalls: 0,
      configuration: { present: true, valid: true, enabled: true, tenantCount: 1 },
      capabilityEndpoint: { authenticated: true, defaultOff: true, tokenMintAttempted: false },
      database: { configured: true, metadataOnly: true, readOnlyTransaction: true, status: "applied", prerequisites: "compatible" },
    });
    expect(database.query.mock.calls[0][0]).toBe("BEGIN TRANSACTION READ ONLY");
    expect(database.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    for (const [sql] of database.query.mock.calls.slice(1, -1))
      expect(sql.trim()).toMatch(/^SELECT/i);
    const output = formatConferenceReadinessReport(result);
    expect(output).not.toMatch(/db-secret|status-secret-value|join-secret-value|customer_key_41|tenant-41|media-41|postgres:/);
  });

  it("fails malformed or explicitly non-strict tenant configuration closed", async () => {
    for (const raw of [
      "not-json",
      JSON.stringify({ enabled: true, tenants: [] }),
      JSON.stringify({ enabled: false, unexpected: true }),
    ]) {
      const result = await runConferenceReadinessProbe({
        env: {
          [connect11PlainVideoTenantConfigEnvironment]: raw,
        },
      });
      expect(result.configuration.valid).toBe(false);
      expect(result.configuration.enabled).toBe(false);
      expect(result.pass).toBe(false);
    }
  });
});
