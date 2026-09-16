import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

/** Keep an unavailable meeting service out of the primary navigation actions. */
export function MeetAction() {
  const { user } = useAuth({ autoFetch: false });
  const colors = useColors();
  const capabilities = trpc.meetings.capabilities.useQuery(undefined, {
    enabled: !!user, retry: false, staleTime: 0,
  });
  if (!user || capabilities.isLoading || capabilities.isFetching || capabilities.error || !capabilities.data?.available) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel="Meet"
    onPress={() => router.push("/conference")}
    style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
    <Text style={{ color: colors.primary, fontWeight: "600" }}>Meet</Text>
  </Pressable>;
}
