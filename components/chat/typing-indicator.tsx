import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { typingText } from "@/lib/chat/typing-format";

export function TypingIndicator({ names }: { names: string[] }) {
  const colors = useColors();
  return <View style={styles.container} accessibilityLiveRegion="polite">
    <Text numberOfLines={1} style={[styles.label, { color: colors.muted }]}>{typingText(names)}</Text>
  </View>;
}

const styles = StyleSheet.create({
  container: { minHeight: 18, justifyContent: "center", paddingHorizontal: 50 },
  label: { fontSize: 12, lineHeight: 16 },
});
