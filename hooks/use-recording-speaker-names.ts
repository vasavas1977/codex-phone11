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
      void AsyncStorage.getItem(key)
        .then((raw) => {
          if (valid())
            setState({
              scope,
              names: decodeAssignedSpeakerNames(raw, transcript),
              ready: true,
              saving: false,
            });
        })
        .catch(() => {
          if (valid())
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
