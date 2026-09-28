import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { SIGN_IN_ROUTE } from "@/constants/oauth";
import { useAuth } from "@/hooks/use-auth";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { useColors } from "@/hooks/use-colors";
import { useSipAccountStore, type RegistrationState } from "@/lib/sip/account-store";
import { useSipDiagnosticsStore } from "@/lib/sip/diagnostics-store";
import { type PhoneProvisioningConfig, sipAccountFromPhoneConfig } from "@/lib/sip/provisioning";
import { assertProvisioningScope, fetchSelectedPhoneConfig, fetchSelectedPilotConfig } from "@/lib/sip/selected-provisioning";
import { resolveSipTenant, selectedSipTenant, useSipTenantSelection } from "@/lib/sip/tenant-selection";
import type { User } from "@/lib/_core/auth";

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

export default function SIPAccountScreen() {
  const colors = useColors();
  const { user, loading: authLoading, isAuthenticated, refresh: refreshAuth } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const workspace = useSipTenantSelection(user?.id);
  const account = useSipAccountStore((s) => s.account);
  const loadAccount = useSipAccountStore((s) => s.loadAccount);
  const setAccount = useSipAccountStore((s) => s.setAccount);
  const setRegistrationState = useSipAccountStore((s) => s.setRegistrationState);
  const registrationState = useSipAccountStore((s) => s.registrationState);
  const registrationError = useSipAccountStore((s) => s.registrationError);
  const addDiagnosticEvent = useSipDiagnosticsStore((s) => s.addEvent);

  useEffect(() => {
    void loadAccount().catch(console.error);
  }, [loadAccount]);

  const statusColor =
    registrationState === "registered"
      ? colors.success
      : registrationState === "registering"
      ? colors.warning
      : registrationState === "failed" || registrationState === "network_error"
      ? colors.error
      : colors.muted;

  const handleSignIn = () => router.push(SIGN_IN_ROUTE);

  const applyProvisioningConfig = async (config: PhoneProvisioningConfig, owner: User, tenantId: number) => {
    if (!config.configured || !config.sip) {
      throw new Error("No SIP extension was returned by admin management.");
    }
    assertProvisioningScope(owner, tenantId, config);
    const currentAccount = useSipAccountStore.getState().account;
    const provisionedAccount = sipAccountFromPhoneConfig(config, currentAccount?.id);
    await setAccount({ ...provisionedAccount, ownerUserId: owner.id });
    assertProvisioningScope(owner, tenantId, config);
    setRegistrationState("unregistered");
    addDiagnosticEvent({
      level: "info",
      category: "registration",
      message: "Phone account provisioned from admin",
      detail:
        "Native SIP registration was not started automatically. Open SIP Diagnostics and run an explicit registration test if needed.",
      context: {
        username: provisionedAccount.username,
        domain: provisionedAccount.domain,
        proxy: provisionedAccount.proxy || provisionedAccount.domain,
        port: provisionedAccount.port,
        transport: provisionedAccount.transport,
        srtp: provisionedAccount.srtp,
      },
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(
      "Provisioning synced",
      `Extension ${provisionedAccount.username} is saved on ${provisionedAccount.domain}. SIP registration will only start from a call or an explicit diagnostics test.`
    );
  };

  const handleSyncFromAdmin = async () => {
    if (authLoading && !user) {
      Alert.alert("Account is still loading", "Please wait a moment, then sync again.");
      return;
    }

    if (!isAuthenticated) {
      Alert.alert("Sign in required", "Sign in first so Phone11 can load the extension assigned to this user.", [
        { text: "Cancel", style: "cancel" },
        { text: "Sign In", onPress: handleSignIn },
      ]);
      return;
    }

    if (!workspace.ready || workspace.tenantId === null) {
      Alert.alert("Select a workspace", workspace.needsSelection
        ? "Choose the workspace whose phone extension you want to use."
        : "Could not verify your active Phone11 workspace. Try again.");
      return;
    }

    setSyncing(true);
    try {
      await refreshAuth();
      const owner = getAuthSnapshot().user;
      if (!owner || owner.id !== user?.id) throw new Error("Your sign-in changed. Please try again.");
      const membershipResult = await workspace.refetch();
      if (!membershipResult.isSuccess || !membershipResult.data) throw new Error("Could not verify your active workspace.");
      const tenantId = resolveSipTenant(owner.id, membershipResult.data, selectedSipTenant(owner.id));
      if (tenantId === null || tenantId !== workspace.tenantId) throw new Error("Your workspace selection changed. Please choose it again.");
      let config = await fetchSelectedPhoneConfig(owner, tenantId);
      if (!config.configured) config = await fetchSelectedPilotConfig(owner, tenantId);
      assertProvisioningScope(owner, tenantId, config);
      const currentAccount = useSipAccountStore.getState().account;
      if (currentAccount && (currentAccount.ownerUserId !== owner.id || currentAccount.tenantId !== tenantId)) {
        Alert.alert("Switch phone workspace?", "This will replace the saved SIP account for your other workspace.", [
          { text: "Cancel", style: "cancel" },
          { text: "Switch account", onPress: () => { void fetchSelectedPhoneConfig(owner, tenantId)
            .then(latest => applyProvisioningConfig(latest, owner, tenantId))
            .catch(error => Alert.alert("Provisioning failed", errorMessage(error))); } },
        ]);
      } else {
        await applyProvisioningConfig(config, owner, tenantId);
      }
    } catch (error) {
      Alert.alert(
        "Phone provisioning failed",
        `The phone is signed in as User ID ${user?.id ?? "unknown"}, but the backend did not return a SIP account. ${errorMessage(error)}`,
      );
    } finally {
      setSyncing(false);
    }
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

  const userLabel = isAuthenticated
    ? `${user?.email || user?.name || "Signed-in user"} - User ID ${user?.id}`
    : authLoading
    ? "Checking sign-in..."
    : "Not signed in";
  const savedWorkspaceName = account?.tenantId
    ? workspace.memberships.find(row => row.tenantId === account.tenantId)?.tenantName
      ?? `Workspace ID ${account.tenantId}${workspace.ready ? " (no active membership)" : ""}`
    : account ? "Unknown workspace" : undefined;

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

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
          <View style={styles.accountHeader}>
            <View style={styles.accountIdentity}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Phone11 Account</Text>
              <Text style={[styles.accountSub, { color: colors.muted }]}>{userLabel}</Text>
            </View>
            {authLoading && !isAuthenticated ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : isAuthenticated ? (
              <View style={[styles.statusPill, { backgroundColor: colors.success + "18" }]}> 
                <Text style={[styles.statusPillText, { color: colors.success }]}>Signed In</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.signInButton, { backgroundColor: colors.primary }]}
                onPress={handleSignIn}
                accessibilityRole="button"
              >
                <Text style={styles.signInText}>Sign In</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={[styles.infoBody, { color: colors.muted }]}>Registration only starts after the phone is signed in and an extension is assigned in admin management.</Text>
        </View>

        {isAuthenticated && (workspace.memberships.length > 1 || workspace.needsSelection) && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Phone workspace</Text>
            <Text style={[styles.infoBody, { color: colors.muted }]}>Choose a workspace before syncing its assigned extension.</Text>
            {workspace.memberships.map(membership => (
              <TouchableOpacity key={membership.tenantId} accessibilityRole="button"
                accessibilityLabel={`Use ${membership.tenantName} for Phone11 calling`}
                onPress={() => workspace.chooseTenant(membership.tenantId)}
                style={[styles.workspaceChoice, { borderColor: workspace.tenantId === membership.tenantId ? colors.primary : colors.border }]}>
                <Text style={{ color: colors.foreground }}>{membership.tenantName}</Text>
                {workspace.tenantId === membership.tenantId && <Text style={{ color: colors.primary }}>Selected</Text>}
              </TouchableOpacity>
            ))}
            {account && workspace.tenantId !== null && account.tenantId !== workspace.tenantId && (
              <Text style={[styles.infoBody, { color: colors.muted }]}>
                Your saved calling account remains on {savedWorkspaceName}. Use Sync Assigned Extension to switch it.
              </Text>
            )}
          </View>
        )}

        <TouchableOpacity
          style={[styles.syncCard, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}
          onPress={handleSyncFromAdmin}
          disabled={syncing}
        >
          <View style={styles.syncText}>
            <Text style={[styles.syncTitle, { color: colors.primary }]}>Sync Assigned Extension</Text>
            <Text style={[styles.syncSub, { color: colors.muted }]}>Loads the extension assigned to you in the selected Phone11 workspace.</Text>
          </View>
          {syncing ? (
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
          <ReadOnlyField label="Saved Phone11 workspace" value={savedWorkspaceName} />
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
          <Text style={[styles.infoBody, { color: colors.muted }]}>An administrator must create or assign your extension in Admin Portal &gt; Phone Provisioning before you can sync it here.</Text>
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
  workspaceChoice: { borderWidth: 1, borderRadius: 10, padding: 12, flexDirection: "row", justifyContent: "space-between" },
  accountHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  accountIdentity: { flex: 1 },
  accountSub: { fontSize: 13, marginTop: 2 },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  statusPillText: { fontSize: 12, fontWeight: "700" },
  signInButton: {
    minWidth: 84,
    minHeight: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  signInText: { color: "#fff", fontSize: 13, fontWeight: "700" },
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
