import { Alert, Platform, Pressable } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { router } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { useChatStore } from "@/lib/chat/store";

/** Admission availability controls joining, while setup remains a separate entry. */
export function MeetAction() {
  const { user } = useAuth({ autoFetch: false });
  const chatOwnerId = useChatStore(state => state.userId);
  const workspace = useChatStore(state => state.workspace);
  const colors = useColors();
  const capabilities = trpc.meetings.capabilities.useQuery(undefined, {
    enabled: !!user,
    retry: false,
    staleTime: 0,
  });

  if (!user) return null;

  const checking = Boolean(capabilities.isLoading || capabilities.isFetching) && !capabilities.error;
  const available = capabilities.data?.available === true && !capabilities.error && !checking;
  const unavailableReason = capabilities.data?.available === false
    ? capabilities.data.reason
    : undefined;
  const webSetup = Platform.OS === "web";
  const label = available
    ? "Meet"
    : webSetup
      ? "Open meeting setup"
      : checking
        ? "Checking meeting availability"
        : capabilities.error
          ? "Retry meeting availability"
          : "Open meeting setup";

  // Native alerts retain callbacks after this render. A new sign-in (even for
  // the same account) or replacement workspace must retire every old action.
  const currentContext = () => {
    const auth = getAuthSnapshot();
    const chat = useChatStore.getState();
    return !auth.loading && auth.user === user &&
      chat.userId === chatOwnerId && chat.workspace === workspace;
  };
  const openSetup = () => {
    if (currentContext()) router.push("/conference");
  };
  const retryAvailability = () => {
    if (currentContext()) void capabilities.refetch();
  };

  const onPress = () => {
    if (!currentContext()) return;
    // React Native Web's Alert is a no-op. The setup route presents its own
    // availability state and keeps hosting/admission checks authoritative.
    if (webSetup || available) {
      openSetup();
      return;
    }

    if (checking) {
      Alert.alert(
        "Checking meeting availability",
        "Phone11 is checking whether meetings are available for this workspace.",
        [
          { text: "Wait", style: "cancel" },
          { text: "Check again", onPress: retryAvailability },
          { text: "Open meeting setup", onPress: openSetup },
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
          { text: "Try again", onPress: retryAvailability },
          { text: "Open meeting setup", onPress: openSetup },
        ],
      );
      return;
    }

    Alert.alert(
      "Video meetings unavailable",
      unavailableReason ??
        "Video meetings are not available for this workspace yet. Contact your administrator.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open meeting setup", onPress: openSetup },
      ],
    );
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={available
        ? "Open meeting setup and your available video meetings."
        : webSetup
          ? "Open meeting setup to choose a channel and participants. Joining and hosting are checked separately."
          : checking
            ? "Show meeting availability, retry the check, or open meeting setup."
            : "Show meeting availability or open setup to choose a channel and participants. Joining and hosting are checked separately."}
      accessibilityState={{ busy: checking }}
      onPress={onPress}
      style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
    >
      <IconSymbol name="video.fill" size={25} color={available ? colors.primary : colors.muted ?? colors.primary} />
    </Pressable>
  );
}
