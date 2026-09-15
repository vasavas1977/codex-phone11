import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Auth from "@/lib/_core/auth";
import type { TranscriptSpeakerNames } from "@/lib/cloud-recordings/transcript";
import {
  decodeAssignedSpeakerNames,
  transcriptFingerprint,
  speakerNamesStorageKey,
  validateAssignedSpeakerNames,
} from "@/lib/cloud-recordings/speaker-names";

// Keep inline and full-screen views of the same recording synchronized without
// retaining a global copy of personal names after their views are unmounted.
const listeners = new Map<
  string,
  Set<(names: TranscriptSpeakerNames) => void>
>();
const notificationScope = (
  ownerId: number,
  callUuid: string,
  transcript: string,
) =>
  `${speakerNamesStorageKey(ownerId, callUuid)}:${transcriptFingerprint(transcript)}`;
function subscribeToNames(
  scope: string,
  listener: (names: TranscriptSpeakerNames) => void,
) {
  const subscribers = listeners.get(scope) ?? new Set();
  subscribers.add(listener);
  listeners.set(scope, subscribers);
  return () => {
    subscribers.delete(listener);
    if (!subscribers.size) listeners.delete(scope);
  };
}

export function useRecordingSpeakerNames(
  ownerId: number | undefined,
  callUuid: string,
  transcript: string,
) {
  const scope = JSON.stringify([ownerId, callUuid, transcript]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const generation = useRef(0);
  const writing = useRef(false);
  const [state, setState] = useState<{
    scope: string;
    names: TranscriptSpeakerNames;
    ready: boolean;
    saving: boolean;
    error?: string;
  }>({ scope, names: {}, ready: false, saving: false });
  useEffect(() => {
    const generationRef = generation;
    const revision = ++generationRef.current;
    writing.current = false;
    setState({ scope, names: {}, ready: false, saving: false });
    const valid = () =>
      generationRef.current === revision &&
      currentScope.current === scope &&
      Auth.getAuthSnapshot().user?.id === ownerId;
    let unsubscribeNames = () => {};
    let receivedSave = false;
    const unsubscribe = Auth.addAuthChangeListener(() => {
      if (Auth.getAuthSnapshot().user?.id === ownerId) return;
      generationRef.current++;
      setState({ scope, names: {}, ready: false, saving: false });
    });
    if (ownerId && Auth.getAuthSnapshot().user?.id === ownerId) {
      let key: string;
      try {
        key = speakerNamesStorageKey(ownerId, callUuid);
      } catch {
        return unsubscribe;
      }
      unsubscribeNames = subscribeToNames(
        notificationScope(ownerId, callUuid, transcript),
        (names) => {
          if (!valid()) return;
          receivedSave = true;
          setState((current) => ({
            scope,
            names,
            ready: true,
            saving: current.saving,
          }));
        },
      );
      void AsyncStorage.getItem(key)
        .then((raw) => {
          if (valid() && !receivedSave)
            setState({
              scope,
              names: decodeAssignedSpeakerNames(raw, transcript),
              ready: true,
              saving: false,
            });
        })
        .catch(() => {
          if (valid() && !receivedSave)
            setState({
              scope,
              names: {},
              ready: false,
              saving: false,
              error:
                "Speaker names could not be loaded. Reopen this call to try again.",
            });
        });
    }
    return () => {
      generationRef.current++;
      unsubscribe();
      unsubscribeNames();
    };
  }, [ownerId, callUuid, transcript, scope]);

  const save = useCallback(
    async (input: TranscriptSpeakerNames) => {
      if (
        !ownerId ||
        !state.ready ||
        state.scope !== scope ||
        currentScope.current !== scope ||
        writing.current ||
        Auth.getAuthSnapshot().user?.id !== ownerId
      )
        return false;
      const revision = generation.current;
      let names: TranscriptSpeakerNames;
      try {
        names = validateAssignedSpeakerNames(input);
      } catch (error) {
        setState((current) => ({
          ...current,
          error:
            error instanceof Error ? error.message : "Check the speaker names.",
        }));
        return false;
      }
      writing.current = true;
      setState((current) => ({ ...current, saving: true, error: undefined }));
      try {
        await AsyncStorage.setItem(
          speakerNamesStorageKey(ownerId, callUuid),
          JSON.stringify({
            transcriptFingerprint: transcriptFingerprint(transcript),
            names,
          }),
        );
        if (
          generation.current !== revision ||
          currentScope.current !== scope ||
          Auth.getAuthSnapshot().user?.id !== ownerId
        )
          return false;
        for (const notify of listeners.get(
          notificationScope(ownerId, callUuid, transcript),
        ) ?? [])
          notify(names);
        setState({ scope, names, ready: true, saving: false });
        return true;
      } catch {
        if (generation.current === revision && currentScope.current === scope)
          setState((current) => ({
            ...current,
            saving: false,
            error: "Speaker names could not be saved. Please try again.",
          }));
        return false;
      } finally {
        if (generation.current === revision) writing.current = false;
      }
    },
    [ownerId, callUuid, transcript, scope, state.ready, state.scope],
  );
  const visible =
    state.scope === scope && Auth.getAuthSnapshot().user?.id === ownerId;
  return {
    names: visible ? state.names : {},
    ready: visible && state.ready,
    saving: visible && state.saving,
    error: visible ? state.error : undefined,
    save,
  };
}
