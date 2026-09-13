import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useSipCallStore } from "@/lib/sip/call-store";
import { beginPlaybackSession } from "@/lib/cloud-recordings/playback-session";
import { useColors } from "@/hooks/use-colors";
import * as Auth from "@/lib/_core/auth";
import { getApiBaseUrl } from "@/constants/oauth";
import { PlaybackControls } from "./call-history-view";
export const callBusy = () => {
  const state = useSipCallStore.getState();
  return (
    Boolean(state.incomingCall) ||
    Object.values(state.activeCalls).some(
      (call) => call.status !== "disconnected",
    )
  );
};
export function Playback({
  callUuid,
  path,
}: {
  callUuid: string;
  path: string;
}) {
  const colors = useColors();
  const player = useAudioPlayer(null, { downloadFirst: false });
  const status = useAudioPlayerStatus(player);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setError(false);
      const session = beginPlaybackSession({
        player,
        base: getApiBaseUrl(),
        callUuid,
        path,
        identity: () => Auth.getAuthSnapshot().user,
        token: Auth.getSessionToken,
        canPlay: () => !callBusy(),
        subscribe: (listener) => {
          const auth = Auth.addAuthChangeListener(listener);
          const calls = useSipCallStore.subscribe(() => {
            if (callBusy()) listener();
          });
          return () => {
            auth();
            calls();
          };
        },
        ready: setReady,
        failed: () => setError(true),
      });
      return session.dispose;
    }, [callUuid, path, player]),
  );
  useEffect(() => {
    if (status.playbackState === "failed" || status.playbackState === "error")
      setError(true);
  }, [status.playbackState]);
  useEffect(() => {
    if (!ready || status.isLoaded) return;
    const timeout = setTimeout(() => {
      player.pause();
      player.replace(null);
      setReady(false);
      setError(true);
    }, 15000);
    return () => clearTimeout(timeout);
  }, [ready, status.isLoaded, player]);
  return (
    <PlaybackControls
      colors={colors}
      currentTime={status.currentTime || 0}
      duration={status.duration || 0}
      playing={status.playing}
      loaded={ready && status.isLoaded}
      error={error ? "Playback unavailable. Refresh and try again." : undefined}
      onToggle={() => {
        if (callBusy()) {
          player.pause();
          return;
        }
        status.playing ? player.pause() : player.play();
      }}
      onSeek={(seconds) => {
        if (!callBusy()) void player.seekTo(seconds);
      }}
    />
  );
}
