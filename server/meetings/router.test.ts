import { describe, expect, it, vi } from "vitest";

import { connect11PlainVideoTenantConfigEnvironment } from "./connect11-plain-video-config";
import type { PlainVideoAdmissionLease } from "./plain-video-admission-lease-repository";
import { createMeetingsRouter } from "./router";

const meetingId = "12345678-1234-4234-8234-123456789012";
const user = { id: 7, name: "Meeting member" };
const grant = { meetingId, tenantId: 41, userId: user.id };
const configuration = {
  enabled: true,
  tenants: [{
    tenantId: 41, customerKey: "customer_key_41",
    apiBaseUrl: "https://tenant-41.connect11.example",
    rtcUrl: "wss://media-41.connect11.example",
    statusCredential: "synthetic-status-credential-41",
    joinCredential: "synthetic-join-credential-41",
  }],
};
const admission = { meetingId, participantId: "participant_41_7", grantProfile: "interactive" as const };
const lease: PlainVideoAdmissionLease = {
  meeting_id: meetingId, tenant_id: 41, user_id: user.id,
  participant_id: admission.participantId, grant_profile: admission.grantProfile,
  room_revision: "22345678-1234-4234-8234-123456789012",
  member_revision: "32345678-1234-4234-8234-123456789012",
  leaseId: "42345678-1234-4234-8234-123456789012",
  expiresAt: new Date("2026-09-19T00:05:00.000Z"),
};

function caller(rawConfiguration: unknown, dependencies: Parameters<typeof createMeetingsRouter>[1]) {
  return createMeetingsRouter(
    { [connect11PlainVideoTenantConfigEnvironment]: typeof rawConfiguration === "string" ? rawConfiguration : JSON.stringify(rawConfiguration) },
    dependencies,
  ).createCaller({ user, req: {}, res: {} } as never);
}

describe("mounted plain-video meetings router", () => {
  it("is unavailable by default and performs no admission or provider work", async () => {
    const authorize = vi.fn();
    const prepare = vi.fn();
    const create = vi.fn();
    const api = createMeetingsRouter({}, {
      repository: { authorize }, resolver: { prepare, confirm: vi.fn() }, clientFactory: { create },
    }).createCaller({ user, req: {}, res: {} } as never);
    await expect(api.capabilities()).resolves.toMatchObject({ available: false });
    await expect(api.join({ meetingId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(authorize).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("joins one explicit tenant only after durable prepare and confirm", async () => {
    const authorize = vi.fn().mockResolvedValue(grant);
    const prepare = vi.fn().mockResolvedValue({ admission, lease });
    const confirm = vi.fn().mockResolvedValue(admission);
    const admit = vi.fn().mockResolvedValue({
      contract_version: "phone11-plain-video.v1" as const,
      rtc_url: "wss://media-41.connect11.example/join",
      access_token: "short-lived-token", expires_at: Math.floor(Date.now() / 1_000) + 300,
    });
    const create = vi.fn(() => ({ admit }));
    const api = caller(configuration, {
      repository: { authorize }, resolver: { prepare, confirm }, clientFactory: { create },
    });
    await expect(api.capabilities()).resolves.toMatchObject({ available: true, video: true });
    await expect(api.join({ meetingId })).resolves.toMatchObject({ url: "wss://media-41.connect11.example/join" });
    expect(prepare).toHaveBeenCalledWith(grant);
    expect(confirm).toHaveBeenCalledWith(lease);
    expect(admit).toHaveBeenCalledWith(admission);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 41 }));
  });

  it("rejects malformed or duplicate mapping before durable admission", async () => {
    for (const raw of ["not-json", { ...configuration, tenants: [configuration.tenants[0], configuration.tenants[0]] }]) {
      const authorize = vi.fn();
      const prepare = vi.fn();
      const create = vi.fn();
      const api = caller(raw, {
        repository: { authorize }, resolver: { prepare, confirm: vi.fn() }, clientFactory: { create },
      });
      await expect(api.join({ meetingId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(authorize).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    }
  });

  it("does not construct a facade when durable authorization or revision confirmation fails", async () => {
    const denied = caller(configuration, {
      repository: { authorize: vi.fn().mockResolvedValue(null) },
      resolver: { prepare: vi.fn(), confirm: vi.fn() }, clientFactory: { create: vi.fn() },
    });
    await expect(denied.join({ meetingId })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const prepare = vi.fn().mockResolvedValue({ admission, lease });
    const confirm = vi.fn().mockRejectedValue(new Error("revoked"));
    const admit = vi.fn().mockResolvedValue({
      contract_version: "phone11-plain-video.v1" as const,
      rtc_url: "wss://media-41.connect11.example/join",
      access_token: "short-lived-token", expires_at: Math.floor(Date.now() / 1_000) + 300,
    });
    const api = caller(configuration, {
      repository: { authorize: vi.fn().mockResolvedValue(grant) },
      resolver: { prepare, confirm }, clientFactory: { create: vi.fn(() => ({ admit })) },
    });
    await expect(api.join({ meetingId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(admit).toHaveBeenCalledWith(admission);
  });
});
