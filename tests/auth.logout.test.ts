import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ revoke: vi.fn() }));
vi.mock("../server/_core/phone11-auth", () => ({
  revokePhone11Session: auth.revoke,
  resolvePhone11User: vi.fn(),
}));
import { appRouter } from "../server/routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "../server/_core/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];
  
  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "phone11",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  
  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      hostname: "api.phone11.test",
      headers: {},
    } as TrpcContext["req"],
    res: {
      setHeader: vi.fn(),
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as unknown as TrpcContext["res"],
  };
  
  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  beforeEach(() => {
    auth.revoke.mockReset();
    auth.revoke.mockResolvedValue(new Response("{}", {
      headers: { "set-cookie": "phone11.session_token=; Path=/; HttpOnly; Max-Age=0" },
    }));
  });
  it("revokes the server session before clearing cookies and reporting success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(auth.revoke).toHaveBeenCalledWith(ctx.req.headers);
    expect(ctx.res.setHeader).toHaveBeenCalledWith("Set-Cookie", [expect.stringContaining("phone11.session_token=")]);
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: -1,
      secure: true,
      sameSite: "none",
      httpOnly: true,
      path: "/",
    });
  });
  it("propagates a revocation failure without clearing cookies or claiming success", async () => {
    auth.revoke.mockRejectedValueOnce(new Error("Revocation unavailable"));
    const { ctx, clearedCookies } = createAuthContext();
    await expect(appRouter.createCaller(ctx).auth.logout()).rejects.toThrow("Revocation unavailable");
    expect(clearedCookies).toHaveLength(0);
    expect(ctx.res.setHeader).not.toHaveBeenCalled();
  });
});
