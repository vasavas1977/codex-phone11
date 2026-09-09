import { useEffect, useSyncExternalStore } from "react";
import * as Api from "@/lib/_core/api";
import * as Auth from "@/lib/_core/auth";

export function useAuth(options?: { autoFetch?: boolean }) {
  const autoFetch = options?.autoFetch ?? true;
  const state = useSyncExternalStore(
    Auth.addAuthChangeListener,
    Auth.getAuthSnapshot,
    Auth.getAuthSnapshot,
  );

  useEffect(() => {
    if (autoFetch) void Api.refreshAuth();
  }, [autoFetch]);

  return {
    ...state,
    loading: autoFetch && state.loading,
    isAuthenticated: Boolean(state.user),
    refresh: Api.refreshAuth,
    logout: Api.logout,
  };
}
