import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { useChatStore } from "@/lib/chat/store";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { createChatTransport } from "@/lib/chat/transport";
import type { ChatMessage } from "@/lib/chat/types";
const api = createChatTransport();
/** Preview metadata is fetched by the protected server, only after an explicit tap. */
export function ChatLinkPreview({ message }: { message: ChatMessage }) {
  const colors = useColors(),
    chat = useChatStore();
  const [data, setData] = useState<{
      title: string | null;
      description: string | null;
      domain: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const epoch = useRef(0),
    pending = useRef(false);
  const url = message.content.match(/https?:\/\/[^\s<>]+/)?.[0];
  useEffect(() => {
    epoch.current++;
    pending.current = false;
    setData(null);
    setFailed(false);
    setBusy(false);
    return () => {
      epoch.current++;
    };
  }, [message.id, message.content, chat.userId, chat.workspace?.id]);
  if (!url || message.deletedAt || message.status !== "sent") return null;
  const preview = async () => {
    const owner = getAuthSnapshot().user,
      tenant = chat.workspace?.id;
    if (!owner || owner.id !== chat.userId || !tenant || pending.current)
      return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    const version = epoch.current;
    try {
      const result = await api.linkPreview(
        tenant,
        message.channelId,
        message.id,
        url,
      );
      if (version === epoch.current && getAuthSnapshot().user === owner)
        setData(result);
    } catch {
      if (version === epoch.current) setFailed(true);
    } finally {
      if (version === epoch.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  return data ? (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open ${data.domain}`}
      onPress={() => void Linking.openURL(url).catch(() => {})}
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
        padding: 12,
        maxWidth: 500,
        marginTop: 4,
      }}
    >
      {data.title && (
        <Text
          numberOfLines={2}
          style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}
        >
          {data.title}
        </Text>
      )}
      {data.description && (
        <Text
          numberOfLines={3}
          style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}
        >
          {data.description}
        </Text>
      )}
      <Text style={{ color: colors.primary, fontSize: 12, marginTop: 4 }}>
        {data.domain}
      </Text>
    </Pressable>
  ) : (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Preview link"
        disabled={busy}
        onPress={() => void preview()}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {busy
            ? "Loading preview…"
            : failed
              ? "Preview unavailable · Retry"
              : "Preview link"}
        </Text>
      </Pressable>
    </View>
  );
}
