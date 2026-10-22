import { beforeEach, describe, expect, it, vi } from "vitest";

// Actual tRPC handler and membership admission; only database/transport edges
// are mocked. These assertions do not establish PostgreSQL role enforcement.
const f = vi.hoisted(() => ({
  close: vi.fn(), authenticate: vi.fn(), query: vi.fn(), sharedTransaction: vi.fn(), transaction: vi.fn(), client: vi.fn(), binding: vi.fn(),
  memberships: [7, 8], cachedRole: "admin", liveRole: "admin", lockRows: [{ role: "admin" }] as any[],
  readRows: [] as any[], updateRows: [{ tenant_id: 7 }] as any[],
  failAudit: false, failStorage: false, pending: 0, committed: 0, audits: [] as unknown[][], events: [] as string[],
}));
vi.mock("../server/pbx/db", () => ({ query: f.query, withTransaction: f.sharedTransaction }));
vi.mock("../server/pbx/fraud-policy-db", () => ({
  getFraudPolicyBindingStatus: f.binding, withFraudPolicyTransaction: f.transaction, closeFraudPolicyPool: f.close,
}));
vi.mock("../server/pbx/redis", () => ({
  cacheGetOrSet: async (_key: string, _ttl: number, callback: () => unknown) => callback(),
  invalidateCache: vi.fn(),
}));
vi.mock("../server/pbx/schema-capabilities", () => ({
  readManagementCapabilities: async () => ({ phoneNumbers: true }), schemaHasRequiredColumns: vi.fn(),
}));
vi.mock("../server/pbx/sip-secrets", () => ({ createSipCredentials: vi.fn(), regenerateSipCredentials: vi.fn() }));
vi.mock("../server/pbx/cdr-processor", () => ({
  getCallStats: vi.fn(), getVoicemails: vi.fn(), requireVoicemailStorage: vi.fn(), VoicemailStorageUnavailableError: class extends Error {},
}));
vi.mock("../server/pbx/voicemail-access", () => ({ countVoicemails: vi.fn(), deleteVoicemail: vi.fn(), markVoicemailRead: vi.fn(), voicemailStorageStatus: vi.fn() }));
vi.mock("../server/profile/photo", () => ({ profilePhotoDescriptors: vi.fn() }));
vi.mock("../server/phone-provisioning", () => ({ reactivateExtensionSipAuth: vi.fn(), revokeExtensionSipAuth: vi.fn(), rotateExtensionSipAuth: vi.fn() }));
vi.mock("../server/_core/sdk", () => ({ sdk: { authenticateRequest: f.authenticate } }));
vi.mock("../server/_core/phone11-auth", () => ({ readAuthConfig: () => ({ trustedOrigins: ["https://portal.example.test"] }) }));
import { createServer, request as nodeRequest, type Server } from "node:http";
import superjson from "superjson";
import { afterAll, beforeAll } from "vitest";
import { createPolicyManagementApp, policyManagementRouter } from "../server/pbx/policy-management-http";
import { readPolicyManagementStartup, startPolicyManagementServer } from "../server/_core/policy-management-entry";

