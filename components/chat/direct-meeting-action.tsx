import { useCallback, useRef, useState } from "react";
import { Alert, Pressable } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { useChatStore } from "@/lib/chat/store";
import { trpc } from "@/lib/trpc";

type Owner = NonNullable<ReturnType<typeof useAuth>["user"]>;
type Scope = { owner: Owner | null; tenantId: number; conversationId: string };

/** Start a new meeting with this exact direct-chat peer; admission stays server-owned. */
export function DirectMeetingAction({
  tenantId,
  conversationId,
}: {
  tenantId: number;
  conversationId: string;
}) {
  const { user } = useAuth({ autoFetch: false });
  const colors = useColors();
  const chatOwnerId = useChatStore((state) => state.userId);
  const workspaceId = useChatStore((state) => state.workspace?.id);
  const active = useRef<Scope | null>(null);
  const rendered = useRef<Scope>({ owner: user, tenantId, conversationId });
  rendered.current = { owner: user, tenantId, conversationId };
  const pending = useRef<Scope | null>(null);
  const [busyScope, setBusyScope] = useState<Scope | null>(null);
  useFocusEffect(
    useCallback(() => {
      // A new object identifies this focused visit, including return to the same
      // chat. Retired callbacks cannot become current again after refocus.
      const scope = { owner: user, tenantId, conversationId };
      active.current = scope;
      setBusyScope(null);
      return () => {
        if (active.current === scope) active.current = null;
      };
    }, [user, tenantId, conversationId]),
  );
  const eligibleScope =
    !!user &&
    getAuthSnapshot().user === user &&
    chatOwnerId === user.id &&
    workspaceId === tenantId;
  const currentScope = (scope: Scope) => {
    const auth = getAuthSnapshot();
    const owner = auth.user;
    const chat = useChatStore.getState();
    return (
      active.current === scope &&
      scope.owner === user &&
      scope.tenantId === tenantId &&
      scope.conversationId === conversationId &&
      !auth.loading &&
      rendered.current.owner === scope.owner &&
      rendered.current.tenantId === scope.tenantId &&
      rendered.current.conversationId === scope.conversationId &&
      !!owner &&
      owner === scope.owner &&
      chat.userId === owner.id &&
      chat.workspace?.id === scope.tenantId &&
      chat.channels.some(
        (item) => item.id === scope.conversationId && item.kind === "direct",
      )
    );
  };
  const capability = trpc.meetings.directCapabilities.useQuery(
    { tenantId, conversationId },
    { enabled: eligibleScope, retry: false, staleTime: 0 },
  );
  const start = trpc.meetings.startDirectMeeting.useMutation();
  // Blur retires UI feedback, not a dispatched durable invitation. Keep its
  // actor/chat request ID for an explicit retry on a later focused visit.
  const request = useRef<{ key: string; requestId: string } | null>(null);
  const busy =
    busyScope !== null &&
    busyScope === active.current &&
    busyScope.owner === user &&
    busyScope.tenantId === tenantId &&
    busyScope.conversationId === conversationId;
  const available =
    eligibleScope &&
    capability.data?.available === true &&
    capability.data?.canStart === true &&
    !capability.error;
  const checking =
    eligibleScope && (capability.isLoading || capability.isFetching);
  const onPress = async () => {
    const scope = active.current;
    if (
      !scope ||
      !available ||
      !currentScope(scope) ||
      pending.current === scope
    )
      return;
    pending.current = scope;
    setBusyScope(scope);
    try {
      const fresh = await capability.refetch();
      if (!currentScope(scope)) return;
      if (fresh.error || !fresh.data?.available || !fresh.data.canStart) {
        Alert.alert(
          "Meeting unavailable",
          "Meeting access changed. Open this chat again and retry.",
        );
        return;
      }
      const key = `${user!.id}:${tenantId}:${conversationId}`;
      const attempt =
        request.current?.key === key
          ? request.current
          : {
              key,
              requestId: "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
                /[xy]/g,
                (character) => {
                  const random = Math.floor(Math.random() * 16);
                  return (
                    character === "x" ? random : (random & 3) | 8
                  ).toString(16);
                },
              ),
            };
      request.current = attempt;
      const result = await start.mutateAsync({
        tenantId,
        conversationId,
        requestId: attempt.requestId,
      });
      if (!currentScope(scope)) return;
      if (request.current === attempt) request.current = null;
      router.push({
        pathname: "/conference",
        params: {
          meetingId: result.meetingId,
          tenantId: String(tenantId),
          source: "direct",
        },
      });
    } catch {
      if (currentScope(scope))
        Alert.alert(
          "Meeting could not start",
          "Check your connection and try again. The same request will be recovered safely.",
        );
    } finally {
      if (pending.current === scope) pending.current = null;
      if (currentScope(scope))
        setBusyScope((value) => (value === scope ? null : value));
    }
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        available
          ? "Meet with contact"
          : checking
            ? "Checking meeting availability"
            : "Video meeting unavailable"
      }
      accessibilityHint={
        available
          ? "Start a video meeting and invite this contact."
          : "Meeting hosting must be enabled for this direct chat."
      }
      accessibilityState={{
        disabled: !available || busy,
        busy: busy || checking,
      }}
      disabled={!available || busy}
      onPress={() => void onPress()}
      style={{
        minWidth: 44,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <MaterialIcons
        name="videocam"
        size={24}
        color={available ? colors.primary : colors.muted}
      />
    </Pressable>
  );
}
