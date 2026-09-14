import { createPlaybackController } from "@/lib/cloud-recordings/playback-controller";
import {
  configurePlaybackRoute,
  releasePlaybackRoute,
  supportsPlaybackSpeaker,
} from "@/lib/cloud-recordings/playback-route";
import { useCallback, useEffect, useRef, useState } from "react";
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
  // Expo's default pause/completion cleanup deactivates AVAudioSession after
  // 100 ms and only checks Expo players, so it can silence a newly active SIP
  // call. Native call ownership must control the shared audio session instead.
  const player = useAudioPlayer(null, {
    downloadFirst: false,
    keepAudioSessionActive: true,
  });
  const status = useAudioPlayerStatus(player);
  const [speaker, setSpeaker] = useState(false);
  const focused = useRef(false);
  const controller = useRef<ReturnType<typeof createPlaybackController> | null>(
    null,
  );
  const [ready, setReady] = useState(false),
    [error, setError] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setError(false);
      focused.current = true;
      const playback = createPlaybackController({
        player,
        allowed: () => focused.current && !callBusy(),
        configure: configurePlaybackRoute,
        failed: () => setError(true),
      });
      controller.current = playback;
      const session = beginPlaybackSession({
        player,
        base: getApiBaseUrl(),
        callUuid,
        path,
        identity: () => Auth.getAuthSnapshot().user,
        token: Auth.getSessionToken,
        canPlay: () => !callBusy(),
        subscribe: (listener) => {
          const invalidate = () => {
            playback.dispose();
            listener();
          };
          const auth = Auth.addAuthChangeListener(invalidate);
          const calls = useSipCallStore.subscribe(() => {
            if (callBusy()) invalidate();
          });
          return () => {
            auth();
            calls();
          };
        },
        ready: setReady,
        failed: () => setError(true),
      });
      return () => {
        focused.current = false;
        playback.dispose();
        session.dispose();
        if (!callBusy()) void releasePlaybackRoute().catch(() => {});
      };
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
      speaker={speaker}
      onSpeakerChange={
        supportsPlaybackSpeaker()
          ? (next) => {
              if (callBusy()) return;
              setSpeaker(next);
              if (status.playing) {
                controller.current?.pause();
                void controller.current?.play(next, false);
              }
            }
          : undefined
      }
      onToggle={() => {
        if (callBusy()) {
          player.pause();
          return;
        }
        if (status.playing) controller.current?.pause();
        else
          void controller.current?.play(
            speaker,
            Boolean(
              status.didJustFinish ||
              (status.duration > 0 && status.currentTime >= status.duration),
            ),
          );
      }}
      onSeek={(seconds) => {
        if (!callBusy() && ready && status.isLoaded)
          void player.seekTo(seconds).catch(() => setError(true));
      }}
    />
  );
}
