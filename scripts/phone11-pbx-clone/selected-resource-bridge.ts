/** Clone transport aliases only. No business/auth/capability responses are synthesized. */
import type pg from "pg";
import type { CloneAdapter, CloneClient, ClonePool } from "./real-pg-adapter";

export const LOCAL_REDIS_URL = "redis://127.0.0.1:6379";
const MAX_KEYS = 64;
const MAX_VALUE_BYTES = 16384;
let adapter: CloneAdapter | undefined;
let used = false;
let closed = false;
const cache = new Map<string, { value: string; expires: number }>();
function refused(): never { throw new Error("RESOURCE_BRIDGE_REFUSED"); }
function active(): CloneAdapter {
  if (!adapter || closed) refused();
  return adapter;
}
/** Called only after genuine real-pg admission by the single-use entry. */
export function bindSelectedResources(value: CloneAdapter, signal: AbortSignal): void {
  if (used || !(signal instanceof AbortSignal) || signal.aborted || !value ||
      typeof value.getPool !== "function" || typeof value.query !== "function" ||
      typeof value.withTransaction !== "function" || typeof value.close !== "function") refused();
  used = true;
  adapter = value;
  signal.addEventListener("abort", retireSelectedResources, { once: true });
}
export function retireSelectedResources(): void { closed = true; adapter = undefined; cache.clear(); }
export function getPool(): ClonePool { return active().getPool(); }
export function query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>> {
  return active().query<R>(text, values);
}
export function withTransaction<T>(fn: (client: CloneClient) => Promise<T>): Promise<T> {
  return active().withTransaction(fn);
}
function expire(): void {
  const now = Date.now();
  for (const [value, stored] of cache) if (stored.expires <= now) cache.delete(value);
}
function key(value: string): void {
  if (typeof value !== "string" || !/^(?:tenant:memberships|dialplan:ivr):[1-9][0-9]{0,9}$/.test(value)) refused();
}
/** ioredis transport alias, NOT an alias for the real PBX Redis wrapper.
 * No socket/events/retry/production invalidation proof. Values are real wrapper cache data in private memory.
 */
export default class LocalSelectedRedisTransport {
  constructor(url: string, options: { maxRetriesPerRequest: number; lazyConnect: boolean; retryStrategy: unknown }) {
    active();
    if (url !== LOCAL_REDIS_URL || !options || Object.keys(options).length !== 3 || options.maxRetriesPerRequest !== 3 || options.lazyConnect !== true || typeof options.retryStrategy !== "function") refused();
  }
  on(event: string, listener: unknown): this {
    active();
    if (!["error", "connect"].includes(event) || typeof listener !== "function") refused();
    // There is no network connection to emit a connection/error event for.
    return this;
  }
  async connect(): Promise<void> { active(); }
  async get(value: string): Promise<string | null> {
    active(); key(value);
    const stored = cache.get(value);
    if (!stored) return null;
    if (stored.expires <= Date.now()) { cache.delete(value); return null; }
    return stored.value;
  }
  async setex(value: string, seconds: number, body: string): Promise<"OK"> {
    active(); key(value); expire();
    if (seconds !== 300 || typeof body !== "string" || Buffer.byteLength(body, "utf8") > MAX_VALUE_BYTES || (!cache.has(value) && cache.size >= MAX_KEYS)) refused();
    cache.set(value, { value: body, expires: Date.now() + seconds * 1000 });
    return "OK";
  }
  async keys(pattern: string): Promise<string[]> {
    active(); expire();
    if (typeof pattern !== "string" || !/^dialplan:ivr:(?:[1-9][0-9]{0,9}|\*)$/.test(pattern)) refused();
    const prefix = pattern === "dialplan:ivr:*";
    return [...cache.keys()].filter(value => prefix ? value.startsWith("dialplan:ivr:") : value === pattern);
  }
  async del(...values: string[]): Promise<number> {
    active();
    if (values.length > MAX_KEYS) refused();
    values.forEach(key);
    let removed = 0;
    for (const value of values) if (cache.delete(value)) removed++;
    return removed;
  }
}
