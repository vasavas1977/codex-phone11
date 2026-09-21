import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

type UnavailableAdminScreenProps = {
  title: string;
  description: string;
  checking?: boolean;
};

/**
 * An honest placeholder for an enterprise administration area whose live
 * data source is unavailable. This avoids presenting demo
 * records or simulated infrastructure data as an operational workspace.
 */
export function UnavailableAdminScreen({
  title,
  description,
  checking = false,
}: UnavailableAdminScreenProps) {
  const colors = useColors();

  return (
    <ScreenContainer>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          accessibilityLabel="Back to workspace administration"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      </View>

      <View style={styles.content}>
        <View style={[styles.icon, { backgroundColor: colors.primary + "14" }]}>
          <IconSymbol name="clock.fill" size={24} color={colors.primary} />
        </View>
        <Text style={[styles.heading, { color: colors.foreground }]}>
          {checking ? "Checking availability" : "Not available for this workspace"}
        </Text>
        <Text style={[styles.description, { color: colors.muted }]}>{description}</Text>
        {checking ? (
          <Text style={[styles.note, { color: colors.muted }]}>
            No administration actions are shown until Phone11 confirms the live workspace capability.
          </Text>
        ) : (
          <>
            <Text style={[styles.note, { color: colors.muted }]}>
              Phone11 will show information here only after it is connected to your workspace’s live service.
            </Text>
            <TouchableOpacity
              accessibilityLabel="Back to workspace administration"
              onPress={() => router.back()}
              style={[styles.action, { borderColor: colors.primary + "55" }]}
            >
              <Text style={[styles.actionText, { color: colors.primary }]}>Back to administration</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    borderBottomWidth: 0.5,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backButton: { padding: 4 },
  title: { flex: 1, fontSize: 20, fontWeight: "700" },
  content: { alignItems: "center", flex: 1, justifyContent: "center", paddingHorizontal: 32 },
  icon: { alignItems: "center", borderRadius: 24, height: 48, justifyContent: "center", marginBottom: 18, width: 48 },
  heading: { fontSize: 20, fontWeight: "700", textAlign: "center" },
  description: { fontSize: 15, lineHeight: 22, marginTop: 10, maxWidth: 360, textAlign: "center" },
  note: { fontSize: 13, lineHeight: 19, marginTop: 12, maxWidth: 360, textAlign: "center" },
  action: { borderRadius: 12, borderWidth: 1, marginTop: 24, paddingHorizontal: 16, paddingVertical: 11 },
  actionText: { fontSize: 14, fontWeight: "600" },
});
