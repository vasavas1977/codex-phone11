import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { router, useLocalSearchParams } from "expo-router";
import { MeetingPrejoin } from "@/components/meetings/meeting-prejoin";
import { ScreenContainer } from "@/components/screen-container";
import type { AdmittedMeeting } from "@/lib/meetings/admitted-selection";
import {
  MeetingJoinFailure,
  meetingJoinFailureStage,
  type MeetingJoinStage,
} from "@/lib/meetings/join-failure";

function EnabledMeetingPrejoin({
  user,
  admittedMeetings,
  initialMeetingCode,
  onBack,
}: {
  user: { id: number; name?: string | null };
  admittedMeetings: readonly AdmittedMeeting[];
  initialMeetingCode?: string;
  onBack: () => void;
}) {
  const join = trpc.meetings.join.useMutation();
  return (
    <MeetingPrejoin
      authenticatedDisplayName={user.name ?? ""}
      admittedMeetings={admittedMeetings}
      initialMeetingCode={initialMeetingCode}
      onJoin={async (preferences) => {
        let stage: MeetingJoinStage = "bindings";
        try {
          // Default-off builds never load a native meeting/SIP implementation
          // until the authenticated server has made joining available.
          const [{ useSipCallStore }, { NativeMeetingLifecycle }] =
            await Promise.all([
              import("@/lib/sip/call-store"),
              import("@/lib/meetings/native-session"),
            ]);
          stage = "audio_start";
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
          stage = "admission";
          const admission = await join.mutateAsync({
            meetingId: preferences.meetingCode,
          });
          await NativeMeetingLifecycle.join(preferences.meetingCode, admission, {
            microphone: preferences.microphoneEnabled,
            camera: preferences.cameraEnabled,
          });
          stage = "connected";
          router.push("/conference/room");
        } catch (error) {
          if (meetingJoinFailureStage(error)) throw error;
          throw new MeetingJoinFailure(stage);
        }
      }}
      onBack={onBack}
    />
  );
}

export default function ConferenceScreen() {
  const params = useLocalSearchParams<{ meetingId?: string }>();
  const requestedMeeting = typeof params.meetingId === "string" ? params.meetingId : "";
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
      {user && !capabilities.error && !admittedMeetings.error && capabilities.data?.available && admittedMeetings.data?.length ? (
        <EnabledMeetingPrejoin
          key={`${user.id}:${requestedMeeting}:${admittedMeetings.data.map(item => item.meetingId).join(",")}`}
          initialMeetingCode={requestedMeeting}
          user={user}
          admittedMeetings={admittedMeetings.data}
          onBack={() =>
            router.canGoBack() ? router.back() : router.replace("/(tabs)")
          }
        />
      ) : (
        <MeetingPrejoin
          key={user?.id ?? "signed-out"}
          authenticatedDisplayName={user?.name ?? ""}
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
