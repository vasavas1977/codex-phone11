import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Redirect } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ChannelMeetingPicker } from "@/components/chat/channel-meeting-picker";
import { LinkedChatText } from "@/components/chat/message-content";
import { NewMessagesJump, UnreadMessageDivider } from "@/components/chat/unread-message-indicator";
import { useColors } from "@/hooks/use-colors";
import { ScreenContainer } from "@/components/screen-container";
const members = [{ id: 1, name: "You", extension: "3001" }, { id: 2, name: "Somchai ใจดี", extension: "1020" }, { id: 3, name: "Nathasa", extension: "1021" }];
export default function ChannelPreview() {
  const colors = useColors();
  const [picker, setPicker] = useState(false);
  if (!__DEV__) return <Redirect href="/(tabs)/teamchat" />;
  return <ScreenContainer>
    <View style={{ padding: 18, flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1 }}><Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 20 }}>Project team</Text><Text style={{ color: colors.muted }}>3 members · Design preview</Text></View>
      <Pressable accessibilityLabel="Choose meeting participants" onPress={() => setPicker(true)} style={{ padding: 10 }}><MaterialIcons name="videocam" size={28} color={colors.primary} /></Pressable>
    </View>
    <ScrollView contentContainerStyle={{ padding: 18 }}>
      <UnreadMessageDivider />
      <Text style={{ color: colors.muted, marginVertical: 10 }}>Somchai · Today 10:15</Text>
      <View style={{ backgroundColor: colors.surface, padding: 16, borderRadius: 20 }}>
        <LinkedChatText text="@Nathasa ช่วยตรวจสอบเอกสารให้หน่อยครับ" mentions={[{ userId: 3, name: "Nathasa", start: 0, length: 8 }]} />
      </View>
      <View style={{ marginTop: 20 }}><NewMessagesJump onPress={() => {}} /></View>
    </ScrollView>
    <ChannelMeetingPicker visible={picker} tenantId={1} channelId="preview" channelName="Project team" hostId={1} members={members} startAvailable={false} onCancel={() => setPicker(false)} onStart={() => {}} />
  </ScreenContainer>;
}
