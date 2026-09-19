import { router } from "expo-router";

import { useAuth } from "@/hooks/use-auth";

import { MeetingRoomState } from "@/components/meetings/meeting-room-state";
import { ScreenContainer } from "@/components/screen-container";
import { getActiveNativeMeeting } from "@/lib/meetings/native-session-registry";

/**
 * A route shell only. The authenticated meeting adapter must supply a real
 * BrowserMeetingSession to MeetingRoomState before media can become available.
 */
export default function ConferenceRoomScreen() {
  const { user } = useAuth({ autoFetch: false });
  const meeting = user ? getActiveNativeMeeting(user.id) : undefined;
  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <MeetingRoomState
        session={meeting?.session}
        nativeRoom={meeting?.room}
        receiveOnly={meeting?.receiveOnly}
        isSipInterrupted={meeting ? () => meeting.wasInterruptedBySip : undefined}
        roomName="Meeting room"
        unavailableReason={meeting ? undefined : "Meetings are still being configured for this workspace. There is no connected meeting session on this device."}
        onLeave={meeting ? () => meeting.leave() : undefined}
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)")
        }
      />
    </ScreenContainer>
  );
}
