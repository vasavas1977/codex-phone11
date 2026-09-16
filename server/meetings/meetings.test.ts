import { describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

import { createMeetingService, joinMeetingSchema } from "./service";
import { createIsolatedCoreGuardProvider, meetingCoordinates } from "./provider";
import { createMeetingRepository } from "./repository";
import { meetingsRouter } from "./router";

const grant = {
  meetingId: "12345678-1234-4234-8234-123456789012",
  tenantId: 7,
  userId: 8,
};
const config = {
  apiBaseUrl: "https://provider.example/functions/v1",
  serverCredential: "server-only-test",
  livekitUrl: "wss://media.example",
  livekitIssuer: "test-issuer",
  livekitSigningSecret: "synthetic-test-signing-secret-long-enough",
  isolatedProjectVerified: true as const,
};

async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ video: { room: meetingCoordinates(grant).room, roomJoin: true }, ...overrides })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(config.livekitIssuer)
    .setSubject(meetingCoordinates(grant).identity)
    .setExpirationTime(Math.floor(Date.now() / 1000) + 120)
    .sign(new TextEncoder().encode(config.livekitSigningSecret));
}

describe("meeting admission", () => {
  it("is disabled by default without looking up membership", async () => {
    const authorize = vi.fn();
    const service = createMeetingService({ authorize });
    expect(service.capabilities().available).toBe(false);
    await expect(service.join(8, { meetingId: grant.meetingId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("rejects client-selected room, identity, tenant, mode and role", () => {
    for (const key of ["room", "identity", "tenantId", "mode", "role"]) {
      expect(joinMeetingSchema.safeParse({ meetingId: grant.meetingId, [key]: "attacker" }).success).toBe(false);
    }
  });

  it("checks tenant and meeting membership together", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    expect(await createMeetingRepository({ query } as never).authorize(8, grant.meetingId)).toBeNull();
    const [sql, values] = query.mock.calls[0];
    expect(values).toEqual([8, grant.meetingId]);
    for (const predicate of ["tm.tenant_id=r.tenant_id", "tm.user_id=$1", "m.tenant_id=r.tenant_id", "m.revoked_at IS NULL", "r.ended_at IS NULL"]) {
      expect(sql).toContain(predicate);
    }
  });

  it("requires authentication for the mounted API", async () => {
    const caller = meetingsRouter.createCaller({ user: null, req: {}, res: {} } as never);
    await expect(caller.capabilities()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.join({ meetingId: grant.meetingId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("isolated provider adapter", () => {
  it("derives video-only coordinates on the server", async () => {
    const signed = await token();
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: config.livekitUrl, token: signed })));
    await expect(createIsolatedCoreGuardProvider(config, request).join(grant)).resolves.toEqual({ url: config.livekitUrl, token: signed });
    expect(request.mock.calls[0][0]).toBe("https://provider.example/functions/v1/get-livekit-token");
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ ...meetingCoordinates(grant), mode: "video_only", sourceLang: "th", targetLang: "th" });
  });

  it("rejects unverified isolation, unsafe endpoints and elevated grants", async () => {
    expect(() => createIsolatedCoreGuardProvider({ ...config, isolatedProjectVerified: false } as never)).toThrow();
    expect(() => createIsolatedCoreGuardProvider({ ...config, apiBaseUrl: "http://provider.example" })).toThrow();
    const signed = await token({ video: { room: meetingCoordinates(grant).room, roomJoin: true, roomAdmin: true } });
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: config.livekitUrl, token: signed })));
    await expect(createIsolatedCoreGuardProvider(config, request).join(grant)).rejects.toThrow("grants exceed");
  });

  it("does not return provider payloads through the service", async () => {
    const service = createMeetingService({ authorize: async () => grant }, { join: async () => { throw new Error("token=private"); } });
    await expect(service.join(8, { meetingId: grant.meetingId })).rejects.toThrow("Meeting provider is unavailable");
  });
});
