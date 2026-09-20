import { EventEmitter } from "node:events";
import { createServer, request } from "node:http";
import type { Socket } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPhone11Shutdown,
  Phone11ShutdownTimeoutError,
  type Phone11BackgroundLifecycle,
} from "../server/_core/runtime-role";
import { startChatNotificationDispatcher } from "../server/chat-notifications/dispatcher";
import { startChatMediaRetention } from "../server/chat/media";
import { startRecordingCaptureService } from "../server/cloud-recordings/capture-service";
import {
  startRecordingAnalysisWorker,
  startRecordingRetentionWorker,
} from "../server/cloud-recordings/worker";
import { FreeSwitchEventListener } from "../server/pbx/fs-event-listener";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  for (let count = 0; count < 6; count++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Phone11 graceful shutdown", () => {
  it("lets an admitted producer finish before stopping and draining its background worker", async () => {
    const requestStarted = deferred();
    const releaseRequest = deferred();
    const releaseBackground = deferred();
    const producer = vi.fn();
    const server = createServer(async (_request, response) => {
      requestStarted.resolve();
      await releaseRequest.promise;
      producer();
      response.end("done");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test listener");

    const activeRequest = new Promise<void>((resolve, reject) => {
      const call = request({ hostname: "127.0.0.1", port: address.port, headers: { connection: "close" } }, response => {
        response.resume();
        response.once("end", resolve);
      });
      call.once("error", reject);
      call.end();
    });
    await requestStarted.promise;

    const background: Phone11BackgroundLifecycle = {
      start: vi.fn(),
      stop: vi.fn(() => releaseBackground.promise),
    };
    const shutdown = createPhone11Shutdown(server, background, 2_000);
    const first = shutdown();
    expect(shutdown()).toBe(first);
    expect(background.stop).not.toHaveBeenCalled();

    const refused = await new Promise<boolean>(resolve => {
      const call = request({ hostname: "127.0.0.1", port: address.port, timeout: 250 }, response => {
        response.resume();
        resolve(false);
      });
      call.once("error", () => resolve(true));
      call.once("timeout", () => { call.destroy(); resolve(true); });
      call.end();
    });
    expect(refused).toBe(true);

    let drained = false;
    void first.then(() => { drained = true; });
    releaseRequest.resolve();
    await activeRequest;
    await flushMicrotasks();
    expect(producer).toHaveBeenCalledOnce();
    expect(background.stop).toHaveBeenCalledOnce();
    expect(producer.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(background.stop).mock.invocationCallOrder[0],
    );
    expect(drained).toBe(false);
    releaseBackground.resolve();
    await expect(first).resolves.toBeUndefined();
  });

  it("fails a bounded drain honestly and force-closes connections", async () => {
    vi.useFakeTimers();
    const closeAllConnections = vi.fn();
    const server = { close: vi.fn(), closeAllConnections };
    const background: Phone11BackgroundLifecycle = {
      start: vi.fn(),
      stop: vi.fn(async () => undefined),
    };
    const shutdown = createPhone11Shutdown(server, background, 25);
    const result = shutdown();
    expect(background.stop).not.toHaveBeenCalled();
    const rejection = expect(result).rejects.toBeInstanceOf(Phone11ShutdownTimeoutError);
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(background.stop).toHaveBeenCalledOnce();
    expect(closeAllConnections).toHaveBeenCalledOnce();
    expect(shutdown()).toBe(result);
  });

  it("waits for an in-flight notification provider attempt before stopping", async () => {
    const provider = deferred();
    const delivery = {
      id: "11111111-1111-4111-8111-111111111111",
      revision: "revision",
      token: "a".repeat(64),
      bundleId: "ai.phone11.mobile",
      environment: "production" as const,
      registeredAt: Date.now(),
      registeredVersion: new Date().toISOString(),
      expiresAt: Date.now() + 60_000,
    };
    const repository = {
      claim: vi.fn().mockResolvedValueOnce(delivery).mockResolvedValue(null),
      current: vi.fn(async () => true),
      finish: vi.fn(async () => undefined),
      removeInvalid: vi.fn(async () => undefined),
      prune: vi.fn(async () => undefined),
    };
    const send = vi.fn(async () => { await provider.promise; });
    const stop = startChatNotificationDispatcher({
      repository,
      send,
      enabled: () => true,
      initialDelayMs: 1,
      intervalMs: 60_000,
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(send).toHaveBeenCalledOnce();

    const stopping = stop();
    let stopped = false;
    void stopping.then(() => { stopped = true; });
    await flushMicrotasks();
    expect(stopped).toBe(false);
    provider.resolve();
    await expect(stopping).resolves.toBeUndefined();
    expect(repository.finish).toHaveBeenCalledWith(delivery, true);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(repository.claim).toHaveBeenCalledOnce();
    await expect(stop()).resolves.toBeUndefined();
  });

  it("stops new recording and media ticks while awaiting active work", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PHONE11_RECORDING_AI_ENABLED", "true");
    vi.stubEnv("GEMINI_API_KEY", "configured-for-test");
    vi.stubEnv("PHONE11_RECORDING_GEMINI_MODEL", "configured-for-test");
    vi.stubEnv("PHONE11_RECORDING_RETENTION_ENABLED", "true");
    const release = deferred();
    const processJob = vi.fn(async () => { await release.promise; return "idle" as const; });
    const processPurge = vi.fn(async () => { await release.promise; return "idle" as const; });
    const captureTick = vi.fn(async () => { await release.promise; });
    const mediaPurge = vi.fn(async () => { await release.promise; return 0; });

    const stops = [
      startRecordingAnalysisWorker({ repository: {} as never, processJob, intervalMs: 10 }),
      startRecordingRetentionWorker({ repository: {} as never, processPurge, intervalMs: 10 }),
      startRecordingCaptureService({ instance: { tick: captureTick }, intervalMs: 10 }),
      startChatMediaRetention({ enabled: true, purge: mediaPurge, intervalMs: 10 }),
    ];
    expect(processJob).toHaveBeenCalledOnce();
    expect(processPurge).toHaveBeenCalledOnce();
    expect(captureTick).toHaveBeenCalledOnce();
    expect(mediaPurge).toHaveBeenCalledOnce();

    const stopping = Promise.all(stops.map(stop => stop()));
    let stopped = false;
    void stopping.then(() => { stopped = true; });
    await flushMicrotasks();
    expect(stopped).toBe(false);
    release.resolve();
    await stopping;
    vi.advanceTimersByTime(1_000);
    await flushMicrotasks();
    expect(processJob).toHaveBeenCalledOnce();
    expect(processPurge).toHaveBeenCalledOnce();
    expect(captureTick).toHaveBeenCalledOnce();
    expect(mediaPurge).toHaveBeenCalledOnce();
    await Promise.all(stops.map(stop => stop()));
  });

  it("suppresses an ESL reconnect already scheduled when stop begins", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    class FakeSocket extends EventEmitter {
      destroyed = false;
      closed = false;
      connect(_port: number, _host: string, connected?: () => void) {
        connected?.();
        return this;
      }
      write() { return true; }
      destroy() {
        if (this.closed) return this;
        this.destroyed = true;
        this.closed = true;
        this.emit("close");
        return this;
      }
    }
    const first = new FakeSocket();
    const createSocket = vi.fn(() => first as unknown as Socket);
    const listener = new FreeSwitchEventListener({
      createSocket,
      loadConfig: () => ({ host: "127.0.0.1", port: 8021, password: "test" }),
      reconnectDelayMs: 10,
    });
    listener.start();
    first.emit("close");
    await listener.stop();
    await listener.stop();
    vi.advanceTimersByTime(100);
    expect(createSocket).toHaveBeenCalledOnce();
  });
});
