import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Auth from "@/lib/_core/auth";
import {
  decodePersonalRecordingMetadata,
  emptyPersonalRecordingMetadata,
  personalMetadataStorageKey,
  type PersonalRecordingMetadata,
} from "@/lib/cloud-recordings/summary-actions";

export function useRecordingPersonalMetadata(
  ownerId: number,
  callUuid: string,
) {
  const scope = `${ownerId}:${callUuid}`;
  const generation = useRef(0);
  const valueRef = useRef(emptyPersonalRecordingMetadata());
  const readyRef = useRef(false);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const [state, setState] = useState<{
    scope: string;
    value: PersonalRecordingMetadata;
    ready: boolean;
    pendingWrites: number;
    error?: string;
  }>({
    scope,
    value: valueRef.current,
    ready: false,
    pendingWrites: 0,
  });

  useEffect(() => {
    const generationRef = generation;
    const revision = ++generationRef.current;
    valueRef.current = emptyPersonalRecordingMetadata();
    readyRef.current = false;
    writes.current = Promise.resolve();
    setState({
      scope,
      value: valueRef.current,
      ready: false,
      pendingWrites: 0,
    });
    const ownsScope = () =>
      generationRef.current === revision &&
      Auth.getAuthSnapshot().user?.id === ownerId;
    const unsubscribe = Auth.addAuthChangeListener(() => {
      if (Auth.getAuthSnapshot().user?.id === ownerId) return;
      generationRef.current++;
      readyRef.current = false;
      valueRef.current = emptyPersonalRecordingMetadata();
      setState({
        scope,
        value: valueRef.current,
        ready: false,
        pendingWrites: 0,
      });
    });
    let key: string;
    try {
      key = personalMetadataStorageKey(ownerId, callUuid);
    } catch {
      readyRef.current = true;
      setState((current) => ({
        ...current,
        ready: true,
        error: "Personal call tools are unavailable.",
      }));
      return unsubscribe;
    }
    if (Auth.getAuthSnapshot().user?.id !== ownerId) {
      return unsubscribe;
    }
    void AsyncStorage.getItem(key)
      .then((raw) => {
        if (!ownsScope()) return;
        valueRef.current = decodePersonalRecordingMetadata(raw);
        readyRef.current = true;
        setState({
          scope,
          value: valueRef.current,
          ready: true,
          pendingWrites: 0,
        });
      })
      .catch(() => {
        if (!ownsScope()) return;
        valueRef.current = emptyPersonalRecordingMetadata();
        readyRef.current = true;
        setState({
          scope,
          value: valueRef.current,
          ready: true,
          pendingWrites: 0,
          error: "Personal call details could not be loaded.",
        });
      });
    return () => {
      generationRef.current++;
      readyRef.current = false;
      unsubscribe();
    };
  }, [callUuid, ownerId, scope]);

  const update = useCallback(
    async (
      change: (current: PersonalRecordingMetadata) => PersonalRecordingMetadata,
    ) => {
      if (!readyRef.current || Auth.getAuthSnapshot().user?.id !== ownerId)
        return false;
      let key: string;
      try {
        key = personalMetadataStorageKey(ownerId, callUuid);
      } catch {
        return false;
      }
      const revision = generation.current;
      const previous = valueRef.current;
      const next = { ...change(previous), updatedAt: Date.now() };
      valueRef.current = next;
      setState((current) =>
        current.scope === scope
          ? {
              ...current,
              value: next,
              pendingWrites: current.pendingWrites + 1,
              error: undefined,
            }
          : current,
      );
      const write = writes.current.then(() =>
        AsyncStorage.setItem(key, JSON.stringify(next)),
      );
      writes.current = write.catch(() => undefined);
      try {
        await write;
        if (
          generation.current === revision &&
          Auth.getAuthSnapshot().user?.id === ownerId
        )
          setState((current) =>
            current.scope === scope
              ? {
                  ...current,
                  pendingWrites: Math.max(0, current.pendingWrites - 1),
                }
              : current,
          );
        return generation.current === revision;
      } catch {
        if (generation.current === revision) {
          if (valueRef.current === next) valueRef.current = previous;
          setState((current) =>
            current.scope === scope
              ? {
                  ...current,
                  value: current.value === next ? previous : current.value,
                  pendingWrites: Math.max(0, current.pendingWrites - 1),
                  error: "Personal call details could not be saved.",
                }
              : current,
          );
        }
        return false;
      }
    },
    [callUuid, ownerId, scope],
  );

  return {
    value:
      state.scope === scope ? state.value : emptyPersonalRecordingMetadata(),
    ready: state.scope === scope && state.ready,
    saving: state.scope === scope && state.pendingWrites > 0,
    error: state.scope === scope ? state.error : undefined,
    update,
  };
}
