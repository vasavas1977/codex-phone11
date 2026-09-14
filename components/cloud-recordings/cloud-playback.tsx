import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useSipCallStore } from "@/lib/sip/call-store";
import { beginPlaybackSession } from "@/lib/cloud-recordings/playback-session";
import { useColors } from "@/hooks/use-colors";
import * as Auth from "@/lib/_core/auth";
import { getApiBaseUrl } from "@/constants/oauth";
import {
  readPlaybackAudioRoute,
  resetPlaybackAudioRoute,
  setPlaybackAudioRoute,
  subscribeToPlaybackAudioRoute,
  type PlaybackAudioRoute,
  type PlaybackAudioRouteStatus,
} from "@/lib/cloud-recordings/playback-route";
import { PlaybackControls } from "./playback-controls";
import { createPlaybackController } from "@/lib/cloud-recordings/playback-controller";
const earpieceOutput: PlaybackAudioRouteStatus = {
  route: "earpiece",
  label: "Earpiece",
};

export const playbackOutputForPreference = (
  output: PlaybackAudioRouteStatus,
  routeApplied: boolean,
) => (routeApplied || output.route === "external" ? output : earpieceOutput);

export function revokePlaybackAuthorization(
  authorization: { current: boolean },
  player: { pause(): void; replace(source: null): void },
  setReady: (ready: boolean) => void,
  setError: (failed: boolean) => void,
) {
  authorization.current = false;
  player.pause();
  player.replace(null);
  setReady(false);
  setError(true);
}

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
    [error, setError] = useState(false),
    [route, setRoute] = useState<PlaybackAudioRoute>("earpiece"),
    [output, setOutput] = useState<PlaybackAudioRouteStatus>(earpieceOutput),
    [routeChanging, setRouteChanging] = useState(false),
    [routeError, setRouteError] = useState<string>();
  const routeChangeInFlight = useRef(false);
  const focusGeneration = useRef(0);
  const playbackAuthorized = useRef(false);
  const routeApplied = useRef(false);
  const resumeAfterScrub = useRef(false);
  const controller = useRef<{
    play(route: PlaybackAudioRoute, restart: boolean): Promise<void>;
    isPending(): boolean;
    pause(): void;
    dispose(): void;
  } | null>(null);
  const failPlayback = useCallback(
    () =>
      revokePlaybackAuthorization(
        playbackAuthorized,
        player,
        setReady,
        setError,
      ),
    [player],
  );
  const applyRoute = useCallback(
    async (nextRoute: PlaybackAudioRoute) => {
      const generation = focusGeneration.current;
      if (
        routeChangeInFlight.current ||
        !playbackAuthorized.current ||
        callBusy()
      ) {
        player.pause();
        return false;
      }
      routeChangeInFlight.current = true;
      setRouteChanging(true);
      setRouteError(undefined);
      try {
        const nextOutput = await setPlaybackAudioRoute(
          nextRoute,
          () => !callBusy(),
        );
        routeApplied.current = true;
        if (
          focusGeneration.current !== generation ||
          !playbackAuthorized.current ||
          callBusy()
        ) {
          if (!callBusy()) {
            await resetPlaybackAudioRoute(() => !callBusy()).catch(() => {});
            routeApplied.current = false;
          }
          return false;
        }
        setRoute(nextRoute);
        setOutput(nextOutput);
        return true;
      } catch {
        player.pause();
        if (focusGeneration.current === generation)
          setRouteError(
            callBusy()
              ? "Playback stopped because a call is active."
              : "Audio route could not be changed.",
          );
        return false;
      } finally {
        routeChangeInFlight.current = false;
        setRouteChanging(false);
      }
    },
    [player],
  );
  useFocusEffect(
    useCallback(() => {
      const generation = ++focusGeneration.current;
      playbackAuthorized.current = false;
      routeApplied.current = false;
      setError(false);
      setRoute("earpiece");
      setOutput(earpieceOutput);
      setRouteError(undefined);
      const unsubscribeRoute = subscribeToPlaybackAudioRoute((nextOutput) => {
        if (focusGeneration.current === generation)
          setOutput(
            playbackOutputForPreference(nextOutput, routeApplied.current),
          );
      });
      void readPlaybackAudioRoute()
        .then((nextOutput) => {
          if (focusGeneration.current === generation)
            setOutput(
              playbackOutputForPreference(nextOutput, routeApplied.current),
            );
        })
        .catch(() => {});
      const playback = createPlaybackController<PlaybackAudioRoute>({
        player,
        allowed: () =>
          focusGeneration.current === generation &&
          playbackAuthorized.current &&
          !callBusy(),
        configure: applyRoute,
        failed: failPlayback,
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
        ready: (value) => {
          playbackAuthorized.current = value;
          setReady(value);
        },
        failed: () => {
          failPlayback();
        },
      });
      return () => {
        ++focusGeneration.current;
        playbackAuthorized.current = false;
        playback.dispose();
        if (controller.current === playback) controller.current = null;
        unsubscribeRoute();
        session.dispose();
        if (routeApplied.current) {
          routeApplied.current = false;
          void resetPlaybackAudioRoute(() => !callBusy()).catch(() => {});
        }
      };
    }, [applyRoute, callUuid, failPlayback, path, player]),
  );
  useEffect(() => {
    if (status.playbackState === "failed" || status.playbackState === "error")
      failPlayback();
  }, [failPlayback, status.playbackState]);
  useEffect(() => {
    if (!ready || status.isLoaded) return;
    const timeout = setTimeout(() => {
      failPlayback();
    }, 15000);
    return () => clearTimeout(timeout);
  }, [failPlayback, ready, status.isLoaded]);
  return (
    <PlaybackControls
      colors={colors}
      currentTime={status.currentTime || 0}
      duration={status.duration || 0}
      playing={status.playing}
      loaded={ready && status.isLoaded}
      route={route}
      output={output}
      routeChanging={routeChanging}
      routeError={routeError}
      error={error ? "Playback unavailable. Refresh and try again." : undefined}
      onToggle={() => {
        const playback = controller.current;
        if (callBusy()) {
          playback?.pause();
          return;
        }
        if (status.playing || playback?.isPending()) {
          playback?.pause();
          return;
        }
        return playback?.play(
          route,
          Boolean(
            status.didJustFinish ||
            (status.duration > 0 && status.currentTime >= status.duration),
          ),
        );
      }}
      onSeek={(seconds) => {
        if (!callBusy())
          return player.seekTo(seconds).catch(() => failPlayback());
      }}
      onScrubStart={() => {
        resumeAfterScrub.current = status.playing;
        if (status.playing) controller.current?.pause();
      }}
      onScrubEnd={() => {
        if (
          resumeAfterScrub.current &&
          playbackAuthorized.current &&
          !callBusy()
        )
          player.play();
        resumeAfterScrub.current = false;
      }}
      onRouteChange={(nextRoute) => void applyRoute(nextRoute)}
    />
  );
}
