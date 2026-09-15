import { FeatureUnavailable } from "@/components/feature-unavailable";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { useChatStore } from "@/lib/chat/store";
import { chatNotificationClientEnabled } from "@/lib/notifications/client";
import { enableChatNotifications } from "@/lib/notifications/chat-notifications";

export default function Screen() {
  if (chatNotificationClientEnabled()) return <MessageAlertSettings />;
  return <FeatureUnavailable title="Notification settings are not available yet" description="Message alerts are not connected yet. Keep Phone11 open and check Team Chat for new messages." />;
}

function MessageAlertSettings() {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const chat = useChatStore();
  type Action = { owner: typeof user; tenantId: number };
  const mounted = useRef(true), pending = useRef<Action | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [feedback, setFeedback] = useState<{ action: Action; text: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current = null; }; }, []);
  const matchesView = (action: Action | null) => !!action && action.owner === user && chat.userId === user?.id && action.tenantId === chat.workspace?.id;
  const current = (action: Action) => {
    const auth = getAuthSnapshot(), state = useChatStore.getState();
    return mounted.current && chatNotificationClientEnabled() && auth.user === action.owner && !auth.loading &&
      state.userId === auth.user?.id && state.workspace?.id === action.tenantId;
  };
  const ownsWorkspace = Boolean(user && chat.userId === user.id && chat.workspace);
  const enable = async () => {
    if (!ownsWorkspace || !chat.workspace || matchesView(pending.current)) return;
    const action = { owner: user, tenantId: chat.workspace.id };
    if (!current(action)) return;
    pending.current = action; setBusy(action); setFeedback(null);
    try {
      const result = await enableChatNotifications();
      if (!current(action) || pending.current !== action) return;
      const text = result.status === "enabled" ? `Alert setup saved for ${chat.workspace.name}.`
        : result.status === "permission-denied" ? "Allow notifications for Phone11 in your phone’s settings, then try again."
        : result.status === "session-changed" ? "Your account or workspace changed. Open these settings again."
        : "Could not set up message alerts. Check your connection and try again.";
      setFeedback({ action, text });
    } catch {
      if (current(action) && pending.current === action) setFeedback({ action, text: "Could not set up message alerts. Check your connection and try again." });
    } finally {
      if (pending.current === action) { pending.current = null; if (mounted.current) setBusy(null); }
    }
  };
  return <ScreenContainer><View style={styles.content}>
    <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Message alerts</Text>
    <Text style={[styles.body, { color: colors.muted }]}>Alerts are for the workspace currently selected in Team Chat. Switch workspaces there to change which messages can notify you.</Text>
    <Text style={[styles.body, { color: colors.foreground }]}>{ownsWorkspace ? `Selected workspace: ${chat.workspace?.name}` : user ? "Open Team Chat and select a workspace first." : "Sign in and open Team Chat to set up message alerts."}</Text>
    <Text style={[styles.body, { color: colors.muted }]}>Message text is not shown in alerts.</Text>
    {feedback && matchesView(feedback.action) && <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.foreground }]}>{feedback.text}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel="Enable message alerts" disabled={!ownsWorkspace || matchesView(busy)} onPress={enable}
      style={[styles.button, { backgroundColor: colors.primary, opacity: !ownsWorkspace || matchesView(busy) ? 0.5 : 1 }]}>
      <Text style={styles.buttonText}>{matchesView(busy) ? "Setting up…" : "Enable message alerts"}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/settings")} style={styles.button}>
      <Text style={{ color: colors.primary }}>Back</Text>
    </Pressable>
  </View></ScreenContainer>;
}
const styles = StyleSheet.create({ content: { padding: 24, gap: 20 }, title: { fontSize: 24, fontWeight: "700" }, body: { fontSize: 16, lineHeight: 24 }, button: { minHeight: 48, padding: 14, alignItems: "center", borderRadius: 12 }, buttonText: { color: "white", fontWeight: "600", fontSize: 16 } });
