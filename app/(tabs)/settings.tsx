import { useState } from "react";
import { SIGN_IN_ROUTE } from "@/constants/oauth";
import { Alert, View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useSipAccountStore } from "@/lib/sip/account-store";
import { useSip } from "@/lib/sip/sip-provider";
import { useAuth } from "@/hooks/use-auth";
import { chatNotificationClientEnabled } from "@/lib/notifications/client";
import { useThemeContext, type AppearancePreference } from "@/lib/theme-provider";
import { trpc } from "@/lib/trpc";
import type { RegistrationState, SipAccount } from "@/lib/sip/account-store";

type StatusTone = "success" | "warning" | "error" | "muted";

export function enabledPhoneAccountForUser(
  account: SipAccount | null | undefined,
  userId: number | undefined,
): SipAccount | null {
  return userId && account?.ownerUserId === userId && account.enabled
    ? account
    : null;
}

export function phoneConnectionStatus(
  signedIn: boolean,
  hasAccount: boolean,
  state: RegistrationState,
): { label: string; tone: StatusTone } {
  if (!signedIn) return { label: "Sign in to connect", tone: "muted" };
  if (!hasAccount) return { label: "Extension setup required", tone: "warning" };
  switch (state) {
    case "registered":
      return { label: "Ready to call", tone: "success" };
    case "registering":
      return { label: "Connecting…", tone: "warning" };
    case "failed":
      return { label: "Connection failed", tone: "error" };
    case "network_error":
      return { label: "Offline", tone: "error" };
    default:
      return { label: "Connecting…", tone: "muted" };
  }
}

export const PHONE11_PREVIEW_AVAILABILITY_COPY = {
  foreground:
    "Calls are available while Phone11 is open. Incoming-call alerts while the app is in the background or closed require commissioned native support and are not available in this preview.",
  meetings:
    "Preview calls are limited to 60 seconds by the SIP trial. Team Chat video meetings are available when enabled for your workspace and channel.",
  other:
    "Call transfer, PBX conference calling and SMS are not available in this preview.",
} as const;

