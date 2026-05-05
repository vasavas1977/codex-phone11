/**
 * Redis Connection for PBX
 * 
 * Used for:
 * - mod_xml_curl response caching (directory + dialplan)
 * - Rate limiting (fraud controls)
 * - Agent state (queue members online/idle/busy)
 * - Idempotency key dedup
 * - Session/tenant context caching
 */
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
      lazyConnect: true,
    });

    _redis.on("error", (err) => {
      console.warn("[Redis] Connection error:", err.message);
    });

    _redis.on("connect", () => {
      console.log("[Redis] Connected");
    });

    // Attempt connection but don't block if Redis is unavailable
    _redis.connect().catch((err) => {
      console.warn("[Redis] Initial connection failed (will retry):", err.message);
    });
  }
  return _redis;
}

/**
 * Cache helper: get or set with TTL
 */
export async function cacheGetOrSet<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  const redis = getRedis();
  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
  } catch {
    // Redis unavailable, fall through to fetch
  }

  const value = await fetchFn();

  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch {
    // Redis unavailable, skip caching
  }

  return value;
}

/**
 * Rate limiter: sliding window counter
 * Returns true if the action is allowed, false if rate-limited.
 */
export async function rateLimitCheck(
  key: string,
  maxCount: number,
  windowSeconds: number
): Promise<boolean> {
  const redis = getRedis();
  try {
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, windowSeconds);
    }
    return current <= maxCount;
  } catch {
    // Redis unavailable — allow by default (fail-open)
    return true;
  }
}

/**
 * Idempotency check: returns cached response or null
 */
export async function idempotencyCheck(key: string): Promise<any | null> {
  const redis = getRedis();
  try {
    const cached = await redis.get(`idem:${key}`);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

/**
 * Idempotency set: cache response for 24h
 */
export async function idempotencySet(key: string, response: any): Promise<void> {
  const redis = getRedis();
  try {
    await redis.setex(`idem:${key}`, 86400, JSON.stringify(response));
  } catch {
    // Redis unavailable, skip
  }
}

/**
 * Invalidate cache by pattern
 */
export async function invalidateCache(pattern: string): Promise<void> {
  const redis = getRedis();
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // Redis unavailable, skip
  }
}
