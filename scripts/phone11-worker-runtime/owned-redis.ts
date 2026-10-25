/** Worker graph only. Never imported by the ordinary API's Redis module. */
import Redis from "ioredis";
let configured: string | undefined;
let client: Redis | undefined;
let closed = false;
let closing: Promise<void> | undefined;
let connecting: Promise<void> | undefined;
const pending = new Set<Promise<unknown>>();
const ended = (value: Redis): boolean => value.status === "end";

export function configureWorkerRedis(url: string): void {
  if (configured || client || closed) throw new Error("WORKER_REDIS_BINDING_REFUSED");
  try {
    if (typeof url !== "string") throw new Error();
    const parsed = new URL(url);
    if (typeof url !== "string" || url.length > 4096 || !["redis:", "rediss:"].includes(parsed.protocol)
      || !parsed.hostname || parsed.search || parsed.hash || !/^\/(?:0|[1-9][0-9]?)?$/.test(parsed.pathname)) throw new Error();
    configured = url;
  } catch { throw new Error("WORKER_REDIS_BINDING_REFUSED"); }
}

export function getRedis(): { publish(channel: string, message: string): Promise<number> } {
  if (!configured || closed) throw new Error("WORKER_REDIS_UNAVAILABLE");
  if (!client) {
    client = new Redis(configured, {
      lazyConnect: true, connectTimeout: 5000, commandTimeout: 10_000,
      maxRetriesPerRequest: 0, enableOfflineQueue: false, retryStrategy: () => null,
    });
    client.on("error", () => undefined);
  }
  // Only the exact websocket graph's publish operation is supplied. It cannot
  // obtain an untracked client, reconnect control or arbitrary Redis commands.
  return { publish(channel: string, message: string) {
    if (!client || closed || channel !== "pbx:events") return Promise.reject(new Error("WORKER_REDIS_UNAVAILABLE"));
    const captured = client;
    const task = (async () => {
      if (captured.status !== "ready") {
        if (!connecting) {
          const current = captured.connect().then(() => undefined);
          connecting = current;
          void current.then(() => { if (connecting === current) connecting = undefined; },
            () => { if (connecting === current) connecting = undefined; });
        }
        await connecting;
      }
      return captured.publish(channel, message);
    })();
    pending.add(task);
    void task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  } };
}

export function closeWorkerRedis(): Promise<void> {
  if (closing) return closing;
  closed = true;
  const captured = client;
  closing = (async () => {
    // Producers stop first; already admitted publications settle before close.
    const results = await Promise.allSettled([...pending]);
    // Publication is best effort in the maintained websocket actor. Rejection
    // is an outcome, not an active task. Never replay it during shutdown.
    void results;
    if (captured && !ended(captured)) {
      captured.disconnect(false);
      if (!ended(captured)) await new Promise<void>(resolve => captured!.once("end", resolve));
    }
  })().catch(() => { throw new Error("WORKER_REDIS_CLOSE_UNCONFIRMED"); });
  return closing;
}
