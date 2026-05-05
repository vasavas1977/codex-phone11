import { useState, useRef } from "react";
import { View, Text, TouchableOpacity, FlatList, TextInput, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface Message {
  id: string;
  text: string;
  from: "me" | "them";
  time: string;
  status: "sent" | "delivered" | "read";
}

const INITIAL_MESSAGES: Message[] = [
  { id: "1", text: "Hey, are you available for a quick call?", from: "them", time: "10:30 AM", status: "read" },
  { id: "2", text: "Sure, give me 5 minutes.", from: "me", time: "10:31 AM", status: "read" },
  { id: "3", text: "I'll call you on extension 1001.", from: "them", time: "10:31 AM", status: "read" },
  { id: "4", text: "Sounds good!", from: "me", time: "10:32 AM", status: "delivered" },
];

export default function MessageThreadScreen() {
  const colors = useColors();
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const flatListRef = useRef<FlatList>(null);

  const sendMessage = () => {
    if (!input.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newMsg: Message = {
      id: Date.now().toString(),
      text: input.trim(),
      from: "me",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      status: "sent",
    };
    setMessages((prev) => [...prev, newMsg]);
    setInput("");
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.from === "me";
    return (
      <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
        <View style={[
          styles.bubble,
          isMe ? [styles.bubbleMe, { backgroundColor: colors.primary }] : [styles.bubbleThem, { backgroundColor: colors.surface, borderColor: colors.border }]
        ]}>
          <Text style={[styles.bubbleText, { color: isMe ? "#fff" : colors.foreground }]}>{item.text}</Text>
          <View style={styles.msgMeta}>
            <Text style={[styles.msgTime, { color: isMe ? "#ffffff80" : colors.muted }]}>{item.time}</Text>
            {isMe && (
              <IconSymbol
                name={item.status === "read" ? "checkmark.circle.fill" : "checkmark"}
                size={12}
                color={item.status === "read" ? "#00E5A8" : "#ffffff60"}
              />
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <View style={[styles.headerAvatar, { backgroundColor: colors.primary + "20" }]}>
            <Text style={[styles.headerAvatarText, { color: colors.primary }]}>{(name || "?").charAt(0)}</Text>
          </View>
          <View>
            <Text style={[styles.headerName, { color: colors.foreground }]}>{name || "Unknown"}</Text>
            <Text style={[styles.headerStatus, { color: colors.success }]}>Online</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => router.push({ pathname: "/call/active", params: { number: name || "", type: "voice" } })}
          style={styles.callBtn}
        >
          <IconSymbol name="phone.fill" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messageList}
        showsVerticalScrollIndicator={false}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
      />

      {/* Input */}
      <View style={[styles.inputBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <TouchableOpacity style={styles.attachBtn}>
          <IconSymbol name="paperclip" size={20} color={colors.muted} />
        </TouchableOpacity>
        <TextInput
          style={[styles.textInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
          placeholder="iMessage"
          placeholderTextColor={colors.muted}
          value={input}
          onChangeText={setInput}
          multiline
          returnKeyType="send"
          onSubmitEditing={sendMessage}
        />
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: input.trim() ? colors.primary : colors.border }]}
          onPress={sendMessage}
          disabled={!input.trim()}
        >
          <IconSymbol name="paperplane.fill" size={16} color={input.trim() ? "#fff" : colors.muted} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    paddingTop: 52,
    borderBottomWidth: 0.5,
    gap: 8,
  },
  backBtn: { padding: 4 },
  headerInfo: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  headerAvatarText: { fontSize: 15, fontWeight: "700" },
  headerName: { fontSize: 16, fontWeight: "600" },
  headerStatus: { fontSize: 12 },
  callBtn: { padding: 8 },
  messageList: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  msgRow: { flexDirection: "row", justifyContent: "flex-start", marginVertical: 2 },
  msgRowMe: { justifyContent: "flex-end" },
  bubble: { maxWidth: "75%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMe: { borderBottomRightRadius: 4 },
  bubbleThem: { borderBottomLeftRadius: 4, borderWidth: 1 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  msgMeta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 4 },
  msgTime: { fontSize: 10 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 0.5,
    gap: 8,
    paddingBottom: 28,
  },
  attachBtn: { padding: 8 },
  textInput: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    maxHeight: 100,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
});
