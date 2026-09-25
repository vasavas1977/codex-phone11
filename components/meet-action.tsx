import { Pressable } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
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
  return <Pressable accessibilityRole="button" accessibilityLabel="Meet" accessibilityHint="Open video meetings"
    onPress={() => router.push("/conference")}
    style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
    <IconSymbol name="video.fill" size={25} color={colors.primary} />
  </Pressable>;
}
