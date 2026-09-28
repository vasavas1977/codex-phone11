import { describe, expect, it, vi } from "vitest";
import {
  checkIndexes,
  formatPreflightReport,
  inspectPlainVideoAdmissionSchema,
  prerequisiteSchema,
  targetSchema,
} from "../scripts/phone11-plain-video-admission-preflight";

function columnRows(
  schema: Record<
    string,
    Record<string, { types: readonly string[]; nullable?: boolean }>
  >,
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

function mockDatabase({ partialTarget = false } = {}) {
  const prerequisiteColumns = columnRows(prerequisiteSchema);
  const targetColumns = partialTarget
    ? columnRows({
        phone11_plain_video_admission_rooms:
          targetSchema.phone11_plain_video_admission_rooms,
      })
    : [];
  const query = vi.fn(async (sql: string) => {
    if (sql === "BEGIN TRANSACTION READ ONLY" || sql === "ROLLBACK")
      return { rows: [] };
    if (sql.includes("information_schema.tables")) {
      return {
        rows: [
          { table_name: "users" },
          { table_name: "tenants" },
          { table_name: "tenant_memberships" },
          { table_name: "phone11_auth_identity" },
          ...(partialTarget
            ? [{ table_name: "phone11_plain_video_admission_rooms" }]
            : []),
        ],
      };
    }
    if (sql.includes("information_schema.columns"))
      return { rows: [...prerequisiteColumns, ...targetColumns] };
    if (sql.includes("FROM pg_indexes")) return { rows: [] };
    if (sql.includes("constraint_type='FOREIGN KEY'")) {
      return {
        rows: [
          {
            table_name: "tenant_memberships",
            column_name: "user_id",
            foreign_table_name: "users",
            foreign_column_name: "id",
          },
          {
            table_name: "tenant_memberships",
            column_name: "tenant_id",
            foreign_table_name: "tenants",
            foreign_column_name: "id",
          },
          {
            table_name: "phone11_auth_identity",
            column_name: "legacy_user_id",
            foreign_table_name: "users",
            foreign_column_name: "id",
          },
        ],
      };
    }
    if (sql.includes("constraint_type='PRIMARY KEY'")) {
      return {
        rows: [
          {
            table_name: "tenant_memberships",
            columns: ["user_id", "tenant_id"],
          },
          { table_name: "phone11_auth_identity", columns: ["auth_user_id"] },
        ],
      };
    }
    if (sql.includes("information_schema.triggers")) return { rows: [] };
    if (sql.includes("information_schema.routines")) return { rows: [] };
    throw new Error(`Unexpected SQL in mocked preflight: ${sql}`);
  });
  return { query };
}

describe("plain-video admission schema preflight", () => {
  it("accepts PostgreSQL 17 text casts but rejects a widened pending predicate", () => {
    const indexes = [
      ["phone11_plain_video_admission_rooms_tenant", "phone11_plain_video_admission_rooms", "(tenant_id, state, created_at DESC)", ""],
      ["phone11_plain_video_admission_members_lookup", "phone11_plain_video_admission_members", "(tenant_id, user_id, meeting_id)", "WHERE (revoked_at IS NULL)"],
      ["phone11_plain_video_admission_leases_pending", "phone11_plain_video_admission_leases", "(tenant_id, meeting_id, user_id, expires_at)", "WHERE (state = 'pending'::text)"],
      ["phone11_plain_video_eviction_operations_pending", "phone11_plain_video_eviction_operations", "(tenant_id, meeting_id, user_id, created_at)", "WHERE (state = 'pending'::text)"],
    ].map(([indexname, tablename, shape, predicate]) => ({
      indexname, tablename,
      indexdef: `CREATE INDEX ${indexname} ON public.${tablename} USING btree ${shape} ${predicate}`,
    }));
    expect(checkIndexes(indexes)).toEqual([]);
    const widened = indexes.map((row) => ({ ...row }));
    widened[2].indexdef += " OR state = 'issued'";
    expect(checkIndexes(widened)).toContain("phone11_plain_video_admission_leases_pending:definition");
  });

  it("passes a compatible prerequisite schema with no target migration objects", async () => {
    const database = mockDatabase();
    const result = await inspectPlainVideoAdmissionSchema(database as never);

    expect(result).toMatchObject({
      readOnly: true,
      pass: true,
      outcome: "ready_for_migration",
      prerequisites: { status: "compatible", issues: [] },
      migration: { state: "not_applied", presentTables: [], issues: [] },
      note: "migration_not_executed",
    });
    expect(formatPreflightReport(result)).toContain(
      "No migration SQL was executed.",
    );
    expect(database.query.mock.calls[0][0]).toBe("BEGIN TRANSACTION READ ONLY");
    expect(database.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    for (const [sql] of database.query.mock.calls.slice(1, -1))
      expect(sql.trim()).toMatch(/^SELECT/i);
  });

  it("fails a partial target schema and never attempts to apply it", async () => {
    const database = mockDatabase({ partialTarget: true });
    const result = await inspectPlainVideoAdmissionSchema(database as never);

    expect(result.pass).toBe(false);
    expect(result.outcome).toBe("blocked");
    expect(result.migration.state).toBe("partial_or_incompatible");
    expect(result.migration.issues).toEqual(
      expect.arrayContaining([
        "phone11_plain_video_admission_members.meeting_id:missing",
        "phone11_plain_video_admission_rooms_tenant:missing",
      ]),
    );
    expect(
      database.query.mock.calls.every(
        ([sql]) => !/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(sql),
      ),
    ).toBe(true);
  });
});
