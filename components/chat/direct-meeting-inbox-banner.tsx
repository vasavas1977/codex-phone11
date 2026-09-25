import { useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getAuthSnapshot } from "@/lib/_core/auth";
import { createChatTransport } from "@/lib/chat/transport";
import { useChatStore } from "@/lib/chat/store";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";

const api = createChatTransport();
type Invite = Awaited<ReturnType<typeof api.directMeetingInbox>>[number];
type InboxState = { owner: ReturnType<typeof getAuthSnapshot>["user"]; tenantId: number; items: Invite[] };

/** Direct invitations remain discoverable while the recipient reads another Team Chat room. */
export function DirectMeetingInboxBanner() {
  const { user } = useAuth({ autoFetch: false });
  const chat = useChatStore();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [inbox, setInbox] = useState<InboxState | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const isChatRoute = path === "/teamchat" || path.startsWith("/chat/");
  const tenantId = chat.workspace?.id;
  const scoped = !!user && getAuthSnapshot().user === user && chat.userId === user.id
    && !!tenantId && isChatRoute;

  useEffect(() => {
    setInbox(null);
    setDismissed([]);
    if (!scoped || !user || !tenantId) return;
    let stopped = false;
    let latestRequest = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => !stopped && AppState.currentState === "active"
      && getAuthSnapshot().user === user && useChatStore.getState().userId === user.id
      && useChatStore.getState().workspace?.id === tenantId;
    const refresh = async () => {
      if (!current()) return;
      const request = ++latestRequest;
      try {
        const items = await api.directMeetingInbox(tenantId);
        if (current() && request === latestRequest) setInbox({ owner: user, tenantId, items: items.filter(item => item.expiresAt > Date.now()) });
      } catch {
        if (current() && request === latestRequest) setInbox({ owner: user, tenantId, items: [] });
      } finally {
        if (current() && request === latestRequest) timer = setTimeout(refresh, 10_000);
      }
    };
    const subscription = AppState.addEventListener("change", state => {
      if (state !== "active") { latestRequest++; if (timer) clearTimeout(timer); setInbox(null); return; }
      if (timer) clearTimeout(timer);
      void refresh();
    });
    void refresh();
    return () => { stopped = true; latestRequest++; if (timer) clearTimeout(timer); subscription.remove(); };
  }, [user, tenantId, scoped]);

  if (!scoped || !inbox || inbox.owner !== user || inbox.tenantId !== tenantId) return null;
  const invitation = inbox.items.find(item => item.expiresAt > Date.now()
    && !dismissed.includes(item.invitationId) && path !== `/chat/${item.conversationId}`);
  if (!invitation) return null;
  const contact = chat.channels.find(item => item.kind === "direct" && item.id === invitation.conversationId);
  const open = () => {
    const state = useChatStore.getState();
    if (getAuthSnapshot().user !== user || state.userId !== user?.id || state.workspace?.id !== tenantId
      || invitation.expiresAt <= Date.now()) return;
    router.push({ pathname: "/conference", params: {
      meetingId: invitation.meetingId, tenantId: String(tenantId), source: "direct",
    } });
  };
  return <View style={[styles.banner, { bottom: insets.bottom + 88, backgroundColor: colors.surface, borderColor: colors.border }]}>
    <View style={styles.copy}>
      <Text style={[styles.title, { color: colors.foreground }]}>Meeting invitation</Text>
      <Text numberOfLines={1} style={{ color: colors.muted }}>{contact?.name || "A teammate"} invited you to meet</Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Join direct meeting invitation" onPress={open} style={[styles.join, { backgroundColor: colors.primary }]}>
      <Text style={styles.joinText}>Join</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss direct meeting invitation" onPress={() => setDismissed(ids => [...ids, invitation.invitationId])} style={styles.dismiss}>
      <Text style={{ color: colors.muted, fontSize: 20 }}>×</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  banner: { position: "absolute", left: 12, right: 12, zIndex: 90, elevation: 9,
    borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
  join: { minHeight: 44, borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" },
  joinText: { color: "#FFFFFF", fontWeight: "700" },
  dismiss: { minWidth: 36, minHeight: 44, alignItems: "center", justifyContent: "center" },
});
