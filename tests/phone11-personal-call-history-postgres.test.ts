import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: db.query }));
import { listPersonalCallHistory } from "../server/pbx/personal-call-history";

const connectionString = process.env.PHONE11_MANAGEMENT_TEST_DATABASE_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/phone11_management_test" || !url.port || url.search || url.hash)
    throw new Error("Personal history tests require a dedicated loopback phone11_management_test database with explicit port");
}
const schema = `personal_history_${randomBytes(8).toString("hex")}`;
const admin = connectionString ? new Pool({ connectionString, ssl: false }) : null;
const database = connectionString ? new Pool({ connectionString, ssl: false, options: `-c search_path=${schema}` }) : null;
const input = { tenantId: 7, userId: 1, limit: 50 };

describe.skipIf(!connectionString)("personal history against isolated PostgreSQL", () => {
  beforeAll(async () => {
    await admin!.query(`CREATE SCHEMA ${schema}`);
    for (const path of ["tests/fixtures/phone11-cloud-recording-baseline.sql", "server/cloud-recordings/prerequisites.sql"])
      await database!.query(await readFile(path, "utf8"));
  });
  beforeEach(async () => {
    db.query.mockReset();
    db.query.mockImplementation((sql, values) => database!.query(sql, values));
    await database!.query(`
      TRUNCATE users, tenants, extensions, call_records RESTART IDENTITY CASCADE;
      INSERT INTO users(id,"openId",name,role) VALUES (1,'history-a','A','user'),(2,'history-b','B','user');
      INSERT INTO tenants(id,name,status) VALUES (7,'Workspace','active'),(8,'Other workspace','active');
      INSERT INTO tenant_memberships(user_id,tenant_id,role,status) VALUES (1,7,'user','active'),(2,7,'user','active');
      INSERT INTO extensions(id,tenant_id,user_id,extension_number,status)
        VALUES (31,7,1,'3101','active'),(32,7,2,'3102','active');
      INSERT INTO user_extensions(user_id,extension_id,is_primary) VALUES (1,31,true),(2,32,true);
    `);
  });
  afterAll(async () => {
    await database?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  async function call(uuid: string, user: number | null, startedAt = "2026-01-01T10:00:00.000999Z", tenant = 7) {
    const result = await database!.query(`INSERT INTO call_records
      (call_uuid,tenant_id,direction,from_number,to_number,caller_user_id,started_at,ended_at,disposition,total_duration_seconds)
      VALUES($1,$2,'internal','3101','3102',$3,$4,$4::timestamptz + interval '10 seconds','answered',10) RETURNING id`,
      [uuid,tenant,user,startedAt]);
    return result.rows[0].id as number;
  }

  it("paginates equal and sub-millisecond timestamps without skipping older calls", async () => {
    const older = await call("older", 1, "2026-01-01T10:00:00.000888Z");
    const tieA = await call("tie-a", 1);
    const tieB = await call("tie-b", 1);
    const first = await listPersonalCallHistory({ ...input, limit: 1 });
    expect(first.items.map(row => row.id)).toEqual([tieB]);
    expect(first.nextCursor?.startedAt).toBe("2026-01-01T10:00:00.000999Z");
    const second = await listPersonalCallHistory({ ...input, limit: 1, cursor: first.nextCursor! });
    expect(second.items.map(row => row.id)).toEqual([tieA]);
    const third = await listPersonalCallHistory({ ...input, limit: 1, cursor: second.nextCursor! });
    expect(third.items.map(row => row.id)).toEqual([older]);
    expect(third.nextCursor).toBeNull();
  });

  it("retains call-time ownership after reassignment and excludes another tenant and unowned calls", async () => {
    const owned = await call("owned-before-reassignment", 1);
    await call("other-tenant", 1, undefined, 8);
    await call("unowned-internal", null);
    await database!.query(`UPDATE extensions SET user_id=2 WHERE id=31;
      DELETE FROM user_extensions WHERE extension_id=31;
      INSERT INTO user_extensions(user_id,extension_id,is_primary) VALUES (2,31,false);
      INSERT INTO extensions(id,tenant_id,user_id,extension_number,status) VALUES(33,7,1,'3103','active');
      INSERT INTO user_extensions(user_id,extension_id,is_primary) VALUES(1,33,true);`);
    const oldOwner = await listPersonalCallHistory(input);
    expect(oldOwner.items.map(row => row.id)).toEqual([owned]);
    expect(oldOwner.items[0].callback_number).toBe("3102");
    expect((await listPersonalCallHistory({ ...input, userId: 2 })).items).toEqual([]);
    await expect(listPersonalCallHistory({ ...input, tenantId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires active membership and assignment even when owned historical rows exist", async () => {
    await call("owned", 1);
    await database!.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=1 AND tenant_id=7");
    await expect(listPersonalCallHistory(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await database!.query("UPDATE tenant_memberships SET status='active' WHERE user_id=1 AND tenant_id=7");
    await database!.query("UPDATE extensions SET status='inactive' WHERE id=31");
    await expect(listPersonalCallHistory(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns no rows when membership is revoked between the eligibility and history reads", async () => {
    await call("owned", 1);
    db.query.mockImplementationOnce(async (sql, values) => {
      const eligible = await database!.query(sql, values);
      await database!.query("UPDATE tenant_memberships SET status='inactive' WHERE user_id=1 AND tenant_id=7");
      return eligible;
    });
    expect((await listPersonalCallHistory(input)).items).toEqual([]);
  });

  it("allows immutable leg-owned legacy history without guessing a callback number", async () => {
    const id = await call("legacy-parent", null);
    await database!.query(`INSERT INTO call_legs(call_record_id,tenant_id,leg_uuid,extension_id,caller_user_id,started_at)
      VALUES($1,7,'legacy-leg',31,1,NOW())`, [id]);
    const result = await listPersonalCallHistory(input);
    expect(result.items.map(row => row.id)).toEqual([id]);
    expect(result.items[0].callback_number).toBeNull();
    expect((await listPersonalCallHistory({ ...input, userId: 2 })).items).toEqual([]);
  });
});
