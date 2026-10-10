import { describe, expect, it, vi } from "vitest";
import {
  PROFILE_PHOTO_CLEANUP_INTERVAL_MAX_MS,
  PROFILE_PHOTO_CLEANUP_INTERVAL_MIN_MS,
  ProfilePhotoCleanupLeaseLostError,
  acquireProfilePhotoCleanupLease,
  startProfilePhotoCleanupWorker,
} from "../server/profile/photo-cleanup-worker";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("Phone11 profile photo cleanup worker", () => {
  it("runs one immediate cleanup cycle and releases its lease on stop", async () => {
    const maintain = vi.fn().mockResolvedValue(3);
    const release = vi.fn().mockResolvedValue(undefined);
    const lease = { assertHealthy: vi.fn().mockResolvedValue(undefined), release };
    const timer = { unref: vi.fn() } as unknown as NodeJS.Timeout;
    const setInterval = vi.fn(() => timer);
    const clearInterval = vi.fn();
    const log = vi.fn();
    const worker = await startProfilePhotoCleanupWorker({
      acquireLease: vi.fn().mockResolvedValue(lease), maintain, log, setInterval, clearInterval,
    });

    await vi.waitFor(() => expect(maintain).toHaveBeenCalledOnce());
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 15 * 60_000);
    expect(timer.unref).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("cycle-complete", { deleted: 3 });
    await worker.stop();
    await worker.stop();
    expect(clearInterval).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("waits for an in-flight cleanup before releasing ownership", async () => {
    const cycle = deferred<number>();
    const release = vi.fn().mockResolvedValue(undefined);
    const worker = await startProfilePhotoCleanupWorker({
      acquireLease: async () => ({ assertHealthy: async () => undefined, release }),
      maintain: () => cycle.promise,
      setInterval: (() => ({ unref() {} }) as unknown as NodeJS.Timeout),
      clearInterval: () => undefined,
    });

    let stopped = false;
    const stopping = worker.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(release).not.toHaveBeenCalled();
    cycle.resolve(0);
    await stopping;
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not start a second tick while the first is still running", async () => {
    const cycle = deferred<number>();
    const maintain = vi.fn(() => cycle.promise);
    let tick!: () => void;
    const worker = await startProfilePhotoCleanupWorker({
      acquireLease: async () => ({ assertHealthy: async () => undefined, release: async () => undefined }),
      maintain,
      setInterval: (callback: () => void) => { tick = callback; return { unref() {} } as unknown as NodeJS.Timeout; },
      clearInterval: () => undefined,
    });

    await vi.waitFor(() => expect(maintain).toHaveBeenCalledOnce());
    tick();
    tick();
    expect(maintain).toHaveBeenCalledOnce();
    cycle.resolve(0);
    await vi.waitFor(() => expect(maintain).toHaveBeenCalledOnce());
    await worker.stop();
  });

  it("logs failures without exposing their message and continues on the next interval", async () => {
    const maintain = vi.fn().mockRejectedValueOnce(Object.assign(new Error("secret connection URL"), { code: "ECONNRESET" })).mockResolvedValueOnce(0);
    const log = vi.fn();
    let tick!: () => void;
    const worker = await startProfilePhotoCleanupWorker({
      acquireLease: async () => ({ assertHealthy: async () => undefined, release: async () => undefined }),
      maintain,
      log,
      setInterval: (callback: () => void) => { tick = callback; return { unref() {} } as unknown as NodeJS.Timeout; },
      clearInterval: () => undefined,
    });

    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("cycle-failed", { code: "ECONNRESET" }));
    tick();
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("cycle-complete", { deleted: 0 }));
    expect(maintain).toHaveBeenCalledTimes(2);
    await worker.stop();
  });

  it("stops and notifies the supervisor when the lease is lost", async () => {
    const maintain = vi.fn().mockResolvedValue(0);
    const release = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    const onFatal = vi.fn();
    let tick!: () => void;
    const clearInterval = vi.fn();
    const worker = await startProfilePhotoCleanupWorker({
      acquireLease: async () => ({
        assertHealthy: async () => { throw new ProfilePhotoCleanupLeaseLostError(); },
        release,
      }),
      maintain,
      log,
      onFatal,
      setInterval: (callback: () => void) => { tick = callback; return { unref() {} } as unknown as NodeJS.Timeout; },
      clearInterval,
    });

    await vi.waitFor(() => expect(onFatal).toHaveBeenCalledWith(expect.any(ProfilePhotoCleanupLeaseLostError)));
    expect(maintain).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("lease-lost", { code: undefined });
    expect(clearInterval).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    tick();
    expect(maintain).not.toHaveBeenCalled();
    await worker.stop();
  });

  it("destroys the failed PostgreSQL lease connection and reports loss", async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ acquired: true }] }).mockRejectedValueOnce(new Error("connection closed")),
      release: vi.fn(),
    } as unknown as import("pg").PoolClient;
    const lease = await acquireProfilePhotoCleanupLease(client);
    await expect(lease.assertHealthy()).rejects.toBeInstanceOf(ProfilePhotoCleanupLeaseLostError);
    expect(client.release).toHaveBeenCalledWith(true);
    await lease.release();
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it("fails closed when lease acquisition fails and validates the bounded interval", async () => {
    await expect(startProfilePhotoCleanupWorker({
      acquireLease: async () => { throw new Error("already owned"); },
      maintain: async () => 0,
    })).rejects.toThrow("already owned");
    await expect(startProfilePhotoCleanupWorker({
      acquireLease: async () => ({ assertHealthy: async () => undefined, release: async () => undefined }),
      maintain: async () => 0,
      intervalMs: PROFILE_PHOTO_CLEANUP_INTERVAL_MIN_MS - 1,
    })).rejects.toThrow("between 60000 and 86400000 ms");
    await expect(startProfilePhotoCleanupWorker({
      acquireLease: async () => ({ assertHealthy: async () => undefined, release: async () => undefined }),
      maintain: async () => 0,
      intervalMs: PROFILE_PHOTO_CLEANUP_INTERVAL_MAX_MS + 1,
    })).rejects.toThrow("between 60000 and 86400000 ms");
  });

  it("holds a PostgreSQL session advisory lock until release", async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ acquired: true }] }).mockResolvedValueOnce({ rows: [{ healthy: 1 }] }).mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }),
      release: vi.fn(),
    } as unknown as import("pg").PoolClient;
    const lease = await acquireProfilePhotoCleanupLease(client);
    expect(client.query).toHaveBeenCalledOnce();
    expect(client.release).not.toHaveBeenCalled();
    await lease.assertHealthy();
    await lease.release();
    await lease.release();
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("releases the database connection when another worker owns the lock", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ acquired: false }] }),
      release: vi.fn(),
    } as unknown as import("pg").PoolClient;
    await expect(acquireProfilePhotoCleanupLease(client)).rejects.toThrow("already owns the lease");
    expect(client.release).toHaveBeenCalledOnce();
  });
});
