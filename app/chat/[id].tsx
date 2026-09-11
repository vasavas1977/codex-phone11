import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { chatError } from "@/lib/chat/state";
import { useChatStore } from "@/lib/chat/store";
import { formatChatTime, type ChatMessage } from "@/lib/chat/types";

export default function ChatRoomScreen() {
  const params = useLocalSearchParams<{ id: string; tenantId?: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const tenantId = Number(params.tenantId);
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const chat = useChatStore();
  type SendAction = { owner: typeof user; workspaceId: number; roomId: string };
  const [sendingAction, setSendingAction] = useState<SendAction | null>(null);
  const sendingRef = useRef<SendAction | null>(null);
  const [searchScope, setSearchScope] = useState<SendAction | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchResult, setSearchResult] = useState<{ messages: ChatMessage[]; hasMore: boolean }>({ messages: [], hasMore: false });
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const ownsWorkspace = Boolean(user && chat.userId === user.id && chat.workspace &&
    (!params.tenantId || (Number.isSafeInteger(tenantId) && tenantId > 0 && chat.workspace.id === tenantId)));
  const searching = ownsWorkspace && !!searchScope && searchScope.owner === user && searchScope.workspaceId === chat.workspace?.id && searchScope.roomId === id;
  const currentScope = () => {
    const state = useChatStore.getState();
    return ownsWorkspace && user && getAuthSnapshot().user === user && state.userId === user.id &&
      state.workspace?.id === chat.workspace?.id ? state : null;
  };
  const draft = ownsWorkspace ? chat.drafts[id] || "" : "";
  const setDraft = (value: string) => { const state = currentScope(); if (state?.channels.some(c => c.id === id)) state.setDraft(id, value); };
  const list = useRef<FlatList<ChatMessage>>(null);
  const channel = ownsWorkspace ? chat.channels.find(c => c.id === id) : undefined;
  const messages = ownsWorkspace ? chat.messages[id] || [] : [];
  const atBottom = useRef(true);
  const initialScroll = useRef(true);
  useEffect(() => { atBottom.current = true; initialScroll.current = true; setSearchScope(null); setSearchText(""); setSearchResult({ messages: [], hasMore: false }); }, [user, id, tenantId, chat.workspace?.id]);
  const canCompose = Boolean(ownsWorkspace && channel);
  const actionIsCurrent = (action: SendAction | null) => !!action && action.owner === user && action.workspaceId === chat.workspace?.id && action.roomId === id;
  const sending = actionIsCurrent(sendingAction);
  useEffect(() => {
    let current = true;
    setSearchResult({ messages: [], hasMore: false }); setSearchError(null);
    if (!searching || searchText.trim().length < 2 || !canCompose) { setSearchLoading(false); return; }
    setSearchLoading(true);
    const timer = setTimeout(() => {
      if (!currentScope()) return;
      void chat.searchMessages(id, searchText.trim()).then(result => { if (current && currentScope()) setSearchResult(result); })
        .catch(error => { if (current && currentScope()) setSearchError(chatError(error)); }).finally(() => { if (current && currentScope()) setSearchLoading(false); });
    }, 350);
    return () => { current = false; clearTimeout(timer); };
  }, [searching, searchText, id, user, chat.workspace?.id, canCompose]);
  useFocusEffect(useCallback(() => {
    chat.setUser(user?.id ?? null);
    if (!user || !id || (params.tenantId && (!Number.isSafeInteger(tenantId) || tenantId <= 0))) return;
    let mounted = true;
    const refresh = async () => {
      if (!mounted || getAuthSnapshot().user !== user || AppState.currentState !== "active") return;
      const state = useChatStore.getState();
      if (!state.workspace || !state.channels.some(c => c.id === id) || (Number.isSafeInteger(tenantId) && tenantId > 0 && state.workspace.id !== tenantId))
        await state.loadChannels(Number.isSafeInteger(tenantId) && tenantId > 0 ? tenantId : undefined);
      if (!mounted || getAuthSnapshot().user !== user || useChatStore.getState().userId !== user.id) return;
      if (params.tenantId && useChatStore.getState().workspace?.id !== tenantId) return;
      await useChatStore.getState().loadMessages(id);
      if (mounted && getAuthSnapshot().user === user && AppState.currentState === "active" && atBottom.current && !searching) await useChatStore.getState().markAsRead(id);
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    const subscription = AppState.addEventListener("change", state => { if (state === "active") void refresh(); });
    return () => { mounted = false; clearInterval(interval); subscription.remove(); };
  }, [user, id, tenantId, searching]));
  const send = async () => {
    const state = currentScope(), content = state?.drafts[id]?.trim();
    if (actionIsCurrent(sendingRef.current) || !state?.workspace || !state.channels.some(c => c.id === id) || !content || content.length > 4000) return;
    atBottom.current = true;
    const action = { owner: user, workspaceId: state.workspace.id, roomId: id };
    sendingRef.current = action; setSendingAction(action);
    try { await state.sendMessage(id, content); }
    finally { if (sendingRef.current === action) { sendingRef.current = null; setSendingAction(null); } }
  };
  const reload = async () => {
    if (!user || getAuthSnapshot().user !== user || (params.tenantId && (!Number.isSafeInteger(tenantId) || tenantId <= 0))) return;
    await useChatStore.getState().loadChannels(params.tenantId ? tenantId : chat.workspace?.id);
    if (getAuthSnapshot().user === user && (!params.tenantId || useChatStore.getState().workspace?.id === tenantId)) await useChatStore.getState().loadMessages(id);
  };
  return <ScreenContainer>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to conversations" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/teamchat")} style={styles.back}><Text style={{ color: colors.primary, fontSize: 18 }}>‹ Back</Text></Pressable>
      <View style={{ flex: 1 }}><Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>{channel?.name || "Conversation"}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{channel ? `${channel.memberIds.length} members · ${chat.workspace?.name}` : "Loading your workspace"}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={searching ? "Close message search" : "Search messages"} disabled={!canCompose} onPress={() => {
        const state = currentScope(); if (!state?.workspace) return;
        setSearchText(""); setSearchResult({ messages: [], hasMore: false });
        setSearchScope(searching ? null : { owner: user, workspaceId: state.workspace.id, roomId: id });
      }} style={{ padding: 8 }}><Text style={{ color: colors.primary }}>{searching ? "Close" : "Search"}</Text></Pressable>
    </View>
    {searching && <View style={{ padding: 12, gap: 6 }}><TextInput accessibilityLabel="Search saved messages" value={searchText} onChangeText={setSearchText} maxLength={100} autoFocus placeholder="Search saved messages in this chat" placeholderTextColor={colors.muted} style={[styles.input, { flex: 0, backgroundColor: colors.surface, color: colors.foreground }]} />
      <Text style={{ color: colors.muted, fontSize: 12 }}>{searchResult.hasMore ? "Showing the latest 50 matches. Narrow your search for older results." : "Search saved messages with at least two characters."}</Text></View>}
    {!user ? <View style={styles.empty}><Text style={{ color: colors.foreground }}>Sign in again to open this conversation.</Text></View> : <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
      {(chat.error || chat.roomErrors[id] || chat.storageError) && <Pressable accessibilityRole="button" onPress={reload} style={styles.notice}><Text style={{ color: colors.error }}>{chat.storageError || chat.roomErrors[id] || chat.error} Tap to retry.</Text></Pressable>}
      <FlatList ref={list} data={searching ? canCompose ? searchResult.messages : [] : messages} keyExtractor={item => `${item.senderId}:${item.clientId}`} contentContainerStyle={styles.messages}
        onScroll={event => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          const wasAtBottom = atBottom.current;
          atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 60;
          if (!searching && !wasAtBottom && atBottom.current) void currentScope()?.markAsRead(id);
        }} scrollEventThrottle={150}
        onContentSizeChange={() => { if (!searching && (initialScroll.current || atBottom.current) && messages.length) { list.current?.scrollToEnd({ animated: !initialScroll.current }); initialScroll.current = false; } }}
        ListHeaderComponent={!searching && canCompose && chat.hasMore[id] ? <Pressable accessibilityRole="button" disabled={chat.roomLoading[id]} onPress={() => { atBottom.current = false; void currentScope()?.loadMessages(id, true); }} style={styles.older}><Text style={{ color: colors.primary }}>{chat.roomLoading[id] ? "Loading…" : "Load earlier messages"}</Text></Pressable> : null}
        renderItem={({ item }) => {
          const own = item.senderId === user.id;
          return <View style={[styles.message, own ? { alignSelf: "flex-end" } : { alignSelf: "flex-start" }]}>
            {!own && <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>{item.senderName}</Text>}
            <View style={[styles.bubble, { backgroundColor: own ? colors.primary : colors.surface }]}><Text selectable style={{ color: own ? "white" : colors.foreground, fontSize: 16, lineHeight: 23 }}>{item.content}</Text></View>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4, textAlign: own ? "right" : "left" }}>{formatChatTime(item.timestamp)}{own ? ` · ${item.status === "sending" ? "Sending…" : item.status === "failed" ? "Not sent" : "Sent"}` : ""}</Text>
            {own && item.status === "failed" && <Pressable accessibilityRole="button" accessibilityLabel="Retry sending message" disabled={!canCompose} onPress={() => { const state = currentScope(); if (state?.channels.some(c => c.id === id)) void state.retryMessage(id, item.clientId); }} style={styles.retry}><Text style={{ color: colors.error, fontWeight: "600" }}>Retry</Text></Pressable>}
          </View>;
        }}
        ListEmptyComponent={<View style={styles.empty}>{searching ? searchLoading ? <ActivityIndicator color={colors.primary} /> : <Text style={{ color: searchError ? colors.error : colors.muted }}>{searchError || (searchText.trim().length < 2 ? "Enter a word or phrase to search this conversation." : "No saved messages match your search.")}</Text> : chat.roomLoading[id] || chat.loading ? <ActivityIndicator color={colors.primary} /> : <><Text style={[styles.emptyTitle, { color: colors.foreground }]}>{channel ? "Start the conversation" : "Conversation unavailable"}</Text><Text style={{ color: colors.muted, textAlign: "center" }}>{channel ? "Messages are saved to your workspace when sent." : "Refresh Team Chat to check your access."}</Text></>}</View>} />
      {!searching && <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TextInput accessibilityLabel="Message" value={draft} onChangeText={setDraft} editable={canCompose} multiline maxLength={4000} placeholder={canCompose ? "Message" : "Connect to chat to send"} placeholderTextColor={colors.muted} style={[styles.input, { color: colors.foreground, backgroundColor: colors.surface }]} />
        <Pressable accessibilityRole="button" accessibilityLabel="Send message" disabled={sending || !canCompose || !draft.trim()} onPress={send} style={[styles.send, { backgroundColor: colors.primary, opacity: !sending && canCompose && draft.trim() ? 1 : 0.4 }]}><Text style={{ color: "white", fontWeight: "700" }}>{sending ? "Sending…" : "Send"}</Text></Pressable>
      </View>}
    </KeyboardAvoidingView>}
  </ScreenContainer>;
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingRight: 18, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  back: { padding: 14 }, title: { fontSize: 18, fontWeight: "700", marginBottom: 3 },
  messages: { padding: 16, flexGrow: 1 }, message: { maxWidth: "85%", marginBottom: 16 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 }, retry: { paddingVertical: 8, alignSelf: "flex-end" },
  notice: { padding: 12 }, older: { padding: 12, alignItems: "center" },
  empty: { padding: 30, flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }, emptyTitle: { fontSize: 20, fontWeight: "600" },
  composer: { flexDirection: "row", gap: 10, padding: 12, alignItems: "flex-end", borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 44, maxHeight: 140, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, fontSize: 16 },
  send: { minHeight: 44, justifyContent: "center", borderRadius: 14, paddingHorizontal: 16 },
});
