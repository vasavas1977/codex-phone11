import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { addAuthChangeListener, getAuthSnapshot } from "@/lib/_core/auth";
import {
  callBlockNumberKey,
  createCallBlocksStore,
  type CallBlockReason,
} from "@/lib/phone/call-blocks";

const store = createCallBlocksStore(
  AsyncStorage,
  () => getAuthSnapshot().user?.id ?? null,
);

export function useCallBlocks(ownerUserId?: number) {
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
  const set = useCallback(
    (number: string, reason: CallBlockReason | null) => {
      if (!ownerUserId) return Promise.reject(new Error("Sign in required"));
      return store.set(ownerUserId, number, reason);
    },
    [ownerUserId],
  );
  const ownsSnapshot = snapshot.ownerUserId === ownerUserId;
  return {
    reason: (number: string) =>
      ownsSnapshot
        ? snapshot.entries.find(
            (entry) => entry.number === callBlockNumberKey(number),
          )?.reason
        : undefined,
    set,
    loading: ownsSnapshot && snapshot.loading,
    error: ownsSnapshot ? snapshot.error : null,
    reload: () => store.load(ownerUserId ?? null),
  };
}
