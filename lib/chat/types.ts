export type ChatKind = "direct" | "group" | "channel";
export interface ChatWorkspace { id: number; name: string }
export interface ChatPerson { id: number; name: string; extension: string | null }
export interface ChatChannel {
  id: string; name: string; kind: ChatKind; memberIds: number[];
  lastMessage: string | null; lastMessageAt: number; unreadCount: number; blocked: boolean;
  /** The current member's private preference; omitted by older servers. */
  notificationsMuted?: boolean;
}
export interface ChatParentPreview {
  id: string; senderName: string; content: string;
}
export interface ChatReactionUser { id: number; name: string }
export interface ChatReaction {
  emoji: string; count: number; reacted: boolean;
  /** Present only to authorized conversation members. */
  users: ChatReactionUser[];
}
export interface ChatBookmark { messageId: string; channelId: string; createdAt: number }
export type ChatPresenceStatus = "available" | "away" | "offline" | "on_call" | "in_meeting";
export interface ChatPresence {
  userId: number;
  /** Kept for older clients; true means a current lease exists. */
  available: boolean;
  status: ChatPresenceStatus;
  lastSeenAt: number | null;
}
/** Safe server descriptor. It intentionally contains no storage key or URL. */
export interface ChatAttachment {
  id: string; conversationId: string; filename: string; mimeType: string; sizeBytes: number;
  status: "ready" | "attached";
}
/** A server-verified member reference. Offsets are UTF-16 offsets in content. */
export interface ChatMention { userId: number; name: string; start: number; length: number }
export interface ChatConversationDetails {
  members: ChatPerson[];
  media: { messageId: string; attachment: ChatAttachment }[];
  links: { messageId: string; url: string }[];
}
export interface ChatMessage {
  id: string; clientId: string; channelId: string; senderId: number; senderName: string;
  content: string; timestamp: number; sequence: number;
  status: "sending" | "sent" | "failed";
  parent: ChatParentPreview | null;
  /** Server-authoritative direct-reply total, never inferred from loaded pages. */
  replyCount?: number;
  reactions?: ChatReaction[];
  editedAt?: number | null;
  deletedAt?: number | null;
  /** Personal save state for the authenticated member only. */
  isBookmarked?: boolean;
  /** Shared conversation pin state. */
  isPinned?: boolean;
  attachments?: ChatAttachment[];
  /** Omitted for legacy messages and clients. Never inferred from display text. */
  mentions?: ChatMention[];
}
export function formatChatTime(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
