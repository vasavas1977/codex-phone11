import { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface Ticket {
  id: string;
  subject: string;
  status: "open" | "in-progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
  created: string;
  lastUpdate: string;
  category: string;
}

const TICKETS: Ticket[] = [
  { id: "TKT-1247", subject: "Call quality issues on international calls", status: "in-progress", priority: "high", created: "Apr 24, 2026", lastUpdate: "Apr 25, 2026", category: "Voice Quality" },
  { id: "TKT-1243", subject: "DID number not receiving inbound calls", status: "open", priority: "urgent", created: "Apr 23, 2026", lastUpdate: "Apr 23, 2026", category: "DID / Numbers" },
  { id: "TKT-1238", subject: "Invoice discrepancy for March billing", status: "resolved", priority: "medium", created: "Apr 15, 2026", lastUpdate: "Apr 20, 2026", category: "Billing" },
  { id: "TKT-1225", subject: "Request for additional SIP trunk capacity", status: "closed", priority: "low", created: "Apr 5, 2026", lastUpdate: "Apr 8, 2026", category: "Provisioning" },
];

const FAQ = [
  { q: "How do I set up call forwarding?", a: "Go to My Account → Call Forwarding. You can set rules for busy, no-answer, unreachable, and time-based forwarding." },
  { q: "How do I purchase a new DID number?", a: "Go to My Account → My Numbers → Browse Available. Select a number and tap Add to activate it on your account." },
  { q: "How do I change my voicemail greeting?", a: "Go to My Account → Voicemail → Greetings tab. You can record a new greeting or upload an audio file." },
  { q: "How do I view my call history?", a: "Open the Recents tab in the main app to see all inbound, outbound, and missed calls with timestamps." },
  { q: "How do I update my payment method?", a: "Go to My Account → Billing & Invoices → Payment Methods. You can add, remove, or set a default payment method." },
  { q: "How do I enable two-factor authentication?", a: "Go to My Account → My Profile → Security section. Tap the Two-Factor Authentication toggle to enable it." },
];

const CATEGORIES = ["All", "Voice Quality", "DID / Numbers", "Billing", "Provisioning", "General"];

export default function SupportScreen() {
  const colors = useColors();
  const [tab, setTab] = useState<"tickets" | "new" | "faq">("tickets");
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [newTicket, setNewTicket] = useState({ subject: "", category: "General", priority: "medium" as string, description: "" });

  const statusColors: Record<string, string> = {
    open: colors.warning,
    "in-progress": colors.primary,
    resolved: colors.success,
    closed: colors.muted,
  };

  const priorityColors: Record<string, string> = {
    low: colors.muted,
    medium: colors.warning,
    high: "#FF6B00",
    urgent: colors.error,
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Support</Text>
        <View style={{ width: 34 }} />
      </View>

      {/* Tab Switcher */}
      <View style={[styles.tabRow, { backgroundColor: colors.surface }]}>
        {(["tickets", "new", "faq"] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && { backgroundColor: colors.primary }]}
            onPress={() => { setTab(t); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          >
            <Text style={[styles.tabText, { color: tab === t ? "#fff" : colors.muted }]}>
              {t === "tickets" ? "My Tickets" : t === "new" ? "New Ticket" : "FAQ"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {tab === "tickets" && (
          <>
            {TICKETS.map((ticket) => (
              <View key={ticket.id} style={[styles.ticketCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.ticketHeader}>
                  <Text style={[styles.ticketId, { color: colors.primary }]}>{ticket.id}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: statusColors[ticket.status] + "20" }]}>
                    <Text style={[styles.statusText, { color: statusColors[ticket.status] }]}>
                      {ticket.status === "in-progress" ? "In Progress" : ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.ticketSubject, { color: colors.foreground }]}>{ticket.subject}</Text>
                <View style={styles.ticketMeta}>
                  <View style={[styles.priorityBadge, { backgroundColor: priorityColors[ticket.priority] + "15" }]}>
                    <Text style={[styles.priorityText, { color: priorityColors[ticket.priority] }]}>
                      {ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
                    </Text>
                  </View>
                  <Text style={[styles.ticketCategory, { color: colors.muted }]}>{ticket.category}</Text>
                </View>
                <View style={[styles.ticketDates, { borderTopColor: colors.border }]}>
                  <Text style={[styles.ticketDate, { color: colors.muted }]}>Created: {ticket.created}</Text>
                  <Text style={[styles.ticketDate, { color: colors.muted }]}>Updated: {ticket.lastUpdate}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {tab === "new" && (
          <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.formLabel, { color: colors.muted }]}>Subject</Text>
            <TextInput
              style={[styles.formInput, { color: colors.foreground, borderColor: colors.border }]}
              value={newTicket.subject}
              onChangeText={(v) => setNewTicket({ ...newTicket, subject: v })}
              placeholder="Brief description of the issue"
              placeholderTextColor={colors.muted}
            />

            <Text style={[styles.formLabel, { color: colors.muted }]}>Category</Text>
            <View style={styles.categoryGrid}>
              {CATEGORIES.filter(c => c !== "All").map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.categoryChip, {
                    backgroundColor: newTicket.category === cat ? colors.primary : colors.background,
                    borderColor: newTicket.category === cat ? colors.primary : colors.border,
                  }]}
                  onPress={() => setNewTicket({ ...newTicket, category: cat })}
                >
                  <Text style={[styles.categoryChipText, { color: newTicket.category === cat ? "#fff" : colors.foreground }]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.formLabel, { color: colors.muted }]}>Priority</Text>
            <View style={styles.priorityGrid}>
              {["low", "medium", "high", "urgent"].map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.priorityChip, {
                    backgroundColor: newTicket.priority === p ? priorityColors[p] + "20" : colors.background,
                    borderColor: newTicket.priority === p ? priorityColors[p] : colors.border,
                  }]}
                  onPress={() => setNewTicket({ ...newTicket, priority: p })}
                >
                  <Text style={[styles.priorityChipText, { color: newTicket.priority === p ? priorityColors[p] : colors.foreground }]}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.formLabel, { color: colors.muted }]}>Description</Text>
            <TextInput
              style={[styles.formTextArea, { color: colors.foreground, borderColor: colors.border }]}
              value={newTicket.description}
              onChangeText={(v) => setNewTicket({ ...newTicket, description: v })}
              placeholder="Describe your issue in detail..."
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />

            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                setNewTicket({ subject: "", category: "General", priority: "medium", description: "" });
                setTab("tickets");
              }}
            >
              <Text style={styles.submitBtnText}>Submit Ticket</Text>
            </TouchableOpacity>
          </View>
        )}

        {tab === "faq" && (
          <>
            {FAQ.map((item, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.faqCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setExpandedFaq(expandedFaq === i ? null : i);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.faqHeader}>
                  <Text style={[styles.faqQuestion, { color: colors.foreground }]}>{item.q}</Text>
                  <IconSymbol name={expandedFaq === i ? "chevron.right" : "chevron.right"} size={14} color={colors.muted} />
                </View>
                {expandedFaq === i && (
                  <Text style={[styles.faqAnswer, { color: colors.muted, borderTopColor: colors.border }]}>{item.a}</Text>
                )}
              </TouchableOpacity>
            ))}

            {/* Contact Info */}
            <View style={[styles.contactCard, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
              <Text style={[styles.contactTitle, { color: colors.foreground }]}>Need more help?</Text>
              <View style={styles.contactRow}>
                <IconSymbol name="phone.fill" size={16} color={colors.primary} />
                <Text style={[styles.contactText, { color: colors.foreground }]}>+1 (800) 555-HELP</Text>
              </View>
              <View style={styles.contactRow}>
                <IconSymbol name="paperplane.fill" size={16} color={colors.primary} />
                <Text style={[styles.contactText, { color: colors.foreground }]}>support@cloudphone11.com</Text>
              </View>
              <Text style={[styles.contactHours, { color: colors.muted }]}>Available Mon-Fri 8AM-8PM EST</Text>
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  tabRow: { flexDirection: "row", margin: 16, borderRadius: 10, padding: 3, gap: 3 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  tabText: { fontSize: 12, fontWeight: "600" },
  content: { paddingBottom: 20 },
  ticketCard: { marginHorizontal: 16, marginBottom: 8, borderRadius: 12, borderWidth: 1, padding: 14 },
  ticketHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  ticketId: { fontSize: 12, fontWeight: "700" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: "700" },
  ticketSubject: { fontSize: 14, fontWeight: "600", marginBottom: 8 },
  ticketMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  priorityText: { fontSize: 10, fontWeight: "700" },
  ticketCategory: { fontSize: 12 },
  ticketDates: { flexDirection: "row", justifyContent: "space-between", paddingTop: 10, borderTopWidth: 0.5 },
  ticketDate: { fontSize: 11 },
  formCard: { marginHorizontal: 16, borderRadius: 12, borderWidth: 1, padding: 16 },
  formLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.3, marginTop: 12, marginBottom: 6 },
  formInput: { fontSize: 14, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  categoryChipText: { fontSize: 12, fontWeight: "600" },
  priorityGrid: { flexDirection: "row", gap: 8 },
  priorityChip: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignItems: "center" },
  priorityChipText: { fontSize: 12, fontWeight: "600" },
  formTextArea: { fontSize: 14, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, minHeight: 120 },
  submitBtn: { marginTop: 16, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  submitBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  faqCard: { marginHorizontal: 16, marginBottom: 8, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  faqHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14 },
  faqQuestion: { fontSize: 14, fontWeight: "600", flex: 1, paddingRight: 8 },
  faqAnswer: { fontSize: 13, lineHeight: 20, padding: 14, paddingTop: 0, borderTopWidth: 0.5, marginTop: 0 },
  contactCard: { marginHorizontal: 16, marginTop: 16, padding: 16, borderRadius: 12, borderWidth: 1 },
  contactTitle: { fontSize: 15, fontWeight: "700", marginBottom: 12 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  contactText: { fontSize: 14 },
  contactHours: { fontSize: 12, marginTop: 4 },
});
