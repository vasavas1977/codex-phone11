import { router } from "expo-router";

import { MeetingRoomState } from "@/components/meetings/meeting-room-state";
import { ScreenContainer } from "@/components/screen-container";

/**
 * A route shell only. The authenticated meeting adapter must supply a real
 * BrowserMeetingSession to MeetingRoomState before media can become available.
 */
export default function ConferenceRoomScreen() {
  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <MeetingRoomState
        roomName="Meeting room"
        unavailableReason="Meetings are still being configured for this workspace. There is no connected meeting session on this device."
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)")
        }
      />
    </ScreenContainer>
  );
}
