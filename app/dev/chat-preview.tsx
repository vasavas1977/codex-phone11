import { useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { ChatMessageRow } from "@/components/chat/message-row";
import { ReadReceiptSheet } from "@/components/chat/read-receipt-sheet";
import { MentionPicker } from "@/components/chat/mention-picker";
import { ConversationDetails } from "@/components/chat/conversation-details";
import { VoiceNote } from "@/components/chat/voice-note";
import { useColors } from "@/hooks/use-colors";
import { useThemeContext } from "@/lib/theme-provider";
import type { ChatConversationDetails, ChatMention, ChatMessage } from "@/lib/chat/types";
import { findMentionTrigger, insertMention, reconcileMentions, selectionAfterEdit, type ComposerSelection } from "@/lib/chat/mentions";
const sampleDetails: ChatConversationDetails = { members: [{ id: 1, name: "You", extension: "1001" }, { id: 2, name: "Nathasa", extension: "1002" }, { id: 3, name: "Somchai", extension: "1003" }, { id: 4, name: "มนตรี ใจดี", extension: "1004" }], media: [], links: [{ messageId: "3", url: "https://phone11.ai" }] };
const sample: ChatMessage[] = [
  {
    id: "1",
    clientId: "1",
    channelId: "preview",
    senderId: 2,
    senderName: "Nathasa",
    content: "@Nathasa ช่วยตรวจสอบข้อมูลให้หน่อยค่ะ\nCould you check the latest update?",
    timestamp: Date.now() - 600000,
    sequence: 1,
    status: "sent",
    parent: null,
    replyCount: 5,
    mentions: [{ userId: 2, name: "Nathasa", start: 0, length: 8 }],
    reactions: [
      {
        emoji: "👍",
        count: 1,
        reacted: false,
        users: [{ id: 1, name: "You" }],
      },
    ],
  },
  {
    id: "2",
    clientId: "2",
    channelId: "preview",
    senderId: 1,
    senderName: "You",
    content: "ได้เลยครับ กำลังตรวจสอบให้\nI’ll check and reply in the thread.",
    timestamp: Date.now() - 500000,
    sequence: 2,
    status: "sent",
    parent: null,
    editedAt: Date.now(),
  },
  {
    id: "3",
    clientId: "3",
    channelId: "preview",
    senderId: 1,
    senderName: "You",
    content: "The latest information is here: https://phone11.ai",
    timestamp: Date.now() - 490000,
    sequence: 3,
    status: "sent",
    parent: null,
  },
];
export default function ChatPreview() {
  const composerInput = useRef<TextInput>(null);
  const c = useColors(),
    theme = useThemeContext(),
    [messages, setMessages] = useState(sample),
    [replies, setReplies] = useState(false),
    [draft, setDraft] = useState(""),
    [draftMentions, setDraftMentions] = useState<ChatMention[]>([]),
    [selection, setSelection] = useState<ComposerSelection>({ start: 0, end: 0 }),
    [detailsOpen, setDetailsOpen] = useState(false),
    [receiptsOpen, setReceiptsOpen] = useState(false),
    [voiceOpen, setVoiceOpen] = useState(false),
    [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const mentionTrigger = findMentionTrigger(draft, selection, draftMentions);
  const updateDraft = (value: string, nextSelection = selectionAfterEdit(draft, value, selection)) => {
    setDraftMentions(reconcileMentions(draft, value, draftMentions));
    setDraft(value);
    setSelection(nextSelection);
  };
  const insertMentionCharacter = () => {
    const value = draft.slice(0, selection.start) + "@" + draft.slice(selection.end);
    updateDraft(value, { start: selection.start + 1, end: selection.start + 1 });
  };
  if (!__DEV__) return <Redirect href="/(tabs)/teamchat" />;
  return (
    <ScreenContainer>
      <View
        style={{
          maxWidth: 760,
          width: "100%",
          alignSelf: "center",
          flex: 1,
          backgroundColor: c.background,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            padding: 14,
            gap: 12,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
          }}
        >
          <Pressable
            accessibilityLabel="Back"
            onPress={() => setReplies(false)}
            style={{ minWidth: 44, minHeight: 44, justifyContent: "center" }}
          >
            <MaterialIcons name="arrow-back-ios" size={20} color={c.primary} />
          </Pressable>
          <Pressable accessibilityLabel="Open sample conversation details" onPress={() => setDetailsOpen(true)} style={{ flex: 1 }}>
            <Text
              style={{ fontSize: 17, fontWeight: "700", color: c.foreground }}
            >
              {replies ? "Replies" : "Team updates"}
            </Text>
            <Text style={{ fontSize: 12, color: c.muted }}>
              Design preview · sample messages
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Switch theme"
            onPress={() =>
              theme.setAppearance(
                theme.appearance === "dark" ? "light" : "dark",
              )
            }
            style={{ padding: 12 }}
          >
            <MaterialIcons name="contrast" size={22} color={c.primary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {(replies ? [messages[0], ...messages.slice(1)] : messages).map(
            (m, i) => (
              <ChatMessageRow
                key={m.id}
                message={m}
                own={m.senderId === 1}
                grouped={i > 0 && messages[i - 1].senderId === m.senderId}
                root={replies && i === 0}
                onActions={() => {}}
                onReplies={() => setReplies(true)}
                onRetry={() => {}}
                receiptLabel={m.senderId === 1 ? "Read by 2" : undefined}
                onReadReceipts={() => setReceiptsOpen(true)}
                onReaction={(emoji, selected) =>
                  setMessages((items) =>
                    items.map((item) =>
                      item.id === m.id
                        ? {
                            ...item,
                            reactions: selected
                              ? [
                                  {
                                    emoji,
                                    count: 1,
                                    reacted: true,
                                    users: [{ id: 1, name: "You" }],
                                  },
                                ]
                              : [],
                          }
                        : item,
                    ),
                  )
                }
              />
            ),
          )}
        </ScrollView>
        {mentionTrigger && <MentionPicker people={sampleDetails.members} query={mentionTrigger.query} onPick={person => {
          const result = insertMention(draft, mentionTrigger, person, draftMentions);
          setDraft(result.value);
          setDraftMentions(result.mentions);
          setSelection(result.selection);
          requestAnimationFrame(() => {
            composerInput.current?.focus();
            composerInput.current?.setNativeProps({ selection: result.selection });
          });
        }} />}
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            padding: 12,
            borderTopWidth: 1,
            borderTopColor: c.border,
            alignItems: "center",
          }}
        >
          <MaterialIcons name="add" size={26} color={c.muted} />
          <Pressable accessibilityLabel="Insert sample mention" onPress={insertMentionCharacter} style={{ minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" }}><MaterialIcons name="alternate-email" size={23} color={c.muted} /></Pressable>
          <TextInput
            ref={composerInput}
            accessibilityLabel="Preview draft"
            value={draft}
            selection={selection}
            onSelectionChange={event => setSelection(event.nativeEvent.selection)}
            onChangeText={updateDraft}
            placeholder={replies ? "Reply…" : "Message Team updates"}
            placeholderTextColor={c.muted}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 44,
              fontSize: 17,
              color: c.foreground,
            }}
          />
          <MaterialIcons
            name="sentiment-satisfied-alt"
            size={25}
            color={c.muted}
          />
          <Pressable
            accessibilityLabel={draft.trim() ? "Send preview message" : "Record voice note"}
            onPress={() => {
              if (!draft.trim()) setVoiceOpen(true);
            }}
            style={{
              borderRadius: 22,
              padding: 10,
              backgroundColor: c.primary,
            }}
          >
            <MaterialIcons
              name={draft.trim() ? "arrow-upward" : "mic-none"}
              size={22}
              color="white"
            />
          </Pressable>
        </View>
        {voiceStatus && (
          <Text style={{ paddingHorizontal: 16, paddingBottom: 8, color: c.muted }}>
            {voiceStatus}
          </Text>
        )}
        <ConversationDetails visible={detailsOpen} loading={false} details={sampleDetails} error={null} onRetry={() => {}} onClose={() => setDetailsOpen(false)} />
        <ReadReceiptSheet visible={receiptsOpen} loading={false} error={null} rows={[
          { userId: 2, name: "Nathasa", readAt: Date.now() - 180000 },
          { userId: 3, name: "Somchai", readAt: Date.now() - 60000 },
        ]} onClose={() => setReceiptsOpen(false)} />
        <Modal
          visible={voiceOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setVoiceOpen(false)}
        >
          <View
            style={{
              flex: 1,
              justifyContent: "flex-end",
              backgroundColor: "rgba(0,0,0,0.35)",
            }}
          >
            <View
              accessibilityViewIsModal
              style={{
                marginHorizontal: 8,
                marginBottom: 8,
                borderRadius: 24,
                padding: 18,
                maxWidth: 560,
                alignSelf: "center",
                width: "96%",
                backgroundColor: c.background,
              }}
            >
              {voiceOpen && (
                <VoiceNote
                  onReady={(upload, delivery) => {
                    if (delivery && !delivery.commit()) return;
                    setVoiceStatus(
                      `Captured ${upload.filename} (${upload.sizeBytes ?? 0} bytes)`,
                    );
                  }}
                  onClose={() => setVoiceOpen(false)}
                />
              )}
            </View>
          </View>
        </Modal>
      </View>
    </ScreenContainer>
  );
}