beforeEach(() => {
  vi.clearAllMocks();
  f.authenticate.mockImplementation(async (req: any) => req.headers.authorization === "Bearer generated" ? { id: 9 } : null);
  Object.assign(f, { memberships: [7, 8], cachedRole: "admin", liveRole: "admin", lockRows: [{ role: "admin" }],
    readRows: [], updateRows: [{ tenant_id: 7 }], failAudit: false, failStorage: false,
    pending: 0, committed: 0, audits: [], events: [] });
  f.binding.mockImplementation((tenantId: number) => ({ available: tenantId === 7 }));
  f.sharedTransaction.mockImplementation(() => { throw new Error("PRIVATE_PRIVILEGED_FALLBACK"); });
  f.query.mockImplementation(async (sql: string, parameters: unknown[]) => {
    if (sql.includes("ORDER BY tm.created_at ASC")) return { rows: f.memberships.map(tenant_id => ({
      tenant_id, user_id: 9, role: f.cachedRole, tenant_name: "Synthetic", tenant_status: "active",
    })) };
    if (sql.includes("SELECT tm.role FROM tenant_memberships tm")) {
      expect(parameters).toEqual([9, expect.any(Number)]);
      return { rows: ["admin", "owner"].includes(f.liveRole) ? [{ role: f.liveRole }] : [] };
    }
    throw new Error("PRIVATE_SHARED_STORAGE_QUERY");
  });
  f.client.mockImplementation(async (sql: string, parameters: unknown[] = []) => {
    if (f.failStorage) throw Object.assign(new Error("PRIVATE_DB_ROW"), { code: "42501" });
    if (sql.includes("phone11_lock_fixed_fraud_admin")) {
      f.events.push("LOCK"); expect(parameters).toEqual([9]); return { rows: f.lockRows };
    }
    if (sql.includes("FROM fraud_controls")) { f.events.push("READ"); expect(parameters).toEqual([7]); return { rows: f.readRows }; }
    if (sql.includes("INSERT INTO fraud_controls")) { f.events.push("WRITE"); f.pending++; return { rows: f.updateRows }; }
    if (sql.includes("INSERT INTO audit_logs")) {
      f.events.push("AUDIT"); f.audits.push(parameters);
      if (f.failAudit) throw Object.assign(new Error("PRIVATE_AUDIT_ROW"), { code: "42501" });
      return { rows: [] };
    }
    throw new Error("PRIVATE_UNEXPECTED_SQL");
  });
  f.transaction.mockImplementation(async (tenantId: number, callback: (client: any) => Promise<unknown>) => {
    expect(tenantId).toBe(7); f.events.push("BEGIN");
    try {
      const result = await callback({ query: f.client });
      f.events.push("COMMIT"); f.committed += f.pending; f.pending = 0; return result;
    } catch (error) { f.events.push("ROLLBACK"); f.pending = 0; throw error; }
    finally { f.events.push("RELEASE"); }
  });
});


let server: Server, port: number;
beforeAll(async () => {
  server = createServer(createPolicyManagementApp());
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
async function request(path: string, method = "GET", headers: Record<string, string> = {}, input?: unknown) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const body = input === undefined ? undefined : JSON.stringify(superjson.serialize(input));
    const req = nodeRequest({ host: "127.0.0.1", port, path, method, agent: false,
      headers: { ...(body ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) } : {}), ...headers } }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => { clearTimeout(timer); try { resolve({ status: response.statusCode!, body: Buffer.concat(chunks).length ? JSON.parse(Buffer.concat(chunks).toString()) : null }); } catch (error) { reject(error); } });
    });
    const timer = setTimeout(() => req.destroy(new Error("Generated request deadline")), 5000);
    req.on("error", error => { clearTimeout(timer); reject(error); });
    req.end(body);
  });
}
const headers = { Authorization: "Bearer generated" };
const getPath = (procedure: string, input: unknown = { tenantId: 7 }) => `/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(superjson.serialize(input)))}`;

