import { Pressable, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";

export type UnreadContentKind = "messages" | "replies";

function labelFor(kind: UnreadContentKind) {
  return kind === "replies" ? "New replies" : "New messages";
}

/**
 * A presentational boundary. Its caller must know the exact first unread item;
 * this component never infers one from a channel-level unread total.
 */
export function UnreadMessageDivider({
  kind = "messages",
}: {
  kind?: UnreadContentKind;
}) {
  const colors = useColors();
  const label = labelFor(kind);
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 14 }}
    >
      <View style={{ height: 1, flex: 1, backgroundColor: colors.error + "66" }} />
      <Text style={{ color: colors.error, fontSize: 12, fontWeight: "700" }}>
        {label}
      </Text>
      <View style={{ height: 1, flex: 1, backgroundColor: colors.error + "66" }} />
    </View>
  );
}

/** A local-arrival alert. It deliberately does not claim a server unread count. */
export function NewMessagesJump({
  kind = "messages",
  onPress,
}: {
  kind?: UnreadContentKind;
  onPress: () => void;
}) {
  const colors = useColors();
  const label = labelFor(kind);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Jump to ${label.toLowerCase()}`}
      accessibilityHint="Shows messages that arrived while you were reading earlier messages"
      onPress={onPress}
      style={{
        alignSelf: "center",
        paddingHorizontal: 18,
        paddingVertical: 10,
        minHeight: 44,
        borderRadius: 22,
        backgroundColor: colors.error,
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>{label} ↓</Text>
    </Pressable>
  );
}
