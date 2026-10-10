import { ScreenContainer } from "@/components/screen-container";
import { ChannelMeetingCreate } from "@/components/meetings/channel-meeting-create";

export default function CreateMeetingScreen() {
  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <ChannelMeetingCreate />
    </ScreenContainer>
  );
}
