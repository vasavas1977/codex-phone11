import { StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { useColors } from "@/hooks/use-colors";

const fixtures = [[], ["Nicha"], ["Nicha", "Arun"], ["Nicha", "Arun", "May"]];

/** Deterministic visual fixture only; it never publishes typing activity. */
export default function TypingPreview() {
  const colors = useColors();
  if (!__DEV__) return <Redirect href="/(tabs)/teamchat" />;
  return <ScreenContainer><View style={styles.content}>
    <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Typing indicator</Text>
    {fixtures.map((names, index) => <View key={index} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.caption, { color: colors.foreground }]}>{names.length ? `${names.length} teammate${names.length > 1 ? "s" : ""}` : "No one typing"}</Text>
      <TypingIndicator names={names} />
      <View style={styles.composer}><TextInput editable={false} placeholder="Message Launch team" placeholderTextColor={colors.muted} style={[styles.input, { color: colors.foreground, backgroundColor: colors.background }]} /><Text style={{ color: colors.primary, fontWeight: "700" }}>Send</Text></View>
    </View>)}
  </View></ScreenContainer>;
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 720, alignSelf: "center", padding: 20, gap: 14 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingTop: 12, overflow: "hidden" },
  caption: { fontSize: 14, fontWeight: "600", paddingHorizontal: 16, paddingBottom: 6 },
  composer: { minHeight: 54, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  input: { flex: 1, minHeight: 40, borderRadius: 18, paddingHorizontal: 14 },
});
