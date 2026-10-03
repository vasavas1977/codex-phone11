import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useColors } from "@/hooks/use-colors";
import { getChatMediaSource, shareChatFile } from "@/lib/chat/media-client";
import type { ChatAllMention, ChatAttachment, ChatMention } from "@/lib/chat/types";
import { ReceivedMedia } from "@/components/chat/received-media";
export type ChatTextSegment = { text: string; mention?: true };

/**
 * Only server-validated UTF-16 ranges get mention treatment. In particular,
 * plain @words and malformed stale payloads remain ordinary message text.
 */
export function mentionSegments(
  text: string,
  mentions: (ChatMention | ChatAllMention)[],
): ChatTextSegment[] {
  const items: ChatTextSegment[] = [];
  let offset = 0;
  for (const mention of [...mentions]
    .filter(
      (item) =>
        Number.isSafeInteger(item.start) &&
        Number.isSafeInteger(item.length) &&
        item.start >= 0 &&
        item.length > 0 &&
        item.start + item.length <= text.length,
    )
    .sort((a, b) => a.start - b.start || a.length - b.length)) {
    if (mention.start < offset) continue;
    if (mention.start > offset) items.push({ text: text.slice(offset, mention.start) });
    items.push({
      text: text.slice(mention.start, mention.start + mention.length),
      mention: true,
    });
    offset = mention.start + mention.length;
  }
  if (offset < text.length) items.push({ text: text.slice(offset) });
  return items.length ? items : [{ text }];
}

export function LinkedChatText({
  text,
  deleted = false,
  mentions = [],
  allMention,
}: {
  text: string;
  deleted?: boolean;
  mentions?: ChatMention[];
  allMention?: ChatAllMention;
}) {
  const colors = useColors();
  const rendered = mentionSegments(text, allMention ? [...mentions, allMention] : mentions);
  return (
    <Text
      selectable
      style={{
        color: deleted ? colors.muted : colors.foreground,
        fontSize: 17,
        lineHeight: 25,
        fontStyle: deleted ? "italic" : "normal",
      }}
    >
      {rendered.flatMap((segment, outer) => segment.text.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <Text
            key={`${outer}:${index}`}
            accessibilityRole="link"
            style={{ color: colors.primary }}
            onPress={() => void Linking.openURL(part).catch(() => {})}
          >
            {part}
          </Text>
        ) : segment.mention ? (
          <Text
            key={`${outer}:${index}`}
            style={{
              color: colors.primary,
              fontWeight: "700",
              backgroundColor: colors.primary + "18",
            }}
          >
            {part}
          </Text>
        ) : part,
      ))}
    </Text>
  );
}
export function ChatAttachmentCard({
  attachment,
}: {
  attachment: ChatAttachment;
}) {
  const colors = useColors(),
    [media, setMedia] = useState<Awaited<
      ReturnType<typeof getChatMediaSource>
    > | null>(null),
    [error, setError] = useState(false),
    [expanded, setExpanded] = useState(false),
    [attempt, setAttempt] = useState(0),
    [ratio, setRatio] = useState(1.5);
  const isImage = attachment.mimeType.startsWith("image/");
  const isPlayable =
    attachment.mimeType.startsWith("audio/") ||
    attachment.mimeType.startsWith("video/");
  useEffect(() => {
    let active = true;
    let value: Awaited<ReturnType<typeof getChatMediaSource>> | null = null;
    const controller = new AbortController();
    setMedia(null);
    setError(false);
    if (isImage)
      void getChatMediaSource(
        attachment.id,
        {
          filename: attachment.filename,
          sizeBytes: attachment.sizeBytes,
        },
        controller.signal,
      )
        .then((result) => {
          value = result;
          result.assertOwner();
          if (active) setMedia(result);
          else result.release();
        })
        .catch(() => active && setError(true));
    return () => {
      active = false;
      controller.abort();
      value?.release();
    };
  }, [attachment.filename, attachment.id, attachment.sizeBytes, isImage, attempt]);
  if (isImage)
    return (
      <View style={{ width: "100%", minWidth: 180, maxWidth: 560 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            error ? "Retry image" : `View ${attachment.filename}`
          }
          onPress={() => (error ? setAttempt((n) => n + 1) : setExpanded(true))}
          style={{
            backgroundColor: colors.border,
            borderRadius: 14,
            overflow: "hidden",
            minHeight: 100,
          }}
        >
          {media && !error ? (
            <Image
              source={media.source}
              resizeMode="contain"
              onError={() => setError(true)}
              onLoad={(event) => {
                const { width, height } = event.nativeEvent.source;
                if (width && height)
                  setRatio(Math.max(0.4, Math.min(2.5, width / height)));
              }}
              style={{ width: "100%", aspectRatio: ratio }}
            />
          ) : error ? (
            <Text style={{ color: colors.muted, padding: 16 }}>
              Image unavailable · Tap to retry
            </Text>
          ) : (
            <ActivityIndicator style={{ padding: 30 }} color={colors.primary} />
          )}
        </Pressable>
        <Modal
          visible={expanded}
          animationType="fade"
          onRequestClose={() => setExpanded(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: colors.background,
              paddingTop: 54,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close image"
              onPress={() => setExpanded(false)}
              style={{ padding: 16, minHeight: 44 }}
            >
              <Text style={{ color: colors.primary }}>Close</Text>
            </Pressable>
            <ScrollView
              maximumZoomScale={4}
              minimumZoomScale={1}
              contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
            >
              {media && (
                <Image
                  source={media.source}
                  resizeMode="contain"
                  style={{ width: "100%", aspectRatio: ratio }}
                />
              )}
            </ScrollView>
          </View>
        </Modal>
      </View>
    );
  if (isPlayable) return <ReceivedMedia attachment={attachment} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${attachment.filename}`}
      onPress={() => void shareChatFile(attachment).catch(() => setError(true))}
      style={{
        flexDirection: "row",
        gap: 12,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 14,
        borderRadius: 14,
        alignItems: "center",
      }}
    >
      <MaterialIcons
        name={
          attachment.mimeType.startsWith("audio/")
            ? "audiotrack"
            : attachment.mimeType.startsWith("video/")
              ? "videocam"
              : "insert-drive-file"
        }
        size={28}
        color={colors.primary}
      />
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={2}
          style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}
        >
          {attachment.filename}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {error
            ? "Unable to open · Tap to retry"
            : `${(attachment.sizeBytes / 1024).toFixed(0)} KB`}
        </Text>
      </View>
    </Pressable>
  );
}
