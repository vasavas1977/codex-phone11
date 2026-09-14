import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { addAuthChangeListener, getAuthSnapshot } from "@/lib/_core/auth";
import { createCallFavoritesStore } from "@/lib/phone/call-actions";

const store = createCallFavoritesStore(
  AsyncStorage,
  () => getAuthSnapshot().user?.id ?? null,
);

export function useCallFavorites(ownerUserId?: number) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => {
    void store.load(ownerUserId ?? null);
    return addAuthChangeListener(() => {
      const owner = getAuthSnapshot().user?.id;
      if (owner === ownerUserId) void store.load(ownerUserId ?? null);
      else store.clear();
    });
  }, [ownerUserId]);
  const toggle = useCallback(
    (callId: string) => {
      if (!ownerUserId) return Promise.reject(new Error("Sign in required"));
      return store.toggle(ownerUserId, callId);
    },
    [ownerUserId],
  );
  const ownsSnapshot = snapshot.ownerUserId === ownerUserId;
  return {
    starred: (callId: string) => ownsSnapshot && snapshot.ids.includes(callId),
    toggle,
    loading: ownsSnapshot && snapshot.loading,
    error: ownsSnapshot ? snapshot.error : null,
    reload: () => store.load(ownerUserId ?? null),
  };
}
