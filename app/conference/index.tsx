import { useCallback, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { MeetingPrejoin } from "@/components/meetings/meeting-prejoin";
import { ScreenContainer } from "@/components/screen-container";
import { Platform, Pressable, Text } from "react-native";
import { useColors } from "@/hooks/use-colors";
import type { AdmittedMeeting } from "@/lib/meetings/admitted-selection";
import { admittedMeetingsWithTenantTitles, safeMeetingTitle } from "@/lib/meetings/admitted-selection";
import { useChatStore } from "@/lib/chat/store";
import { meetingAdmissionFailure } from "@/lib/meetings/admission-failure";
import {
  MeetingJoinFailure,
  meetingJoinFailureStage,
  type MeetingJoinStage,
} from "@/lib/meetings/join-failure";

function EnabledMeetingPrejoin({
  user,
  admittedMeetings,
  initialMeetingCode,
  onOpenInvitations,
  onBack,
}: {
  user: { id: number; name?: string | null };
  admittedMeetings: readonly AdmittedMeeting[];
  initialMeetingCode?: string;
  onOpenInvitations?: () => void;
  onBack: () => void;
}) {
  const join = trpc.meetings.join.useMutation();
  const routeActive = useRef(false);
  const routeLifetime = useRef(0);
  // Stack routes remain mounted on blur. A later refocus must not revive a
  // pending admission or connection from the previous focus lifetime.
  useFocusEffect(useCallback(() => {
    routeLifetime.current += 1;
    routeActive.current = true;
    return () => {
      routeActive.current = false;
      routeLifetime.current += 1;
    };
  }, []));
  const requireActiveRoute = (lifetime: number) => {
    if (!routeActive.current || routeLifetime.current !== lifetime)
      throw new MeetingJoinFailure("post_connect_guard");
    // Profile refreshes preserve this owner reference; a new sign-in does not,
    // even when it belongs to the same numeric account.
    if (getAuthSnapshot().user !== user) throw new MeetingJoinFailure("admission");
  };
  const openConnectedMeeting = async (meeting: { leave(): Promise<void> }, lifetime: number) => {
    if (!routeActive.current || routeLifetime.current !== lifetime || getAuthSnapshot().user !== user) {
      // Stop only this attempt's session. Failed teardown remains owned by its
      // lifecycle for retry; never clear a newer meeting from the registry.
      await meeting.leave().catch(() => { throw new MeetingJoinFailure("room_cleanup"); });
      throw new MeetingJoinFailure("post_connect_guard");
    }
    router.push("/conference/room");
  };
  return (
    <MeetingPrejoin
      authenticatedDisplayName={user.name ?? ""}
      admittedMeetings={admittedMeetings}
      initialMeetingCode={initialMeetingCode}
      onOpenInvitations={onOpenInvitations}
      onJoin={async (preferences) => {
        let stage: MeetingJoinStage = "bindings";
        const joiningOwnerId = user.id;
        const lifetime = routeLifetime.current;
        try {
          requireActiveRoute(lifetime);
          if (Platform.OS === "web") {
            stage = "admission";
            const admission = await join.mutateAsync({ meetingId: preferences.meetingCode })
              .catch(error => { throw meetingAdmissionFailure(error); });
            requireActiveRoute(lifetime);
            stage = "bindings";
            const { WebMeetingLifecycle } = await import("@/lib/meetings/web-session");
            requireActiveRoute(lifetime);
            const meeting = await WebMeetingLifecycle.join(joiningOwnerId, preferences.meetingCode, admission, {
              microphone: preferences.microphoneEnabled,
              camera: preferences.cameraEnabled,
            });
            stage = "connected";
            await openConnectedMeeting(meeting, lifetime);
            return;
          }
          // Default-off builds never load a native meeting/SIP implementation
          // until the authenticated server has made joining available.
          const [{ useSipCallStore }, { NativeMeetingLifecycle }] =
            await Promise.all([
              import("@/lib/sip/call-store"),
              import("@/lib/meetings/native-session"),
            ]);
          requireActiveRoute(lifetime);
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
            throw new MeetingJoinFailure("audio_start", { reason: "phone_call_active" });
          stage = "admission";
          const admission = await join.mutateAsync({
            meetingId: preferences.meetingCode,
          }).catch(error => { throw meetingAdmissionFailure(error); });
          requireActiveRoute(lifetime);
          stage = "native_setup";
          const meeting = await NativeMeetingLifecycle.join(preferences.meetingCode, admission, {
            microphone: preferences.microphoneEnabled,
            camera: preferences.cameraEnabled,
          });
          stage = "connected";
          await openConnectedMeeting(meeting, lifetime);
        } catch (error) {
          if (meetingJoinFailureStage(error)) throw error;
          throw new MeetingJoinFailure(stage);
        }
      }}
      onBack={() => {
        routeActive.current = false;
        routeLifetime.current += 1;
        onBack();
      }}
    />
  );
}

export default function ConferenceScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ meetingId?: string; tenantId?: string; source?: string }>();
  const requestedMeeting = typeof params.meetingId === "string" ? params.meetingId : "";
  const { user } = useAuth({ autoFetch: false });
  const chatOwnerId = useChatStore(state => state.userId);
  const selectedWorkspaceId = useChatStore(state => state.workspace?.id);
  const requestedTenantId = Number(params.tenantId);
  const fromConversation = params.source === "channel" || params.source === "direct";
  const selectedTenantId =
    fromConversation &&
    Number.isSafeInteger(requestedTenantId) && requestedTenantId > 0 &&
    user?.id === chatOwnerId && selectedWorkspaceId === requestedTenantId
      ? requestedTenantId
      : null;
  const capabilities = trpc.meetings.capabilities.useQuery(undefined, {
    enabled: !!user,
    retry: false,
  });
  const admittedMeetings = trpc.meetings.available.useQuery(undefined, {
    enabled: !!user && capabilities.data?.available === true && !fromConversation,
    retry: false,
  });
  const tenantMeetings = trpc.meetings.availableForTenant.useQuery(
    { tenantId: selectedTenantId ?? 0 },
    { enabled: !!user && capabilities.data?.available === true && selectedTenantId !== null, retry: false, staleTime: 0 },
  );
  // A conversation link names one exact room. The general availability list
  // is intentionally capped, so it cannot be used as proof that this room is
  // admitted (or as the picker for a direct/channel invitation).
  const exactMeeting = trpc.meetings.availableMeetingForTenant.useQuery(
    { tenantId: selectedTenantId ?? 0, meetingId: requestedMeeting },
    { enabled: !!user && capabilities.data?.available === true && selectedTenantId !== null && !!requestedMeeting, retry: false,
      staleTime: 0, gcTime: 0, refetchOnMount: "always" },
  );
  const scopedMeeting = user && getAuthSnapshot().user === user && selectedTenantId !== null &&
    !exactMeeting.isFetching && !exactMeeting.error && exactMeeting.data?.meetingId === requestedMeeting &&
    exactMeeting.data?.tenantId === selectedTenantId
    ? {
        meetingId: requestedMeeting,
        title: safeMeetingTitle(tenantMeetings.data?.find(row => row.meetingId === requestedMeeting)?.title),
      }
    : null;
  const displayedMeetings = fromConversation
    ? scopedMeeting ? [scopedMeeting] : undefined
    : admittedMeetings.data
      ? admittedMeetingsWithTenantTitles(admittedMeetings.data, undefined, null)
      : undefined;
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
      {!fromConversation &&
        user &&
        getAuthSnapshot().user === user &&
        chatOwnerId === user.id &&
        selectedWorkspaceId && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New meeting"
            accessibilityHint="Choose a team channel and participants to invite."
            onPress={() => {
              const auth = getAuthSnapshot();
              const chat = useChatStore.getState();
              if (
                !auth.loading &&
                auth.user === user &&
                chat.userId === user.id &&
                chat.workspace?.id === selectedWorkspaceId
              )
                router.push("/conference/create");
            }}
            style={{
              minHeight: 48,
              marginHorizontal: 20,
              marginTop: 12,
              justifyContent: "center",
              alignItems: "center",
              borderRadius: 12,
              backgroundColor: colors.primary,
            }}
          >
            <Text style={{ color: "#ffffff", fontSize: 17, fontWeight: "600" }}>
              New meeting
            </Text>
          </Pressable>
        )}
      {user && !capabilities.error && (fromConversation || !admittedMeetings.error) && capabilities.data?.available && displayedMeetings?.length ? (
        <EnabledMeetingPrejoin
          key={`${user.id}:${requestedMeeting}:${displayedMeetings.map(item => item.meetingId).join(",")}`}
          initialMeetingCode={requestedMeeting}
          user={user}
          admittedMeetings={displayedMeetings}
          onOpenInvitations={!fromConversation ? () => {
            if (getAuthSnapshot().user === user) router.push("/(tabs)/teamchat");
          } : undefined}
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
