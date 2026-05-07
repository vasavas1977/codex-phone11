import { useEffect, type ReactNode } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useSipAccountStore, type RegistrationState } from "@/lib/sip/account-store";
import { sipEngine } from "@/lib/sip/engine";
import { sipAccountFromPhoneConfig } from "@/lib/sip/provisioning";

function registrationLabel(state: RegistrationState): string {
  switch (state) {
    case "registered":
      return "SIP Registered";
    case "registering":
      return "Registering";
    case "failed":
      return "Registration Failed";
    case "network_error":
      return "Network Error";
    default:
      return "Not Registered";
  }
}

export default function SIPAccountScreen() {
  const colors = useColors();
  const account = useSipAccountStore((s) => s.account);
  const loadAccount = useSipAccountStore((s) => s.loadAccount);
  const setAccount = useSipAccountStore((s) => s.setAccount);
  const registrationState = useSipAccountStore((s) => s.registrationState);
  const registrationError = useSipAccountStore((s) => s.registrationError);
  const phoneConfigQuery = trpc.phone.getConfig.useQuery(undefined, { enabled: false, retry: false });

  useEffect(() => {
    loadAccount().catch(console.error);
  }, [loadAccount]);

  const statusColor =
    registrationState === "registered"
      ? colors.success
      : registrationState === "registering"
      ? colors.warning
      : registrationState === "failed" || registrationState === "network_error"
      ? colors.error
      : colors.muted;

  const handleSyncFromAdmin = async () => {
    const result = await phoneConfigQuery.refetch();

    if (result.error) {
      Alert.alert("Admin sync failed", result.error.message);
      return;
    }

    if (!result.data?.configured || !result.data.sip) {
      Alert.alert("No extension assigned", "Assign an extension to this user in the Phone11 admin portal, then sync again.");
      return;
    }

    const provisionedAccount = sipAccountFromPhoneConfig(result.data, account?.id);
    await setAccount(provisionedAccount);
    await sipEngine.restart();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Provisioning synced", `Extension ${provisionedAccount.username} is ready on ${provisionedAccount.domain}.`);
  };

  const ReadOnlyField = ({
    label,
    value,
    secureTextEntry,
    rightElement,
  }: {
    label: string;
    value?: string | number | null;
    secureTextEntry?: boolean;
    rightElement?: ReactNode;
  }) => (
    <View style={styles.inputGroup}>
      <Text style={[styles.inputLabel, { color: colors.muted }]}>{label}</Text>
      <View style={[styles.inputWrapper, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <TextInput
          style={[styles.input, { color: colors.foreground }]}
          value={value === undefined || value === null || value === "" ? "Not provisioned" : String(value)}
          editable={false}
          secureTextEntry={secureTextEntry}
          selectTextOnFocus={false}
        />
        {rightElement}
      </View>
    </View>
  );

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <IconSymbol name="chevron.left" size={20} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>Settings</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Phone Provisioning</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={[styles.statusBanner, { backgroundColor: statusColor + "15", borderColor: statusColor + "40" }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}> 
            {registrationLabel(registrationState)}
            {registrationError ? ` - ${registrationError}` : account ? ` - ${account.domain}` : ""}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.syncCard, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}
          onPress={handleSyncFromAdmin}
          disabled={phoneConfigQuery.isFetching}
        >
          <View style={styles.syncText}>
            <Text style={[styles.syncTitle, { color: colors.primary }]}>Sync from Admin</Text>
            <Text style={[styles.syncSub, { color: colors.muted }]}> 
              Device SIP settings are read-only and controlled by Phone11 admin management.
            </Text>
          </View>
          {phoneConfigQuery.isFetching ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <IconSymbol name="arrow.clockwise" size={18} color={colors.primary} />
          )}
        </TouchableOpacity>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Server</Text>
          <ReadOnlyField label="SIP Domain" value={account?.domain} />
          <ReadOnlyField label="SIP Proxy" value={account?.proxy || account?.domain} />
          <ReadOnlyField label="Port" value={account?.port} />
          <ReadOnlyField label="Transport" value={account?.transport} />
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Assigned Extension</Text>
          <ReadOnlyField label="Display Name" value={account?.displayName} />
          <ReadOnlyField label="Username / Extension" value={account?.username} />
          <ReadOnlyField label="Password" value={account?.password ? "Stored securely" : ""} rightElement={<IconSymbol name="lock.fill" size={15} color={colors.muted} />} />
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Calling Policy</Text>
          <ReadOnlyField label="SIP Account Enabled" value={account?.enabled ? "Enabled" : "Not provisioned"} />
          <ReadOnlyField label="Secure Media" value={account?.srtp ? "SRTP enabled" : "Not provisioned"} />
          <ReadOnlyField label="STUN Server" value={account?.stun} />
        </View>

        <View style={[styles.infoCard, { backgroundColor: colors.primary + "08", borderColor: colors.primary + "20" }]}> 
          <View style={styles.infoHeader}>
            <IconSymbol name="info.circle" size={16} color={colors.primary} />
            <Text style={[styles.infoTitle, { color: colors.primary }]}>Admin-managed configuration</Text>
          </View>
          <Text style={[styles.infoBody, { color: colors.muted }]}> 
            Create or assign the user's extension in Admin Portal &gt; Phone Provisioning. The app then receives SIP username, encrypted password, TLS port, SRTP, and network settings from the server.
          </Text>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, width: 92 },
  backText: { fontSize: 16, fontWeight: "500" },
  title: { fontSize: 17, fontWeight: "700" },
  headerSpacer: { width: 92 },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: "600", flex: 1 },
  syncCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  syncText: { flex: 1, gap: 3 },
  syncTitle: { fontSize: 14, fontWeight: "700" },
  syncSub: { fontSize: 12, lineHeight: 17 },
  card: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", marginBottom: 4 },
  inputGroup: { gap: 6 },
  inputLabel: { fontSize: 12, fontWeight: "600" },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: 12 },
  infoCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  infoHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoTitle: { fontSize: 14, fontWeight: "700" },
  infoBody: { fontSize: 13, lineHeight: 19 },
});