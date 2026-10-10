import { afterEach, describe, expect, it, vi } from "vitest";
import { createSipCredentials, decryptSecret, encryptSecret } from "../server/pbx/sip-secrets";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SIP credential encryption key", () => {
  it("rejects production encryption and decryption without an explicit key", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SIP_DEK_SECRET", undefined);

    expect(() => encryptSecret("test-password")).toThrow(/SIP_DEK_SECRET is required/);
    expect(() => decryptSecret(Buffer.alloc(1), Buffer.alloc(12), Buffer.alloc(16)))
      .toThrow(/SIP_DEK_SECRET is required/);
    expect(() => createSipCredentials("3001", undefined, undefined, "test-password"))
      .toThrow(/SIP_DEK_SECRET is required/);
    vi.stubEnv("SIP_DEK_SECRET", "   ");
    expect(() => encryptSecret("test-password")).toThrow(/SIP_DEK_SECRET is required/);
  });

  it("keeps configured-key ciphertext readable with the existing derivation and format", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SIP_DEK_SECRET", "test-only-configured-production-key");

    const credentials = createSipCredentials("3001", undefined, undefined, "test-password");
    expect(credentials.dekId).toBe("dek-v1");
    expect(credentials.secretIv).toHaveLength(12);
    expect(credentials.secretTag).toHaveLength(16);
    expect(decryptSecret(credentials.secretCiphertext, credentials.secretIv, credentials.secretTag))
      .toBe("test-password");
  });

  it("preserves the historical development key but does not use it after entering production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SIP_DEK_SECRET", undefined);
    const encrypted = encryptSecret("legacy-local-password");
    expect(decryptSecret(encrypted.ciphertext, encrypted.iv, encrypted.tag))
      .toBe("legacy-local-password");

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SIP_DEK_SECRET", "test-only-different-production-key");
    expect(() => decryptSecret(encrypted.ciphertext, encrypted.iv, encrypted.tag)).toThrow();
  });
});
