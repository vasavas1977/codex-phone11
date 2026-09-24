import { describe, expect, it, vi } from "vitest";

import type { PlainVideoAdmissionLease } from "./plain-video-admission-lease-repository";
import { createConnect11PlainVideoFacade } from "./connect11-plain-video-facade";
import { createPlainVideoAdmissionResolver } from "./plain-video-admission-resolver";
import {
  createConnect11PlainVideoTenantProvider,
  PlainVideoTenantProviderUnavailableError,
  readConnect11PlainVideoTenantConfiguration,
} from "./connect11-plain-video-tenant-provider";
import type { Connect11PlainVideoTenantExternalConfig } from "./connect11-plain-video-tenant-provider";

const firstGrant = {
  meetingId: "12345678-1234-4234-8234-123456789012",
  tenantId: 41,
  userId: 7,
};
const secondGrant = {
  meetingId: "22345678-1234-4234-8234-123456789012",
  tenantId: 42,
  userId: 8,
};

const configuration = {
  enabled: true,
  tenants: [
    {
      tenantId: 41,
      customerKey: "customer_key_41",
      apiBaseUrl: "https://tenant-41.connect11.example",
      rtcUrl: "wss://media-41.connect11.example",
      statusCredential: "synthetic-status-credential-41",
      joinCredential: "synthetic-join-credential-41",
    },
    {
      tenantId: 42,
      customerKey: "customer_key_42",
      apiBaseUrl: "https://tenant-42.connect11.example",
      rtcUrl: "wss://media-42.connect11.example",
      statusCredential: "synthetic-status-credential-42",
      joinCredential: "synthetic-join-credential-42",
    },
  ],
};

type Grant = { meetingId: string; tenantId: number; userId: number };

function admissionFor(grant: Grant = firstGrant) {
  return {
    meetingId: grant.meetingId,
    participantId: `participant_${grant.tenantId}_${grant.userId}`,
    grantProfile: "interactive" as const,
  };
}

function leaseFor(grant: Grant = firstGrant, admission = admissionFor(grant)): PlainVideoAdmissionLease {
  return {
    meeting_id: grant.meetingId,
    tenant_id: grant.tenantId,
    user_id: grant.userId,
    participant_id: admission.participantId,
    grant_profile: admission.grantProfile,
    room_revision: "32345678-1234-4234-8234-123456789012",
    member_revision: "42345678-1234-4234-8234-123456789012",
    leaseId: "52345678-1234-4234-8234-123456789012",
    expiresAt: new Date("2026-09-19T00:05:00.000Z"),
  };
}

function resolverFor(resolveAdmission: (grant: Grant) => ReturnType<typeof admissionFor> = admissionFor) {
  const prepare = vi.fn(async (grant) => {
    const admission = resolveAdmission(grant);
    return { admission, lease: leaseFor(grant, admission) };
  });
  const confirm = vi.fn(async (lease: PlainVideoAdmissionLease) => ({
    meetingId: lease.meeting_id,
    participantId: lease.participant_id,
    grantProfile: lease.grant_profile,
  }));
  return { resolver: { prepare, confirm }, prepare, confirm };
}

const capabilities = {
  contract_version: "phone11-plain-video.v1",
  available: true,
  unavailable_reasons: [],
  grant_profiles: ["interactive", "listener"],
  token_ttl_seconds: 300,
  interpreter: { enabled: false, dispatch: "none", status: "not_applicable" },
};

