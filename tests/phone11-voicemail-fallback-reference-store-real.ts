/** Disposable Redis integration harness. Run only against an isolated Redis
 * instance; never point this at the production cache. */
import assert from "node:assert/strict";
import Redis from "ioredis";
import { createVoicemailFallbackReferenceStore, FALLBACK_REFERENCE_PATTERN } from "../server/pbx/voicemail-fallback-reference-store";

async function main() {
  const url = process.env.PHONE11_VOICEMAIL_TEST_REDIS_URL;
  if (!url) throw Error("Isolated test Redis URL required");
  const store = createVoicemailFallbackReferenceStore(url);
  const snapshot = {
    input: { authenticatedCallerUsername: "3001", authenticatedCallerRealm: "phone11.invalid",
      canonicalTargetUsername: "1020", canonicalTargetDomain: "phone11.invalid", terminalCause: "no-answer" },
    identity: { tenantId: 12, caller: { extensionId: 41, userId: 17, sipUsername: "3001", sipDomain: "phone11.invalid" },
      target: { extensionId: 42, ownerUserId: 18, ownerEpoch: "11111111-1111-4111-8111-111111111111",
        extensionNumber: "1020", sipUsername: "1020", sipDomain: "phone11.invalid" } },
    callId: "call@phone11.invalid", fromTag: "tag-1",
  };
  const redis = new Redis(url, { enableOfflineQueue: false, retryStrategy: () => null });
  try {
    const ref = await store.issue(snapshot);
    assert.match(ref, FALLBACK_REFERENCE_PATTERN);
    const key = `phone11:voicemail:local-fallback:v1:${ref}`;
    const ttl = await redis.ttl(key);
    assert(ttl > 0 && ttl <= 30);
    const outcomes = await Promise.all(Array.from({ length: 16 }, () => store.consume(ref)));
    assert.equal(outcomes.filter(Boolean).length, 1);
    assert.deepEqual(outcomes.find(Boolean), snapshot);
    assert.equal(await store.consume(ref), null);
    const expiring = await store.issue(snapshot);
    await redis.pexpire(`phone11:voicemail:local-fallback:v1:${expiring}`, 10);
    await new Promise(done => setTimeout(done, 40));
    assert.equal(await store.consume(expiring), null);
    process.stdout.write("isolated_real_redis_pass\n");
  } finally { redis.disconnect(); }
}

main().catch(() => { process.stderr.write("isolated_real_redis_failed\n"); process.exitCode = 1; });
