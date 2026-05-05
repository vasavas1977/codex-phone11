import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

const CONTACTS_MAP: Record<string, { name: string; extension: string; phone: string; email: string; department: string; presence: string }> = {
  "1": { name: "Alice Johnson", extension: "1001", phone: "+1 (555) 100-1001", email: "alice@company.com", department: "Engineering", presence: "online" },
  "2": { name: "Bob Chen", extension: "1002", phone: "+1 (555) 100-1002", email: "bob@company.com", department: "Sales", presence: "busy" },
  "3": { name: "Carol Martinez", extension: "1003", phone: "+1 (555) 100-1003", email: "carol@company.com", department: "Support", presence: "away" },
  "4": { name: "David Kim", extension: "1004", phone: "+1 (555) 100-1004", email: "david@company.com", department: "Finance", presence: "offline" },
};

const PRESENCE_COLORS: Record<string, string> = {
  online: "#00C896", busy: "#FF3B30", away: "#FF9500", offline: "#6B7280",
};

export default function ContactDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const contact = CONTACTS_MAP[id] || { name: "Unknown", extension: "", phone: "", email: "", department: "", presence: "offline" };

  const ActionButton = ({ icon, label, color, onPress }: { icon: any; label: string; color: string; onPress: () => void }) => (
    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: color + "18", borderColor: color + "40" }]} onPress={onPress}>
      <IconSymbol name={icon} size={24} color={color} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Back */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
          <Text style={[styles.backText, { color: colors.primary }]}>Contacts</Text>
        </TouchableOpacity>

        {/* Profile */}
        <View style={styles.profile}>
          <View style={[styles.avatar, { backgroundColor: colors.primary + "20" }]}>
            <Text style={[styles.avatarText, { color: colors.primary }]}>{contact.name.charAt(0)}</Text>
          </View>
          <View style={styles.presenceRow}>
            <View style={[styles.presenceDot, { backgroundColor: PRESENCE_COLORS[contact.presence] }]} />
            <Text style={[styles.presenceText, { color: PRESENCE_COLORS[contact.presence] }]}>
              {contact.presence.charAt(0).toUpperCase() + contact.presence.slice(1)}
            </Text>
          </View>
          <Text style={[styles.name, { color: colors.foreground }]}>{contact.name}</Text>
          <Text style={[styles.department, { color: colors.muted }]}>{contact.department}</Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <ActionButton icon="phone.fill" label="Call" color={colors.success} onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push({ pathname: "/call/active", params: { number: contact.extension || contact.phone, type: "voice" } });
          }} />
          <ActionButton icon="video.fill" label="Video" color={colors.primary} onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push({ pathname: "/call/video", params: { number: contact.name } });
          }} />
          <ActionButton icon="message.fill" label="Message" color="#8B5CF6" onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push({ pathname: "/messages/[id]", params: { id, name: contact.name } });
          }} />
        </View>

        {/* Info */}
        <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {[
            { label: "Extension", value: contact.extension, icon: "phone.fill" },
            { label: "Mobile", value: contact.phone, icon: "phone.arrow.up.right" },
            { label: "Email", value: contact.email, icon: "paperplane.fill" },
            { label: "Department", value: contact.department, icon: "person.2.fill" },
          ].map(({ label, value, icon }) => (
            <View key={label} style={[styles.infoRow, { borderBottomColor: colors.border }]}>
              <IconSymbol name={icon as any} size={16} color={colors.primary} />
              <View style={styles.infoText}>
                <Text style={[styles.infoLabel, { color: colors.muted }]}>{label}</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>{value}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  backBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  backText: { fontSize: 16, fontWeight: "500" },
  profile: { alignItems: "center", paddingVertical: 24, gap: 8 },
  avatar: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 40, fontWeight: "700" },
  presenceRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  presenceDot: { width: 8, height: 8, borderRadius: 4 },
  presenceText: { fontSize: 13, fontWeight: "600" },
  name: { fontSize: 26, fontWeight: "700" },
  department: { fontSize: 15 },
  actionRow: { flexDirection: "row", justifyContent: "center", gap: 16, paddingHorizontal: 20, paddingBottom: 24 },
  actionBtn: { flex: 1, alignItems: "center", paddingVertical: 16, borderRadius: 16, borderWidth: 1, gap: 6 },
  actionLabel: { fontSize: 13, fontWeight: "600" },
  infoCard: { marginHorizontal: 16, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  infoRow: { flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 0.5, gap: 12 },
  infoText: { flex: 1 },
  infoLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.5 },
  infoValue: { fontSize: 15, marginTop: 2 },
});