describe("isolated management gateway", () => {
  it("keeps capability promises restricted to upgraded procedures", async () => {
    const result = await request(getPath("pbx.capabilities"), "GET", headers);
    expect(result.status).toBe(200);
    expect(result.body.result.data.json).toEqual({ phoneNumbers: true, explicitFraudControls: true });
    expect(f.authenticate).toHaveBeenCalledTimes(1);
  });
  it.each(["pbx.capabilities", "pbx.fraudControls.get"])("rejects anonymous %s with real protectedProcedure", async procedure => {
    expect((await request(getPath(procedure))).status).toBe(401);
    expect(f.query).not.toHaveBeenCalled(); expect(f.transaction).not.toHaveBeenCalled();
  });
  it.each(["pbx.capabilities", "pbx.fraudControls.get"])("rejects unknown selected tenant for %s", async procedure => {
    expect((await request(getPath(procedure, { tenantId: 99 }), "GET", headers)).status).toBe(403);
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it("rechecks live admin before policy reads", async () => {
    f.liveRole = "user";
    expect((await request(getPath("pbx.fraudControls.get"), "GET", headers)).status).toBe(403);
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it("retains policy helper locking and atomic audit on the dedicated executor", async () => {
    const result = await request("/api/trpc/pbx.fraudControls.update", "POST", headers, { tenantId: 7, internationalEnabled: true });
    expect(result.status).toBe(200); expect(result.body.result.data.json).toEqual({ success: true });
    expect(f.events).toEqual(["BEGIN", "LOCK", "WRITE", "AUDIT", "COMMIT", "RELEASE"]);
    expect(f.sharedTransaction).not.toHaveBeenCalled();
  });
  it("denies cross-tenant mutation before storage", async () => {
    expect((await request("/api/trpc/pbx.fraudControls.update", "POST", headers, { tenantId: 99, internationalEnabled: true })).status).toBe(403);
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it("rejects cookie-only POST lacking trusted Origin before authentication", async () => {
    expect((await request("/api/trpc/pbx.fraudControls.update", "POST", { Cookie: "generated=session" }, { tenantId: 7, internationalEnabled: true })).status).toBe(403);
    expect(f.authenticate).not.toHaveBeenCalled();
  });
  it.each([
    ["/api/trpc/pbx.fraudControls.get,pbx.capabilities", "GET"],
    ["/api/trpc/chat.list,pbx.fraudControls.get", "GET"],
    ["/api/trpc/pbx.fraudControls.get?batch=1", "GET"],
    ["/api/trpc/pbx.fraudControls.get?%62atch=1", "GET"],
    ["/api/trpc/pbx%2efraudControls.get", "GET"],
    ["/api/trpc/pbx%252efraudControls.get", "GET"],
    ["/api/trpc/pbx.fraudControls.get%252Cchat.list", "GET"],
    ["/api/trpc/pbx.fraudControls.get%2Cchat.list", "GET"],
    ["/api/trpc/pbx.fraudControls.get/", "GET"],
    ["/api/trpc//pbx.fraudControls.get", "GET"],
    ["/api/trpc/chat.list", "GET"],
    ["/api/auth/me", "GET"],
    ["/api/trpc/pbx.fraudControls.update", "GET"],
    ["/api/trpc/pbx.fraudControls.get", "POST"],
    ["/api/trpc/pbx.capabilities", "HEAD"],
    ["/api/trpc/pbx.fraudControls.update?input=x", "POST"],
    ["/api/trpc/pbx.capabilities?input=x&input=y", "GET"],
  ])("refuses noncanonical %s %s before authentication", async (path, method) => {
    expect((await request(path, method, headers)).status).toBeGreaterThanOrEqual(400);
    expect(f.authenticate).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled();
  });
  it("does not expose unrelated router procedures even to internal callers", () => {
    const names = Object.keys(policyManagementRouter._def.procedures).sort();
    expect(names).toEqual(["pbx.capabilities", "pbx.fraudControls.get", "pbx.fraudControls.update"]);
  });
  it("closes the owned policy pool if the admitted port is occupied", async () => {
    const prior = { ...process.env };
    Object.assign(process.env, { NODE_ENV: "production", PHONE11_RUNTIME_ROLE: "api-policy", PHONE11_POLICY_PORT: String(port), PHONE11_POLICY_LISTEN_HOST: "127.0.0.1", PHONE11_FRAUD_TENANT_ID: "7", PHONE11_BUILD_SHA: "generated-build" });
    try {
      await expect(startPolicyManagementServer()).rejects.toThrow("POLICY_MANAGEMENT_STARTUP_REFUSED");
      expect(f.transaction).toHaveBeenCalledTimes(1); expect(f.close).toHaveBeenCalledTimes(1);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
      Object.assign(process.env, prior);
    }
  });
  it("requires explicit production startup identity and binding host/port", () => {
    const env = { NODE_ENV: "production", PHONE11_RUNTIME_ROLE: "api-policy", PHONE11_POLICY_PORT: "3043", PHONE11_POLICY_LISTEN_HOST: "127.0.0.1", PHONE11_FRAUD_TENANT_ID: "7", PHONE11_BUILD_SHA: "generated-build" };
    expect(readPolicyManagementStartup(env)).toEqual({ port: 3043, host: "127.0.0.1", tenantId: 7, build: "generated-build" });
    for (const change of [{ NODE_ENV: "development" }, { PHONE11_RUNTIME_ROLE: "default" }, { PHONE11_POLICY_PORT: "3043x" }, { PHONE11_POLICY_LISTEN_HOST: "::" }]) expect(() => readPolicyManagementStartup({ ...env, ...change })).toThrow("POLICY_MANAGEMENT_STARTUP_REFUSED");
  });
});
