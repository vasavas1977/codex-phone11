import { View, Text, TouchableOpacity, FlatList, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface Thread {
  id: string;
  name: string;
  lastMessage: string;
  time: string;
  unread: number;
  online: boolean;
}

const THREADS: Thread[] = [
  { id: "1", name: "Alice Johnson", lastMessage: "Sure, give me 5 minutes.", time: "10:32 AM", unread: 0, online: true },
  { id: "2", name: "Bob Chen", lastMessage: "Can you review the call logs?", time: "9:15 AM", unread: 3, online: true },
  { id: "3", name: "Carol Martinez", lastMessage: "I'll be in the office at 2pm", time: "Yesterday", unread: 1, online: false },
  { id: "4", name: "Support Team", lastMessage: "Ticket #4521 has been resolved", time: "Yesterday", unread: 0, online: true },
  { id: "5", name: "David Kim", lastMessage: "Thanks for the update!", time: "Mon", unread: 0, online: false },
  { id: "6", name: "Emma Wilson", lastMessage: "Call me when you're free", time: "Sun", unread: 2, online: true },
];

export default function MessagesScreen() {
  const colors = useColors();

  const renderThread = ({ item }: { item: Thread }) => (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({ pathname: "/messages/[id]", params: { id: item.id, name: item.name } });
      }}
      activeOpacity={0.7}
    >
      <View style={styles.avatarContainer}>
        <View style={[styles.avatar, { backgroundColor: colors.primary + "20" }]}>
          <Text style={[styles.avatarText, { color: colors.primary }]}>{item.name.charAt(0)}</Text>
        </View>
        {item.online && <View style={[styles.onlineDot, { backgroundColor: colors.success }]} />}
      </View>
      <View style={styles.threadInfo}>
        <View style={styles.topRow}>
          <Text style={[styles.threadName, { color: colors.foreground }, item.unread > 0 && styles.bold]}>
            {item.name}
          </Text>
          <Text style={[styles.threadTime, { color: item.unread > 0 ? colors.primary : colors.muted }]}>
            {item.time}
          </Text>
        </View>
        <View style={styles.bottomRow}>
          <Text
            style={[styles.lastMsg, { color: item.unread > 0 ? colors.foreground : colors.muted }]}
            numberOfLines={1}
          >
            {item.lastMessage}
          </Text>
          {item.unread > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={styles.badgeText}>{item.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Messages</Text>
        <TouchableOpacity
          style={[styles.composeBtn, { backgroundColor: colors.primary }]}
          onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
        >
          <IconSymbol name="plus" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={THREADS}
        renderItem={renderThread}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
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
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  title: { fontSize: 22, fontWeight: "700" },
  composeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  avatarContainer: { position: "relative" },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 20, fontWeight: "700" },
  onlineDot: {
    position: "absolute",
    bottom: 1,
    right: 1,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    borderWidth: 2,
    borderColor: "#fff",
  },
  threadInfo: { flex: 1 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  threadName: { fontSize: 15, fontWeight: "500" },
  bold: { fontWeight: "700" },
  threadTime: { fontSize: 12 },
  bottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 3 },
  lastMsg: { flex: 1, fontSize: 14, marginRight: 8 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