export default function SettingsScreen() {
  const colors = useColors();
  const { appearance, setAppearance } = useThemeContext();
  const { user, logout } = useAuth({ autoFetch: false });
  const tenantQuery = trpc.pbx.tenant.get.useQuery(undefined, {
    enabled: Boolean(user),
    staleTime: 300_000,
  });
  const canManageWorkspace = ["owner", "admin"].includes(
    String(tenantQuery.data?.userRole || ""),
  );
  const saved = useSipAccountStore(s => s.account);
  const account = enabledPhoneAccountForUser(saved, user?.id);
  const state = useSipAccountStore(s => s.registrationState);
  const { reconnectPhone } = useSip();
  const [busy, setBusy] = useState(false);
  const reconnect = async () => {
    if (busy) return;
    setBusy(true);
    try { await reconnectPhone(); }
    catch { Alert.alert("Unable to reconnect", "Check your connection and account setup, then try again."); }
    finally { setBusy(false); }
  };
  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    try { await logout(); router.replace(SIGN_IN_ROUTE); }
    catch { Alert.alert("Sign-out failed", "Please try again."); }
    finally { setBusy(false); }
  };
  const row = (title: string, detail: string, action?: () => void, destructive = false) => (
    <Pressable key={title} accessibilityRole={action ? "button" : undefined} disabled={!action || busy} onPress={action}
      style={[styles.row, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={{ flex: 1 }}><Text style={[styles.rowTitle, { color: destructive ? colors.error : colors.foreground }]}>{title}</Text>
        <Text style={[styles.detail, { color: colors.muted }]}>{detail}</Text></View>
      {action && <Text style={{ color: colors.muted, fontSize: 22 }}>›</Text>}
    </Pressable>
  );
  const status = phoneConnectionStatus(Boolean(user), Boolean(account), state);
  const statusColor = colors[status.tone];
  return <ScreenContainer><ScrollView contentContainerStyle={styles.content}>
    <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Settings</Text>
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.name, { color: colors.foreground }]}>{user?.name || "Your work account"}</Text>
      <Text style={[styles.detail, { color: colors.muted }]}>{account ? `Extension ${account.username}` : "No extension connected"}</Text>
      <Text style={{ color: statusColor, marginTop: 12 }}>{status.label}</Text>
    </View>
    {row("My profile", "View your work account and phone extension", () => router.push("/profile"))}
    {row("Phone account", "View your assigned extension and connection", () => router.push(user ? "/settings/sip" : "/auth/sign-in"))}
    {account && row(busy ? "Connecting…" : "Reconnect", "Refresh your phone connection", reconnect)}
    {row("About Phone11", "Current calling features and availability", () => router.push("/settings/about"))}
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.rowTitle, { color: colors.foreground }]}>Appearance</Text>
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        {(["system", "light", "dark"] as AppearancePreference[]).map(preference => (
          <Pressable key={preference} accessibilityRole="radio"
            accessibilityState={{ checked: appearance === preference }}
            accessibilityLabel={preference === "system" ? "Follow device appearance" : `${preference} appearance`}
            onPress={() => setAppearance(preference)}
            style={{ flex: 1, minHeight: 44, padding: 10, alignItems: "center", justifyContent: "center", borderRadius: 10,
              backgroundColor: appearance === preference ? colors.primary : colors.background }}>
            <Text style={{ color: appearance === preference ? "#FFFFFF" : colors.foreground, fontWeight: "600" }}>
              {preference === "system" ? "System" : preference === "light" ? "Light" : "Dark"}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
    {row("Recording & AI", "Recording policy, AI summaries and retention", () => router.push("/call-recording/settings"))}
    {row("Voicemail", "Listen to and manage voicemail for your assigned extension", () => router.push("/voicemail"))}
    {row("Today & calendar", "Scheduled calls and meetings from Super Number", () => router.push("/calendar" as any))}
    {row("Call history", "Calls placed and received on this phone", () => router.push("/(tabs)/recents"))}
    {row("Team Chat", "Conversations in your work account", () => router.push("/(tabs)/teamchat"))}
    {chatNotificationClientEnabled() && row("Message alerts", "Choose alerts for your selected workspace", () => router.push("/notifications/preferences"))}
    {canManageWorkspace && row("Workspace administration", "Manage people, numbers and call routing", () => router.push("/admin"))}
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.rowTitle, { color: colors.foreground }]}>Preview availability</Text>
      <Text style={[styles.detail, { color: colors.muted }]}>{PHONE11_PREVIEW_AVAILABILITY_COPY.foreground}</Text>
      <Text style={[styles.detail, { color: colors.muted }]}>{PHONE11_PREVIEW_AVAILABILITY_COPY.meetings}</Text>
      <Text style={[styles.detail, { color: colors.muted }]}>{PHONE11_PREVIEW_AVAILABILITY_COPY.other}</Text>
    </View>
    {row("Connection diagnostics", "Troubleshooting information for support", () => router.push("/settings/sip-diagnostics"))}
    {user ? row("Sign out", "Disconnect this work account from the app", signOut, true) : row("Sign in", "Connect your work account", () => router.push(SIGN_IN_ROUTE))}
    <Text style={[styles.footer, { color: colors.muted }]}>Phone11 · Work calls and team conversations</Text>
  </ScrollView></ScreenContainer>;
}
const styles = StyleSheet.create({ content: { padding: 20, gap: 8 }, title: { fontSize: 28, fontWeight: "700", marginBottom: 12 }, card: { padding: 20, borderRadius: 16, borderWidth: 1, marginBottom: 12, gap: 4 }, name: { fontSize: 21, fontWeight: "700" }, row: { minHeight: 72, borderRadius: 12, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 0.5 }, rowTitle: { fontSize: 16, fontWeight: "600" }, detail: { fontSize: 14, lineHeight: 21, marginTop: 5 }, footer: { fontSize: 12, textAlign: "center", paddingVertical: 20 } });
