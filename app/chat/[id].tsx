import { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useChatStore } from "@/lib/chat/store";
import { type ChatMessage, formatChatTime } from "@/lib/chat/types";
import { getPresenceColor } from "@/lib/presence/store";
import type { PresenceStatus } from "@/lib/presence/engine";

// Simulated presence for DM contacts
const CONTACT_PRESENCE: Record<string, PresenceStatus> = {
  "dm-sarah": "online",
  "dm-james": "busy",
  "dm-alex": "away",
};

export default function ChatRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const flatListRef = useRef<FlatList>(null);
  const [inputText, setInputText] = useState("");
  const [showActions, setShowActions] = useState(false);

  const {
    channels,
    messages,
    loadMessages,
    sendMessage,
    markAsRead,
    addReaction,
    setActiveChannel,
  } = useChatStore();

  const channel = channels.find((ch) => ch.id === id);
  const channelMessages = messages[id || ""] || [];
  const isDM = channel?.type === "direct";
  const presence = isDM && id ? CONTACT_PRESENCE[id] : undefined;

  useEffect(() => {
    if (id) {
      loadMessages(id);
      markAsRead(id);
      setActiveChannel(id);
    }
    return () => setActiveChannel(null);
  }, [id]);

  useEffect(() => {
    // Scroll to bottom when messages change
    if (channelMessages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [channelMessages.length]);

  const handleSend = useCallback(() => {
    if (!inputText.trim() || !id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendMessage(id, inputText.trim());
    setInputText("");
  }, [inputText, id, sendMessage]);

  const handleReaction = useCallback(
    (messageId: string) => {
      if (!id) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const emojis = ["👍", "❤️", "😂", "🎉", "🔥", "✅"];
      Alert.alert(
        "React",
        "Choose a reaction",
        emojis.map((emoji) => ({
          text: emoji,
          onPress: () => addReaction(id, messageId, emoji),
        }))
      );
    },
    [id, addReaction]
  );

  const handleCallPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/call/active" as any);
  }, []);

  const handleVideoPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/call/video" as any);
  }, []);

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isMe = item.senderId === "me";
    const isSystem = item.type === "system";
    const prevMessage = index > 0 ? channelMessages[index - 1] : null;
    const showSender = !isMe && !isSystem && prevMessage?.senderId !== item.senderId;
    const showTimeDivider =
      !prevMessage || item.timestamp - prevMessage.timestamp > 600000; // 10 min gap

    const reactionEntries = Object.entries(item.reactions);

    if (isSystem) {
      return (
        <View style={styles.systemMessage}>
          <Text style={[styles.systemText, { color: colors.muted }]}>
            ⚙️ {item.content}
          </Text>
        </View>
      );
    }

    return (
      <View>
        {showTimeDivider && (
          <View style={styles.timeDivider}>
            <View style={[styles.timeLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.timeLabel, { color: colors.muted, backgroundColor: colors.background }]}>
              {new Date(item.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
            <View style={[styles.timeLine, { backgroundColor: colors.border }]} />
          </View>
        )}
        <TouchableOpacity
          style={[styles.messageRow, isMe && styles.messageRowMe]}
          onLongPress={() => handleReaction(item.id)}
          activeOpacity={0.8}
        >
          {/* Avatar for others */}
          {!isMe && showSender && (
            <View
              style={[styles.msgAvatar, { backgroundColor: colors.primary + "20" }]}
            >
              <Text style={[styles.msgAvatarText, { color: colors.primary }]}>
                {item.senderName.charAt(0)}
              </Text>
            </View>
          )}
          {!isMe && !showSender && <View style={styles.msgAvatarSpacer} />}

          <View style={[styles.messageBubbleContainer, isMe && styles.messageBubbleContainerMe]}>
            {/* Sender name */}
            {showSender && (
              <Text style={[styles.senderName, { color: colors.primary }]}>
                {item.senderName}
              </Text>
            )}

            {/* Bubble */}
            <View
              style={[
                styles.messageBubble,
                isMe
                  ? { backgroundColor: colors.primary }
                  : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
              ]}
            >
              <Text
                style={[
                  styles.messageText,
                  { color: isMe ? "#fff" : colors.foreground },
                ]}
              >
                {item.content}
              </Text>
              <View style={styles.messageFooter}>
                <Text
                  style={[
                    styles.messageTime,
                    { color: isMe ? "#ffffff80" : colors.muted },
                  ]}
                >
                  {formatChatTime(item.timestamp)}
                </Text>
                {isMe && (
                  <Text style={{ color: "#ffffff80", fontSize: 10, marginLeft: 4 }}>
                    {item.delivered ? "✓✓" : "✓"}
                  </Text>
                )}
              </View>
            </View>

            {/* Reactions */}
            {reactionEntries.length > 0 && (
              <View style={styles.reactionsRow}>
                {reactionEntries.map(([emoji, users]) => (
                  <TouchableOpacity
                    key={emoji}
                    style={[
                      styles.reactionChip,
                      {
                        backgroundColor: users.includes("me")
                          ? colors.primary + "20"
                          : colors.surface,
                        borderColor: users.includes("me") ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => {
                      if (id) addReaction(id, item.id, emoji);
                    }}
                  >
                    <Text style={styles.reactionEmoji}>{emoji}</Text>
                    <Text style={[styles.reactionCount, { color: colors.foreground }]}>
                      {users.length}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  if (!channel) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]} className="items-center justify-center">
        <Text style={{ color: colors.muted }}>Channel not found</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            style={styles.backButton}
          >
            <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <View style={styles.headerNameRow}>
              <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
                {isDM ? channel.name : `# ${channel.name}`}
              </Text>
              {presence && (
                <View
                  style={[styles.headerPresence, { backgroundColor: getPresenceColor(presence) }]}
                />
              )}
            </View>
            <Text style={[styles.headerSubtitle, { color: colors.muted }]} numberOfLines={1}>
              {isDM
                ? presence
                  ? presence === "online"
                    ? "Online"
                    : presence === "busy"
                    ? "On a call"
                    : "Away"
                  : "Offline"
                : `${channel.members.length} members`}
            </Text>
          </View>

          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleCallPress} style={styles.headerAction}>
              <IconSymbol name="phone.fill" size={20} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleVideoPress} style={styles.headerAction}>
              <IconSymbol name="video.fill" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Channel topic bar */}
        {channel.type === "channel" && channel.topic && (
          <View style={[styles.topicBar, { backgroundColor: colors.primary + "08", borderBottomColor: colors.border }]}>
            <IconSymbol name="pin.fill" size={12} color={colors.primary} />
            <Text style={[styles.topicText, { color: colors.muted }]} numberOfLines={1}>
              {channel.topic}
            </Text>
          </View>
        )}

        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={channelMessages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 8 }}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />

        {/* Input Bar */}
        <View style={[styles.inputBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={styles.inputAction}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowActions(!showActions);
            }}
          >
            <IconSymbol name="plus.circle.fill" size={26} color={colors.primary} />
          </TouchableOpacity>

          <View style={[styles.inputContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TextInput
              style={[styles.textInput, { color: colors.foreground }]}
              placeholder="Type a message..."
              placeholderTextColor={colors.muted}
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={2000}
              returnKeyType="default"
            />
          </View>

          {inputText.trim().length > 0 ? (
            <TouchableOpacity style={[styles.sendButton, { backgroundColor: colors.primary }]} onPress={handleSend}>
              <IconSymbol name="arrow.up.circle.fill" size={28} color="#fff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.inputAction} onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}>
              <IconSymbol name="mic.fill" size={22} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Quick Actions Panel */}
        {showActions && (
          <View style={[styles.actionsPanel, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
            {[
              { icon: "photo.fill" as const, label: "Photo", color: "#22C55E" },
              { icon: "paperclip" as const, label: "File", color: "#0057FF" },
              { icon: "person.fill" as const, label: "Contact", color: "#8B5CF6" },
              { icon: "pin.fill" as const, label: "Location", color: "#EF4444" },
            ].map((action) => (
              <TouchableOpacity
                key={action.label}
                style={styles.actionItem}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowActions(false);
                }}
              >
                <View style={[styles.actionIcon, { backgroundColor: action.color + "20" }]}>
                  <IconSymbol name={action.icon} size={22} color={action.color} />
                </View>
                <Text style={[styles.actionLabel, { color: colors.foreground }]}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  backButton: { padding: 8 },
  headerCenter: { flex: 1, marginLeft: 4 },
  headerNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  headerPresence: { width: 8, height: 8, borderRadius: 4 },
  headerSubtitle: { fontSize: 12, marginTop: 1 },
  headerActions: { flexDirection: "row", gap: 4 },
  headerAction: { padding: 8 },
  topicBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    gap: 6,
  },
  topicText: { fontSize: 12, flex: 1 },
  // Messages
  timeDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 12,
    paddingHorizontal: 16,
  },
  timeLine: { flex: 1, height: 0.5 },
  timeLabel: { fontSize: 11, paddingHorizontal: 12, fontWeight: "500" },
  systemMessage: {
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 32,
  },
  systemText: { fontSize: 12, textAlign: "center", fontStyle: "italic" },
  messageRow: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignItems: "flex-end",
  },
  messageRowMe: { flexDirection: "row-reverse" },
  msgAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
    marginBottom: 4,
  },
  msgAvatarText: { fontSize: 13, fontWeight: "700" },
  msgAvatarSpacer: { width: 36 },
  messageBubbleContainer: { maxWidth: "75%" },
  messageBubbleContainerMe: { alignItems: "flex-end" },
  senderName: { fontSize: 12, fontWeight: "600", marginBottom: 2, marginLeft: 4 },
  messageBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  messageText: { fontSize: 15, lineHeight: 21 },
  messageFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: 4,
  },
  messageTime: { fontSize: 10 },
  reactionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
    marginLeft: 4,
  },
  reactionChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    gap: 3,
  },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { fontSize: 12, fontWeight: "600" },
  // Input
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: 0.5,
    gap: 6,
  },
  inputAction: { padding: 4, marginBottom: 4 },
  inputContainer: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxHeight: 120,
  },
  textInput: { fontSize: 15, lineHeight: 20 },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  // Actions panel
  actionsPanel: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderTopWidth: 0.5,
  },
  actionItem: { alignItems: "center", gap: 6 },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { fontSize: 12, fontWeight: "500" },
});
