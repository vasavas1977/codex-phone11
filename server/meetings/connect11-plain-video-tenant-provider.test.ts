import { describe, expect, it, vi } from "vitest";

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
      rtc_url: "wss://media-41.connect11.example/join",
      access_token: "short-lived-synthetic-token",
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
      rtc_url: "wss://media-41.connect11.example/join",
      access_token: "short-lived-synthetic-token",
    }));
    const create = vi.fn((config: Connect11PlainVideoTenantExternalConfig) => {
      calls.push(`config:${config.tenantId}`);
      return { admit };
    });
    const { provider } = providerFor({ resolve, create, admit });

    await expect(provider.join(firstGrant)).resolves.toEqual({
      url: "wss://media-41.connect11.example/join",
      token: "short-lived-synthetic-token",
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
        rtc_url: "wss://media-42.connect11.example/join",
        access_token: "short-lived-synthetic-token",
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
});
