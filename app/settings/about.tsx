import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

const AVAILABILITY = [
  {
    title: "Voice calls",
    detail: "Call from your assigned work number while Phone11 is open.",
  },
  {
    title: "Incoming calls",
    detail: "Available in the current preview while Phone11 is open.",
  },
  {
    title: "Background and closed-app calls",
    detail: "Requires commissioned native incoming-call support and is unavailable in this preview.",
  },
  {
    title: "Video, transfers and conference calls",
    detail: "Not available yet.",
  },
  {
    title: "SMS and live presence",
    detail: "Not available yet.",
  },
] as const;

export default function AboutScreen() {
  const colors = useColors();

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Settings"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <IconSymbol name="chevron.left" size={20} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>Settings</Text>
          </Pressable>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>About Phone11</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={[styles.appCard, { backgroundColor: colors.primary }]}>
          <Text style={styles.appName}>Phone11</Text>
          <Text style={styles.appTagline}>Work calls and team conversations</Text>
          <Text style={styles.appVersion}>Version 1.0.0</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Phone11</Text>
          <Text style={[styles.body, { color: colors.muted }]}>Phone11 connects your assigned work number to your work account for voice calls and team conversations.</Text>
        </View>

        <Text style={[styles.sectionHeader, { color: colors.muted }]}>CURRENT AVAILABILITY</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {AVAILABILITY.map((item, index) => (
            <View key={item.title} style={[styles.availabilityRow, index < AVAILABILITY.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 0.5 }]}>
              <View style={[styles.dot, { backgroundColor: index < 2 ? colors.success : colors.warning }]} />
              <View style={styles.availabilityText}>
                <Text style={[styles.itemTitle, { color: colors.foreground }]}>{item.title}</Text>
                <Text style={[styles.itemDetail, { color: colors.muted }]}>{item.detail}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={[styles.footer, { color: colors.muted }]}>Phone11 · Work calls and team conversations</Text>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  backButton: { flexDirection: "row", alignItems: "center", gap: 4, width: 100, minHeight: 44 },
  backText: { fontSize: 16, fontWeight: "500" },
  title: { fontSize: 17, fontWeight: "700" },
  headerSpacer: { width: 100 },
  appCard: { margin: 16, padding: 20, borderRadius: 20, alignItems: "center", gap: 4 },
  appName: { fontSize: 24, fontWeight: "800", color: "#fff" },
  appTagline: { fontSize: 14, color: "#ffffff90" },
  appVersion: { fontSize: 12, color: "#ffffff70", marginTop: 4 },
  card: { marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 16, borderWidth: 1 },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  body: { fontSize: 13, lineHeight: 20, marginTop: 8 },
  sectionHeader: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  availabilityRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 12, gap: 12 },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 5 },
  availabilityText: { flex: 1 },
  itemTitle: { fontSize: 14, fontWeight: "700" },
  itemDetail: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  footer: { fontSize: 12, textAlign: "center", paddingVertical: 20 },
});
