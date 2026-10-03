import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useVideoCapability } from "@/hooks/use-video-capability";

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
    detail: "Not available in this preview. Requires native incoming-call setup.",
  },
  {
    title: "Team Chat video meetings",
    detail: "Use Meet when meetings are enabled for your workspace and conversation.",
  },
  {
    title: "Call transfers",
    detail: "Not available in this preview.",
  },
  {
    title: "PBX conference calls",
    detail: "Not available in this preview.",
  },
  {
    title: "SMS",
    detail: "Not available in this preview.",
  },
  {
    title: "Workspace presence",
    detail: "Team Chat shows status when presence is enabled for your workspace.",
  },
] as const;

export default function AboutScreen() {
  const colors = useColors();
  const phoneVideo = useVideoCapability();
  const availability = [
    ...AVAILABILITY.slice(0, 3),
    {
      title: "Phone video calls",
      detail: phoneVideo === null
        ? "Checking this build’s video support…"
        : phoneVideo
          ? "This build supports phone video controls. Compatible callers and camera permission are required."
          : "Not available in this build.",
    },
    ...AVAILABILITY.slice(3),
  ];
  const version = Constants.expoConfig?.version?.trim();
  // Use the installed binary's native value, never the updateable Expo config.
  const nativeBuild = Platform.OS === "ios"
    ? Constants.platform?.ios?.buildNumber?.trim()
    : Platform.OS === "android"
      ? Constants.platform?.android?.versionCode
      : undefined;
  const build = typeof nativeBuild === "string" && nativeBuild
    ? nativeBuild
    : typeof nativeBuild === "number" && Number.isInteger(nativeBuild) && nativeBuild > 0
      ? String(nativeBuild)
      : undefined;
  const versionLabel = `${version ? `Version ${version}` : "Version unavailable"}${build ? ` · Build ${build}` : ""}`;

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
          <Text style={styles.appVersion}>{versionLabel}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Phone11</Text>
          <Text style={[styles.body, { color: colors.muted }]}>Phone11 connects your assigned work number to your work account for voice calls and team conversations.</Text>
        </View>

        <Text style={[styles.sectionHeader, { color: colors.muted }]}>CURRENT AVAILABILITY</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {availability.map((item, index) => (
            <View key={item.title} style={[styles.availabilityRow, index < availability.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 0.5 }]}>
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
