import { MeetAction } from "@/components/meet-action";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { useChatStore } from "@/lib/chat/store";
import { chatError } from "@/lib/chat/state";
import { formatChatTime, type ChatKind } from "@/lib/chat/types";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PresenceIndicator } from "@/components/chat/presence-indicator";
import { usePresencePolling } from "@/lib/chat/presence-store";
import { NotificationEnrollmentPrompt } from "@/components/chat/notification-enrollment-prompt";

type Filter = "all" | "unread" | "chats" | "group" | "channel" | "drafts";
type ScopedAction = { owner: ReturnType<typeof useAuth>["user"]; workspaceId: number };

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join("").toUpperCase() || "?";

export default function TeamChatScreen() {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const chat = useChatStore();
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [peopleSearch, setPeopleSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [kind, setKind] = useState<ChatKind>("direct");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [composerScope, setComposerScope] = useState<ScopedAction | null>(null);
  const [creatingAction, setCreatingAction] = useState<ScopedAction | null>(null);
  const creatingRef = useRef<ScopedAction | null>(null);
  const directoryRef = useRef<ScopedAction | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const ownsWorkspace = Boolean(user && chat.userId === user.id && chat.workspace);
  const actionIsCurrent = (action: ScopedAction | null) => !!action && action.owner === user && action.workspaceId === chat.workspace?.id;
  const creating = actionIsCurrent(creatingAction);
  const currentScope = () => {
    const state = useChatStore.getState();
    return ownsWorkspace && user && getAuthSnapshot().user === user && state.userId === user.id && state.workspace?.id === chat.workspace?.id ? state : null;
  };

  useEffect(() => {
    setComposing(false); setSelected([]); setName(""); setSearch(""); setSearchOpen(false); setMoreFiltersOpen(false);
    setCreateError(null); setDirectoryLoading(false);
  }, [user, chat.workspace?.id]);

  useFocusEffect(useCallback(() => {
    useChatStore.getState().setUser(user?.id ?? null);
    if (!user) return;
    const refresh = () => { if (getAuthSnapshot().user === user && AppState.currentState === "active") void useChatStore.getState().loadChannels(); };
    refresh();
  }, [user]));

  const refreshDirectory = async () => {
    const state = currentScope(); if (!state?.workspace) return;
    const action = { owner: user, workspaceId: state.workspace.id }; directoryRef.current = action;
    setCreateError(null); setDirectoryLoading(true);
    try { await state.loadDirectory(); }
    catch (error) { if (directoryRef.current === action && currentScope()) setCreateError(chatError(error)); }
    finally { if (directoryRef.current === action && currentScope()) setDirectoryLoading(false); }
  };

  const openComposer = () => {
    const state = currentScope(); if (!state?.workspace) return;
    setComposerScope({ owner: user, workspaceId: state.workspace.id });
    setComposing(true); setPeopleSearch(""); setSelected([]); setName(""); setKind("direct"); setCreateError(null); void refreshDirectory();
  };

  const toggleSearch = () => {
    if (searchOpen) setSearch("");
    setSearchOpen(open => !open);
  };

  const create = async (conversationKind: ChatKind, conversationName: string, memberIds: number[]) => {
    const state = currentScope();
    if (!state?.workspace || actionIsCurrent(creatingRef.current) || directoryLoading || memberIds.length === 0 || (conversationKind !== "direct" && !conversationName.trim())) return;
    const action = { owner: user, workspaceId: state.workspace.id }; creatingRef.current = action;
    setCreatingAction(action); setCreateError(null);
    try {
      const id = await state.createConversation(conversationKind, conversationKind === "direct" ? "Direct message" : conversationName.trim(), memberIds);
      if (!currentScope() || creatingRef.current !== action) return;
      setComposing(false);
      router.push({ pathname: "/chat/[id]", params: { id, tenantId: String(action.workspaceId) } });
    } catch (error) {
      if (currentScope() && creatingRef.current === action) setCreateError(chatError(error));
    } finally {
      if (creatingRef.current === action) { creatingRef.current = null; setCreatingAction(null); }
    }
  };

  const selectPerson = (personId: number) => {
    if (kind === "direct") {
      setSelected([personId]);
      void create("direct", "Direct message", [personId]);
      return;
    }
    if (currentScope()) setSelected(previous => previous.includes(personId) ? previous.filter(id => id !== personId) : previous.length < 49 ? [...previous, personId] : previous);
  };

  const rows = (ownsWorkspace ? chat.channels : []).filter(channel => {
    const matchesSearch = channel.name.toLowerCase().includes(search.trim().toLowerCase());
    const matchesFilter = filter === "all" || (filter === "unread" ? channel.unreadCount > 0 : filter === "drafts" ? Boolean(chat.drafts[channel.id]?.trim()) : filter === "chats" ? channel.kind === "direct" || channel.kind === "group" : channel.kind === filter);
    return matchesSearch && matchesFilter;
  });
  const fg = { color: colors.foreground };
  const composerVisible = composing && ownsWorkspace && actionIsCurrent(composerScope);
  const visiblePeople = ownsWorkspace ? chat.people.filter(person => `${person.name} ${person.extension || ""}`.toLowerCase().includes(peopleSearch.trim().toLowerCase())) : [];
  const moreSelection = filter === "group" ? "Groups" : filter === "drafts" ? "Drafts" : null;
  const presenceIds = [...new Set([
    ...chat.people.map(person => person.id),
    ...chat.channels.flatMap(channel => channel.kind === "direct" ? channel.memberIds.filter(id => id !== user?.id) : []),
  ])];
  usePresencePolling(chat.workspace?.id, presenceIds, ownsWorkspace);

  return <ScreenContainer>
    <View style={styles.content}>
      <View style={styles.header}>
        <View style={[styles.identity, { backgroundColor: colors.primary + "16" }]}><Text style={[styles.identityText, { color: colors.primary }]}>TC</Text></View>
        <View style={styles.titleBlock}><Text numberOfLines={1} style={[styles.title, fg]}>Team Chat</Text><Text numberOfLines={1} style={[styles.workspaceName, { color: colors.muted }]}>{ownsWorkspace ? chat.workspace?.name : "Your work conversations"}</Text></View>
        <MeetAction />
        <Pressable accessibilityRole="button" accessibilityLabel="Search conversations" accessibilityState={{ expanded: searchOpen }} onPress={toggleSearch} style={styles.iconButton}>
          <IconSymbol name="magnifyingglass" size={23} color={colors.foreground} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="New message" disabled={!ownsWorkspace} onPress={openComposer} style={styles.iconButton}>
          <IconSymbol name="plus" size={24} color={colors.primary} style={{ opacity: ownsWorkspace ? 1 : 0.4 }} />
        </Pressable>
      </View>
      {!user ? <View style={styles.empty}><Text style={[styles.emptyTitle, fg]}>Sign in to use Team Chat</Text><Text style={{ color: colors.muted }}>Your conversations are shared with your workspace.</Text></View> : <>
        {ownsWorkspace && chat.workspaces.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.workspaceStrip} contentContainerStyle={styles.filters}>{chat.workspaces.map(workspace => <Pressable key={workspace.id} accessibilityRole="button" accessibilityLabel={`Switch to ${workspace.name}`} onPress={() => currentScope()?.loadChannels(workspace.id)} style={[styles.chip, { borderColor: colors.border, backgroundColor: workspace.id === chat.workspace?.id ? colors.primary : colors.surface }]}><Text style={{ color: workspace.id === chat.workspace?.id ? "white" : colors.foreground }}>{workspace.name}</Text></Pressable>)}</ScrollView>}
        <NotificationEnrollmentPrompt ownerId={user?.id} tenantId={chat.workspace?.id} />
        {searchOpen && <TextInput autoFocus accessibilityLabel="Search conversations" value={search} onChangeText={setSearch} placeholder="Search conversations" placeholderTextColor={colors.muted} style={[styles.search, fg, { backgroundColor: colors.surface, borderColor: colors.border }]} />}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterStrip} contentContainerStyle={styles.filters}>
          {([ ["all", "All"], ["unread", "Unread"], ["chats", "Chats"], ["channel", "Channels"] ] as [Filter, string][]).map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${label} conversations`} accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)} style={[styles.chip, { borderColor: colors.border, backgroundColor: filter === value ? colors.primary : colors.surface }]}><Text style={{ color: filter === value ? "white" : colors.foreground, fontSize: 14 }}>{label}</Text></Pressable>)}
          <Pressable accessibilityRole="button" accessibilityLabel={`More filters${moreSelection ? `, ${moreSelection} selected` : ""}`} accessibilityState={{ expanded: moreFiltersOpen, selected: Boolean(moreSelection) }} onPress={() => setMoreFiltersOpen(open => !open)} style={[styles.moreFilter, { backgroundColor: moreSelection ? colors.primary + "12" : "transparent" }]}><Text style={{ color: moreSelection ? colors.primary : colors.muted, fontSize: 14, fontWeight: "600" }}>{moreSelection || "More"}</Text></Pressable>
        </ScrollView>
        {moreFiltersOpen && <View style={[styles.moreMenu, { backgroundColor: colors.surface, borderColor: colors.border }]}>{([ ["group", "Groups"], ["drafts", "Drafts"] ] as [Filter, string][]).map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${label} conversations`} accessibilityState={{ selected: filter === value }} onPress={() => { setFilter(value); setMoreFiltersOpen(false); }} style={styles.menuItem}><Text style={{ color: colors.foreground }}>{label}</Text></Pressable>)}</View>}
        {(chat.error || chat.storageError) && <Pressable accessibilityRole="button" accessibilityLabel="Retry Team Chat" onPress={() => chat.loadChannels()} style={styles.error}><Text style={{ color: colors.error }}>{chat.storageError || chat.error} Tap to retry.</Text></Pressable>}
        <FlatList data={rows} keyExtractor={item => item.id} refreshing={chat.loading} onRefresh={() => chat.loadChannels()} contentContainerStyle={rows.length === 0 ? styles.listEmpty : undefined} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} onPress={() => { const state = currentScope(); if (state?.channels.some(channel => channel.id === item.id)) router.push({ pathname: "/chat/[id]", params: { id: item.id, tenantId: String(state.workspace?.id) } }); }} style={[styles.row, { borderBottomColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.primary + "18" }]}><Text style={[styles.avatarText, { color: colors.primary }]}>{item.kind === "channel" ? "#" : initials(item.name)}</Text></View>
          <View style={styles.rowBody}><View style={styles.rowHeading}><Text numberOfLines={1} style={[styles.rowName, fg, item.unreadCount > 0 && { fontWeight: "700" }]}>{item.name}</Text><Text style={[styles.rowTime, { color: colors.muted }]}>{formatChatTime(item.lastMessageAt)}</Text></View>{item.kind === "direct" && <PresenceIndicator tenantId={chat.workspace?.id} userId={item.memberIds.find(id => id !== user?.id)} />}<Text numberOfLines={1} style={[styles.preview, { color: chat.drafts[item.id]?.trim() ? colors.error : colors.muted }]}>{chat.drafts[item.id]?.trim() ? `Draft: ${chat.drafts[item.id]}` : item.lastMessage || "No messages yet"}</Text></View>
          {item.unreadCount > 0 && <View style={[styles.badge, { backgroundColor: colors.primary }]}><Text style={styles.buttonText}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text></View>}
        </Pressable>} ListEmptyComponent={<View style={styles.empty}>{chat.loading ? <ActivityIndicator color={colors.primary} /> : <><Text style={[styles.emptyTitle, fg]}>{chat.error ? "Chat is unavailable" : search || filter !== "all" ? "No matching conversations" : "Start a conversation"}</Text><Text style={{ color: colors.muted, textAlign: "center" }}>{chat.error ? "Your messages will appear when the connection is restored." : "Choose New message to message someone in your workspace."}</Text></>}</View>} />
      </>}
    </View>
    <Modal visible={composerVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => !creating && setComposing(false)}>
      <ScreenContainer edges={["top", "left", "right", "bottom"]}><KeyboardAvoidingView behavior="padding" style={styles.keyboardSheet}><View style={styles.sheet}>
        <View style={styles.sheetHeader}><Pressable accessibilityRole="button" accessibilityLabel="Cancel new message" disabled={creating} onPress={() => setComposing(false)} style={styles.sheetCancel}><Text style={{ color: colors.primary }}>Cancel</Text></Pressable><Text style={[styles.sheetTitle, fg]}>New message</Text><View style={styles.headerSpacer} /></View>
        <View style={styles.composerOptions}>
          <Pressable accessibilityRole="button" accessibilityLabel="New message" accessibilityState={{ selected: kind === "direct" }} disabled={creating} onPress={() => { setKind("direct"); setSelected([]); }} style={[styles.modeButton, { borderColor: colors.border, backgroundColor: kind === "direct" ? colors.primary : colors.surface }]}><Text style={{ color: kind === "direct" ? "white" : colors.foreground }}>Message</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="New group" accessibilityState={{ selected: kind === "group" }} disabled={creating} onPress={() => { setKind("group"); setSelected([]); }} style={[styles.modeButton, { borderColor: colors.border, backgroundColor: kind === "group" ? colors.primary : colors.surface }]}><Text style={{ color: kind === "group" ? "white" : colors.foreground }}>Group</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="New channel" accessibilityState={{ selected: kind === "channel" }} disabled={creating} onPress={() => { setKind("channel"); setSelected([]); }} style={[styles.modeButton, { borderColor: colors.border, backgroundColor: kind === "channel" ? colors.primary : colors.surface }]}><Text style={{ color: kind === "channel" ? "white" : colors.foreground }}>Channel</Text></Pressable>
        </View>
        {kind !== "direct" && <TextInput accessibilityLabel="Conversation name" value={name} onChangeText={setName} maxLength={100} placeholder={kind === "group" ? "Group name" : "Channel name"} placeholderTextColor={colors.muted} style={[styles.search, fg, { backgroundColor: colors.surface, borderColor: colors.border }]} />}
        <View style={styles.helperRow}>{creating && <ActivityIndicator color={colors.primary} size="small" />}<Text accessibilityLiveRegion="polite" style={[styles.helper, { color: colors.muted }]}>{creating ? "Opening private message…" : kind === "direct" ? "Choose a teammate to open a private message." : `Choose members for this private ${kind}.`}</Text></View>
        {createError && <Pressable accessibilityRole="button" accessibilityLabel="Refresh teammates" onPress={refreshDirectory} style={styles.error}><Text style={{ color: colors.error }}>{createError} Tap to refresh teammates; your selection and name are kept.</Text></Pressable>}
        {directoryLoading && <ActivityIndicator color={colors.primary} />}
        <TextInput accessibilityLabel="Search teammates" value={peopleSearch} onChangeText={setPeopleSearch} placeholder="Search name or extension" placeholderTextColor={colors.muted} style={[styles.search, fg, { backgroundColor: colors.surface, borderColor: colors.border }]} />
        <FlatList style={styles.peopleList} data={visiblePeople} keyExtractor={person => String(person.id)} keyboardShouldPersistTaps="handled" renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Select teammate ${item.name}`} disabled={creating || directoryLoading} onPress={() => selectPerson(item.id)} style={[styles.personRow, { borderBottomColor: colors.border }]}>
          <View style={[styles.personAvatar, { backgroundColor: colors.primary + "18" }]}><Text style={[styles.avatarText, { color: colors.primary }]}>{initials(item.name)}</Text></View><View style={styles.personText}><Text numberOfLines={1} style={fg}>{item.name}</Text><PresenceIndicator tenantId={chat.workspace?.id} userId={item.id} />{item.extension ? <Text style={{ color: colors.muted, fontSize: 13 }}>Ext. {item.extension}</Text> : null}</View>{kind !== "direct" && <Text style={{ color: colors.primary }}>{selected.includes(item.id) ? "Selected ✓" : "Select"}</Text>}
        </Pressable>} ListEmptyComponent={!directoryLoading ? <Text style={{ color: colors.muted, padding: 20 }}>{peopleSearch.trim() ? "No teammates match your search." : "No other teammates are available. Your administrator must add another active workspace member."}</Text> : null} />
        {kind !== "direct" && <Pressable accessibilityRole="button" accessibilityLabel="Create" disabled={creating || directoryLoading || selected.length === 0 || !name.trim()} onPress={() => void create(kind, name, selected)} style={[styles.createButton, { backgroundColor: colors.primary, opacity: selected.length && name.trim() && !creating ? 1 : 0.4 }]}><Text style={styles.buttonText}>{creating ? "Creating…" : "Create"}</Text></Pressable>}
      </View></KeyboardAvoidingView></ScreenContainer>
    </Modal>
  </ScreenContainer>;
}

const styles = StyleSheet.create({
  content: { flex: 1, width: "100%", maxWidth: 720, alignSelf: "center" },
  header: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 6 },
  identity: { width: 32, height: 32, borderRadius: 11, alignItems: "center", justifyContent: "center" }, identityText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.2 },
  titleBlock: { flex: 1, minWidth: 0 }, title: { fontSize: 19, lineHeight: 23, fontWeight: "700", letterSpacing: -0.25, marginBottom: 0 }, workspaceName: { fontSize: 12, lineHeight: 15 },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }, headerSpacer: { width: 58 }, sheetCancel: { minWidth: 58, minHeight: 44, justifyContent: "center" },
  workspaceStrip: { maxHeight: 44 }, filterStrip: { maxHeight: 50 }, filters: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 6, alignItems: "center" },
  chip: { minHeight: 34, justifyContent: "center", borderWidth: 1, borderRadius: 17, paddingVertical: 6, paddingHorizontal: 13 }, moreFilter: { minHeight: 34, justifyContent: "center", borderRadius: 17, paddingHorizontal: 10 },
  search: { marginHorizontal: 16, marginVertical: 6, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 16 },
  moreMenu: { marginHorizontal: 16, borderWidth: 1, borderRadius: 10, overflow: "hidden", alignSelf: "flex-start", minWidth: 130 }, menuItem: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  rowBody: { flex: 1, minWidth: 0, gap: 3 }, rowHeading: { flexDirection: "row", alignItems: "center", gap: 8 }, rowName: { flex: 1, fontSize: 17, lineHeight: 21 }, rowTime: { fontSize: 12, lineHeight: 16 }, preview: { fontSize: 14.5, lineHeight: 18 },
  avatar: { width: 46, height: 46, borderRadius: 16, justifyContent: "center", alignItems: "center" }, avatarText: { fontSize: 16, fontWeight: "700" },
  badge: { borderRadius: 12, paddingHorizontal: 7, paddingVertical: 3 }, buttonText: { color: "white", fontWeight: "600" },
  empty: { padding: 28, paddingTop: 70, alignItems: "center", gap: 10 }, listEmpty: { flexGrow: 1 }, emptyTitle: { fontSize: 19, fontWeight: "600" }, error: { padding: 16 },
  keyboardSheet: { flex: 1 }, sheet: { flex: 1, width: "100%", maxWidth: 720, alignSelf: "center" }, peopleList: { flex: 1, minHeight: 0 }, sheetHeader: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, sheetTitle: { fontSize: 18, fontWeight: "700" },
  composerOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingBottom: 8 }, modeButton: { flexGrow: 1, flexShrink: 1, minWidth: 80, minHeight: 44, justifyContent: "center", borderWidth: 1, borderRadius: 18, paddingHorizontal: 12 }, helperRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }, helper: { flex: 1, paddingHorizontal: 20, paddingVertical: 8 },
  personRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth }, personAvatar: { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" }, personText: { flex: 1, minWidth: 0, gap: 2 },
  createButton: { margin: 16, minHeight: 46, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
