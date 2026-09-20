import { Pressable, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ChatLinkPreview } from "./link-preview";
import { useColors } from "@/hooks/use-colors";
import { ChatAttachmentCard, LinkedChatText } from "./message-content";
import type { ChatMessage } from "@/lib/chat/types";
export function ChatMessageRow({
  message,
  own,
  grouped,
  root,
  onActions,
  onReplies,
  onReaction,
  onRetry,
  receiptLabel,
  onReadReceipts,
}: {
  message: ChatMessage;
  own: boolean;
  grouped: boolean;
  root: boolean;
  onActions: () => void;
  onReplies: () => void;
  onReaction: (emoji: string, selected: boolean) => void;
  onRetry: () => void;
  receiptLabel?: string;
  onReadReceipts?: () => void;
}) {
  const c = useColors();
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const reactions = message.reactions || [];
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 9,
        marginTop: grouped ? 3 : 16,
        marginBottom: 3,
      }}
    >
      <View style={{ width: 34, paddingTop: 22 }}>
        {!grouped && (
          <View
            style={{
              height: 34,
              width: 34,
              borderRadius: 12,
              backgroundColor: c.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{ color: c.foreground, fontSize: 12, fontWeight: "600" }}
            >
              {(own ? "You" : message.senderName)
                .split(/\s+/)
                .slice(0, 2)
                .map((s) => s[0])
                .join("")
                .toUpperCase()}
            </Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {!grouped && (
          <Text
            style={{
              color: c.muted,
              fontSize: 12,
              lineHeight: 18,
              marginBottom: 4,
            }}
          >
            {own ? "You" : message.senderName} · {time}
            {message.editedAt ? " · Edited" : ""}
          </Text>
        )}
        {root && (
          <Text style={{ color: c.muted, fontSize: 12, marginBottom: 4 }}>
            Original message
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Message from ${message.senderName}`}
          accessibilityHint="Long press for message actions"
          accessibilityActions={[
            { name: "activate", label: "Open message actions" },
          ]}
          onAccessibilityAction={(e) =>
            e.nativeEvent.actionName === "activate" && onActions()
          }
          onLongPress={onActions}
          delayLongPress={350}
          style={{ alignSelf: "flex-start", maxWidth: "100%", gap: 3 }}
        >
          {(message.content || message.deletedAt) && (
            <View
              style={{
                backgroundColor: own ? c.primary + "14" : c.surface,
                paddingHorizontal: 13,
                paddingVertical: 10,
                borderRadius: 16,
                borderWidth: root ? 1 : 0,
                borderColor: c.border,
              }}
            >
              <LinkedChatText
                text={message.deletedAt ? "Message deleted" : message.content}
                deleted={!!message.deletedAt}
                mentions={message.mentions}
              />
            </View>
          )}
          {!message.deletedAt &&
            message.attachments?.map((a) => (
              <ChatAttachmentCard key={a.id} attachment={a} />
            ))}
        </Pressable>
        <ChatLinkPreview message={message} />
        {(message.isPinned || message.isBookmarked) && (
          <Text style={{ color: c.muted, fontSize: 11, marginTop: 4 }}>
            {message.isPinned ? "Pinned" : ""}
            {message.isPinned && message.isBookmarked ? " · " : ""}
            {message.isBookmarked ? "Saved for you" : ""}
          </Text>
        )}
        {own && message.status !== "sent" && (
          <Text style={{ color: c.muted, fontSize: 11, marginTop: 4 }}>
            {message.status === "sending" ? "Sending…" : "Not sent"}
          </Text>
        )}
        {own && message.status === "sent" && receiptLabel && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${receiptLabel}. View read receipts`}
            onPress={onReadReceipts}
            style={{ alignSelf: "flex-start", minHeight: 32, justifyContent: "center" }}
          >
            <Text style={{ color: c.primary, fontSize: 11 }}>{receiptLabel}</Text>
          </Pressable>
        )}
        {!message.deletedAt &&
          message.status === "sent" &&
          (reactions.length > 0 ||
            (!message.parent && !root && !!message.replyCount)) && (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 6,
                marginTop: 4,
              }}
            >
              {reactions.map((r) => (
                <Pressable
                  key={r.emoji}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.emoji}, ${r.count} reactions${r.reacted ? ", selected" : ""}`}
                  accessibilityState={{ selected: r.reacted }}
                  onPress={() => onReaction(r.emoji, !r.reacted)}
                  onLongPress={onActions}
                  style={{
                    borderRadius: 18,
                    paddingHorizontal: 10,
                    minHeight: 44,
                    justifyContent: "center",
                    backgroundColor: r.reacted ? c.primary + "20" : c.surface,
                    borderWidth: 1,
                    borderColor: r.reacted ? c.primary : c.border,
                  }}
                >
                  <Text style={{ color: c.foreground }}>
                    {r.emoji} {r.count}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add reaction"
                onPress={onActions}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <MaterialIcons name="add-reaction" size={19} color={c.muted} />
              </Pressable>
              {!message.parent && !root && !!message.replyCount && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    message.replyCount
                      ? `${message.replyCount} replies`
                      : "Reply to message"
                  }
                  onPress={onReplies}
                  style={{
                    minHeight: 44,
                    justifyContent: "center",
                    paddingHorizontal: 4,
                  }}
                >
                  {message.replyCount ? (
                    <Text style={{ color: c.primary, fontSize: 14 }}>
                      {message.replyCount}{" "}
                      {message.replyCount === 1 ? "reply" : "replies"} ›
                    </Text>
                  ) : (
                    <MaterialIcons
                      name="chat-bubble-outline"
                      size={19}
                      color={c.muted}
                    />
                  )}
                </Pressable>
              )}
            </View>
          )}
        {message.deletedAt &&
          !!message.replyCount &&
          !message.parent &&
          !root && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${message.replyCount} replies`}
              onPress={onReplies}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: c.primary }}>
                {message.replyCount}{" "}
                {message.replyCount === 1 ? "reply" : "replies"} ›
              </Text>
            </Pressable>
          )}
        {own && message.status === "failed" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry sending message"
            onPress={onRetry}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: c.error }}>Retry</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
