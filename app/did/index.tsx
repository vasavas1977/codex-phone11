import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

// ─── Types ───────────────────────────────────────────────────────────────────

type DIDType = "local" | "national" | "tollfree" | "international";
type DIDStatus = "active" | "pending" | "suspended";

interface DIDNumber {
  id: string;
  number: string;
  country: string;
  countryCode: string;
  type: DIDType;
  monthlyRate: number;
  perMinuteRate: number;
  status: DIDStatus;
  activatedDate: string;
  nextBillingDate: string;
  inboundMinutes: number;
}

interface AvailableDID {
  id: string;
  number: string;
  country: string;
  countryCode: string;
  city?: string;
  type: DIDType;
  monthlyRate: number;
  perMinuteRate: number;
  setupFee: number;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MY_DIDS: DIDNumber[] = [
  {
    id: "1",
    number: "+1 (415) 555-0192",
    country: "United States",
    countryCode: "🇺🇸",
    type: "local",
    monthlyRate: 3.99,
    perMinuteRate: 0.012,
    status: "active",
    activatedDate: "Mar 1, 2026",
    nextBillingDate: "May 1, 2026",
    inboundMinutes: 342,
  },
  {
    id: "2",
    number: "+44 20 7946 0958",
    country: "United Kingdom",
    countryCode: "🇬🇧",
    type: "local",
    monthlyRate: 4.50,
    perMinuteRate: 0.015,
    status: "active",
    activatedDate: "Feb 15, 2026",
    nextBillingDate: "May 15, 2026",
    inboundMinutes: 128,
  },
  {
    id: "3",
    number: "+1 (800) 555-0143",
    country: "United States",
    countryCode: "🇺🇸",
    type: "tollfree",
    monthlyRate: 14.99,
    perMinuteRate: 0.025,
    status: "active",
    activatedDate: "Jan 10, 2026",
    nextBillingDate: "May 10, 2026",
    inboundMinutes: 891,
  },
];

const AVAILABLE_DIDS: AvailableDID[] = [
  { id: "a1", number: "+1 (212) 555-0187", country: "United States", countryCode: "🇺🇸", city: "New York", type: "local", monthlyRate: 3.99, perMinuteRate: 0.012, setupFee: 0 },
  { id: "a2", number: "+1 (310) 555-0234", country: "United States", countryCode: "🇺🇸", city: "Los Angeles", type: "local", monthlyRate: 3.99, perMinuteRate: 0.012, setupFee: 0 },
  { id: "a3", number: "+49 30 12345678", country: "Germany", countryCode: "🇩🇪", city: "Berlin", type: "local", monthlyRate: 5.50, perMinuteRate: 0.018, setupFee: 2.00 },
  { id: "a4", number: "+61 2 9876 5432", country: "Australia", countryCode: "🇦🇺", city: "Sydney", type: "local", monthlyRate: 6.00, perMinuteRate: 0.020, setupFee: 0 },
  { id: "a5", number: "+65 6123 4567", country: "Singapore", countryCode: "🇸🇬", city: "Singapore", type: "national", monthlyRate: 7.50, perMinuteRate: 0.022, setupFee: 5.00 },
  { id: "a6", number: "+1 (888) 555-0199", country: "United States", countryCode: "🇺🇸", type: "tollfree", monthlyRate: 14.99, perMinuteRate: 0.025, setupFee: 0 },
  { id: "a7", number: "+44 800 123 4567", country: "United Kingdom", countryCode: "🇬🇧", type: "tollfree", monthlyRate: 18.00, perMinuteRate: 0.030, setupFee: 0 },
  { id: "a8", number: "+33 1 23 45 67 89", country: "France", countryCode: "🇫🇷", city: "Paris", type: "local", monthlyRate: 5.00, perMinuteRate: 0.016, setupFee: 1.00 },
];

const COUNTRIES = ["All", "United States", "United Kingdom", "Germany", "Australia", "Singapore", "France"];
const DID_TYPES: { key: DIDType | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "local", label: "Local" },
  { key: "national", label: "National" },
  { key: "tollfree", label: "Toll-Free" },
  { key: "international", label: "Intl" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function typeLabel(type: DIDType): string {
  switch (type) {
    case "local": return "Local";
    case "national": return "National";
    case "tollfree": return "Toll-Free";
    case "international": return "International";
  }
}

function typeBadgeColor(type: DIDType, colors: ReturnType<typeof useColors>) {
  switch (type) {
    case "local": return { bg: colors.primary + "20", text: colors.primary };
    case "national": return { bg: colors.success + "20", text: colors.success };
    case "tollfree": return { bg: colors.warning + "20", text: colors.warning };
    case "international": return { bg: "#8B5CF620", text: "#8B5CF6" };
  }
}

function statusColor(status: DIDStatus, colors: ReturnType<typeof useColors>) {
  switch (status) {
    case "active": return colors.success;
    case "pending": return colors.warning;
    case "suspended": return colors.error;
  }
}

// ─── My DID Card ──────────────────────────────────────────────────────────────

function MyDIDCard({ did, colors, onPress }: { did: DIDNumber; colors: ReturnType<typeof useColors>; onPress: () => void }) {
  const badge = typeBadgeColor(did.type, colors);
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Text style={{ fontSize: 18 }}>{did.countryCode}</Text>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{did.number}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ backgroundColor: badge.bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
              <Text style={{ fontSize: 11, fontWeight: "600", color: badge.text }}>{typeLabel(did.type)}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor(did.status, colors) }} />
              <Text style={{ fontSize: 12, color: colors.muted, textTransform: "capitalize" }}>{did.status}</Text>
            </View>
          </View>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.primary }}>${did.monthlyRate.toFixed(2)}</Text>
          <Text style={{ fontSize: 11, color: colors.muted }}>/ month</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, gap: 16 }}>
        <View>
          <Text style={{ fontSize: 11, color: colors.muted }}>Inbound this month</Text>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{did.inboundMinutes} min</Text>
        </View>
        <View>
          <Text style={{ fontSize: 11, color: colors.muted }}>Next billing</Text>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{did.nextBillingDate}</Text>
        </View>
        <View>
          <Text style={{ fontSize: 11, color: colors.muted }}>Country</Text>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{did.country}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Available DID Row ────────────────────────────────────────────────────────

