import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPbxReadinessHttpGuard } from "../server/_core/pbx-readiness-http";

function request(path = "/pbx.databaseReadiness", method = "GET", header: unknown = "1", query = {}) {
  const next = vi.fn();
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
  const suppliedHeader = arguments.length >= 3 ? arguments[2] : header;
  createPbxReadinessHttpGuard()({ path, method, headers: { "x-phone11-read-only-probe": suppliedHeader }, query } as any, res as any, next);
  return { next, res };
}
describe("pre-auth readonly diagnostic guard", () => {
  it("admits only the exact unbatched GET protocol", () => { expect(request().next).toHaveBeenCalledTimes(1); expect(request("/pbx%2EdatabaseReadiness").next).toHaveBeenCalledTimes(1); });
  it.each([
    ["/pbx.databaseReadiness", "POST", "1", {}],
    ["/pbx.databaseReadiness", "GET", undefined, {}],
    ["/pbx.databaseReadiness", "GET", ["1"], {}],
    ["/pbx.databaseReadiness", "GET", "1", { batch: "1" }],
    ["/pbx.databaseReadiness,pbx.tenant.get", "GET", "1", {}],
    ["/pbx.databaseReadiness%2Cpbx.tenant.get", "GET", "1", {}],
    ["/pbx.databaseReadiness/other", "GET", "1", {}],
  ])("refuses malformed/ordinary probe before next/auth context", (path, method, header, query) => {
    const r = request(path as string, method as string, header, query as object);
    expect(r.next).not.toHaveBeenCalled(); expect(r.res.status).toHaveBeenCalledWith(400);
    expect(r.res.json).toHaveBeenCalledWith({ error: "Use an unbatched read-only diagnostic GET" });
  });
  it("preserves ordinary routes and existing auth semantics", () => { expect(request("/pbx.tenant.get", "POST", undefined).next).toHaveBeenCalledTimes(1); });
  it("does not echo malformed private URL fragments", () => { const r = request("/%FFPRIVATE"); expect(r.next).not.toHaveBeenCalled(); expect(JSON.stringify(r.res.json.mock.calls)).not.toContain("PRIVATE"); });
  it("is mounted before middleware that creates authentication context", () => {
    const source = readFileSync(resolve(process.cwd(), "server/_core/index.ts"), "utf8");
    expect(source.indexOf('app.use("/api/trpc", createPbxReadinessHttpGuard())')).toBeLessThan(source.indexOf("createExpressMiddleware({"));
  });
});
