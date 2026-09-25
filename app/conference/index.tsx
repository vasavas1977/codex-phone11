import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { useChatStore } from "@/lib/chat/store";
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
      initialDisplayName={user.name ?? ""}
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
  const params = useLocalSearchParams<{ meetingId?: string; tenantId?: string; source?: string }>();
  const requestedMeeting = typeof params.meetingId === "string" ? params.meetingId : "";
  const { user } = useAuth({ autoFetch: false });
  const chatOwnerId = useChatStore(state => state.userId);
  const selectedWorkspaceId = useChatStore(state => state.workspace?.id);
  const requestedTenantId = Number(params.tenantId);
  const fromConversation = params.source === "channel" || params.source === "direct";
  const selectedTenantId = fromConversation && Number.isSafeInteger(requestedTenantId) &&
    requestedTenantId > 0 && user?.id === chatOwnerId && selectedWorkspaceId === requestedTenantId
      ? requestedTenantId : null;
  const capabilities = trpc.meetings.capabilities.useQuery(undefined, {
    enabled: !!user,
    retry: false,
  });
  const admittedMeetings = trpc.meetings.available.useQuery(undefined, {
    enabled: !!user && capabilities.data?.available === true && !fromConversation,
    retry: false,
  });
  // The general list is capped. A chat invitation must verify its exact room.
  const exactMeeting = trpc.meetings.availableMeetingForTenant.useQuery(
    { tenantId: selectedTenantId ?? 0, meetingId: requestedMeeting },
    { enabled: !!user && capabilities.data?.available === true && selectedTenantId !== null && !!requestedMeeting,
      retry: false, staleTime: 0, gcTime: 0, refetchOnMount: "always" },
  );
  const scopedMeeting = user && getAuthSnapshot().user === user && selectedTenantId !== null &&
    !exactMeeting.isFetching && !exactMeeting.error && exactMeeting.data?.meetingId === requestedMeeting &&
    exactMeeting.data?.tenantId === selectedTenantId ? { meetingId: requestedMeeting } : null;
  const displayedMeetings = fromConversation
    ? scopedMeeting ? [scopedMeeting] : undefined
    : admittedMeetings.data;
  const reason = !user
    ? "Sign in to join your workspace meetings."
    : fromConversation && selectedTenantId === null
      ? "Return to Team Chat and open this meeting from the current workspace."
    : capabilities.isLoading
      ? "Checking meeting availability…"
      : capabilities.error
        ? "Could not check meeting availability. Return to Team and try again."
        : !capabilities.data?.available
          ? (capabilities.data?.reason ??
            "Video meetings are being connected for your workspace. Joining is not available yet.")
          : fromConversation && (exactMeeting.isLoading || exactMeeting.isFetching)
            ? "Checking this meeting invitation…"
            : fromConversation && exactMeeting.error
              ? "Could not check this meeting invitation. Return to Team Chat and try again."
              : fromConversation
                ? scopedMeeting ? undefined : "This meeting invitation is no longer available."
          : admittedMeetings.isLoading
            ? "Loading your admitted meetings…"
            : admittedMeetings.error
              ? "Could not load your admitted meetings. Return to Team and try again."
              : !admittedMeetings.data?.length
                ? "There are no admitted meetings for this account."
                : undefined;
  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      {user && !capabilities.error && (fromConversation || !admittedMeetings.error) && capabilities.data?.available && displayedMeetings?.length ? (
        <EnabledMeetingPrejoin
          key={`${user.id}:${requestedMeeting}:${displayedMeetings.map(item => item.meetingId).join(",")}`}
          initialMeetingCode={requestedMeeting}
          user={user}
          admittedMeetings={displayedMeetings}
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
                  if (fromConversation) void exactMeeting.refetch();
                  else void admittedMeetings.refetch();
                }
              : undefined
          }
          checkingAvailability={
            capabilities.isFetching || (fromConversation ? exactMeeting.isFetching : admittedMeetings.isFetching)
          }
          onBack={() =>
            router.canGoBack() ? router.back() : router.replace("/(tabs)")
          }
        />
      )}
    </ScreenContainer>
  );
}