function AvailableDIDRow({ did, colors, onOrder }: { did: AvailableDID; colors: ReturnType<typeof useColors>; onOrder: () => void }) {
  const badge = typeBadgeColor(did.type, colors);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ fontSize: 20, marginRight: 10 }}>{did.countryCode}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{did.number}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
          {did.city && <Text style={{ fontSize: 12, color: colors.muted }}>{did.city} · </Text>}
          <View style={{ backgroundColor: badge.bg, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
            <Text style={{ fontSize: 10, fontWeight: "600", color: badge.text }}>{typeLabel(did.type)}</Text>
          </View>
        </View>
      </View>
      <View style={{ alignItems: "flex-end", marginRight: 10 }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>${did.monthlyRate.toFixed(2)}/mo</Text>
        {did.setupFee > 0 && <Text style={{ fontSize: 11, color: colors.muted }}>+${did.setupFee.toFixed(2)} setup</Text>}
      </View>
      <TouchableOpacity
        onPress={onOrder}
        style={{ backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 }}
      >
        <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }}>Get</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DIDScreen() {
  const colors = useColors();
  const router = useRouter();
  const [tab, setTab] = useState<"my" | "browse">("my");
  const [search, setSearch] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("All");
  const [selectedType, setSelectedType] = useState<DIDType | "all">("all");
  const [detailDID, setDetailDID] = useState<DIDNumber | null>(null);

  const filteredAvailable = AVAILABLE_DIDS.filter((d) => {
    const matchCountry = selectedCountry === "All" || d.country === selectedCountry;
    const matchType = selectedType === "all" || d.type === selectedType;
    const matchSearch = d.number.includes(search) || d.country.toLowerCase().includes(search.toLowerCase());
    return matchCountry && matchType && matchSearch;
  });

  const handleOrder = (did: AvailableDID) => {
    Alert.alert(
      "Confirm Number Purchase",
      `Activate ${did.number}?\n\n${did.countryCode} ${did.country}${did.city ? ` · ${did.city}` : ""}\n\nMonthly: $${did.monthlyRate.toFixed(2)}/mo${did.setupFee > 0 ? `\nSetup fee: $${did.setupFee.toFixed(2)}` : ""}\nPer minute (inbound): $${did.perMinuteRate.toFixed(3)}\n\nBilling will be managed through BillRun BSS.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Activate",
          onPress: () => Alert.alert("Number Activated", `${did.number} is now active on your account. It will appear in My Numbers shortly.`),
        },
      ]
    );
  };

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12 }}>
          <IconSymbol name="chevron.left" size={24} color={colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>Phone Numbers</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>DID Management · Powered by BillRun</Text>
        </View>
        <TouchableOpacity onPress={() => setTab("browse")} style={{ backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }}>+ Get Number</Text>
        </TouchableOpacity>
      </View>

      {/* Tab Bar */}
      <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingTop: 12, gap: 8 }}>
        {(["my", "browse"] as const).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            style={{
              flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center",
              backgroundColor: tab === t ? colors.primary : colors.surface,
              borderWidth: 1, borderColor: tab === t ? colors.primary : colors.border,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "600", color: tab === t ? "#fff" : colors.muted }}>
              {t === "my" ? `My Numbers (${MY_DIDS.length})` : "Browse Numbers"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "my" ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          {/* Summary Card */}
          <View style={{ backgroundColor: colors.primary + "15", borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.primary + "30" }}>
            <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "600", marginBottom: 8 }}>Monthly DID Billing Summary</Text>
            <View style={{ flexDirection: "row", gap: 20 }}>
              <View>
                <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>
                  ${MY_DIDS.reduce((s, d) => s + d.monthlyRate, 0).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>Total monthly rental</Text>
              </View>
              <View>
                <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>
                  {MY_DIDS.reduce((s, d) => s + d.inboundMinutes, 0)}
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>Inbound minutes</Text>
              </View>
              <View>
                <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>{MY_DIDS.length}</Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>Active numbers</Text>
              </View>
            </View>
          </View>

          {MY_DIDS.map((did) => (
            <MyDIDCard key={did.id} did={did} colors={colors} onPress={() => setDetailDID(did)} />
          ))}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          {/* Search */}
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border }}>
              <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search by number or country..."
                placeholderTextColor={colors.muted}
                style={{ flex: 1, paddingVertical: 10, paddingLeft: 8, fontSize: 14, color: colors.foreground }}
              />
            </View>
          </View>

          {/* Type Filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
            {DID_TYPES.map((t) => (
              <TouchableOpacity
                key={t.key}
                onPress={() => setSelectedType(t.key)}
                style={{
                  paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                  backgroundColor: selectedType === t.key ? colors.primary : colors.surface,
                  borderWidth: 1, borderColor: selectedType === t.key ? colors.primary : colors.border,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "600", color: selectedType === t.key ? "#fff" : colors.muted }}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Country Filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 10, gap: 8 }}>
            {COUNTRIES.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => setSelectedCountry(c)}
                style={{
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
                  backgroundColor: selectedCountry === c ? colors.foreground : colors.surface,
                  borderWidth: 1, borderColor: selectedCountry === c ? colors.foreground : colors.border,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "500", color: selectedCountry === c ? colors.background : colors.muted }}>{c}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <FlatList
            data={filteredAvailable}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <AvailableDIDRow did={item} colors={colors} onOrder={() => handleOrder(item)} />
            )}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
            ListEmptyComponent={
              <View style={{ alignItems: "center", paddingTop: 40 }}>
                <IconSymbol name="magnifyingglass" size={40} color={colors.muted} />
                <Text style={{ color: colors.muted, marginTop: 12, fontSize: 15 }}>No numbers found</Text>
              </View>
            }
          />
        </View>
      )}

      {/* DID Detail Modal */}
      <Modal visible={!!detailDID} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetailDID(null)}>
        {detailDID && (
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={{ flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <TouchableOpacity onPress={() => setDetailDID(null)}>
                <IconSymbol name="xmark" size={22} color={colors.foreground} />
              </TouchableOpacity>
              <Text style={{ flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: colors.foreground }}>Number Details</Text>
              <View style={{ width: 22 }} />
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <View style={{ alignItems: "center", marginBottom: 24 }}>
                <Text style={{ fontSize: 32 }}>{detailDID.countryCode}</Text>
                <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground, marginTop: 8 }}>{detailDID.number}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor(detailDID.status, colors) }} />
                  <Text style={{ color: statusColor(detailDID.status, colors), fontWeight: "600", textTransform: "capitalize" }}>{detailDID.status}</Text>
                </View>
              </View>

              {[
                { label: "Country", value: detailDID.country },
                { label: "Number Type", value: typeLabel(detailDID.type) },
                { label: "Monthly Rental", value: `$${detailDID.monthlyRate.toFixed(2)} / month` },
                { label: "Inbound Rate", value: `$${detailDID.perMinuteRate.toFixed(3)} / minute` },
                { label: "Activated", value: detailDID.activatedDate },
                { label: "Next Billing", value: detailDID.nextBillingDate },
                { label: "Inbound Minutes (This Month)", value: `${detailDID.inboundMinutes} minutes` },
                { label: "Billing Platform", value: "BillRun BSS (Open Source)" },
              ].map((row) => (
                <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.muted, fontSize: 14 }}>{row.label}</Text>
                  <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{row.value}</Text>
                </View>
              ))}

              <View style={{ marginTop: 24, gap: 12 }}>
                <TouchableOpacity style={{ backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>Configure Call Forwarding</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 16 }}>View CDR / Call History</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => Alert.alert("Release Number", "Are you sure you want to release this number? This action cannot be undone.", [{ text: "Cancel", style: "cancel" }, { text: "Release", style: "destructive", onPress: () => setDetailDID(null) }])}
                  style={{ backgroundColor: colors.error + "15", borderRadius: 14, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: colors.error + "40" }}
                >
                  <Text style={{ color: colors.error, fontWeight: "600", fontSize: 16 }}>Release Number</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>
    </ScreenContainer>
  );
}
