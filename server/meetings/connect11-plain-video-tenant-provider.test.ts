import { describe, expect, it, vi } from "vitest";

import {
  createConnect11PlainVideoTenantProvider,
  PlainVideoTenantProviderUnavailableError,
  readConnect11PlainVideoTenantConfiguration,
} from "./connect11-plain-video-tenant-provider";
import type { Connect11PlainVideoTenantExternalConfig } from "./connect11-plain-video-tenant-provider";
import { createConnect11PlainVideoFacade } from "./connect11-plain-video-facade";

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

const externalConfiguration = {
  enabled: true,
  tenants: [
    {
      tenantId: firstGrant.tenantId,
      customerKey: "customer_key_41",
      apiBaseUrl: "https://tenant-41.connect11.example",
      rtcUrl: "wss://media-41.connect11.example",
      statusCredential: "synthetic-status-credential-41",
      joinCredential: "synthetic-join-credential-41",
    },
    {
      tenantId: secondGrant.tenantId,
      customerKey: "customer_key_42",
      apiBaseUrl: "https://tenant-42.connect11.example",
      rtcUrl: "wss://media-42.connect11.example",
      statusCredential: "synthetic-status-credential-42",
      joinCredential: "synthetic-join-credential-42",
    },
  ],
};

const capabilities = {
  contract_version: "phone11-plain-video.v1",
  available: true,
  unavailable_reasons: [],
  grant_profiles: ["interactive", "listener"],
  token_ttl_seconds: 300,
  interpreter: { enabled: false, dispatch: "none", status: "not_applicable" },
};

function admissionFor(grant = firstGrant) {
  return {
    meetingId: grant.meetingId,
    participantId: `participant_${grant.tenantId}_${grant.userId}`,
    grantProfile: "interactive" as const,
  };
}

