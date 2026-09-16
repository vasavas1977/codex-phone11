import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { router } from "expo-router";
import { MeetingPrejoin } from "@/components/meetings/meeting-prejoin";
import { ScreenContainer } from "@/components/screen-container";

export default function ConferenceScreen() {
  const { user } = useAuth({ autoFetch: false });
  const capabilities = trpc.meetings.capabilities.useQuery(undefined, { enabled: !!user, retry: false });
  const reason = !user ? "Sign in to join your workspace meetings."
    : capabilities.isLoading ? "Checking meeting availability…"
    : capabilities.error ? "Could not check meeting availability. Return to Team and try again."
    : capabilities.data?.available ? undefined
    : capabilities.data?.reason ?? "Video meetings are being connected for your workspace. Joining is not available yet.";
  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <MeetingPrejoin
        key={user?.id ?? "signed-out"}
        initialDisplayName={user?.name ?? ""}
        unavailableReason={reason}
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/(tabs)")
        }
      />
    </ScreenContainer>
  );
}
