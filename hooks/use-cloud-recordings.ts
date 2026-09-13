import { AppState } from "react-native";
import { startRecordingPoll } from "@/lib/cloud-recordings/polling";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./use-auth";
import * as Auth from "@/lib/_core/auth";
import { createTRPCClient } from "@/lib/trpc";
import type {
  CloudRecording,
  CloudRecordingDetail,
} from "@/shared/cloud-recordings";

/** Distinguish an absent RPC from a missing recording or an auth/network failure. */
export function isMissingCloudProcedure(
  error: unknown,
  procedure: "list" | "detail" | "getPolicy" | "updatePolicy",
): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    data?: { code?: unknown; path?: unknown };
    message?: unknown;
  };
  const path = `cloudRecordings.${procedure}`;
  return (
    candidate.data?.code === "NOT_FOUND" &&
    (candidate.data.path === undefined || candidate.data.path === path) &&
    (candidate.message === `No procedure found on path "${path}"` ||
      candidate.message ===
        `No "${procedure === "updatePolicy" ? "mutation" : "query"}"-procedure on path "${path}"`)
  );
}

/** Memory only. Every auth transition invalidates in-flight results. */
export function useCloudRecordings(callUuid?: string) {
  const { user } = useAuth({ autoFetch: false });
  const generation = useRef(0);
  const [state, setState] = useState<{
    owner?: number;
    items: CloudRecording[];
    detail?: CloudRecordingDetail;
    loading: boolean;
    error?: string;
    unavailable?: boolean;
  }>({ items: [], loading: false });
  const reload = useCallback(async () => {
    if (AppState.currentState !== "active") return;
    const revision = ++generation.current;
    const identity = Auth.getAuthSnapshot().user;
    setState((previous) =>
      identity && previous.owner === identity.id
        ? { ...previous, loading: true, error: undefined }
        : { items: [], loading: !!identity },
    );
    if (!identity) return;
    const current = () =>
      AppState.currentState === "active" &&
      revision === generation.current &&
      Auth.getAuthSnapshot().user === identity;
    try {
      const api = createTRPCClient().cloudRecordings;
      const result = callUuid
        ? { detail: await api.detail.query({ callUuid }), items: [] }
        : await api.list.query({ limit: 100 });
      if (current())
        setState({ ...result, owner: identity.id, loading: false });
    } catch (error) {
      if (
        current() &&
        isMissingCloudProcedure(error, callUuid ? "detail" : "list")
      ) {
        setState({
          owner: identity.id,
          items: [],
          loading: false,
          unavailable: true,
        });
        return;
      }
      if (current())
        setState({
          owner: identity.id,
          items: [],
          loading: false,
          error:
            "Could not load cloud recordings. Your call history is still available.",
        });
    }
  }, [callUuid, user]);
  useEffect(() => {
    void reload();
    const unsubscribe = Auth.addAuthChangeListener(() => {
      generation.current++;
      setState({ items: [], loading: false });
    });
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") void reload();
      else {
        generation.current++;
        setState((current) => ({ ...current, loading: false }));
      }
    });
    return () => {
      generation.current++;
      unsubscribe();
      app.remove();
    };
  }, [reload]);
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    if (!callUuid) return;
    const identity = Auth.getAuthSnapshot().user;
    return startRecordingPoll({
      active: () =>
        AppState.currentState === "active" &&
        !!identity &&
        Auth.getAuthSnapshot().user === identity,
      pending: () => {
        const current = latest.current;
        return (
          !current.loading &&
          !!current.detail &&
          (["pending", "recording"].includes(current.detail.recordingStatus) ||
            ["queued", "processing"].includes(current.detail.summaryStatus))
        );
      },
      refresh: () => void reload(),
      subscribe: (listener) => {
        const app = AppState.addEventListener("change", () => {
          if (AppState.currentState !== "active") {
            generation.current++;
            setState((current) => ({ ...current, loading: false }));
          }
          listener();
        });
        const auth = Auth.addAuthChangeListener(listener);
        return () => {
          app.remove();
          auth();
        };
      },
    });
  }, [callUuid, reload]);
  return {
    ...(state.owner === user?.id &&
    (!callUuid || !state.detail || state.detail.callUuid === callUuid)
      ? state
      : { items: [], loading: state.loading }),
    reload,
  };
}
