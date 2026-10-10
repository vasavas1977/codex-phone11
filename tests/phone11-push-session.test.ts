import { describe, expect, it, vi } from "vitest";
import { resolvePushSession } from "../server/push/session";
function fixture() {
  const current = { session: { id: "session-test", userId: "auth-1", expiresAt: new Date(Date.now()+60_000) }, user: { id: "auth-1" } };
  const getSession = vi.fn(async (_request?: any) => current), query = vi.fn(async () => ({ rows: [{}] }));
  return { current, getSession, query, auth: { api: { getSession } } as any, database: { query } as any };
}
describe("push registration authenticated-session binding", () => {
  it("requires request headers and a valid authenticated owner", async () => {
    const f = fixture(); await expect(resolvePushSession(undefined, 1, f.auth, f.database)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(resolvePushSession({}, 0, f.auth, f.database)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(f.getSession).not.toHaveBeenCalled();
  });
  it("uses fresh non-refreshing auth lookup, bearer precedence and explicit active identity mapping", async () => {
    const f = fixture(); expect(await resolvePushSession({ authorization: "Bearer fake-test-only", cookie: "another-user-cookie" }, 17, f.auth, f.database)).toBe("session-test");
    const request = f.getSession.mock.calls[0][0] as any;
    expect(request.headers.has("cookie")).toBe(false); expect(request.query).toEqual({ disableCookieCache: true, disableRefresh: true });
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("disabled_at IS NULL"), ["auth-1", 17]);
  });
  it.each(["missing", "expired", "mismatched", "invalid-expiry"])("rejects %s sessions before mapping lookup", async kind => {
    const f = fixture();
    if (kind === "missing") f.getSession.mockResolvedValue(null as any);
    if (kind === "expired") f.current.session.expiresAt = new Date(0);
    if (kind === "mismatched") f.current.session.userId = "different-auth-user";
    if (kind === "invalid-expiry") f.current.session.expiresAt = new Date("invalid");
    await expect(resolvePushSession({}, 1, f.auth, f.database)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(f.query).not.toHaveBeenCalled();
  });
  it("refuses an unmapped, remapped or disabled identity", async () => {
    const f = fixture(); f.query.mockResolvedValue({ rows: [] });
    await expect(resolvePushSession({}, 17, f.auth, f.database)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
