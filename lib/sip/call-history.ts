import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { addAuthChangeListener, getAuthSnapshot } from "../_core/auth";

export interface CallHistoryEntry {
  id: string;
  ownerUserId: number;
  number: string;
  name?: string;
  direction: "inbound" | "outbound";
  startedAt: number;
  answeredAt?: number;
  endedAt?: number;
  updatedAt: number;
  nativeCompletion?: true;
}

export function callNumber(uri: string): string {
  return uri.match(/sips?:([^@;>]+)(?:@|;|>)/i)?.[1] ?? uri;
}

export function historyDuration(entry: CallHistoryEntry): number {
  return entry.answeredAt !== undefined && entry.endedAt !== undefined
    ? Math.max(0, Math.floor((entry.endedAt - entry.answeredAt) / 1000)) : 0;
}

export function isMissedCall(entry: CallHistoryEntry): boolean {
  return entry.direction === "inbound" && entry.endedAt !== undefined && entry.answeredAt === undefined;
}

export function mergeHistory(saved: CallHistoryEntry[], current: CallHistoryEntry[]): CallHistoryEntry[] {
  const entries = new Map<string, CallHistoryEntry>();
  for (const entry of [...saved, ...current]) {
    const existing = entries.get(entry.id);
    if (!existing || (entry.nativeCompletion && !existing.nativeCompletion) || entry.updatedAt >= existing.updatedAt) {
      // A later JS observer must not reopen an already completed native record.
      entries.set(entry.id, existing?.nativeCompletion && existing.endedAt !== undefined && !entry.nativeCompletion
        ? { ...entry, startedAt: existing.startedAt, answeredAt: existing.answeredAt ?? entry.answeredAt, endedAt: existing.endedAt, nativeCompletion: true }
        : entry.nativeCompletion && existing ? { ...entry, name: entry.name ?? existing.name } : entry);
    }
  }
  return [...entries.values()].sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id));
}

function decode(raw: string | null, owner: number): CallHistoryEntry[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Invalid call history");
  return parsed.filter((e): e is CallHistoryEntry => Boolean(e && typeof e === "object" &&
    e.ownerUserId === owner && typeof e.id === "string" && typeof e.number === "string" &&
    (e.name === undefined || typeof e.name === "string") &&
    ["inbound", "outbound"].includes(e.direction) && Number.isFinite(e.startedAt) &&
    Number.isFinite(e.updatedAt) && (e.answeredAt === undefined || Number.isFinite(e.answeredAt)) &&
    (e.endedAt === undefined || Number.isFinite(e.endedAt))));
}

interface HistoryState {
  ownerUserId: number | null;
  entries: CallHistoryEntry[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  upsert: (entry: CallHistoryEntry) => void;
}

let queue: Promise<unknown> = Promise.resolve();
const key = (owner: number) => `phone11_call_history_v1_user_${owner}`;
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const task = queue.then(operation, operation);
  queue = task.catch(() => undefined);
  return task;
}

export const useCallHistoryStore = create<HistoryState>((set, get) => ({
  ownerUserId: null, entries: [], loading: false, error: null,
  reload: async () => {
    const owner = getAuthSnapshot().user?.id ?? null;
    if (get().ownerUserId !== owner) set({ ownerUserId: owner, entries: [], error: null });
    if (!owner) { set({ loading: false }); return; }
    set({ loading: true });
    try {
      await serialize(async () => {
        const saved = decode(await AsyncStorage.getItem(key(owner)), owner);
        if (getAuthSnapshot().user?.id !== owner || get().ownerUserId !== owner) return;
        set({ entries: mergeHistory(saved, get().entries), loading: false, error: null });
      });
    } catch {
      if (get().ownerUserId === owner) set({ loading: false, error: "Could not load saved calls. Pull to retry." });
    }
  },
  upsert: (entry) => {
    // Retain the owner captured when the call started, even if sign-out ends it.
    if (!Number.isSafeInteger(entry.ownerUserId) || entry.ownerUserId <= 0) return;
    if (getAuthSnapshot().user?.id === entry.ownerUserId) {
      const current = get().ownerUserId === entry.ownerUserId ? get().entries : [];
      set({ ownerUserId: entry.ownerUserId, entries: mergeHistory(current, [entry]) });
    }
    void serialize(async () => {
      const saved = decode(await AsyncStorage.getItem(key(entry.ownerUserId)), entry.ownerUserId);
      const merged = mergeHistory(saved, [entry]);
      await AsyncStorage.setItem(key(entry.ownerUserId), JSON.stringify(merged));
      if (getAuthSnapshot().user?.id === entry.ownerUserId && get().ownerUserId === entry.ownerUserId) {
        set({ entries: mergeHistory(merged, get().entries), error: null });
      }
    }).catch(() => {
      if (get().ownerUserId === entry.ownerUserId) set({ error: "Call history could not be saved on this device." });
    });
  },
}));

addAuthChangeListener(() => {
  const owner = getAuthSnapshot().user?.id ?? null;
  if (owner !== useCallHistoryStore.getState().ownerUserId) void useCallHistoryStore.getState().reload();
});

/** Resolve only after the owner-specific disk write; callers may then ack native. */
export async function importCompletedWakeCalls(entries: CallHistoryEntry[], owner: number, current: () => boolean): Promise<void> {
  await serialize(async () => {
    if (!current()) throw new Error("Call history owner changed");
    const valid = decode(JSON.stringify(entries), owner);
    if (valid.length !== entries.length || valid.some(e => !e.id.startsWith("native-wake:") || e.endedAt === undefined)) throw new Error("Invalid completed calls");
    const saved = decode(await AsyncStorage.getItem(key(owner)), owner);
    if (!current()) throw new Error("Call history owner changed");
    const merged = mergeHistory(saved, valid.map(entry => ({ ...entry, nativeCompletion: true as const })));
    await AsyncStorage.setItem(key(owner), JSON.stringify(merged));
    if (!current()) throw new Error("Call history owner changed");
    useCallHistoryStore.setState(state => ({ ownerUserId: owner, entries: mergeHistory(merged, state.ownerUserId === owner ? state.entries : []), error: null }));
  });
}