function providerFor(
  options: {
    raw?: unknown;
    resolve?: ReturnType<typeof vi.fn>;
    admit?: ReturnType<typeof vi.fn>;
    create?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const resolve = options.resolve ?? vi.fn().mockResolvedValue(admissionFor());
  const admit =
    options.admit ??
    vi.fn().mockResolvedValue({
      contract_version: "phone11-plain-video.v1",
      rtc_url: "wss://media-41.connect11.example/join",
      access_token: "short-lived-synthetic-token",
      expires_at: Math.floor(Date.now() / 1000) + 300,
    });
  const create = options.create ?? vi.fn().mockReturnValue({ admit });
  const configuration = readConnect11PlainVideoTenantConfiguration(
    Object.hasOwn(options, "raw") ? options.raw : externalConfiguration,
  );
  return {
    provider: createConnect11PlainVideoTenantProvider(
      configuration,
      { resolve },
      { create },
    ),
    resolve,
    admit,
    create,
  };
}

describe("Connect11 plain-video tenant provider", () => {
  it("defaults disabled and makes no admission, client, or token request when configuration is absent", async () => {
    const { provider, resolve, create, admit } = providerFor({
      raw: undefined,
    });
    await expect(provider.join(firstGrant)).rejects.toBeInstanceOf(
      PlainVideoTenantProviderUnavailableError,
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
  });

  it("admits before choosing the exact tenant configuration and constructing a client", async () => {
    const calls: string[] = [];
    const resolve = vi.fn(async () => {
      calls.push("admission");
      return admissionFor();
    });
    const admit = vi.fn(async () => ({
      contract_version: "phone11-plain-video.v1" as const,
      rtc_url: "wss://media-41.connect11.example/join",
      access_token: "short-lived-synthetic-token",
      expires_at: Math.floor(Date.now() / 1000) + 300,
    }));
    const create = vi.fn((config: Connect11PlainVideoTenantExternalConfig) => {
      calls.push(`config:${config.tenantId}`);
      return { admit };
    });
    const { provider } = providerFor({ resolve, create, admit });

    await expect(provider.join(firstGrant)).resolves.toEqual({
      url: "wss://media-41.connect11.example/join",
      token: "short-lived-synthetic-token",
      contract_version: "phone11-plain-video.v1",
      expires_at: expect.any(Number),
    });
    expect(calls).toEqual(["admission", "config:41"]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 41,
        customerKey: "customer_key_41",
      }),
    );
    expect(admit).toHaveBeenCalledWith(admissionFor());
  });

  it("does not select another tenant or call Connect11 when tenant admission rejects", async () => {
    const resolve = vi
      .fn()
      .mockRejectedValue(new Error("admission unavailable"));
    const { provider, create, admit } = providerFor({ resolve });
    await expect(provider.join(firstGrant)).rejects.toThrow(
      "admission unavailable",
    );
    expect(create).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown tenant after a valid admission without falling back to any global Customer key", async () => {
    const unknownGrant = { ...firstGrant, tenantId: 999 };
    const { provider, resolve, create, admit } = providerFor({
      resolve: vi.fn().mockResolvedValue(admissionFor(unknownGrant)),
    });
    await expect(provider.join(unknownGrant)).rejects.toBeInstanceOf(
      PlainVideoTenantProviderUnavailableError,
    );
    expect(resolve).toHaveBeenCalledWith(unknownGrant);
    expect(create).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
  });

  it("rejects malformed, unknown-field, insecure, duplicate-tenant, and duplicate-Customer-key mappings", () => {
    const cases: unknown[] = [
      "not json",
      { enabled: true },
      { ...externalConfiguration, unexpected: true },
      {
        ...externalConfiguration,
        tenants: [
          {
            ...externalConfiguration.tenants[0],
            apiBaseUrl: "http://unsafe.example",
          },
        ],
      },
      {
        ...externalConfiguration,
        tenants: [
          {
            ...externalConfiguration.tenants[0],
            rtcUrl: "https://not-wss.example",
          },
        ],
      },
      {
        ...externalConfiguration,
        tenants: [
          externalConfiguration.tenants[0],
          { ...externalConfiguration.tenants[1], tenantId: 41 },
        ],
      },
      {
        ...externalConfiguration,
        tenants: [
          externalConfiguration.tenants[0],
          {
            ...externalConfiguration.tenants[1],
            customerKey: "customer_key_41",
          },
        ],
      },
    ];
    for (const value of cases) {
      expect(readConnect11PlainVideoTenantConfiguration(value)).toEqual({
        enabled: false,
      });
    }
  });

  it("defensively disables a malformed configuration passed directly to the composition seam", async () => {
    const bypassedParser = {
      enabled: true,
      tenants: [
        externalConfiguration.tenants[0],
        { ...externalConfiguration.tenants[1], customerKey: "customer_key_41" },
      ],
    } as never;
    const resolve = vi.fn();
    const create = vi.fn();
    const provider = createConnect11PlainVideoTenantProvider(
      bypassedParser,
      { resolve },
      { create },
    );
    await expect(provider.join(firstGrant)).rejects.toBeInstanceOf(
      PlainVideoTenantProviderUnavailableError,
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant RTC endpoint and malformed trusted admission before exposing a token", async () => {
    const wrongRtc = providerFor({
      admit: vi.fn().mockResolvedValue({
        contract_version: "phone11-plain-video.v1",
        rtc_url: "wss://media-42.connect11.example/join",
        access_token: "short-lived-synthetic-token",
        expires_at: Math.floor(Date.now() / 1000) + 300,
      }),
    });
    await expect(wrongRtc.provider.join(firstGrant)).rejects.toBeInstanceOf(
      PlainVideoTenantProviderUnavailableError,
    );

    const malformedAdmission = providerFor({
      resolve: vi
        .fn()
        .mockResolvedValue({
          ...admissionFor(),
          participantId: "display name",
        }),
    });
    await expect(
      malformedAdmission.provider.join(firstGrant),
    ).rejects.toBeInstanceOf(PlainVideoTenantProviderUnavailableError);
    expect(malformedAdmission.create).not.toHaveBeenCalled();
  });

  it("uses the actual facade contract and preserves its version and expiry", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const request = vi
      .fn()
      .mockImplementationOnce(async () => new Response(JSON.stringify(capabilities)))
      .mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify({
              contract_version: "phone11-plain-video.v1",
              rtc_url: "wss://media-41.connect11.example/join",
              access_token: "short-lived-synthetic-token",
              expires_at: expiresAt,
            }),
          ),
      );
    const create = vi.fn((config: Connect11PlainVideoTenantExternalConfig) =>
      createConnect11PlainVideoFacade(
        {
          baseUrl: config.apiBaseUrl,
          statusCredential: config.statusCredential,
          joinCredential: config.joinCredential,
        },
        request,
      ),
    );
    const resolve = vi.fn().mockResolvedValue(admissionFor());
    const provider = createConnect11PlainVideoTenantProvider(
      readConnect11PlainVideoTenantConfiguration(externalConfiguration),
      { resolve },
      { create },
    );

    await expect(provider.join(firstGrant)).resolves.toEqual({
      url: "wss://media-41.connect11.example/join",
      token: "short-lived-synthetic-token",
      contract_version: "phone11-plain-video.v1",
      expires_at: expiresAt,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1].headers.authorization).toBe(
      "Bearer synthetic-status-credential-41",
    );
    expect(request.mock.calls[1][1].headers.authorization).toBe(
      "Bearer synthetic-join-credential-41",
    );
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
      meeting_id: firstGrant.meetingId,
      participant_id: "participant_41_7",
      grant_profile: "interactive",
    });
  });

  it("rejects duplicate join credentials and facade-contract deviations", async () => {
    expect(
      readConnect11PlainVideoTenantConfiguration({
        ...externalConfiguration,
        tenants: [
          externalConfiguration.tenants[0],
          {
            ...externalConfiguration.tenants[1],
            joinCredential: externalConfiguration.tenants[0].joinCredential,
          },
        ],
      }),
    ).toEqual({ enabled: false });

    for (const malformedToken of [
      {
        rtc_url: "wss://media-41.connect11.example/join",
        access_token: "short-lived-synthetic-token",
      },
      {
        contract_version: "phone11-plain-video.v2",
        rtc_url: "wss://media-41.connect11.example/join",
        access_token: "short-lived-synthetic-token",
        expires_at: Math.floor(Date.now() / 1000) + 300,
      },
      {
        contract_version: "phone11-plain-video.v1",
        rtc_url: "wss://media-41.connect11.example/join",
        access_token: "short-lived-synthetic-token",
        expires_at: Math.floor(Date.now() / 1000) + 300,
        unexpected: true,
      },
      {
        contract_version: "phone11-plain-video.v1",
        rtc_url: "wss://media-41.connect11.example/join",
        access_token: "short-lived-synthetic-token",
        expires_at: Math.floor(Date.now() / 1000) - 1,
      },
      {
        contract_version: "phone11-plain-video.v1",
        rtc_url: "wss://media-41.connect11.example/join",
        access_token: "short-lived-synthetic-token",
        expires_at: Math.floor(Date.now() / 1000) + 3_600,
      },
    ]) {
      const { provider } = providerFor({
        admit: vi.fn().mockResolvedValue(malformedToken),
      });
      await expect(provider.join(firstGrant)).rejects.toBeInstanceOf(
        PlainVideoTenantProviderUnavailableError,
      );
    }
  });
});
