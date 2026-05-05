import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

// ─── Types ────────────────────────────────────────────────────────────────────

type InvoiceStatus = "paid" | "pending" | "overdue";
type ServiceType = "voip" | "did" | "sms" | "mvno" | "pbx";

interface Invoice {
  id: string;
  invoiceNo: string;
  period: string;
  amount: number;
  status: InvoiceStatus;
  dueDate: string;
  paidDate?: string;
}

interface UsageLine {
  service: ServiceType;
  label: string;
  usage: string;
  amount: number;
  icon: string;
}

interface Plan {
  id: string;
  name: string;
  price: number;
  period: string;
  features: string[];
  current: boolean;
  highlight?: boolean;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const BALANCE = 47.32;
const CREDIT_LIMIT = 200.00;

const CURRENT_USAGE: UsageLine[] = [
  { service: "voip", label: "VoIP Voice (SIP Trunk)", usage: "1,842 min", amount: 22.10, icon: "📞" },
  { service: "did", label: "DID Numbers (3 active)", usage: "Monthly rental", amount: 23.48, icon: "🔢" },
  { service: "sms", label: "SMS Messages", usage: "347 messages", amount: 2.89, icon: "💬" },
  { service: "mvno", label: "MVNO SIM (2 SIMs)", usage: "Voice + Data bundle", amount: 39.98, icon: "📱" },
  { service: "pbx", label: "Hosted PBX / IVR", usage: "5 seats", amount: 49.95, icon: "🏢" },
];

const INVOICES: Invoice[] = [
  { id: "1", invoiceNo: "INV-2026-0412", period: "April 2026", amount: 138.40, status: "pending", dueDate: "May 5, 2026" },
  { id: "2", invoiceNo: "INV-2026-0311", period: "March 2026", amount: 124.75, status: "paid", dueDate: "Apr 5, 2026", paidDate: "Apr 3, 2026" },
  { id: "3", invoiceNo: "INV-2026-0210", period: "February 2026", amount: 118.20, status: "paid", dueDate: "Mar 5, 2026", paidDate: "Mar 2, 2026" },
  { id: "4", invoiceNo: "INV-2026-0109", period: "January 2026", amount: 131.60, status: "paid", dueDate: "Feb 5, 2026", paidDate: "Feb 4, 2026" },
];

const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 9.99,
    period: "/ user / month",
    features: ["500 VoIP minutes", "1 DID number", "100 SMS", "Basic IVR"],
    current: false,
  },
  {
    id: "business",
    name: "Business",
    price: 24.99,
    period: "/ user / month",
    features: ["Unlimited VoIP minutes", "3 DID numbers", "500 SMS", "Full IVR builder", "Call recording", "Video calling"],
    current: true,
    highlight: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 49.99,
    period: "/ user / month",
    features: ["Unlimited everything", "10 DID numbers", "Unlimited SMS", "MVNO SIM included", "Priority support", "Custom integrations"],
    current: false,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function invoiceStatusColor(status: InvoiceStatus, colors: ReturnType<typeof useColors>) {
  switch (status) {
    case "paid": return colors.success;
    case "pending": return colors.warning;
    case "overdue": return colors.error;
  }
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function BillingScreen() {
  const colors = useColors();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"overview" | "invoices" | "plans">("overview");

  const totalThisMonth = CURRENT_USAGE.reduce((s, u) => s + u.amount, 0);

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12 }}>
          <IconSymbol name="chevron.left" size={24} color={colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>Billing & Usage</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>Powered by BillRun Open Source BSS</Text>
        </View>
      </View>

      {/* Tab Bar */}
      <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingTop: 12, gap: 6 }}>
        {(["overview", "invoices", "plans"] as const).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setActiveTab(t)}
            style={{
              flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center",
              backgroundColor: activeTab === t ? colors.primary : colors.surface,
              borderWidth: 1, borderColor: activeTab === t ? colors.primary : colors.border,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: activeTab === t ? "#fff" : colors.muted, textTransform: "capitalize" }}>
              {t}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === "overview" && (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {/* Balance Card */}
          <View style={{ backgroundColor: colors.primary, borderRadius: 20, padding: 20, marginBottom: 16 }}>
            <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: "600" }}>Account Balance</Text>
            <Text style={{ color: "#fff", fontSize: 36, fontWeight: "800", marginTop: 4 }}>${BALANCE.toFixed(2)}</Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 16 }}>
              <View>
                <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}>Credit Limit</Text>
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>${CREDIT_LIMIT.toFixed(2)}</Text>
              </View>
              <View>
                <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}>This Month</Text>
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>${totalThisMonth.toFixed(2)}</Text>
              </View>
              <TouchableOpacity
                onPress={() => Alert.alert("Top Up", "Redirect to BillRun payment portal to top up your prepaid balance.")}
                style={{ backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 }}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Top Up</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Current Month Usage */}
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Current Month Usage</Text>
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden", marginBottom: 16 }}>
            {CURRENT_USAGE.map((line, idx) => (
              <View
                key={line.service}
                style={{
                  flexDirection: "row", alignItems: "center", padding: 14,
                  borderBottomWidth: idx < CURRENT_USAGE.length - 1 ? 1 : 0,
                  borderBottomColor: colors.border,
                }}
              >
                <Text style={{ fontSize: 22, marginRight: 12 }}>{line.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{line.label}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted }}>{line.usage}</Text>
                </View>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>${line.amount.toFixed(2)}</Text>
              </View>
            ))}
            <View style={{ flexDirection: "row", justifyContent: "space-between", padding: 14, backgroundColor: colors.primary + "10" }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>Total Estimated</Text>
              <Text style={{ fontSize: 15, fontWeight: "800", color: colors.primary }}>${totalThisMonth.toFixed(2)}</Text>
            </View>
          </View>

          {/* Quick Actions */}
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Quick Actions</Text>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
            {[
              { icon: "number" as const, label: "Manage DIDs", onPress: () => router.push("/did") },
              { icon: "doc.text.fill" as const, label: "View Invoices", onPress: () => setActiveTab("invoices") },
              { icon: "chart.bar.fill" as const, label: "Usage Report", onPress: () => Alert.alert("Usage Report", "Full CDR report available in BillRun portal.") },
              { icon: "creditcard.fill" as const, label: "Payment", onPress: () => Alert.alert("Payment", "Manage payment methods in BillRun self-care portal.") },
            ].map((action) => (
              <TouchableOpacity
                key={action.label}
                onPress={action.onPress}
                style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 12, alignItems: "center", borderWidth: 1, borderColor: colors.border }}
              >
                <IconSymbol name={action.icon} size={22} color={colors.primary} />
                <Text style={{ fontSize: 11, color: colors.foreground, fontWeight: "600", marginTop: 6, textAlign: "center" }}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* BillRun Info Banner */}
          <View style={{ backgroundColor: colors.success + "15", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.success + "30" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <IconSymbol name="checkmark.seal.fill" size={18} color={colors.success} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.success }}>BillRun Open Source BSS</Text>
            </View>
            <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 18 }}>
              All billing is processed by BillRun — the same platform used by Golan Telecom (publicly traded). 
              Zero licensing cost · 100% IP ownership · Investor-grade revenue assurance.
            </Text>
          </View>
        </ScrollView>
      )}

      {activeTab === "invoices" && (
        <FlatList
          data={INVOICES}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border }}
              onPress={() => Alert.alert(item.invoiceNo, `Period: ${item.period}\nAmount: $${item.amount.toFixed(2)}\nStatus: ${item.status.toUpperCase()}\nDue: ${item.dueDate}${item.paidDate ? `\nPaid: ${item.paidDate}` : ""}`)}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{item.invoiceNo}</Text>
                  <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>{item.period}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>${item.amount.toFixed(2)}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: invoiceStatusColor(item.status, colors) }} />
                    <Text style={{ fontSize: 12, fontWeight: "600", color: invoiceStatusColor(item.status, colors), textTransform: "capitalize" }}>{item.status}</Text>
                  </View>
                </View>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>Due: {item.dueDate}</Text>
                {item.paidDate && <Text style={{ fontSize: 12, color: colors.success }}>Paid: {item.paidDate}</Text>}
                {item.status === "pending" && (
                  <TouchableOpacity
                    onPress={() => Alert.alert("Pay Now", "Redirecting to BillRun payment portal...")}
                    style={{ backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 8 }}
                  >
                    <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Pay Now</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {activeTab === "plans" && (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Text style={{ fontSize: 14, color: colors.muted, marginBottom: 16, lineHeight: 20 }}>
            All plans include HD voice calling, video, messaging, and IVR. Billing managed by BillRun BSS.
          </Text>
          {PLANS.map((plan) => (
            <View
              key={plan.id}
              style={{
                backgroundColor: plan.highlight ? colors.primary : colors.surface,
                borderRadius: 20, padding: 20, marginBottom: 14,
                borderWidth: plan.current ? 2 : 1,
                borderColor: plan.current ? colors.primary : colors.border,
              }}
            >
              {plan.current && (
                <View style={{ backgroundColor: plan.highlight ? "rgba(255,255,255,0.25)" : colors.primary + "20", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, alignSelf: "flex-start", marginBottom: 10 }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: plan.highlight ? "#fff" : colors.primary }}>CURRENT PLAN</Text>
                </View>
              )}
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <Text style={{ fontSize: 20, fontWeight: "800", color: plan.highlight ? "#fff" : colors.foreground }}>{plan.name}</Text>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 24, fontWeight: "800", color: plan.highlight ? "#fff" : colors.foreground }}>${plan.price}</Text>
                  <Text style={{ fontSize: 11, color: plan.highlight ? "rgba(255,255,255,0.7)" : colors.muted }}>{plan.period}</Text>
                </View>
              </View>
              {plan.features.map((f) => (
                <View key={f} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <IconSymbol name="checkmark" size={14} color={plan.highlight ? "#fff" : colors.success} />
                  <Text style={{ fontSize: 13, color: plan.highlight ? "rgba(255,255,255,0.9)" : colors.foreground }}>{f}</Text>
                </View>
              ))}
              {!plan.current && (
                <TouchableOpacity
                  onPress={() => Alert.alert("Upgrade Plan", `Switch to ${plan.name} plan at $${plan.price}/user/month?\n\nBilling will be updated in BillRun BSS immediately.`, [{ text: "Cancel", style: "cancel" }, { text: "Upgrade", onPress: () => {} }])}
                  style={{ backgroundColor: plan.highlight ? "rgba(255,255,255,0.2)" : colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: "center", marginTop: 14 }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Switch to {plan.name}</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}
