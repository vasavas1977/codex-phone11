import { Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { PresenceIndicator } from "@/components/chat/presence-indicator";
import { useColors } from "@/hooks/use-colors";
import type { ChatPresenceStatus } from "@/lib/chat/types";
import { useThemeContext } from "@/lib/theme-provider";

const fixtures: { name: string; extension: string; status: ChatPresenceStatus | null }[] = [
  { name: "Nicha S.", extension: "1020", status: "available" },
  { name: "Arun K.", extension: "3001", status: "away" },
  { name: "May P.", extension: "1042", status: "on_call" },
  { name: "Krit T.", extension: "1088", status: "in_meeting" },
  { name: "Pim C.", extension: "1055", status: "offline" },
  { name: "Somchai R.", extension: "1061", status: null },
];

/** Visual fixture only. Production screens read authenticated server leases. */
export default function PresencePreview() {
  const colors = useColors();
  const { colorScheme, setColorScheme } = useThemeContext();
  if (!__DEV__) return <Redirect href="/(tabs)/teamchat" />;
  return <ScreenContainer>
    <View style={styles.content}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Team presence</Text>
      <Text style={[styles.subtitle, { color: colors.muted }]}>Status shows account activity only. Call and meeting details stay private.</Text>
      <View style={styles.themes}>{(["light", "dark"] as const).map(scheme => <Pressable key={scheme} accessibilityRole="button" accessibilityState={{ selected: colorScheme === scheme }} onPress={() => setColorScheme(scheme)} style={[styles.themeButton, { borderColor: colors.border, backgroundColor: colorScheme === scheme ? colors.primary : colors.surface }]}><Text style={{ color: colorScheme === scheme ? "white" : colors.foreground }}>{scheme === "light" ? "Light" : "Dark"}</Text></Pressable>)}</View>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {fixtures.map((person, index) => <View key={person.extension} style={[styles.person, index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
          <View style={[styles.avatar, { backgroundColor: colors.primary + "18" }]}><Text style={[styles.initials, { color: colors.primary }]}>{person.name.split(" ").map(part => part[0]).join("")}</Text></View>
          <View style={styles.identity}><Text style={[styles.name, { color: colors.foreground }]}>{person.name}</Text><Text style={[styles.extension, { color: colors.muted }]}>Ext. {person.extension}</Text><PresenceIndicator status={person.status} /></View>
        </View>)}
      </View>
    </View>
  </ScreenContainer>;
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 720, alignSelf: "center", padding: 20, gap: 14 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
  subtitle: { fontSize: 15, lineHeight: 21, maxWidth: 540 },
  themes: { flexDirection: "row", gap: 8 },
  themeButton: { minHeight: 40, minWidth: 72, borderWidth: 1, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: "hidden" },
  person: { minHeight: 76, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  initials: { fontSize: 16, fontWeight: "700" },
  identity: { flex: 1, gap: 2 },
  name: { fontSize: 17, lineHeight: 21, fontWeight: "600" },
  extension: { fontSize: 13, lineHeight: 16 },
});