describe("Connect11 plain-video tenant provider", () => {
  it("defaults disabled without preparing admission or constructing a client", async () => {
    for (const raw of [undefined, { enabled: false }]) {
      const prepare = vi.fn();
      const create = vi.fn();
      const provider = createConnect11PlainVideoTenantProvider(
        readConnect11PlainVideoTenantConfiguration(raw),
        { prepare, confirm: vi.fn() },
        { create },
      );
      await expect(provider.join(firstGrant)).rejects.toBeInstanceOf(
        PlainVideoTenantProviderUnavailableError,
      );
      expect(prepare).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    }
  });

  it("selects only the durable tenant and confirms the lease after a token response", async () => {
    const { resolver, prepare, confirm } = resolverFor();
    const selected: number[] = [];
    const create = vi.fn((tenant: Connect11PlainVideoTenantExternalConfig) => {
      selected.push(tenant.tenantId);
      return {
        admit: vi.fn().mockResolvedValue({
          contract_version: "phone11-plain-video.v1" as const,
          rtc_url: `${tenant.rtcUrl}/join`,
          access_token: "short-lived-token",
          expires_at: Math.floor(Date.now() / 1_000) + 300,
        }),
      };
    });
    const provider = createConnect11PlainVideoTenantProvider(
      readConnect11PlainVideoTenantConfiguration(configuration), resolver, { create },
    );

    await expect(provider.join(secondGrant)).resolves.toMatchObject({
      url: "wss://media-42.connect11.example/join",
      contract_version: "phone11-plain-video.v1",
    });
    expect(prepare).toHaveBeenCalledWith(secondGrant);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 42 }));
    expect(selected).toEqual([42]);
  });

  it("fails closed for malformed, duplicate, or unknown tenant configuration", async () => {
    for (const raw of [
      "not JSON",
      { enabled: true, tenants: [] },
      { ...configuration, unexpected: true },
      { ...configuration, tenants: [configuration.tenants[0], { ...configuration.tenants[1], tenantId: 41 }] },
      { ...configuration, tenants: [configuration.tenants[0], { ...configuration.tenants[1], joinCredential: configuration.tenants[0].joinCredential }] },
    ]) {
      expect(readConnect11PlainVideoTenantConfiguration(raw)).toEqual({ enabled: false });
    }

    const { resolver, confirm } = resolverFor((grant) => admissionFor({
      meetingId: grant.meetingId,
      tenantId: 99,
      userId: grant.userId,
    }));
    const create = vi.fn();
    const provider = createConnect11PlainVideoTenantProvider(
      readConnect11PlainVideoTenantConfiguration(configuration), resolver, { create },
    );
    await expect(provider.join({ ...firstGrant, tenantId: 99 })).rejects.toBeInstanceOf(
      PlainVideoTenantProviderUnavailableError,
    );
    expect(create).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("rejects another tenant origin and a revision changed during issuance", async () => {
    const { resolver, confirm } = resolverFor();
    confirm.mockResolvedValueOnce({ ...admissionFor(), participantId: "changed_member" });
    const provider = createConnect11PlainVideoTenantProvider(
      readConnect11PlainVideoTenantConfiguration(configuration), resolver,
      {
        create: vi.fn().mockReturnValue({
          admit: vi.fn().mockResolvedValue({
            contract_version: "phone11-plain-video.v1",
            rtc_url: "wss://media-42.connect11.example/join",
            access_token: "short-lived-token",
            expires_at: Math.floor(Date.now() / 1_000) + 300,
          }),
        }),
      },
    );
    await expect(provider.join(firstGrant)).rejects.toBeInstanceOf(PlainVideoTenantProviderUnavailableError);
  });

  it("keeps status and token requests on the opaque contract and confirms before return", async () => {
    const expiresAt = Math.floor(Date.now() / 1_000) + 300;
    const request = vi
      .fn()
      .mockImplementationOnce(async () => new Response(JSON.stringify(capabilities)))
      .mockImplementationOnce(async () => new Response(JSON.stringify({
        contract_version: "phone11-plain-video.v1",
        rtc_url: "wss://media-41.connect11.example/join",
        access_token: "short-lived-token",
        expires_at: expiresAt,
      })));
    const { resolver, confirm } = resolverFor();
    const provider = createConnect11PlainVideoTenantProvider(
      readConnect11PlainVideoTenantConfiguration(configuration), resolver,
      { create: (tenant) => createConnect11PlainVideoFacade({
        baseUrl: tenant.apiBaseUrl,
        statusCredential: tenant.statusCredential,
        joinCredential: tenant.joinCredential,
      }, request) },
    );

    await expect(provider.join(firstGrant)).resolves.toMatchObject({
      url: "wss://media-41.connect11.example/join",
      expires_at: expiresAt,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
      meeting_id: firstGrant.meetingId,
      participant_id: "participant_41_7",
      grant_profile: "interactive",
    });
  });

  it("sends a normalized tenant directory label only for the opted-in tenant", async () => {
    const bodies: Record<string, unknown>[] = [];
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({
          contract_version: "phone11-plain-video.v1",
          rtc_url: "wss://media-41.connect11.example/join",
          access_token: "synthetic",
          expires_at: Math.floor(Date.now() / 1_000) + 300,
        }));
      }
      return new Response(JSON.stringify(capabilities));
    });
    const begin = vi.fn(async (_grant: Grant, withName?: boolean) => ({
      ...leaseFor(),
      ...(withName ? { displayName: "  e\u0301 สวัสดี 👩‍💻  " } : {}),
    }));
    const resolver = createPlainVideoAdmissionResolver(vi.fn(), {
      begin,
      confirm: vi.fn().mockResolvedValue(leaseFor()),
    });
    const factory = { create: (tenant: Connect11PlainVideoTenantExternalConfig) =>
      createConnect11PlainVideoFacade({ baseUrl: tenant.apiBaseUrl,
        statusCredential: tenant.statusCredential, joinCredential: tenant.joinCredential }, request) };
    const baseTenant = configuration.tenants[0];
    for (const displayNameEnabled of [undefined, true]) {
      const provider = createConnect11PlainVideoTenantProvider(
        readConnect11PlainVideoTenantConfiguration({ enabled: true,
          tenants: [{ ...baseTenant, ...(displayNameEnabled ? { displayNameEnabled } : {}) }] }),
        resolver, factory,
      );
      await provider.join(firstGrant);
    }
    expect(bodies[0]).toEqual({ meeting_id: firstGrant.meetingId,
      participant_id: "participant_41_7", grant_profile: "interactive" });
    expect(bodies[1]).toEqual({ ...bodies[0], display_name: "é สวัสดี 👩‍💻" });
    expect(begin.mock.calls[0]).toEqual([firstGrant]);
    expect(begin.mock.calls[1]).toEqual([firstGrant, true]);
  });
});
