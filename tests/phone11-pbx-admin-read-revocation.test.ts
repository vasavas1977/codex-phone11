import { beforeEach, expect, it, vi } from "vitest";
import { pbxRouter } from "../server/pbx/pbx-router";
import { resolveTenantMemberships } from "../server/pbx/tenant-middleware";
import { invalidateCache } from "../server/pbx/redis";

const m = vi.hoisted(() => ({
  query: vi.fn(), capabilities: vi.fn(), audit: vi.fn(), analytics: vi.fn(),
  cached: null as string | null, roles: new Map<number, string>(),
  entered: (() => {}) as () => void, writeGate: Promise.resolve(), pauseWrite: false,
  calls: [{ id: 42, tenant_id: 7, caller_number: "synthetic-private-caller" }],
}));
vi.mock("../server/pbx/db", () => ({ query: m.query, withTransaction: vi.fn() }));
vi.mock("ioredis", () => ({ default: class {
  on() { return this; }
  connect() { return Promise.resolve(); }
  get() { return Promise.resolve(m.cached); }
  async setex(_key: string, _ttl: number, value: string) {
    if (m.pauseWrite) { m.entered(); await m.writeGate; }
    m.cached = value;
  }
  keys() { return Promise.resolve(m.cached ? ["tenant:memberships:9"] : []); }
  del() { m.cached = null; return Promise.resolve(); }
} }));
vi.mock("../server/pbx/audit", () => ({ writeAuditLog: vi.fn(), queryAuditLogs: m.audit }));
vi.mock("../server/pbx/schema-capabilities", () => ({ readManagementCapabilities: m.capabilities }));
vi.mock("../server/pbx/sip-secrets", () => ({ createSipCredentials: vi.fn(), regenerateSipCredentials: vi.fn(), decryptSecret: vi.fn() }));
vi.mock("../server/pbx/cdr-processor", () => ({ getCallStats: m.analytics, getVoicemails: vi.fn(), requireVoicemailStorage: vi.fn(), VoicemailStorageUnavailableError: class extends Error {} }));
vi.mock("../server/profile/photo", () => ({ profilePhotoDescriptors: vi.fn() }));
vi.mock("../server/phone-provisioning", () => ({ reactivateExtensionSipAuth: vi.fn(), revokeExtensionSipAuth: vi.fn(), rotateExtensionSipAuth: vi.fn() }));


const caller = () => pbxRouter.createCaller({ user: { id: 9, role: "user" }, req: { headers: {}, ip: "127.0.0.1" }, res: {} } as any);
type Caller = ReturnType<typeof caller>;
const legacyReads: [string, (c: Caller) => Promise<unknown>][] = [
  ["dashboard stats", c => c.dashboard.stats()],
  ["recent calls", c => c.dashboard.recentCalls({ limit: 7 })],
  ["analytics", c => c.dashboard.analytics({ period: "week" })],
  ["audit log", c => c.auditLogs.list({ resourceType: "call" })],
  ["fraud controls", c => c.fraudControls.get()],
];
const selectedReads: [string, (c: Caller) => Promise<unknown>][] = [
  ["capabilities", c => c.capabilities({ tenantId: 7 })],
  ["people", c => c.tenant.people({ tenantId: 7 })],
  ["members", c => c.tenant.members({ tenantId: 7 })],
  ["extensions", c => c.extensions.list({ tenantId: 7 })],
  ["extension", c => c.extensions.get({ tenantId: 7, id: 4 })],
  ["numbers", c => c.phoneNumbers.list({ tenantId: 7 })],
  ["voicemail storage", c => c.voicemail.storageStatus({ tenantId: 7 })],
];

beforeEach(() => {
  vi.clearAllMocks();
  m.cached = null; m.roles = new Map([[7, "admin"]]); m.pauseWrite = false;
  m.capabilities.mockResolvedValue({ phoneNumbers: false });
  m.audit.mockResolvedValue({ rows: ["synthetic audit"] });
  m.analytics.mockResolvedValue({ tenant: 7, synthetic: true });
  // Real router, membership resolver and Redis cache logic; only transports are fake.
  m.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("SELECT tm.role FROM tenant_memberships tm")) {
      const role = m.roles.get(Number(params[1]));
      return { rows: role === "admin" || role === "owner" ? [{ role }] : [] };
    }
    if (sql.includes("ORDER BY tm.created_at ASC, tm.tenant_id ASC")) return { rows: [...m.roles].map(([tenant_id, role]) =>
      ({ user_id: 9, tenant_id, role, tenant_name: "Synthetic", tenant_status: "active" })) };
    return { rows: sql.includes("FROM call_records") ? m.calls : [{ c: "1", avg: "1" }] };
  });
});

