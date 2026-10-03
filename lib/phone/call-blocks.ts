import { contactPhoneKey } from "./phone-number";

export type CallBlockReason = "spam" | "other";

export interface CallBlockEntry {
  number: string;
  reason: CallBlockReason;
  updatedAt: number;
}

export interface CallBlockStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface CallBlocksSnapshot {
  ownerUserId: number | null;
  entries: readonly CallBlockEntry[];
  loading: boolean;
  error: string | null;
}

const MAX_BLOCKS = 1_000;
const blockKey = (owner: number) => `phone11_call_blocks_v1_user_${owner}`;

export function callBlockNumberKey(number: string): string {
  return contactPhoneKey(number) ?? number.normalize("NFKC").trim();
}

function decodeBlocks(raw: string | null): CallBlockEntry[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("Invalid call blocklist");
  const entries = new Map<string, CallBlockEntry>();
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      !("number" in item) ||
      typeof item.number !== "string" ||
      !("reason" in item) ||
      (item.reason !== "spam" && item.reason !== "other") ||
      !("updatedAt" in item) ||
      !Number.isFinite(item.updatedAt)
    )
      continue;
    const number = callBlockNumberKey(item.number);
    if (!number || number.length > 64) continue;
    const entry = { number, reason: item.reason, updatedAt: item.updatedAt };
    const existing = entries.get(number);
    if (!existing || entry.updatedAt >= existing.updatedAt)
      entries.set(number, entry);
  }
  return [...entries.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_BLOCKS);
}

export function createCallBlocksStore(
  storage: CallBlockStorage,
  currentOwner: () => number | null,
  now: () => number = Date.now,
) {
  let snapshot: CallBlocksSnapshot = {
    ownerUserId: null,
    entries: [],
    loading: false,
    error: null,
  };
  let revision = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (next: CallBlocksSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const serialize = <T,>(operation: () => Promise<T>) => {
    const task = queue.then(operation, operation);
    queue = task.catch(() => undefined);
    return task;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      revision++;
      publish({ ownerUserId: null, entries: [], loading: false, error: null });
    },
    async load(ownerUserId: number | null) {
      const current = ++revision;
      if (!ownerUserId || currentOwner() !== ownerUserId) {
        publish({ ownerUserId: null, entries: [], loading: false, error: null });
        return;
      }
      publish({ ownerUserId, entries: [], loading: true, error: null });
      try {
        await serialize(async () => {
          const entries = decodeBlocks(
            await storage.getItem(blockKey(ownerUserId)),
          );
          if (current !== revision || currentOwner() !== ownerUserId) return;
          publish({ ownerUserId, entries, loading: false, error: null });
        });
      } catch {
        if (current === revision && currentOwner() === ownerUserId)
          publish({
            ownerUserId,
            entries: [],
            loading: false,
            error: "Could not load blocked numbers. Pull to retry.",
          });
      }
    },
    async set(
      ownerUserId: number,
      number: string,
      reason: CallBlockReason | null,
    ) {
      const normalized = callBlockNumberKey(number);
      if (
        !Number.isSafeInteger(ownerUserId) ||
        ownerUserId <= 0 ||
        !normalized ||
        normalized.length > 64
      )
        throw new Error("Invalid call block");
      return serialize(async () => {
        if (currentOwner() !== ownerUserId)
          throw new Error("Call blocklist owner changed");
        const entries = decodeBlocks(
          await storage.getItem(blockKey(ownerUserId)),
        );
        if (currentOwner() !== ownerUserId)
          throw new Error("Call blocklist owner changed");
        const retained = entries.filter((entry) => entry.number !== normalized);
        const next = reason
          ? [
              { number: normalized, reason, updatedAt: now() },
              ...retained,
            ].slice(0, MAX_BLOCKS)
          : retained;
        await storage.setItem(blockKey(ownerUserId), JSON.stringify(next));
        if (currentOwner() !== ownerUserId)
          throw new Error("Call blocklist owner changed");
        revision++;
        publish({ ownerUserId, entries: next, loading: false, error: null });
      });
    },
  };
}
