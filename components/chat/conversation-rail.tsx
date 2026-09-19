import {
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { useChatStore } from "@/lib/chat/store";
import { useColors } from "@/hooks/use-colors";
export function ConversationRail({ selected }: { selected: string }) {
  const { width } = useWindowDimensions();
  const chat = useChatStore(),
    c = useColors();
  if (width < 1000) return null;
  return (
    <View
      style={{
        width: 290,
        borderRightWidth: 1,
        borderRightColor: c.border,
        paddingTop: 16,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{
          fontSize: 24,
          fontWeight: "700",
          paddingHorizontal: 20,
          paddingBottom: 16,
          color: c.foreground,
        }}
      >
        Team Chat
      </Text>
      <ScrollView>
        {chat.channels.map((room) => (
          <Pressable
            key={room.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${room.name}`}
            accessibilityState={{ selected: room.id === selected }}
            onPress={() =>
              router.replace({
                pathname: "/chat/[id]",
                params: { id: room.id, tenantId: chat.workspace?.id },
              })
            }
            style={{
              padding: 16,
              backgroundColor:
                room.id === selected ? c.primary + "14" : "transparent",
              borderBottomWidth: 1,
              borderBottomColor: c.border,
              gap: 4,
            }}
          >
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: c.foreground,
                  fontWeight: "600",
                  fontSize: 15,
                  flex: 1,
                }}
              >
                {room.name}
              </Text>
              {room.unreadCount > 0 && (
                <Text style={{ color: c.primary }}>
                  {Math.min(room.unreadCount, 99)}
                  {room.unreadCount > 99 ? "+" : ""}
                </Text>
              )}
            </View>
            <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13 }}>
              {room.lastMessage || "Start a conversation"}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
