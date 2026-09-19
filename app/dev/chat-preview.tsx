import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ScreenContainer } from "@/components/screen-container";
import { ChatMessageRow } from "@/components/chat/message-row";
import { MentionPicker } from "@/components/chat/mention-picker";
import { ConversationDetails } from "@/components/chat/conversation-details";
import { useColors } from "@/hooks/use-colors";
import { useThemeContext } from "@/lib/theme-provider";
import type { ChatConversationDetails, ChatMessage } from "@/lib/chat/types";
const sampleDetails: ChatConversationDetails = { members: [{ id: 1, name: "You", extension: "1001" }, { id: 2, name: "Nathasa", extension: "1002" }, { id: 3, name: "Somchai", extension: "1003" }], media: [], links: [{ messageId: "3", url: "https://phone11.ai" }] };
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
  const c = useColors(),
    theme = useThemeContext(),
    [messages, setMessages] = useState(sample),
    [replies, setReplies] = useState(false),
    [draft, setDraft] = useState(""),
    [mentionsOpen, setMentionsOpen] = useState(false),
    [detailsOpen, setDetailsOpen] = useState(false);
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
              {replies ? "Replies" : "Nathasa"}
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
        {mentionsOpen && <MentionPicker people={sampleDetails.members} onPick={person => { setDraft(value => `${value}${value ? " " : ""}@${person.name} `); setMentionsOpen(false); }} />}
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
          <Pressable accessibilityLabel="Open sample mention picker" onPress={() => setMentionsOpen(open => !open)} style={{ minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" }}><MaterialIcons name="alternate-email" size={23} color={c.muted} /></Pressable>
          <TextInput
            accessibilityLabel="Preview draft"
            value={draft}
            onChangeText={setDraft}
            placeholder={replies ? "Reply…" : "Message Nathasa"}
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
          <View
            style={{
              borderRadius: 22,
              padding: 10,
              backgroundColor: c.primary,
            }}
          >
            <MaterialIcons name="arrow-upward" size={22} color="white" />
          </View>
        </View>
        <ConversationDetails visible={detailsOpen} loading={false} details={sampleDetails} error={null} onRetry={() => {}} onClose={() => setDetailsOpen(false)} />
      </View>
    </ScreenContainer>
  );
}
