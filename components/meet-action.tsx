import { Alert, Pressable } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { router } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

/** Keep the meeting entry visible without implying that unavailable meetings can be joined. */
export function MeetAction() {
  const { user } = useAuth({ autoFetch: false });
  const colors = useColors();
  const capabilities = trpc.meetings.capabilities.useQuery(undefined, {
    enabled: !!user,
    retry: false,
    staleTime: 0,
  });

  if (!user) return null;

  const checking = (capabilities.isLoading || capabilities.isFetching) && !capabilities.error;
  const available = capabilities.data?.available === true && !capabilities.error && !checking;
  const unavailableReason = capabilities.data?.available === false
    ? capabilities.data.reason
    : undefined;
  const label = available
    ? "Meet"
    : checking
      ? "Checking meeting availability"
      : capabilities.error
        ? "Retry meeting availability"
        : "Video meetings unavailable";

  const onPress = () => {
    if (available) {
      router.push("/conference");
      return;
    }

    if (checking) {
      Alert.alert(
        "Checking meeting availability",
        "Phone11 is checking whether meetings are available for this workspace.",
        [
          { text: "Wait", style: "cancel" },
          { text: "Check again", onPress: () => void capabilities.refetch() },
        ],
      );
      return;
    }

    if (capabilities.error) {
      Alert.alert(
        "Could not check meeting availability",
        "Check your connection and try again.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Try again", onPress: () => void capabilities.refetch() },
        ],
      );
      return;
    }

    Alert.alert(
      "Video meetings unavailable",
      unavailableReason ??
        "Video meetings are not available for this workspace yet. Contact your administrator.",
    );
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={available
        ? "Open your available video meetings."
        : checking
          ? "Show meeting availability and retry the check."
          : "Show why video meetings are unavailable or retry checking availability."}
      accessibilityState={{ busy: checking }}
      onPress={onPress}
      style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
    >
      <IconSymbol name="video.fill" size={25} color={available ? colors.primary : colors.muted ?? colors.primary} />
    </Pressable>
  );
}
