import type { PoolClient } from "pg";

export const PROFILE_PHOTO_CLEANUP_INTERVAL_DEFAULT_MS = 15 * 60_000;
export const PROFILE_PHOTO_CLEANUP_INTERVAL_MIN_MS = 60_000;
export const PROFILE_PHOTO_CLEANUP_INTERVAL_MAX_MS = 24 * 60 * 60_000;
export const PROFILE_PHOTO_CLEANUP_LOCK_KEY = "phone11-profile-photo-cleanup-worker:v1";

export class ProfilePhotoCleanupLeaseLostError extends Error {
  constructor() {
    super("Profile photo cleanup lease connection was lost");
    this.name = "ProfilePhotoCleanupLeaseLostError";
  }
}

export interface ProfilePhotoCleanupWorkerOptions {
  acquireLease: () => Promise<ProfilePhotoCleanupLease>;
  maintain: () => Promise<number>;
  intervalMs?: number;
  log?: (event: "cycle-complete" | "cycle-failed" | "lease-lost", details: { deleted?: number; code?: string }) => void;
  onFatal?: (error: ProfilePhotoCleanupLeaseLostError) => void;
  setInterval?: (handler: () => void, timeoutMs: number) => NodeJS.Timeout;
  clearInterval?: (timer: NodeJS.Timeout) => void;
}

export interface ProfilePhotoCleanupLease {
  assertHealthy(): Promise<void>;
  release(): Promise<void>;
}

export interface ProfilePhotoCleanupWorker {
  stop(): Promise<void>;
}

function validateInterval(value: number): number {
  if (!Number.isSafeInteger(value)
    || value < PROFILE_PHOTO_CLEANUP_INTERVAL_MIN_MS
    || value > PROFILE_PHOTO_CLEANUP_INTERVAL_MAX_MS) {
    throw new Error("Profile photo worker interval must be between 60000 and 86400000 ms");
  }
  return value;
}

function safeErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? code : undefined;
}

/** Starts exactly one bounded cleanup cycle at a time while holding a lease. */
export async function startProfilePhotoCleanupWorker(
  options: ProfilePhotoCleanupWorkerOptions,
): Promise<ProfilePhotoCleanupWorker> {
  const intervalMs = validateInterval(options.intervalMs ?? PROFILE_PHOTO_CLEANUP_INTERVAL_DEFAULT_MS);
  const clear = options.clearInterval ?? globalThis.clearInterval;
  const lease = await options.acquireLease();
  let stopped = false;
  let activeCycle: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  let leaseReleasePromise: Promise<void> | undefined;
  const releaseLease = () => leaseReleasePromise ??= lease.release();

  const runCycle = (): Promise<void> => {
    if (stopped || activeCycle) return activeCycle ?? Promise.resolve();
    const cycle = Promise.resolve()
      .then(() => lease.assertHealthy())
      .then(options.maintain)
      .then(deleted => { try { options.log?.("cycle-complete", { deleted }); } catch { /* logging must not stop cleanup */ } })
      .catch(async error => {
        if (error instanceof ProfilePhotoCleanupLeaseLostError) {
          stopped = true;
          clear(timer);
          try { options.log?.("lease-lost", { code: safeErrorCode(error) }); } catch { /* keep failure handling alive */ }
          try { await releaseLease(); } catch { /* a dead DB connection cannot retain the session lock */ }
          try { options.onFatal?.(error); } catch { /* caller still receives fatal state via process supervisor */ }
          return;
        }
        try { options.log?.("cycle-failed", { code: safeErrorCode(error) }); } catch { /* keep the timer alive */ }
      })
      .then(() => undefined);
    activeCycle = cycle;
    void cycle.finally(() => {
      if (activeCycle === cycle) activeCycle = undefined;
    });
    return cycle;
  };

  const timer = (options.setInterval ?? globalThis.setInterval)(() => { void runCycle(); }, intervalMs) as NodeJS.Timeout;
  timer.unref?.();
  void runCycle();

  return {
    stop() {
      if (stopPromise) return stopPromise;
      stopped = true;
      clear(timer);
      stopPromise = (async () => {
        await activeCycle;
        await releaseLease();
      })();
      return stopPromise;
    },
  };
}

/** Retain this connection for the worker lifetime; PostgreSQL releases the lock if it dies. */
export async function acquireProfilePhotoCleanupLease(client: PoolClient): Promise<ProfilePhotoCleanupLease> {
  let result;
  try {
    result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [PROFILE_PHOTO_CLEANUP_LOCK_KEY],
    );
  } catch (error) {
    client.release();
    throw error;
  }
  if (result.rows[0]?.acquired !== true) {
    client.release();
    throw new Error("A Phone11 profile photo cleanup worker already owns the lease");
  }

  let released = false;
  return {
    async assertHealthy() {
      if (released) throw new Error("Profile photo cleanup lease was released");
      try {
        await client.query("SELECT 1");
      } catch {
        released = true;
        client.release(true);
        throw new ProfilePhotoCleanupLeaseLostError();
      }
    },
    async release() {
      if (released) return;
      released = true;
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [PROFILE_PHOTO_CLEANUP_LOCK_KEY]);
      } finally {
        client.release();
      }
    },
  };
}
