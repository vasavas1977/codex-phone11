import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { create } from "zustand";
import { getAuthSnapshot } from "../_core/auth";
import { createChatTransport } from "./transport";
import type { ChatPresence, ChatPresenceStatus } from "./types";

const api = createChatTransport();
const POLL_MS = 5_000;
const capabilityCache = new Map<string, { expiresAt: number; request: Promise<boolean> }>();

export function startForegroundPresencePolling(
  refresh: () => void,
  activity: Pick<typeof AppState, "currentState" | "addEventListener"> = AppState,
): () => void {
  if (activity.currentState === "active") refresh();
  const timer = setInterval(() => { if (activity.currentState === "active") refresh(); }, POLL_MS);
  const subscription = activity.addEventListener("change", state => { if (state === "active") refresh(); });
  return () => { clearInterval(timer); subscription.remove(); };
}

export async function richPresenceAvailable(ownerId: number, tenantId: number): Promise<boolean> {
  const key = `${ownerId}:${tenantId}`;
  let cached = capabilityCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    const request = api.presenceCapability(tenantId).then(result => result.version === 2).catch(() => false);
    cached = { expiresAt: Date.now() + 10_000, request };
    capabilityCache.set(key, cached);
    void request.then(supported => {
      const current = capabilityCache.get(key);
      if (current?.request === request) current.expiresAt = Date.now() + (supported ? 60_000 : 10_000);
    });
  }
  return cached.request;
}

type PresenceState = {
  ownerId: number | null;
  byWorkspace: Record<number, Record<number, ChatPresence>>;
  merge: (ownerId: number, tenantId: number, requested: number[], rows: ChatPresence[]) => void;
  fail: (ownerId: number, tenantId: number, requested: number[]) => void;
  setOwner: (ownerId: number | null) => void;
  resetOwner: (ownerId: number | null) => void;
};

export const useChatPresenceStore = create<PresenceState>(set => ({
  ownerId: null, byWorkspace: {},
  merge: (ownerId, tenantId, requested, rows) => set(state => {
    if (state.ownerId !== ownerId) return state;
    const next = { ...(state.byWorkspace[tenantId] || {}) };
    requested.forEach(id => { delete next[id]; });
    rows.forEach(row => { next[row.userId] = row; });
    return { byWorkspace: { ...state.byWorkspace, [tenantId]: next } };
  }),
  fail: (ownerId, tenantId, requested) => set(state => {
    if (state.ownerId !== ownerId) return state;
    const next = { ...(state.byWorkspace[tenantId] || {}) };
    requested.forEach(id => { delete next[id]; });
    return { byWorkspace: { ...state.byWorkspace, [tenantId]: next } };
  }),
  setOwner: ownerId => set(state => state.ownerId === ownerId ? state : { ownerId, byWorkspace: {} }),
  resetOwner: ownerId => set({ ownerId, byWorkspace: {} }),
}));

export function resetPresenceOwner(ownerId: number | null): void {
  capabilityCache.clear();
  useChatPresenceStore.getState().resetOwner(ownerId);
}

export function useChatPresence(tenantId: number | undefined, userId: number | undefined): ChatPresence | undefined {
  const ownerId = getAuthSnapshot().user?.id;
  return useChatPresenceStore(state => state.ownerId === ownerId && tenantId && userId ? state.byWorkspace[tenantId]?.[userId] : undefined);
}

export function usePresencePolling(tenantId: number | undefined, userIds: number[], enabled = true): void {
  // Every production caller already rerenders from its authenticated directory
  // or chat owner. Keeping the exact object in the dependency list also rotates
  // a same-user replacement session.
  const owner = getAuthSnapshot().user;
  const idsKey = [...new Set(userIds)].sort((a, b) => a - b).join(",");
  const ids = useMemo(() => idsKey ? idsKey.split(",").map(Number) : [], [idsKey]);
  useEffect(() => {
    if (!enabled || !owner || !tenantId || ids.length === 0) return;
    useChatPresenceStore.getState().setOwner(owner.id);
    let stopped = false, running = false, pending = false;
    const refresh = async () => {
      if (stopped || AppState.currentState !== "active") return;
      if (running) { pending = true; return; }
      running = true;
      try {
        if (!await richPresenceAvailable(owner.id, tenantId)) {
          useChatPresenceStore.getState().fail(owner.id, tenantId, ids); return;
        }
        for (let offset = 0; offset < ids.length; offset += 100) {
          const requested = ids.slice(offset, offset + 100);
          try {
            const rows = await api.presence(tenantId, requested);
            if (!stopped && getAuthSnapshot().user === owner) useChatPresenceStore.getState().merge(owner.id, tenantId, requested, rows);
          } catch {
            if (!stopped && getAuthSnapshot().user === owner) useChatPresenceStore.getState().fail(owner.id, tenantId, requested);
          }
        }
      } catch {
        if (!stopped && getAuthSnapshot().user === owner) useChatPresenceStore.getState().fail(owner.id, tenantId, ids);
      } finally {
        running = false;
        if (pending && !stopped) { pending = false; void refresh(); }
      }
    };
    const stopPolling = startForegroundPresencePolling(() => void refresh());
    return () => { stopped = true; stopPolling(); };
  }, [enabled, ids, owner, tenantId]);
}

export const presenceLabel = (status: ChatPresenceStatus | undefined): string => status ? ({
  available: "Available", away: "Away", offline: "Offline", on_call: "On a call", in_meeting: "In a meeting",
}[status]) : "Status unavailable";
export const presenceColor = (status: ChatPresenceStatus | undefined): string => status ? ({
  available: "#22C55E", away: "#F59E0B", offline: "#94A3B8", on_call: "#EF4444", in_meeting: "#8B5CF6",
}[status]) : "#94A3B8";
