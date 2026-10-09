import { afterEach, expect, it, vi } from "vitest";
const driver = vi.hoisted(() => ({ query: vi.fn(), on: vi.fn() }));
vi.mock("pg", () => ({ default: { Pool: vi.fn(function () { return driver; }) } }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it("logs constant events while preserving caller errors and pool behavior", async () => {
  vi.stubEnv("PG_HOST", "fixture"); vi.stubEnv("PG_USER", "fixture"); vi.stubEnv("PG_PASSWORD", "PRIVATE_PASSWORD"); vi.stubEnv("PG_DATABASE", "fixture");
  vi.stubEnv("PG_CONNECTION_STRING", "");
  const error = new Error("PRIVATE_DSN_ROLE_CAUSE"); const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const { getPool, query } = await import("../server/pbx/db");
  getPool(); const idle = driver.on.mock.calls.find(([event]) => event === "error")![1]; idle(error);
  driver.query.mockRejectedValue(error);
  await expect(query("PRIVATE_SQL", ["PRIVATE_PARAMETER"])).rejects.toBe(error);
  expect(log.mock.calls).toEqual([["[PBX DB] Pool error"], ["[PBX DB] Query error"]]);
  expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
});
