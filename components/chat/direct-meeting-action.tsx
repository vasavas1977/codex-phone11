import { useRef, useState } from "react";
import { Alert, Pressable } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { useChatStore } from "@/lib/chat/store";
import { trpc } from "@/lib/trpc";

/** Start a new meeting with this exact direct-chat peer; admission stays server-owned. */
export function DirectMeetingAction({ tenantId, conversationId }: {
  tenantId: number;
  conversationId: string;
}) {
  const { user } = useAuth({ autoFetch: false });
  const colors = useColors();
  const chatOwnerId = useChatStore(state => state.userId);
  const workspaceId = useChatStore(state => state.workspace?.id);
  const eligibleScope = !!user && getAuthSnapshot().user === user &&
    chatOwnerId === user.id && workspaceId === tenantId;
  const currentScope = () => {
    const owner = getAuthSnapshot().user;
    const chat = useChatStore.getState();
    return !!owner && owner === user && chat.userId === owner.id &&
      chat.workspace?.id === tenantId &&
      chat.channels.some(item => item.id === conversationId && item.kind === "direct");
  };
  const capability = trpc.meetings.directCapabilities.useQuery(
    { tenantId, conversationId },
    { enabled: eligibleScope, retry: false, staleTime: 0 },
  );
  const start = trpc.meetings.startDirectMeeting.useMutation();
  const request = useRef<{ key: string; requestId: string } | null>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const available = eligibleScope && capability.data?.available === true &&
    capability.data?.canStart === true && !capability.error;
  const checking = eligibleScope && (capability.isLoading || capability.isFetching);
  const onPress = async () => {
    if (!available || !currentScope() || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const fresh = await capability.refetch();
      if (!currentScope() || fresh.error || !fresh.data?.canStart) {
        Alert.alert("Meeting unavailable", "Meeting access changed. Open this chat again and retry.");
        return;
      }
      const key = `${user!.id}:${tenantId}:${conversationId}`;
      const attempt = request.current?.key === key ? request.current : {
        key,
        requestId: "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
          const random = Math.floor(Math.random() * 16);
          return (character === "x" ? random : (random & 3) | 8).toString(16);
        }),
      };
      request.current = attempt;
      const result = await start.mutateAsync({ tenantId, conversationId, requestId: attempt.requestId });
      if (!currentScope()) return;
      request.current = null;
      router.push({ pathname: "/conference", params: {
        meetingId: result.meetingId,
        tenantId: String(tenantId),
        source: "direct",
      } });
    } catch {
      if (currentScope())
        Alert.alert("Meeting could not start", "Check your connection and try again. The same request will be recovered safely.");
    } finally {
      pending.current = false;
      if (currentScope()) setBusy(false);
    }
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={available ? "Meet with contact" : checking ? "Checking meeting availability" : "Video meeting unavailable"}
      accessibilityHint={available ? "Start a video meeting and invite this contact." : "Meeting hosting must be enabled for this direct chat."}
      accessibilityState={{ disabled: !available || busy, busy: busy || checking }}
      disabled={!available || busy}
      onPress={() => void onPress()}
      style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
    >
      <MaterialIcons name="videocam" size={24} color={available ? colors.primary : colors.muted} />
    </Pressable>
  );
}
