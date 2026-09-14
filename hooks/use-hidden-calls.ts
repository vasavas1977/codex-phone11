import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { addAuthChangeListener, getAuthSnapshot } from "@/lib/_core/auth";

/** A reversible, device-local view preference. Never deletes cloud recordings. */
export function useHiddenCalls(owner?: number) {
  const [state, setState] = useState<{
    owner?: number;
    ids: string[];
    ready: boolean;
    error?: string;
  }>({ ids: [], ready: !owner });
  const revision = useRef(0);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    const generation = ++revision.current;
    const invalidate = () => { revision.current++; };
    setState({ owner, ids: [], ready: !owner });
    if (owner)
      queue.current = queue.current
        .then(() => AsyncStorage.getItem(`phone11_hidden_calls_v1_${owner}`))
        .then((raw) => {
          if (
            generation !== revision.current ||
            getAuthSnapshot().user?.id !== owner
          )
            return;
          const value: unknown = raw ? JSON.parse(raw) : [];
          setState({
            owner,
            ids: Array.isArray(value)
              ? value.filter((id): id is string => typeof id === "string")
              : [],
            ready: true,
          });
        })
        .catch(() => {
          if (generation === revision.current)
            setState({
              owner,
              ids: [],
              ready: true,
              error: "Hidden calls could not be loaded.",
            });
        });
    const unsubscribe = addAuthChangeListener(() => {
      if (getAuthSnapshot().user?.id !== owner) {
        revision.current++;
        setState({ ids: [], ready: false });
      }
    });
    return () => {
      invalidate();
      unsubscribe();
    };
  }, [owner]);
  const update = useCallback(
    (id?: string) => {
      if (!owner || getAuthSnapshot().user?.id !== owner)
        return Promise.reject(new Error("Call history owner changed"));
      const generation = revision.current;
      const task = queue.current.then(async () => {
        if (
          revision.current !== generation ||
          getAuthSnapshot().user?.id !== owner
        )
          throw new Error("Call history owner changed");
        const raw = await AsyncStorage.getItem(
          `phone11_hidden_calls_v1_${owner}`,
        );
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        const ids = id
          ? [
              ...new Set([
                ...(Array.isArray(parsed)
                  ? parsed.filter(
                      (item): item is string => typeof item === "string",
                    )
                  : []),
                id,
              ]),
            ]
          : [];
        if (
          revision.current !== generation ||
          getAuthSnapshot().user?.id !== owner
        )
          throw new Error("Call history owner changed");
        await AsyncStorage.setItem(
          `phone11_hidden_calls_v1_${owner}`,
          JSON.stringify(ids),
        );
        if (
          revision.current !== generation ||
          getAuthSnapshot().user?.id !== owner
        )
          throw new Error("Call history owner changed");
        setState({ owner, ids, ready: true });
      });
      queue.current = task.catch(() => {
        if (revision.current === generation)
          setState((previous) => ({
            ...previous,
            error: "Could not update hidden calls. Try again.",
          }));
      });
      return task;
    },
    [owner],
  );
  return {
    ids: state.owner === owner ? state.ids : [],
    ready: state.owner === owner && state.ready,
    error: state.owner === owner ? state.error : undefined,
    hide: update,
    restoreAll: () => update(),
  };
}