async function staleAdminAfterInvalidation(role: string | null = "user") {
  let unblock!: () => void;
  const writing = new Promise<void>(resolve => { m.entered = resolve; });
  m.writeGate = new Promise<void>(resolve => { unblock = resolve; });
  m.pauseWrite = true;
  const filling = resolveTenantMemberships(9);
  await writing;
  if (role === null) m.roles.delete(7); else m.roles.set(7, role);
  // Exact cache invalidation used after the committed membership mutation.
  await invalidateCache("tenant:memberships:9");
  unblock(); await filling; m.pauseWrite = false; m.query.mockClear();
}

it.each([...legacyReads, ...selectedReads])("%s refuses cache refill after demotion before reading resources", async (_name, read) => {
  await staleAdminAfterInvalidation();
  await expect(read(caller())).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(m.query).toHaveBeenCalledTimes(1);
  expect(m.query.mock.calls[0][1]).toEqual([9, 7]);
  expect(m.query.mock.calls[0][0]).toContain("tm.role::text IN ('owner', 'admin')");
  expect(m.analytics).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  expect(m.capabilities).not.toHaveBeenCalled();
});

it.each(["manager", null])("refuses a stale admin whose current role is %s", async role => {
  await staleAdminAfterInvalidation(role);
  await expect(caller().dashboard.recentCalls()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(m.query).toHaveBeenCalledTimes(1);
});

it.each(["admin", "owner"])("admits current %s and preserves query limits and tenant scope", async role => {
  m.roles.set(7, role); await resolveTenantMemberships(9); m.query.mockClear();
  await expect(caller().dashboard.recentCalls({ limit: 7 })).resolves.toEqual(m.calls);
  expect(m.query.mock.calls.map(([, p]) => p)).toEqual([[9, 7], [7, 7]]);
});

it.each(["admin", "owner"])("admits current %s for explicit workspace capabilities", async role => {
  m.roles.set(7, role); await resolveTenantMemberships(9); m.query.mockClear();
  await expect(caller().capabilities({ tenantId: 7 })).resolves.toEqual({ phoneNumbers: false, explicitTenantReads: true, explicitDidRouteDirectories: true });
  expect(m.query).toHaveBeenCalledTimes(1); expect(m.query.mock.calls[0][1]).toEqual([9, 7]);
  expect(m.capabilities).toHaveBeenCalledOnce();
});

it("passes the same admitted workspace and filters to analytics and audit readers", async () => {
  await resolveTenantMemberships(9); m.query.mockClear();
  await caller().dashboard.analytics({ period: "week" });
  await caller().auditLogs.list({ resourceType: "call", page: 2, pageSize: 7 });
  expect(m.query.mock.calls.map(([, p]) => p)).toEqual([[9, 7], [9, 7]]);
  expect(m.analytics).toHaveBeenCalledWith(7, "week");
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 7, resourceType: "call", limit: 7, offset: 7 }));
});

it("does not borrow another workspace's live admin role", async () => {
  m.roles.set(8, "owner"); await staleAdminAfterInvalidation();
  await expect(caller().dashboard.recentCalls()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(m.query).toHaveBeenCalledTimes(1); expect(m.query.mock.calls[0][1]).toEqual([9, 7]);
});

it("preserves oldest-workspace selection for the legacy dashboard", async () => {
  m.roles.set(8, "owner"); await resolveTenantMemberships(9); m.query.mockClear();
  await expect(caller().dashboard.recentCalls()).resolves.toEqual(m.calls);
  expect(m.query.mock.calls.map(([, p]) => p)).toEqual([[9, 7], [7, 10]]);
});

it("retains the explicit-workspace requirement for multi-workspace selected reads", async () => {
  m.roles.set(8, "owner"); await resolveTenantMemberships(9); m.query.mockClear();
  await expect(caller().tenant.people()).rejects.toMatchObject({ code: "FORBIDDEN", message: "Select a workspace before viewing phone administration" });
  expect(m.query).not.toHaveBeenCalled();
});

it("fails closed if fresh membership lookup fails", async () => {
  await resolveTenantMemberships(9); m.query.mockReset(); m.query.mockRejectedValue(new Error("synthetic DB failure"));
  await expect(caller().dashboard.recentCalls()).rejects.toThrow("synthetic DB failure");
  expect(m.query).toHaveBeenCalledTimes(1);
});
