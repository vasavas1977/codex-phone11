import { Pressable } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

/** Opens the existing admitted-meeting pre-join flow; it never creates or invites a chat participant. */
export function ChatMeetingAction() {
  const { user } = useAuth({ autoFetch: false });
  const colors = useColors();
  const capabilities = trpc.meetings.capabilities.useQuery(undefined, {
    enabled: !!user,
    retry: false,
    staleTime: 0,
  });
  if (
    !user ||
    capabilities.isLoading ||
    capabilities.isFetching ||
    capabilities.error ||
    !capabilities.data?.available
  )
    return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Meet"
      accessibilityHint="Choose one of your available meetings. This does not call or invite this person."
      onPress={() => router.push("/conference")}
      style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
    >
      <MaterialIcons name="videocam" size={24} color={colors.primary} />
    </Pressable>
  );
}
