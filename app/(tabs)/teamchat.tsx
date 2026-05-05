import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
} from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useChatStore } from "@/lib/chat/store";
import { type ChatChannel, getLastMessagePreview, formatChatTime } from "@/lib/chat/types";
import { getPresenceColor } from "@/lib/presence/store";
import type { PresenceStatus } from "@/lib/presence/engine";

// Simulated presence for DM contacts
const DM_PRESENCE: Record<string, PresenceStatus> = {
  "dm-sarah": "online",
  "dm-james": "busy",
  "dm-alex": "away",
  "grp-leadership": "online",
};

type FilterType = "all" | "channels" | "direct" | "unread";

export default function TeamChatScreen() {
  const colors = useColors();
  const { channels, loadChannels, filter, setFilter, searchQuery, setSearchQuery } = useChatStore();
  const [myStatus, setMyStatus] = useState<PresenceStatus>("online");

  useEffect(() => {
    loadChannels();
  }, []);

  const filteredChannels = channels
    .filter((ch) => {
      if (filter === "channels") return ch.type === "channel";
      if (filter === "direct") return ch.type === "direct" || ch.type === "group";
      if (filter === "unread") return ch.unreadCount > 0;
      return true;
    })
    .filter((ch) => {
      if (!searchQuery) return true;
      return ch.name.toLowerCase().includes(searchQuery.toLowerCase());
    })
    .sort((a, b) => {
      // Pinned first, then by last message time
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.lastMessageAt - a.lastMessageAt;
    });

  const totalUnread = channels.reduce((sum, ch) => sum + ch.unreadCount, 0);

  const handleStatusPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const statuses: { label: string; value: PresenceStatus }[] = [
      { label: "🟢 Online", value: "online" },
      { label: "🔴 Busy", value: "busy" },
      { label: "🟡 Away", value: "away" },
      { label: "⛔ Do Not Disturb", value: "dnd" },
    ];
    Alert.alert(
      "Set Status",
      "Choose your presence status",
      statuses.map((s) => ({
        text: s.label,
        onPress: () => setMyStatus(s.value),
      }))
    );
  }, []);

  const handleChannelPress = useCallback((channel: ChatChannel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/chat/${channel.id}` as any);
  }, []);

  const handleNewChat = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("New Conversation", "Choose type", [
      { text: "New Channel", onPress: () => {} },
      { text: "Direct Message", onPress: () => {} },
      { text: "Group Chat", onPress: () => {} },
      { text: "Cancel", style: "cancel" },
    ]);
  }, []);

  const FilterChip = ({ label, value }: { label: string; value: FilterType }) => (
    <TouchableOpacity
      style={[
        styles.filterChip,
        {
          backgroundColor: filter === value ? colors.primary : colors.surface,
          borderColor: filter === value ? colors.primary : colors.border,
        },
      ]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setFilter(value);
      }}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.filterChipText,
          { color: filter === value ? "#fff" : colors.muted },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderChannel = ({ item }: { item: ChatChannel }) => {
    const isDM = item.type === "direct";
    const isGroup = item.type === "group";
    const presence = isDM ? DM_PRESENCE[item.id] : undefined;
    const presenceColor = presence ? getPresenceColor(presence) : undefined;
    const preview = getLastMessagePreview(item.id);
    const timeStr = formatChatTime(item.lastMessageAt);

    return (
      <TouchableOpacity
        style={[styles.channelRow, { borderBottomColor: colors.border }]}
        onPress={() => handleChannelPress(item)}
        activeOpacity={0.7}
      >
        {/* Avatar */}
        <View style={styles.avatarContainer}>
          <View
            style={[
              styles.avatar,
              {
                backgroundColor: isDM
                  ? colors.primary + "20"
                  : isGroup
                  ? "#8B5CF620"
                  : colors.primary + "15",
              },
            ]}
          >
            {isDM ? (
              <Text style={[styles.avatarText, { color: colors.primary }]}>
                {item.name.charAt(0)}
              </Text>
            ) : isGroup ? (
              <IconSymbol name="person.3.fill" size={18} color="#8B5CF6" />
            ) : (
              <Text style={[styles.channelHash, { color: colors.primary }]}>#</Text>
            )}
          </View>
          {/* Presence dot for DMs */}
          {presenceColor && (
            <View style={[styles.presenceDot, { backgroundColor: presenceColor, borderColor: colors.surface }]} />
          )}
        </View>

        {/* Content */}
        <View style={styles.channelContent}>
          <View style={styles.channelHeader}>
            <View style={styles.channelNameRow}>
              {item.pinned && (
                <IconSymbol name="pin.fill" size={12} color={colors.muted} style={{ marginRight: 4 }} />
              )}
              {item.muted && (
                <IconSymbol name="speaker.slash.fill" size={12} color={colors.muted} style={{ marginRight: 4 }} />
              )}
              <Text
                style={[
                  styles.channelName,
                  { color: colors.foreground },
                  item.unreadCount > 0 && styles.channelNameBold,
                ]}
                numberOfLines={1}
              >
                {isDM ? item.name : `# ${item.name}`}
              </Text>
            </View>
            <Text style={[styles.channelTime, { color: item.unreadCount > 0 ? colors.primary : colors.muted }]}>
              {timeStr}
            </Text>
          </View>
          <View style={styles.channelPreviewRow}>
            <Text
              style={[
                styles.channelPreview,
                { color: colors.muted },
                item.unreadCount > 0 && { color: colors.foreground },
              ]}
              numberOfLines={1}
            >
              {preview}
            </Text>
            {item.unreadCount > 0 && (
              <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.unreadText}>
                  {item.unreadCount > 99 ? "99+" : item.unreadCount}
                </Text>
              </View>
            )}
          </View>
          {item.type === "channel" && item.topic && (
            <Text style={[styles.channelTopic, { color: colors.muted }]} numberOfLines={1}>
              {item.topic}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Text style={[styles.title, { color: colors.foreground }]}>Team Chat</Text>
          {totalUnread > 0 && (
            <View style={[styles.headerBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.headerBadgeText}>{totalUnread}</Text>
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          {/* My Status */}
          <TouchableOpacity
            style={[styles.statusButton, { backgroundColor: getPresenceColor(myStatus) + "20" }]}
            onPress={handleStatusPress}
            activeOpacity={0.7}
          >
            <View style={[styles.statusIndicator, { backgroundColor: getPresenceColor(myStatus) }]} />
            <Text style={[styles.statusLabel, { color: getPresenceColor(myStatus) }]}>
              {myStatus === "online" ? "Online" : myStatus === "busy" ? "Busy" : myStatus === "away" ? "Away" : "DND"}
            </Text>
          </TouchableOpacity>
          {/* New Chat */}
          <TouchableOpacity
            style={[styles.newChatButton, { backgroundColor: colors.primary }]}
            onPress={handleNewChat}
            activeOpacity={0.7}
          >
            <IconSymbol name="plus" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search */}
      <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <IconSymbol name="magnifyingglass" size={16} color={colors.muted} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Search conversations..."
          placeholderTextColor={colors.muted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery("")}>
            <IconSymbol name="xmark.circle.fill" size={16} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter Chips */}
      <View style={styles.filterRow}>
        <FilterChip label="All" value="all" />
        <FilterChip label="Channels" value="channels" />
        <FilterChip label="Direct" value="direct" />
        <FilterChip label="Unread" value="unread" />
      </View>

      {/* Channel List */}
      <FlatList
        data={filteredChannels}
        keyExtractor={(item) => item.id}
        renderItem={renderChannel}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20 }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <IconSymbol name="bubble.left.and.bubble.right.fill" size={48} color={colors.muted} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No conversations</Text>
            <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
              {filter === "unread" ? "All caught up!" : "Start a new conversation"}
            </Text>
          </View>
        }
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 22, fontWeight: "700" },
  headerBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  headerBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  statusIndicator: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, fontWeight: "600" },
  newChatButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15 },
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  filterChipText: { fontSize: 13, fontWeight: "600" },
  channelRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  avatarContainer: { position: "relative" },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 20, fontWeight: "700" },
  channelHash: { fontSize: 22, fontWeight: "700" },
  presenceDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  channelContent: { flex: 1, justifyContent: "center" },
  channelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  channelNameRow: { flexDirection: "row", alignItems: "center", flex: 1, marginRight: 8 },
  channelName: { fontSize: 15, fontWeight: "500" },
  channelNameBold: { fontWeight: "700" },
  channelTime: { fontSize: 12 },
  channelPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 3,
  },
  channelPreview: { fontSize: 13, flex: 1, marginRight: 8 },
  channelTopic: { fontSize: 11, marginTop: 2, fontStyle: "italic" },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  unreadText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  emptyState: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "600" },
  emptySubtitle: { fontSize: 14 },
});
