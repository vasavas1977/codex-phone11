import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { requestChatNotificationEnrollment, useChatNotificationEnrollment } from "@/lib/notifications/enrollment-status";

export function NotificationEnrollmentPrompt({ ownerId, tenantId }: { ownerId?: number; tenantId?: number }) {
  const colors = useColors();
  const enrollment = useChatNotificationEnrollment();
  if (!ownerId || !tenantId || enrollment.ownerId !== ownerId || enrollment.tenantId !== tenantId || enrollment.status !== "permission-required") return null;
  return <View style={[styles.card, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
    <View style={styles.copy}>
      <Text style={[styles.title, { color: colors.foreground }]}>Get new message alerts</Text>
      <Text style={[styles.body, { color: colors.muted }]}>Enable Phone11 notifications so messages can reach this phone while it is locked or in standby.</Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Enable message notifications" onPress={() => void requestChatNotificationEnrollment()} style={[styles.button, { backgroundColor: colors.primary }]}>
      <Text style={styles.buttonText}>Enable</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginBottom: 6, borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1, gap: 3 }, title: { fontSize: 15, fontWeight: "700" }, body: { fontSize: 13, lineHeight: 18 },
  button: { minHeight: 40, justifyContent: "center", borderRadius: 10, paddingHorizontal: 14 }, buttonText: { color: "white", fontWeight: "700" },
});
