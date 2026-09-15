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

export default function SettingsScreen() {
  const colors = useColors();
  const { user, logout } = useAuth({ autoFetch: false });
  const saved = useSipAccountStore(s => s.account);
  const account = saved?.ownerUserId === user?.id ? saved : null;
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
  const status = !user ? "Sign in to connect" : !account ? "Extension setup required" : state === "registered" ? "Ready to call" : state === "registering" ? "Connecting…" : "Offline · reconnecting automatically";
  return <ScreenContainer><ScrollView contentContainerStyle={styles.content}>
    <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Settings</Text>
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.name, { color: colors.foreground }]}>{user?.name || "Your work account"}</Text>
      <Text style={[styles.detail, { color: colors.muted }]}>{account ? `Extension ${account.username}` : "No extension connected"}</Text>
      <Text style={{ color: state === "registered" && account ? colors.success : colors.warning, marginTop: 12 }}>{status}</Text>
    </View>
    {row("Phone account", "View your assigned extension and connection", () => router.push(user ? "/settings/sip" : "/auth/sign-in"))}
    {account && row(busy ? "Connecting…" : "Reconnect", "Refresh your phone connection", reconnect)}
    {row("Call history", "Calls placed and received on this phone", () => router.push("/(tabs)/recents"))}
    {row("Team Chat", "Conversations in your work account", () => router.push("/(tabs)/teamchat"))}
    {chatNotificationClientEnabled() && row("Message alerts", "Choose alerts for your selected workspace", () => router.push("/notifications/preferences"))}
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.rowTitle, { color: colors.foreground }]}>Preview availability</Text>
      <Text style={[styles.detail, { color: colors.muted }]}>Keep Phone11 open to receive calls in this preview. Incoming-call notifications while the app is closed are not connected yet.</Text>
      <Text style={[styles.detail, { color: colors.muted }]}>Preview calls are limited to 60 seconds. Voicemail, transfer, video, SMS and live presence are not available yet.</Text>
    </View>
    {row("Connection diagnostics", "Troubleshooting information for support", () => router.push("/settings/sip-diagnostics"))}
    {user ? row("Sign out", "Disconnect this work account from the app", signOut, true) : row("Sign in", "Connect your work account", () => router.push(SIGN_IN_ROUTE))}
    <Text style={[styles.footer, { color: colors.muted }]}>Phone11 · Work calls and team conversations</Text>
  </ScrollView></ScreenContainer>;
}
const styles = StyleSheet.create({ content: { padding: 20, gap: 8 }, title: { fontSize: 28, fontWeight: "700", marginBottom: 12 }, card: { padding: 20, borderRadius: 16, borderWidth: 1, marginBottom: 12, gap: 4 }, name: { fontSize: 21, fontWeight: "700" }, row: { minHeight: 72, borderRadius: 12, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 0.5 }, rowTitle: { fontSize: 16, fontWeight: "600" }, detail: { fontSize: 14, lineHeight: 21, marginTop: 5 }, footer: { fontSize: 12, textAlign: "center", paddingVertical: 20 } });
