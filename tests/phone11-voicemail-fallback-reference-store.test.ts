import Redis from "ioredis";
import { describe, expect, it } from "vitest";
import {
  createVoicemailFallbackReferenceStore,
  FallbackReferenceStoreUnavailable,
  FALLBACK_REFERENCE_PATTERN,
  FALLBACK_REFERENCE_TTL_SECONDS,
  type VoicemailFallbackReferenceSnapshot,
} from "../server/pbx/voicemail-fallback-reference-store";

const redisUrl = process.env.PHONE11_VOICEMAIL_TEST_REDIS_URL;
const snapshot: VoicemailFallbackReferenceSnapshot = {
  input: {
    authenticatedCallerUsername: "3001", authenticatedCallerRealm: "phone11.invalid",
    canonicalTargetUsername: "1020", canonicalTargetDomain: "phone11.invalid", terminalCause: "timeout",
  },
  identity: {
    tenantId: 12,
    caller: { extensionId: 41, userId: 17, sipUsername: "3001", sipDomain: "phone11.invalid" },
    target: { extensionId: 42, ownerUserId: 18, ownerEpoch: "11111111-1111-4111-8111-111111111111",
      extensionNumber: "1020", sipUsername: "1020", sipDomain: "phone11.invalid" },
  },
  callId: "test-call@phone11.invalid", fromTag: "test-tag",
};

describe("fallback reference store failure boundary", () => {
  it("fails closed without an explicitly configured Redis URL", async () => {
    const store = createVoicemailFallbackReferenceStore("");
    await expect(store.issue(snapshot)).rejects.toBeInstanceOf(FallbackReferenceStoreUnavailable);
    await expect(store.consume("a".repeat(64))).rejects.toBeInstanceOf(FallbackReferenceStoreUnavailable);
  });

  it("does not touch Redis for malformed references", async () => {
    const store = createVoicemailFallbackReferenceStore("");
    expect(await store.consume("bad")).toBeNull();
  });

  it("fails boundedly if an isolated Redis listener is unavailable", async () => {
    const store = createVoicemailFallbackReferenceStore("redis://127.0.0.1:1");
    await expect(store.issue(snapshot)).rejects.toBeInstanceOf(FallbackReferenceStoreUnavailable);
  });
});

describe.skipIf(!redisUrl)("fallback one-use references against isolated real Redis", () => {
  it("issues a 256-bit opaque reference with a short TTL and consumes atomically", async () => {
    const store = createVoicemailFallbackReferenceStore(redisUrl);
    const reference = await store.issue(snapshot);
    expect(reference).toMatch(FALLBACK_REFERENCE_PATTERN);
    const inspector = new Redis(redisUrl!, { enableOfflineQueue: false, retryStrategy: () => null });
    try {
      const key = `phone11:voicemail:local-fallback:v1:${reference}`;
      const ttl = await inspector.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(FALLBACK_REFERENCE_TTL_SECONDS);
      const results = await Promise.all(Array.from({ length: 12 }, () => store.consume(reference)));
      expect(results.filter(Boolean)).toEqual([snapshot]);
      expect(results.filter(value => value === null)).toHaveLength(11);
      expect(await inspector.exists(key)).toBe(0);
    } finally { inspector.disconnect(); }
  });

  it("expires promptly and never replays", async () => {
    const store = createVoicemailFallbackReferenceStore(redisUrl);
    const reference = await store.issue(snapshot);
    const inspector = new Redis(redisUrl!, { enableOfflineQueue: false, retryStrategy: () => null });
    try {
      await inspector.pexpire(`phone11:voicemail:local-fallback:v1:${reference}`, 15);
      await new Promise(done => setTimeout(done, 40));
      expect(await store.consume(reference)).toBeNull();
      expect(await store.consume(reference)).toBeNull();
    } finally { inspector.disconnect(); }
  });
});
