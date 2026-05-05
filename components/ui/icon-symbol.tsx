import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolWeight, SymbolViewProps } from "expo-symbols";
import { ComponentProps } from "react";
import { OpaqueColorValue, type StyleProp, type TextStyle } from "react-native";

type IconMapping = Record<SymbolViewProps["name"], ComponentProps<typeof MaterialIcons>["name"]>;
type IconSymbolName = keyof typeof MAPPING;

const MAPPING = {
  // Navigation tabs
  "house.fill": "home",
  "phone.fill": "phone",
  "clock.fill": "history",
  "person.2.fill": "contacts",
  "message.fill": "chat",
  "gearshape.fill": "settings",
  // Call actions
  "phone.arrow.up.right": "call-made",
  "phone.arrow.down.left": "call-received",
  "phone.fill.arrow.down.left": "call-missed",
  "video.fill": "videocam",
  "video.slash.fill": "videocam-off",
  "mic.fill": "mic",
  "mic.slash.fill": "mic-off",
  "speaker.wave.3.fill": "volume-up",
  "speaker.slash.fill": "volume-off",
  "phone.down.fill": "call-end",
  "arrow.triangle.2.circlepath": "swap-calls",
  "pause.fill": "pause",
  "rectangle.grid.3x2.fill": "dialpad",
  // Messaging
  "paperplane.fill": "send",
  "paperclip": "attach-file",
  // Contacts
  "person.fill": "person",
  "person.fill.badge.plus": "person-add",
  "star.fill": "star",
  "star": "star-border",
  // Settings & misc
  "chevron.right": "chevron-right",
  "chevron.left": "chevron-left",
  "chevron.left.forwardslash.chevron.right": "code",
  "xmark": "close",
  "xmark.circle.fill": "cancel",
  "checkmark": "check",
  "checkmark.circle.fill": "check-circle",
  "info.circle": "info",
  "exclamationmark.triangle.fill": "warning",
  "bell.fill": "notifications",
  "lock.fill": "lock",
  "network": "wifi",
  "server.rack": "dns",
  "waveform": "graphic-eq",
  "voicemail": "voicemail",
  "tray.fill": "inbox",
  "arrow.clockwise": "refresh",
  "trash.fill": "delete",
  "ellipsis": "more-horiz",
  "ellipsis.circle": "more-vert",
  "magnifyingglass": "search",
  "plus": "add",
  "plus.circle.fill": "add-circle",
  "minus.circle.fill": "remove-circle",
  "arrow.right.arrow.left": "swap-horiz",
  "shield.fill": "security",
  "doc.text.fill": "description",
  "externaldrive.fill": "storage",
  "antenna.radiowaves.left.and.right": "cell-tower",
  // DID & Billing
  "number": "tag",
  "creditcard.fill": "credit-card",
  "banknote.fill": "payments",
  "chart.bar.fill": "bar-chart",
  "arrow.down.circle.fill": "download",
  "globe": "language",
  "building.2.fill": "business",
  "sim.card.fill": "sim-card",
  "phone.badge.plus": "add-call",
  "list.bullet": "list",
  "cart.fill": "shopping-cart",
  "checkmark.seal.fill": "verified",
  "clock.arrow.circlepath": "update",
  // Team Chat & Presence
  "bubble.left.and.bubble.right.fill": "forum",
  "number.circle.fill": "tag",
  "at": "alternate-email",
  "circle.fill": "circle",
  "moon.fill": "dark-mode",
  "minus.circle": "do-not-disturb-on",
  "hand.raised.fill": "pan-tool",
  "face.smiling": "emoji-emotions",
  "photo.fill": "photo",
  "arrow.up.circle.fill": "arrow-circle-up",
  "pin.fill": "push-pin",
  "person.3.fill": "groups",
  // Conference Bridge
  "person.3.sequence.fill": "groups",
  "video.badge.plus": "video-call",
  "record.circle": "fiber-manual-record",
  "record.circle.fill": "fiber-manual-record",
  "speaker.wave.2.fill": "volume-up",
  "hand.raised": "pan-tool",
  "crown.fill": "star",
  "link": "link",
  "doc.on.clipboard": "content-copy",
  "calendar.badge.plus": "event",
  "play.fill": "play-arrow",
  "stop.fill": "stop",
  // Analytics
  "sparkles": "auto-awesome",
  "checklist": "checklist",
  // Self-service & misc
  "person.crop.circle.fill": "account-circle",
  "questionmark.circle.fill": "help",
  // Presence indicators
  "circle": "radio-button-unchecked",
} as unknown as IconMapping;

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
