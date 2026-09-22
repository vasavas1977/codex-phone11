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
  if (!user) return null;

  // The header reserves the camera affordance even before the capability
  // check completes. Hiding it made a supported Team Chat look unfinished,
  // while treating a failed-closed admission check as a direct video call
  // would over-promise. Only an admitted meeting enables navigation.
  const capability = capabilities.data;
  const available = capability?.available === true && !capabilities.error;
  const unavailableReason =
    capability?.available === false ? capability.reason : undefined;
  const checking =
    !available &&
    (capabilities.isLoading || capabilities.isFetching) &&
    !capabilities.error;
  const label = available
    ? "Meet"
    : checking
      ? "Checking meeting availability"
      : "Video meetings unavailable";
  const hint = available
    ? "Choose one of your available meetings. This does not call or invite this person."
    : checking
      ? "Checking whether admitted video meetings are available in this workspace."
      : (unavailableReason ??
        "Video meetings are not available for this workspace. Phone calls remain available.");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !available, busy: checking }}
      disabled={!available}
      onPress={available ? () => router.push("/conference") : undefined}
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
