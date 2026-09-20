import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { router } from "expo-router";
import { MeetingPrejoin } from "@/components/meetings/meeting-prejoin";
import { ScreenContainer } from "@/components/screen-container";
import type { AdmittedMeeting } from "@/lib/meetings/admitted-selection";

function EnabledMeetingPrejoin({
  user,
  admittedMeetings,
  onBack,
}: {
  user: { id: number; name?: string | null };
  admittedMeetings: readonly AdmittedMeeting[];
  onBack: () => void;
}) {
  const join = trpc.meetings.join.useMutation();
  return (
    <MeetingPrejoin
      initialDisplayName={user.name ?? ""}
      admittedMeetings={admittedMeetings}
      onJoin={async (preferences) => {
        // Default-off builds never load a native meeting/SIP implementation
        // until the authenticated server has made joining available.
        const [{ useSipCallStore }, { NativeMeetingLifecycle }] =
          await Promise.all([
            import("@/lib/sip/call-store"),
            import("@/lib/meetings/native-session"),
          ]);
        const calls = useSipCallStore.getState();
        const sipBusy =
          Boolean(
            calls.incomingCall && calls.incomingCall.status !== "disconnected",
          ) ||
          Object.values(calls.activeCalls).some(
            (call) => call.status !== "disconnected",
          );
        if (sipBusy)
          throw new Error("Finish your Phone call before joining a meeting.");
        const admission = await join.mutateAsync({
          meetingId: preferences.meetingCode,
        });
        await NativeMeetingLifecycle.join(preferences.meetingCode, admission, {
          microphone: preferences.microphoneEnabled,
          camera: preferences.cameraEnabled,
        });
        router.push("/conference/room");
      }}
      onBack={onBack}
    />
  );
}

export default function ConferenceScreen() {
  const { user } = useAuth({ autoFetch: false });
  const capabilities = trpc.meetings.capabilities.useQuery(undefined, {
    enabled: !!user,
    retry: false,
  });
  const admittedMeetings = trpc.meetings.available.useQuery(undefined, {
    enabled: !!user && capabilities.data?.available === true,
    retry: false,
  });
  const reason = !user
    ? "Sign in to join your workspace meetings."
    : capabilities.isLoading
      ? "Checking meeting availability…"
      : capabilities.error
        ? "Could not check meeting availability. Return to Team and try again."
        : !capabilities.data?.available
          ? (capabilities.data?.reason ??
            "Video meetings are being connected for your workspace. Joining is not available yet.")
          : admittedMeetings.isLoading
            ? "Loading your admitted meetings…"
            : admittedMeetings.error
              ? "Could not load your admitted meetings. Return to Team and try again."
              : !admittedMeetings.data?.length
                ? "There are no admitted meetings for this account."
                : undefined;
  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      {user && capabilities.data?.available && admittedMeetings.data?.length ? (
        <EnabledMeetingPrejoin
          key={user.id}
          user={user}
          admittedMeetings={admittedMeetings.data}
          onBack={() =>
            router.canGoBack() ? router.back() : router.replace("/(tabs)")
          }
        />
      ) : (
        <MeetingPrejoin
          key={user?.id ?? "signed-out"}
          initialDisplayName={user?.name ?? ""}
          unavailableReason={reason}
          onRetryAvailability={
            user && !capabilities.isLoading
              ? () => {
                  void capabilities.refetch();
                  void admittedMeetings.refetch();
                }
              : undefined
          }
          checkingAvailability={
            capabilities.isFetching || admittedMeetings.isFetching
          }
          onBack={() =>
            router.canGoBack() ? router.back() : router.replace("/(tabs)")
          }
        />
      )}
    </ScreenContainer>
  );
}
