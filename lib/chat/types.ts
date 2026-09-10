export type ChatKind = "direct" | "group" | "channel";
export interface ChatWorkspace { id: number; name: string }
export interface ChatPerson { id: number; name: string; extension: string | null }
export interface ChatChannel {
  id: string; name: string; kind: ChatKind; memberIds: number[];
  lastMessage: string | null; lastMessageAt: number; unreadCount: number;
}
export interface ChatMessage {
  id: string; clientId: string; channelId: string; senderId: number; senderName: string;
  content: string; timestamp: number; sequence: number;
  status: "sending" | "sent" | "failed";
}
export function formatChatTime(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
