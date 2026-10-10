import { AppState } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./use-auth";
import * as Auth from "@/lib/_core/auth";
import { createTRPCClient } from "@/lib/trpc";

export type PersonalCallHistoryItem = {
  id: number;
  call_uuid: string;
  direction: "inbound" | "outbound" | "internal" | "emergency";
  disposition: string;
  caller_number: string;
  callee_number: string;
  callback_number: string | null;
  total_duration_seconds: number;
  started_at: string;
};

export type PersonalCallHistoryCursor = {
  startedAt: string;
  id: number;
};

type PersonalCallHistoryState = {
  ownerId: number | null;
  tenantId: number | null;
  items: PersonalCallHistoryItem[];
  nextCursor: PersonalCallHistoryCursor | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
};

const emptyState = (): PersonalCallHistoryState => ({
  ownerId: null,
  tenantId: null,
  items: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  error: null,
});

/** Deduplicate server pages by immutable CDR id, never by number or timestamp. */
export function mergePersonalCallHistory(
  current: readonly PersonalCallHistoryItem[],
  incoming: readonly PersonalCallHistoryItem[],
): PersonalCallHistoryItem[] {
  const byId = new Map<number, PersonalCallHistoryItem>();
  for (const item of [...current, ...incoming]) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

function isMissingCallHistoryProcedure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    data?: { code?: unknown; path?: unknown };
    message?: unknown;
  };
  const path = "pbx.selfService.callHistory";
  return (
    candidate.data?.code === "NOT_FOUND" &&
    (candidate.data.path === undefined || candidate.data.path === path) &&
    (candidate.message === `No procedure found on path "${path}"` ||
      candidate.message === `No "query"-procedure on path "${path}"`)
  );
}

/**
 * In-memory, tenant-scoped CDR history. It deliberately has no persistence or
 * local/native history fallback; the selected source owns those decisions.
 */
export function usePersonalCallHistory(
  tenantId: number | undefined,
  enabled: boolean,
) {
  const { user } = useAuth({ autoFetch: false });
  const ownerId = user?.id ?? null;
  const generation = useRef(0);
  const scopeRef = useRef({ ownerId, tenantId, enabled });
  scopeRef.current = { ownerId, tenantId, enabled };
  const [state, setState] = useState<PersonalCallHistoryState>(emptyState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const replaceState = useCallback((next: PersonalCallHistoryState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const reload = useCallback(async () => {
    const identity = Auth.getAuthSnapshot().user;
    const scope = scopeRef.current;
    if (
      !scope.enabled ||
      !scope.ownerId ||
      !scope.tenantId ||
      identity?.id !== scope.ownerId
    ) {
      generation.current++;
      replaceState(emptyState());
      return;
    }
    if (AppState.currentState !== "active") return;

    const requestedOwner = scope.ownerId;
    const requestedTenant = scope.tenantId;
    const revision = ++generation.current;
    const current = () => {
      const live = scopeRef.current;
      return (
        AppState.currentState === "active" &&
        revision === generation.current &&
        Auth.getAuthSnapshot().user === identity &&
        live.enabled &&
        live.ownerId === requestedOwner &&
        live.tenantId === requestedTenant
      );
    };
    replaceState({
      ownerId: requestedOwner,
      tenantId: requestedTenant,
      items: [],
      nextCursor: null,
      loading: true,
      loadingMore: false,
      error: null,
    });

    try {
      const result = await createTRPCClient().pbx.selfService.callHistory.query({
        tenantId: requestedTenant,
        limit: 50,
      });
      if (!current()) return;
      if (result.tenantId !== requestedTenant) throw new Error("Workspace changed");
      replaceState({
        ownerId: requestedOwner,
        tenantId: requestedTenant,
        items: mergePersonalCallHistory([], result.items),
        nextCursor: result.nextCursor,
        loading: false,
        loadingMore: false,
        error: null,
      });
    } catch (error) {
      if (!current()) return;
      replaceState({
        ownerId: requestedOwner,
        tenantId: requestedTenant,
        items: [],
        nextCursor: null,
        loading: false,
        loadingMore: false,
        error: isMissingCallHistoryProcedure(error)
          ? "Workspace call history is unavailable on this server. You can switch to This device."
          : "Could not load workspace call history. Pull to retry or choose This device.",
      });
    }
  }, [replaceState]);

  const loadMore = useCallback(async () => {
    const scope = scopeRef.current;
    const prior = stateRef.current;
    const identity = Auth.getAuthSnapshot().user;
    const cursor = prior.nextCursor;
    if (
      !scope.enabled ||
      !scope.ownerId ||
      !scope.tenantId ||
      identity?.id !== scope.ownerId ||
      prior.ownerId !== scope.ownerId ||
      prior.tenantId !== scope.tenantId ||
      !cursor ||
      prior.loading ||
      prior.loadingMore ||
      AppState.currentState !== "active"
    ) return;

    const requestedOwner = scope.ownerId;
    const requestedTenant = scope.tenantId;
    const revision = ++generation.current;
    const current = () => {
      const live = scopeRef.current;
      return (
        AppState.currentState === "active" &&
        revision === generation.current &&
        Auth.getAuthSnapshot().user === identity &&
        live.enabled &&
        live.ownerId === requestedOwner &&
        live.tenantId === requestedTenant
      );
    };
    replaceState({ ...prior, loadingMore: true, error: null });
    try {
      const result = await createTRPCClient().pbx.selfService.callHistory.query({
        tenantId: requestedTenant,
        limit: 50,
        cursor,
      });
      if (!current()) return;
      if (result.tenantId !== requestedTenant) throw new Error("Workspace changed");
      const latest = stateRef.current;
      if (latest.ownerId !== requestedOwner || latest.tenantId !== requestedTenant) return;
      replaceState({
        ...latest,
        items: mergePersonalCallHistory(latest.items, result.items),
        nextCursor: result.nextCursor,
        loadingMore: false,
        error: null,
      });
    } catch {
      if (!current()) return;
      replaceState({
        ...stateRef.current,
        loadingMore: false,
        error: "Could not load more workspace calls. Pull to retry.",
      });
    }
  }, [replaceState]);

  useEffect(() => {
    generation.current++;
    replaceState(emptyState());
  }, [enabled, ownerId, replaceState, tenantId]);

  useEffect(() => {
    const invalidate = () => {
      generation.current++;
      replaceState(emptyState());
      const liveOwner = Auth.getAuthSnapshot().user?.id;
      const liveScope = scopeRef.current;
      if (
        liveScope.enabled &&
        liveOwner === liveScope.ownerId &&
        liveScope.tenantId &&
        AppState.currentState === "active"
      ) void reload();
    };
    const unsubscribe = Auth.addAuthChangeListener(invalidate);
    const app = AppState.addEventListener("change", (appState) => {
      if (appState === "active") {
        if (scopeRef.current.enabled) void reload();
      } else {
        generation.current++;
        replaceState((stateRef.current.ownerId && stateRef.current.tenantId)
          ? { ...stateRef.current, loading: false, loadingMore: false }
          : emptyState());
      }
    });
    return () => {
      // Invalidate the latest in-flight generation so it cannot commit after unmount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      unsubscribe();
      app.remove();
    };
  }, [reload, replaceState]);

  const visible =
    state.ownerId === ownerId && state.tenantId === tenantId && enabled
      ? state
      : emptyState();
  const scopeError = enabled
    ? !ownerId
      ? "Sign in to view workspace call history."
      : !tenantId
        ? "Select or restore an active workspace phone account to view calls."
        : null
    : null;
  return { ...visible, error: visible.error ?? scopeError, reload, loadMore };
}
