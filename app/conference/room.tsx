import { useCallback, useEffect, useMemo } from "react";
import { BackHandler } from "react-native";
import { router } from "expo-router";

import { useAuth } from "@/hooks/use-auth";

import { MeetingRoomState } from "@/components/meetings/meeting-room-state";
import { ScreenContainer } from "@/components/screen-container";
import { getActiveNativeMeeting } from "@/lib/meetings/native-session-registry";
import { createMeetingRouteExit } from "@/lib/meetings/route-exit";

/**
 * A route shell only. The authenticated meeting adapter must supply a real
 * BrowserMeetingSession to MeetingRoomState before media can become available.
 */
export default function ConferenceRoomScreen() {
  const { user } = useAuth({ autoFetch: false });
  const meeting = user ? getActiveNativeMeeting(user.id) : undefined;
  const back = useCallback(() =>
    router.canGoBack() ? router.back() : router.replace("/(tabs)"), []);
  const exit = useMemo(
    () => meeting ? createMeetingRouteExit(meeting, back) : undefined,
    [meeting, back],
  );
  useEffect(() => {
    if (!exit) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      void exit.leaveAndNavigate().catch(() => undefined);
      return true;
    });
    return () => {
      subscription.remove();
      exit.dispose();
    };
  }, [exit]);
  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <MeetingRoomState
        session={meeting?.session}
        nativeRoom={meeting?.room}
        receiveOnly={meeting?.receiveOnly}
        isSipInterrupted={meeting ? () => meeting.wasInterruptedBySip : undefined}
        roomName="Meeting room"
        unavailableReason={meeting ? undefined : "Meetings are still being configured for this workspace. There is no connected meeting session on this device."}
        onLeave={exit ? () => exit.leaveAndNavigate() : undefined}
        onBack={back}
      />
    </ScreenContainer>
  );
}
