import { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Switch } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface Invoice {
  id: string;
  date: string;
  amount: string;
  status: "paid" | "due" | "overdue";
  period: string;
}

const INVOICES: Invoice[] = [
  { id: "INV-2026-04", date: "Apr 1, 2026", amount: "$124.50", status: "due", period: "April 2026" },
  { id: "INV-2026-03", date: "Mar 1, 2026", amount: "$118.75", status: "paid", period: "March 2026" },
  { id: "INV-2026-02", date: "Feb 1, 2026", amount: "$132.00", status: "paid", period: "February 2026" },
  { id: "INV-2026-01", date: "Jan 1, 2026", amount: "$98.50", status: "paid", period: "January 2026" },
  { id: "INV-2025-12", date: "Dec 1, 2025", amount: "$145.25", status: "paid", period: "December 2025" },
];

const CHARGES = [
  { label: "Business Pro Plan", amount: "$49.99" },
  { label: "5 DID Numbers", amount: "$25.00" },
  { label: "Voice Usage (847 min)", amount: "$33.88" },
  { label: "SMS Messages (142)", amount: "$7.10" },
  { label: "Toll-Free Inbound (23 min)", amount: "$4.60" },
  { label: "Taxes & Fees", amount: "$3.93" },
];

const PAYMENT_METHODS = [
  { id: "1", type: "Visa", last4: "4242", expiry: "12/27", default: true },
  { id: "2", type: "Mastercard", last4: "8888", expiry: "06/28", default: false },
];

