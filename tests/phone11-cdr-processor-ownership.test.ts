import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), client: { query: vi.fn() }, route: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: db.query, withTransaction: db.transaction }));
vi.mock("../server/cloud-recordings/correlation", () => ({ trustedCdrRecordingRoute: db.route }));
vi.mock("../server/cloud-recordings/repository", () => ({ createCloudRecordingRepository: vi.fn() }));
import { processCdr } from "../server/pbx/cdr-processor";
const uuid = "10000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.mockImplementation(fn => fn(db.client));
  db.route.mockResolvedValue(null);
  db.client.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("SELECT id, call_record_id") ? [] : [{ id: 1 }] }));
});
it("never defaults direct processor calls to tenant 1", async () => {
  await expect(processCdr({ variables: { uuid } })).rejects.toThrow("Explicit CDR tenant required");
  expect(db.transaction).not.toHaveBeenCalled();
});
it("checks the own channel and rejects tenant mismatch before a transaction", async () => {
  db.route.mockResolvedValue({ tenantId: 12, extensionId: 23 });
  await expect(processCdr({ variables: { uuid, sip_call_id: "exact@sip", tenant_id: 99, originating_leg_uuid: "foreign-parent" } })).rejects.toThrow("Trusted call tenant mismatch");
  expect(db.route).toHaveBeenCalledWith(uuid, "exact@sip");
  expect(db.transaction).not.toHaveBeenCalled();
});
it("does not insert a leg when a parent upsert reports an ownership collision", async () => {
  db.client.query.mockResolvedValueOnce({ rows: [] });
  await expect(processCdr({ variables: { uuid, tenant_id: 12 } })).rejects.toThrow("Call tenant collision");
  expect(db.client.query).toHaveBeenCalledTimes(1);
});
it("supplies complete answer/end facts and completion metadata for a native final CDR", async () => {
  await processCdr({ variables: { uuid, tenant_id: 12, start_epoch: "1700000000", answer_epoch: "1700000010", end_epoch: "1700000020", billsec: "10" } });
  const args = db.client.query.mock.calls[0][1];
  expect(args[7]).toEqual(new Date(1700000010000)); expect(args[8]).toEqual(new Date(1700000020000));
  expect(JSON.parse(args[12])).toMatchObject({ completion: "complete", source: "authenticated_freeswitch_cdr" });
});
it("does not describe a partial JSON callback as completed", async () => {
  await processCdr({ variables: { uuid, tenant_id: 12 } });
  expect(JSON.parse(db.client.query.mock.calls[0][1][12]).completion).toBe("unknown");
});
