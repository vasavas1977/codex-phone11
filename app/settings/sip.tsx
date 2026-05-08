import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { getOAuthConfigMessage, isOAuthConfigured, startOAuthLogin } from "@/constants/oauth";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useSipAccountStore, type RegistrationState } from "@/lib/sip/account-store";
import { sipEngine } from "@/lib/sip/engine";
import { type PhoneProvisioningConfig, sipAccountFromPhoneConfig } from "@/lib/sip/provisioning";

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

function pilotExtensionCandidates(userId: number): string[] {
  const userBased = 1000 + userId;
  const timeBased = 3000 + (Date.now() % 6000);
  return Array.from(new Set([userBased, 2000 + userId, timeBased, timeBased + 1].map(String)));
}

export default function SIPAccountScreen() {
  const colors = useColors();
  const { user, loading: authLoading, isAuthenticated, refresh: refreshAuth } = useAuth();
  const [loginBusy, setLoginBusy] = useState(false);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const autoProvisionAttempted = useRef(false);
  const account = useSipAccountStore((s) => s.account);
  const loadAccount = useSipAccountStore((s) => s.loadAccount);
  const setAccount = useSipAccountStore((s) => s.setAccount);
  const registrationState = useSipAccountStore((s) => s.registrationState);
  const registrationError = useSipAccountStore((s) => s.registrationError);
  const phoneConfigQuery = trpc.phone.getConfig.useQuery(undefined, { enabled: false, retry: false });
  const ensurePilotConfig = trpc.phone.ensurePilotConfig.useMutation();
  const createExtension = trpc.phone.createExtension.useMutation();
  const assignExtension = trpc.phone.assignExtension.useMutation();

  useEffect(() => {
    let cancelled = false;
    loadAccount()
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setAccountLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [loadAccount]);

  const statusColor =
    registrationState === "registered"
      ? colors.success
      : registrationState === "registering"
      ? colors.warning
      : registrationState === "failed" || registrationState === "network_error"
      ? colors.error
      : colors.muted;

  const handleSignIn = async () => {
    if (!isOAuthConfigured()) {
      Alert.alert("Sign in is not configured", getOAuthConfigMessage());
      return;
    }

    try {
      setLoginBusy(true);
      await startOAuthLogin();
    } catch (error) {
      Alert.alert(
        "Sign in could not start",
        error instanceof Error ? error.message : "Check the Phone11 login configuration.",
      );
    } finally {
      setLoginBusy(false);
    }
  };

  const applyProvisioningConfig = async (config: PhoneProvisioningConfig, title: string) => {
    if (!config.configured || !config.sip) {
      throw new Error("No SIP extension was returned by admin management.");
    }

    const provisionedAccount = sipAccountFromPhoneConfig(config, account?.id);
    await setAccount(provisionedAccount);
    await sipEngine.restart();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(title, `Extension ${provisionedAccount.username} is ready on ${provisionedAccount.domain}.`);
  };

  const refetchAssignedConfig = async (): Promise<PhoneProvisioningConfig> => {
    const refreshed = await phoneConfigQuery.refetch();
    if (refreshed.error) throw refreshed.error;
    if (!refreshed.data?.configured || !refreshed.data.sip) {
      throw new Error("Extension was created, but the server still did not return SIP settings for this user.");
    }
    return refreshed.data;
  };

  const createPilotWithExistingAdminApi = async (): Promise<PhoneProvisioningConfig> => {
    if (!user?.id) {
      throw new Error("The signed-in user ID is missing. Sign out and sign in again, then retry.");
    }

    let lastError: unknown;
    for (const extensionNumber of pilotExtensionCandidates(user.id)) {
      try {
        const created = await createExtension.mutateAsync({
          orgId: 1,
          extensionNumber,
          displayName: `Phone11 Pilot ${extensionNumber}`,
        });

        if (!created?.id) {
          throw new Error("Admin API created an extension without returning an extension ID.");
        }

        await assignExtension.mutateAsync({ userId: user.id, extensionId: created.id, isPrimary: true });
        return refetchAssignedConfig();
      } catch (error) {
        lastError = error;
        const message = errorMessage(error).toLowerCase();
        if (message.includes("forbidden") || message.includes("not_admin") || message.includes("not admin")) {
          break;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Could not create a pilot extension with the deployed admin API.");
  };

  const createOrSyncPilotConfig = async (): Promise<PhoneProvisioningConfig> => {
    try {
      return await ensurePilotConfig.mutateAsync();
    } catch (newEndpointError) {
      console.warn("[Phone Provisioning] ensurePilotConfig failed, falling back to admin APIs:", newEndpointError);
      return createPilotWithExistingAdminApi();
    }
  };

  const handleSyncFromAdmin = async () => {
    if (authLoading) {
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

    try {
      await refreshAuth();
      const result = await phoneConfigQuery.refetch();

      if (result.error) throw result.error;

      if (result.data?.configured && result.data.sip) {
        await applyProvisioningConfig(result.data, "Provisioning synced");
        return;
      }

      const pilotConfig = await createOrSyncPilotConfig();
      await applyProvisioningConfig(pilotConfig, "Pilot extension created");
    } catch (error) {
      Alert.alert(
        "Pilot provisioning failed",
        `The phone is signed in as User ID ${user?.id ?? "unknown"}, but the backend did not return a SIP account. ${errorMessage(error)}`,
      );
    }
  };

  useEffect(() => {
    if (!accountLoaded || authLoading || !isAuthenticated || !user?.id || account) return;
    if (autoProvisionAttempted.current) return;
    if (
      phoneConfigQuery.isFetching ||
      ensurePilotConfig.isPending ||
      createExtension.isPending ||
      assignExtension.isPending
    ) {
      return;
    }

    autoProvisionAttempted.current = true;
    handleSyncFromAdmin().catch((error) => {
      console.warn("[Phone Provisioning] automatic provisioning failed:", error);
    });
  }, [
    account,
    accountLoaded,
    authLoading,
    isAuthenticated,
    user?.id,
    phoneConfigQuery.isFetching,
    ensurePilotConfig.isPending,
    createExtension.isPending,
    assignExtension.isPending,
  ]);

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

  const syncing =
    phoneConfigQuery.isFetching ||
    ensurePilotConfig.isPending ||
    createExtension.isPending ||
    assignExtension.isPending;
  const userLabel = authLoading
    ? "Checking sign-in..."
    : isAuthenticated
    ? `${user?.email || user?.name || "Signed-in user"} - User ID ${user?.id}`
    : "Not signed in";

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
            {authLoading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : isAuthenticated ? (
              <View style={[styles.statusPill, { backgroundColor: colors.success + "18" }]}> 
                <Text style={[styles.statusPillText, { color: colors.success }]}>Signed In</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.signInButton, { backgroundColor: colors.primary }]}
                onPress={handleSignIn}
                disabled={loginBusy}
              >
                {loginBusy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.signInText}>Sign In</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
          <Text style={[styles.infoBody, { color: colors.muted }]}>Registration only starts after the phone is signed in and an extension is assigned in admin management.</Text>
        </View>

        <TouchableOpacity
          style={[styles.syncCard, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}
          onPress={handleSyncFromAdmin}
          disabled={syncing}
        >
          <View style={styles.syncText}>
            <Text style={[styles.syncTitle, { color: colors.primary }]}>Sync or Create Pilot Extension</Text>
            <Text style={[styles.syncSub, { color: colors.muted }]}>Loads admin settings, or creates a first-device pilot extension for this signed-in user.</Text>
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
          <Text style={[styles.infoBody, { color: colors.muted }]}>Create or assign the user's extension in Admin Portal &gt; Phone Provisioning. For pilot testing, this screen can request a server-created pilot extension for the signed-in user.</Text>
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