export default function BillingScreen() {
  const colors = useColors();
  const [autoPay, setAutoPay] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);

  const statusColors: Record<string, string> = {
    paid: colors.success,
    due: colors.warning,
    overdue: colors.error,
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Billing & Invoices</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Balance Card */}
        <View style={[styles.balanceCard, { backgroundColor: colors.primary }]}>
          <Text style={styles.balanceLabel}>Current Balance Due</Text>
          <Text style={styles.balanceAmount}>$124.50</Text>
          <Text style={styles.balanceDue}>Due by May 1, 2026</Text>
          <TouchableOpacity
            style={styles.payBtn}
            onPress={() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)}
          >
            <IconSymbol name="creditcard.fill" size={18} color={colors.primary} />
            <Text style={[styles.payBtnText, { color: colors.primary }]}>Pay Now</Text>
          </TouchableOpacity>
        </View>

        {/* Current Charges Breakdown */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Current Period Charges</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {CHARGES.map((charge, i) => (
            <View key={i} style={[styles.chargeRow, i < CHARGES.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.border }]}>
              <Text style={[styles.chargeLabel, { color: colors.foreground }]}>{charge.label}</Text>
              <Text style={[styles.chargeAmount, { color: colors.foreground }]}>{charge.amount}</Text>
            </View>
          ))}
          <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.totalLabel, { color: colors.foreground }]}>Total</Text>
            <Text style={[styles.totalAmount, { color: colors.primary }]}>$124.50</Text>
          </View>
        </View>

        {/* Payment Methods */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Payment Methods</Text>
        {PAYMENT_METHODS.map((pm) => (
          <View key={pm.id} style={[styles.paymentCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.cardIcon, { backgroundColor: colors.primary + "15" }]}>
              <IconSymbol name="creditcard.fill" size={20} color={colors.primary} />
            </View>
            <View style={styles.paymentInfo}>
              <Text style={[styles.paymentType, { color: colors.foreground }]}>{pm.type} ····{pm.last4}</Text>
              <Text style={[styles.paymentExpiry, { color: colors.muted }]}>Expires {pm.expiry}</Text>
            </View>
            {pm.default && (
              <View style={[styles.defaultBadge, { backgroundColor: colors.success + "20" }]}>
                <Text style={[styles.defaultText, { color: colors.success }]}>Default</Text>
              </View>
            )}
          </View>
        ))}
        <TouchableOpacity style={[styles.addPaymentBtn, { borderColor: colors.primary }]}>
          <IconSymbol name="plus" size={16} color={colors.primary} />
          <Text style={[styles.addPaymentText, { color: colors.primary }]}>Add Payment Method</Text>
        </TouchableOpacity>

        {/* Auto-Pay */}
        <View style={[styles.autoPayRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.autoPayInfo}>
            <Text style={[styles.autoPayTitle, { color: colors.foreground }]}>Auto-Pay</Text>
            <Text style={[styles.autoPaySub, { color: colors.muted }]}>Automatically pay invoices on due date</Text>
          </View>
          <Switch
            value={autoPay}
            onValueChange={(v) => {
              setAutoPay(v);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            trackColor={{ false: colors.border, true: colors.primary }}
          />
        </View>

        {/* Invoice History */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Invoice History</Text>
        {INVOICES.map((inv) => (
          <TouchableOpacity
            key={inv.id}
            style={[styles.invoiceRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setSelectedInvoice(selectedInvoice === inv.id ? null : inv.id);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.invoiceMain}>
              <View>
                <Text style={[styles.invoiceId, { color: colors.foreground }]}>{inv.id}</Text>
                <Text style={[styles.invoicePeriod, { color: colors.muted }]}>{inv.period}</Text>
              </View>
              <View style={styles.invoiceRight}>
                <Text style={[styles.invoiceAmount, { color: colors.foreground }]}>{inv.amount}</Text>
                <View style={[styles.statusBadge, { backgroundColor: statusColors[inv.status] + "20" }]}>
                  <Text style={[styles.statusText, { color: statusColors[inv.status] }]}>
                    {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                  </Text>
                </View>
              </View>
            </View>
            {selectedInvoice === inv.id && (
              <View style={[styles.invoiceActions, { borderTopColor: colors.border }]}>
                <TouchableOpacity style={[styles.invoiceActionBtn, { backgroundColor: colors.primary + "15" }]}>
                  <IconSymbol name="eye.fill" size={14} color={colors.primary} />
                  <Text style={[styles.invoiceActionText, { color: colors.primary }]}>View</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.invoiceActionBtn, { backgroundColor: colors.primary + "15" }]}>
                  <IconSymbol name="arrow.down.circle.fill" size={14} color={colors.primary} />
                  <Text style={[styles.invoiceActionText, { color: colors.primary }]}>Download PDF</Text>
                </TouchableOpacity>
                {inv.status !== "paid" && (
                  <TouchableOpacity style={[styles.invoiceActionBtn, { backgroundColor: colors.success + "15" }]}>
                    <IconSymbol name="creditcard.fill" size={14} color={colors.success} />
                    <Text style={[styles.invoiceActionText, { color: colors.success }]}>Pay</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </TouchableOpacity>
        ))}

        <View style={{ height: 40 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  content: { paddingBottom: 20 },
  balanceCard: { margin: 16, borderRadius: 16, padding: 24, alignItems: "center" },
  balanceLabel: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontWeight: "600" },
  balanceAmount: { fontSize: 40, fontWeight: "800", color: "#fff", marginTop: 4 },
  balanceDue: { fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 4 },
  payBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, marginTop: 16 },
  payBtnText: { fontSize: 15, fontWeight: "700" },
  sectionTitle: { fontSize: 16, fontWeight: "700", paddingHorizontal: 16, marginTop: 20, marginBottom: 12 },
  card: { marginHorizontal: 16, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  chargeRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  chargeLabel: { fontSize: 14 },
  chargeAmount: { fontSize: 14, fontWeight: "600" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1 },
  totalLabel: { fontSize: 15, fontWeight: "700" },
  totalAmount: { fontSize: 18, fontWeight: "800" },
  paymentCard: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 12, borderWidth: 1, gap: 12 },
  cardIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  paymentInfo: { flex: 1 },
  paymentType: { fontSize: 14, fontWeight: "600" },
  paymentExpiry: { fontSize: 12, marginTop: 2 },
  defaultBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  defaultText: { fontSize: 10, fontWeight: "700" },
  addPaymentBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 16, marginTop: 4, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderStyle: "dashed" },
  addPaymentText: { fontSize: 14, fontWeight: "600" },
  autoPayRow: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginTop: 16, padding: 16, borderRadius: 12, borderWidth: 1 },
  autoPayInfo: { flex: 1 },
  autoPayTitle: { fontSize: 14, fontWeight: "600" },
  autoPaySub: { fontSize: 12, marginTop: 2 },
  invoiceRow: { marginHorizontal: 16, marginBottom: 8, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  invoiceMain: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14 },
  invoiceId: { fontSize: 14, fontWeight: "600" },
  invoicePeriod: { fontSize: 12, marginTop: 2 },
  invoiceRight: { alignItems: "flex-end" },
  invoiceAmount: { fontSize: 15, fontWeight: "700" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, marginTop: 4 },
  statusText: { fontSize: 10, fontWeight: "700" },
  invoiceActions: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 0.5 },
  invoiceActionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  invoiceActionText: { fontSize: 12, fontWeight: "600" },
});
