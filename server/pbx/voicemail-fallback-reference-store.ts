import { randomBytes } from "node:crypto";
import Redis from "ioredis";
import type { LocalVoicemailFallbackIdentity, LocalVoicemailFallbackInput } from "./voicemail-fallback-authority";

/** This is a short-lived authorization handoff, not a SIP transaction ledger. */
export interface VoicemailFallbackReferenceSnapshot {
  input: LocalVoicemailFallbackInput;
  identity: LocalVoicemailFallbackIdentity;
  callId: string;
  fromTag: string;
}

export interface VoicemailFallbackReferenceStore {
  issue(snapshot: VoicemailFallbackReferenceSnapshot): Promise<string>;
  consume(reference: string): Promise<VoicemailFallbackReferenceSnapshot | null>;
}

export const FALLBACK_REFERENCE_TTL_SECONDS = 30;
export const FALLBACK_REFERENCE_PATTERN = /^[a-f0-9]{64}$/;
const PREFIX = "phone11:voicemail:local-fallback:v1:";
const CONSUME_SCRIPT = `local value = redis.call('GET', KEYS[1])
if value then redis.call('DEL', KEYS[1]) end
return value`;

export class FallbackReferenceStoreUnavailable extends Error {
  constructor() { super("Fallback reference store unavailable"); }
}

/** Each operation owns a bounded connection. The ordinary PBX Redis cache is
 * deliberately not used: it retries/offline-queues and fails open. */
export function createVoicemailFallbackReferenceStore(redisUrl: string | undefined = process.env.REDIS_URL): VoicemailFallbackReferenceStore {
  async function withRedis<T>(work: (redis: Redis) => Promise<T>): Promise<T> {
    if (!redisUrl) throw new FallbackReferenceStoreUnavailable();
    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      connectTimeout: 750,
      commandTimeout: 750,
    });
    // Avoid leaking URL or data in transport diagnostics.
    redis.on("error", () => undefined);
    try {
      await redis.connect();
      return await work(redis);
    } catch {
      throw new FallbackReferenceStoreUnavailable();
    } finally {
      redis.disconnect();
    }
  }

  return {
    async issue(snapshot) {
      return withRedis(async redis => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const reference = randomBytes(32).toString("hex");
          const result = await redis.set(`${PREFIX}${reference}`, JSON.stringify(snapshot), "EX", FALLBACK_REFERENCE_TTL_SECONDS, "NX");
          if (result === "OK") return reference;
        }
        throw new FallbackReferenceStoreUnavailable();
      });
    },
    async consume(reference) {
      if (!FALLBACK_REFERENCE_PATTERN.test(reference)) return null;
      return withRedis(async redis => {
        const raw = await redis.eval(CONSUME_SCRIPT, 1, `${PREFIX}${reference}`);
        if (raw === null) return null;
        if (typeof raw !== "string") throw new FallbackReferenceStoreUnavailable();
        try { return JSON.parse(raw) as VoicemailFallbackReferenceSnapshot; }
        catch { throw new FallbackReferenceStoreUnavailable(); }
      });
    },
  };
}
