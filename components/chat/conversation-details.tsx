import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatAttachmentCard } from "./message-content";
import type { ChatConversationDetails } from "@/lib/chat/types";

export function ConversationDetails({ visible, loading, details, error, onRetry, onClose }: { visible: boolean; loading: boolean; details: ChatConversationDetails | null; error?: string | null; onRetry: () => void; onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}><View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 18, borderBottomWidth: 1, borderBottomColor: c.border }}><Text style={{ color: c.foreground, fontSize: 19, fontWeight: "700" }}>Conversation details</Text><Pressable accessibilityRole="button" accessibilityLabel="Close conversation details" onPress={onClose} style={{ minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "flex-end" }}><Text style={{ color: c.primary }}>Close</Text></Pressable></View>
    {loading ? <ActivityIndicator color={c.primary} style={{ padding: 28 }} /> : error ? <View style={{ padding: 18, gap: 12 }}><Text style={{ color: c.error }}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry conversation details" onPress={onRetry} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: c.primary }}>Retry</Text></Pressable></View> : <ScrollView contentContainerStyle={{ padding: 18, gap: 12 }}>
      <Text style={{ color: c.muted, fontSize: 12, fontWeight: "700" }}>MEMBERS ({details?.members.length || 0})</Text>
      {details?.members.map(member => <Text key={member.id} style={{ color: c.foreground, fontSize: 16 }}>{member.name}{member.extension ? ` · ${member.extension}` : ""}</Text>)}
      <Text style={{ color: c.muted, fontSize: 12, fontWeight: "700", marginTop: 16 }}>SHARED MEDIA & FILES ({details?.media.length || 0})</Text>
      {details?.media.map(item => <ChatAttachmentCard key={`${item.messageId}:${item.attachment.id}`} attachment={item.attachment} />)}
      <Text style={{ color: c.muted, fontSize: 12, fontWeight: "700", marginTop: 16 }}>SHARED LINKS ({details?.links.length || 0})</Text>
      {details?.links.map(item => <Pressable key={`${item.messageId}:${item.url}`} accessibilityRole="link" onPress={() => void Linking.openURL(item.url).catch(() => {})}><Text numberOfLines={2} style={{ color: c.primary }}>{item.url}</Text></Pressable>)}
      <Text style={{ color: c.muted, fontSize: 12 }}>Showing recent shared items (up to 100 messages).</Text>
    </ScrollView>}
  </View></Modal>;
}
