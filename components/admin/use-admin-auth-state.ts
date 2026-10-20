import { useRef, useState, useSyncExternalStore } from "react";
import * as Auth from "@/lib/_core/auth";
import { refreshAuth } from "@/lib/_core/api";

/** Observe hydration without starting another auth request in each admin screen. */
export function useAdminAuthState() {
  const state = useSyncExternalStore(
    Auth.addAuthChangeListener,
    Auth.getAuthSnapshot,
    Auth.getAuthSnapshot,
  );
  const [retrying, setRetrying] = useState(false);
  const retryPending = useRef(false);
  const retry = async () => {
    if (retryPending.current) return;
    retryPending.current = true;
    setRetrying(true);
    try {
      await refreshAuth();
    } finally {
      retryPending.current = false;
      setRetrying(false);
    }
  };
  return {
    user: state.user,
    checking: !state.user && (state.loading || retrying),
    unavailable: !state.user && Boolean(state.error),
    retry,
  };
}
