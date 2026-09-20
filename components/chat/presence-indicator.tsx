import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { presenceColor, presenceLabel, useChatPresence } from "@/lib/chat/presence-store";
import type { ChatPresenceStatus } from "@/lib/chat/types";
import { IconSymbol } from "@/components/ui/icon-symbol";

export function PresenceIndicator({ tenantId, userId, compact = false, status }: { tenantId?: number; userId?: number; compact?: boolean; status?: ChatPresenceStatus | null }) {
  const colors = useColors();
  const presence = useChatPresence(tenantId, userId);
  const resolved = status === null ? undefined : status ?? presence?.effectiveStatus ?? presence?.status;
  const label = presenceLabel(resolved, status === undefined ? presence?.source : undefined);
  const icon = resolved === "on_call" ? "phone.fill" : resolved === "in_meeting" ? "video.fill"
    : resolved === "away" || resolved === "out_of_office" ? "moon.fill" : resolved === "offline" ? "circle"
      : resolved === "dnd" ? "minus.circle" : resolved === "busy" ? "circle.fill"
      : resolved === "available" ? "circle.fill" : "questionmark.circle.fill";
  return <View accessibilityLabel={label} style={styles.row}>
    <IconSymbol name={icon} size={resolved === "on_call" || resolved === "in_meeting" ? 12 : 10} color={presenceColor(resolved)} />
    {!compact && <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 5 },
  label: { fontSize: 12, lineHeight: 15 },
});
