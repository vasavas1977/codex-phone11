import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { useChatStore } from "@/lib/chat/store";
import { chatError } from "@/lib/chat/state";
import { formatChatTime, type ChatKind } from "@/lib/chat/types";

export default function TeamChatScreen() {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const chat = useChatStore();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [composing, setComposing] = useState(false);
  const [kind, setKind] = useState<ChatKind>("direct");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  useEffect(() => { setComposing(false); setSelected([]); setName(""); setSearch(""); setCreateError(null); }, [user?.id]);
  useFocusEffect(useCallback(() => {
    chat.setUser(user?.id ?? null);
    if (!user) return;
    const refresh = () => { if (AppState.currentState === "active") void useChatStore.getState().loadChannels(); };
    refresh();
    const timer = setInterval(refresh, 5000);
    const subscription = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [user?.id]));

  const openComposer = async () => {
    setComposing(true); setSelected([]); setName(""); setKind("direct"); setCreateError(null); setDirectoryLoading(true);
    try { await chat.loadDirectory(); } catch (error) { setCreateError(chatError(error)); }
    finally { setDirectoryLoading(false); }
  };
  const create = async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true); setCreateError(null);
    try {
      const id = await chat.createConversation(kind, kind === "direct" ? "Direct message" : name.trim(), selected);
      setComposing(false);
      router.push({ pathname: "/chat/[id]", params: { id, tenantId: String(chat.workspace?.id) } });
    } catch (error) { setCreateError(chatError(error)); }
    finally { creatingRef.current = false; setCreating(false); }
  };
  const rows = chat.channels.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) &&
    (filter === "all" || (filter === "unread" ? c.unreadCount > 0 : c.kind === filter)));
  const fg = { color: colors.foreground };
  return <ScreenContainer>
    <View style={styles.header}>
      <View style={{ flex: 1 }}><Text style={[styles.title, fg]}>Team Chat</Text><Text style={{ color: colors.muted }}>{chat.workspace?.name || "Your work conversations"}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="New conversation" disabled={!chat.workspace || !user} onPress={openComposer}
        style={[styles.button, { backgroundColor: colors.primary, opacity: chat.workspace && user ? 1 : 0.4 }]}><Text style={styles.buttonText}>New</Text></Pressable>
    </View>
    {!user ? <View style={styles.empty}><Text style={[styles.emptyTitle, fg]}>Sign in to use Team Chat</Text><Text style={{ color: colors.muted }}>Your conversations are shared with your workspace.</Text></View> : <>
      {chat.workspaces.length > 1 && <ScrollView horizontal style={{ maxHeight: 48 }} contentContainerStyle={styles.filters}>{chat.workspaces.map(w => <Pressable key={w.id} onPress={() => chat.loadChannels(w.id)} style={[styles.chip, { borderColor: colors.border, backgroundColor: w.id === chat.workspace?.id ? colors.primary : colors.surface }]}><Text style={{ color: w.id === chat.workspace?.id ? "white" : colors.foreground }}>{w.name}</Text></Pressable>)}</ScrollView>}
      <TextInput accessibilityLabel="Search conversations" value={search} onChangeText={setSearch} placeholder="Search conversations" placeholderTextColor={colors.muted} style={[styles.search, fg, { backgroundColor: colors.surface, borderColor: colors.border }]} />
      <View style={styles.filters}>{["all", "direct", "group", "channel", "unread"].map(f => <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, { borderColor: colors.border, backgroundColor: filter === f ? colors.primary : colors.surface }]}><Text style={{ color: filter === f ? "white" : colors.foreground, textTransform: "capitalize", fontSize: 12 }}>{f === "channel" ? "Channels" : f}</Text></Pressable>)}</View>
      {(chat.error || chat.storageError) && <Pressable onPress={() => chat.loadChannels()} style={styles.error}><Text style={{ color: colors.error }}>{chat.storageError || chat.error} Tap to retry.</Text></Pressable>}
      <FlatList data={rows} keyExtractor={item => item.id} refreshing={chat.loading} onRefresh={() => chat.loadChannels()} renderItem={({ item }) => <Pressable
        accessibilityRole="button" onPress={() => router.push({ pathname: "/chat/[id]", params: { id: item.id, tenantId: String(chat.workspace?.id) } })}
        style={[styles.row, { borderBottomColor: colors.border }]}>
        <View style={[styles.avatar, { backgroundColor: colors.primary + "18" }]}><Text style={[styles.avatarText, { color: colors.primary }]}>{item.kind === "channel" ? "#" : item.name.charAt(0).toUpperCase()}</Text></View>
        <View style={{ flex: 1, gap: 5 }}><View style={styles.rowHeading}><Text numberOfLines={1} style={[styles.rowName, fg, item.unreadCount > 0 && { fontWeight: "700" }]}>{item.name}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{formatChatTime(item.lastMessageAt)}</Text></View>
        <Text numberOfLines={1} style={{ color: colors.muted }}>{item.lastMessage || "No messages yet"}</Text></View>
        {item.unreadCount > 0 && <View style={[styles.badge, { backgroundColor: colors.primary }]}><Text style={styles.buttonText}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text></View>}
      </Pressable>} ListEmptyComponent={<View style={styles.empty}>{chat.loading ? <ActivityIndicator color={colors.primary} /> : <><Text style={[styles.emptyTitle, fg]}>{chat.error ? "Chat is unavailable" : search || filter !== "all" ? "No matching conversations" : "Start a conversation"}</Text><Text style={{ color: colors.muted, textAlign: "center" }}>{chat.error ? "Your messages will appear when the connection is restored." : "Choose New to message someone in your workspace."}</Text></>}</View>} />
    </>}
    <Modal visible={composing && Boolean(user)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => !creating && setComposing(false)}>
      <ScreenContainer><View style={styles.header}><Text style={[styles.title, fg]}>New conversation</Text><Pressable disabled={creating} onPress={() => setComposing(false)}><Text style={{ color: colors.primary }}>Cancel</Text></Pressable></View>
        <View style={styles.filters}>{(["direct", "group", "channel"] as ChatKind[]).map(k => <Pressable key={k} disabled={creating} onPress={() => { setKind(k); setSelected([]); }} style={[styles.chip, { borderColor: colors.border, backgroundColor: k === kind ? colors.primary : colors.surface }]}><Text style={{ color: k === kind ? "white" : colors.foreground, textTransform: "capitalize" }}>{k}</Text></Pressable>)}</View>
        {kind !== "direct" && <TextInput accessibilityLabel="Conversation name" value={name} onChangeText={setName} maxLength={100} placeholder="Conversation name" placeholderTextColor={colors.muted} style={[styles.search, fg, { backgroundColor: colors.surface, borderColor: colors.border }]} />}
        <Text style={{ paddingHorizontal: 20, paddingVertical: 12, color: colors.muted }}>Choose {kind === "direct" ? "one teammate" : "teammates"}. Conversations are private to these members.</Text>
        {createError && <Pressable onPress={openComposer} style={styles.error}><Text style={{ color: colors.error }}>{createError} Tap to refresh.</Text></Pressable>}
        {directoryLoading && <ActivityIndicator color={colors.primary} />}
        <FlatList data={chat.people} keyExtractor={p => String(p.id)} renderItem={({ item }) => <Pressable disabled={creating} onPress={() => setSelected(previous => kind === "direct" ? [item.id] : previous.includes(item.id) ? previous.filter(id => id !== item.id) : previous.length < 49 ? [...previous, item.id] : previous)} style={[styles.row, { borderBottomColor: colors.border }]}><Text style={[fg, { flex: 1 }]}>{item.name}</Text><Text style={{ color: colors.primary }}>{selected.includes(item.id) ? "Selected ✓" : "Select"}</Text></Pressable>}
          ListEmptyComponent={!directoryLoading ? <Text style={{ color: colors.muted, padding: 20 }}>No other teammates are available. Your administrator must add another active workspace member.</Text> : null} />
        <Pressable disabled={creating || directoryLoading || selected.length === 0 || (kind !== "direct" && !name.trim())} onPress={create} style={[styles.button, { margin: 20, backgroundColor: colors.primary, opacity: selected.length && (kind === "direct" || name.trim()) && !creating ? 1 : 0.4 }]}><Text style={styles.buttonText}>{creating ? "Creating…" : "Start conversation"}</Text></Pressable>
      </ScreenContainer>
    </Modal>
  </ScreenContainer>;
}
const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 3 },
  button: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, alignItems: "center" }, buttonText: { color: "white", fontWeight: "600" },
  search: { marginHorizontal: 16, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 16 },
  filters: { flexDirection: "row", gap: 7, padding: 16 }, chip: { borderWidth: 1, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 11 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  rowHeading: { flexDirection: "row", alignItems: "center", gap: 6 }, rowName: { flex: 1, fontSize: 16 },
  avatar: { width: 46, height: 46, borderRadius: 23, justifyContent: "center", alignItems: "center" }, avatarText: { fontSize: 20, fontWeight: "600" },
  badge: { borderRadius: 12, paddingHorizontal: 7, paddingVertical: 3 },
  empty: { padding: 28, paddingTop: 70, alignItems: "center", gap: 10 }, emptyTitle: { fontSize: 19, fontWeight: "600" }, error: { padding: 16 },
});
