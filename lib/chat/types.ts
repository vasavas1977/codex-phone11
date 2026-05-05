/**
 * CloudPhone11 Team Chat Types
 * 
 * Data models for team messaging channels, direct messages, and chat messages.
 */

export type ChannelType = "channel" | "direct" | "group";

export interface ChatChannel {
  id: string;
  name: string;
  type: ChannelType;
  description?: string;
  members: string[];        // SIP URIs or user IDs
  memberNames?: string[];   // Display names
  createdAt: number;
  lastMessageAt: number;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
  avatar?: string;          // Channel avatar / group icon
  topic?: string;           // Channel topic
}

export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
  type: "text" | "image" | "file" | "system" | "call";
  timestamp: number;
  edited: boolean;
  reactions: Record<string, string[]>; // emoji -> user IDs
  replyTo?: string;         // Message ID being replied to
  replyPreview?: string;    // Preview text of replied message
  read: boolean;
  delivered: boolean;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
}

export interface ChatMember {
  id: string;
  name: string;
  sipUri: string;
  extension: string;
  avatar?: string;
  role: "admin" | "member";
}

// Mock data for UI development
export const MOCK_CHANNELS: ChatChannel[] = [
  {
    id: "ch-general",
    name: "General",
    type: "channel",
    description: "Company-wide announcements and updates",
    members: ["user1", "user2", "user3", "user4", "user5", "user6"],
    createdAt: Date.now() - 86400000 * 30,
    lastMessageAt: Date.now() - 120000,
    unreadCount: 3,
    pinned: true,
    muted: false,
    topic: "Welcome to CloudPhone11 team chat!",
  },
  {
    id: "ch-sales",
    name: "Sales Team",
    type: "channel",
    description: "Sales pipeline, leads, and customer discussions",
    members: ["user1", "user2", "user5"],
    createdAt: Date.now() - 86400000 * 20,
    lastMessageAt: Date.now() - 300000,
    unreadCount: 1,
    pinned: true,
    muted: false,
    topic: "Q2 targets: $500K ARR",
  },
  {
    id: "ch-support",
    name: "Customer Support",
    type: "channel",
    description: "Ticket escalations and support coordination",
    members: ["user2", "user3", "user4"],
    createdAt: Date.now() - 86400000 * 15,
    lastMessageAt: Date.now() - 600000,
    unreadCount: 0,
    pinned: false,
    muted: false,
    topic: "SLA: 15 min first response",
  },
  {
    id: "ch-engineering",
    name: "Engineering",
    type: "channel",
    description: "Development updates, deployments, and tech discussions",
    members: ["user1", "user3", "user6"],
    createdAt: Date.now() - 86400000 * 25,
    lastMessageAt: Date.now() - 1800000,
    unreadCount: 5,
    pinned: false,
    muted: false,
    topic: "Sprint 14 — FreeSWITCH migration",
  },
  {
    id: "ch-noc",
    name: "NOC Alerts",
    type: "channel",
    description: "Network operations center — system alerts and incidents",
    members: ["user1", "user3", "user4", "user6"],
    createdAt: Date.now() - 86400000 * 10,
    lastMessageAt: Date.now() - 3600000,
    unreadCount: 0,
    pinned: false,
    muted: true,
    topic: "Uptime: 99.997% this month",
  },
  // Direct messages
  {
    id: "dm-sarah",
    name: "Sarah Chen",
    type: "direct",
    members: ["me", "user1"],
    memberNames: ["Me", "Sarah Chen"],
    createdAt: Date.now() - 86400000 * 5,
    lastMessageAt: Date.now() - 180000,
    unreadCount: 2,
    pinned: false,
    muted: false,
  },
  {
    id: "dm-james",
    name: "James Wilson",
    type: "direct",
    members: ["me", "user2"],
    memberNames: ["Me", "James Wilson"],
    createdAt: Date.now() - 86400000 * 3,
    lastMessageAt: Date.now() - 900000,
    unreadCount: 0,
    pinned: false,
    muted: false,
  },
  {
    id: "dm-alex",
    name: "Alex Rivera",
    type: "direct",
    members: ["me", "user3"],
    memberNames: ["Me", "Alex Rivera"],
    createdAt: Date.now() - 86400000 * 7,
    lastMessageAt: Date.now() - 7200000,
    unreadCount: 0,
    pinned: false,
    muted: false,
  },
  // Group DM
  {
    id: "grp-leadership",
    name: "Leadership Team",
    type: "group",
    members: ["me", "user1", "user2", "user4"],
    memberNames: ["Me", "Sarah Chen", "James Wilson", "Priya Patel"],
    createdAt: Date.now() - 86400000 * 12,
    lastMessageAt: Date.now() - 5400000,
    unreadCount: 0,
    pinned: true,
    muted: false,
  },
];

export const MOCK_MESSAGES: Record<string, ChatMessage[]> = {
  "ch-general": [
    {
      id: "msg-1",
      channelId: "ch-general",
      senderId: "user1",
      senderName: "Sarah Chen",
      content: "Good morning team! Quick reminder — all-hands meeting at 2pm today.",
      type: "text",
      timestamp: Date.now() - 3600000,
      edited: false,
      reactions: { "👍": ["user2", "user3"], "✅": ["user4"] },
      read: true,
      delivered: true,
    },
    {
      id: "msg-2",
      channelId: "ch-general",
      senderId: "user3",
      senderName: "Alex Rivera",
      content: "Thanks Sarah! I'll present the FreeSWITCH migration update.",
      type: "text",
      timestamp: Date.now() - 3300000,
      edited: false,
      reactions: {},
      read: true,
      delivered: true,
    },
    {
      id: "msg-3",
      channelId: "ch-general",
      senderId: "user2",
      senderName: "James Wilson",
      content: "Just closed the Acme Corp deal! 500 seats on CloudPhone11 🎉",
      type: "text",
      timestamp: Date.now() - 1800000,
      edited: false,
      reactions: { "🎉": ["user1", "user3", "user4", "user5"], "🔥": ["user6"] },
      read: true,
      delivered: true,
    },
    {
      id: "msg-4",
      channelId: "ch-general",
      senderId: "user4",
      senderName: "Priya Patel",
      content: "Amazing work James! That puts us at 85% of Q2 target.",
      type: "text",
      timestamp: Date.now() - 1500000,
      edited: false,
      reactions: { "💪": ["user2"] },
      read: true,
      delivered: true,
    },
    {
      id: "msg-5",
      channelId: "ch-general",
      senderId: "system",
      senderName: "System",
      content: "BillRun CDR sync completed — 12,847 records processed",
      type: "system",
      timestamp: Date.now() - 600000,
      edited: false,
      reactions: {},
      read: true,
      delivered: true,
    },
    {
      id: "msg-6",
      channelId: "ch-general",
      senderId: "user5",
      senderName: "Marcus Johnson",
      content: "New DID batch imported: 200 US numbers, 50 UK numbers ready for assignment.",
      type: "text",
      timestamp: Date.now() - 300000,
      edited: false,
      reactions: {},
      read: false,
      delivered: true,
    },
    {
      id: "msg-7",
      channelId: "ch-general",
      senderId: "user6",
      senderName: "Fatima Al-Rashid",
      content: "Kamailio cluster health check passed — all 3 nodes green. Latency avg 12ms.",
      type: "text",
      timestamp: Date.now() - 120000,
      edited: false,
      reactions: {},
      read: false,
      delivered: true,
    },
  ],
  "dm-sarah": [
    {
      id: "dm-msg-1",
      channelId: "dm-sarah",
      senderId: "user1",
      senderName: "Sarah Chen",
      content: "Hey, can you check the Dinstar SBC logs? Getting some 503 errors from the Zoom trunk.",
      type: "text",
      timestamp: Date.now() - 900000,
      edited: false,
      reactions: {},
      read: true,
      delivered: true,
    },
    {
      id: "dm-msg-2",
      channelId: "dm-sarah",
      senderId: "me",
      senderName: "Me",
      content: "On it — looks like the AudioCodes gateway needs a TLS cert renewal. Fixing now.",
      type: "text",
      timestamp: Date.now() - 600000,
      edited: false,
      reactions: {},
      read: true,
      delivered: true,
    },
    {
      id: "dm-msg-3",
      channelId: "dm-sarah",
      senderId: "user1",
      senderName: "Sarah Chen",
      content: "Perfect. Also, the investor deck needs the latest MRR numbers. Can you pull from BillRun?",
      type: "text",
      timestamp: Date.now() - 300000,
      edited: false,
      reactions: {},
      read: false,
      delivered: true,
    },
    {
      id: "dm-msg-4",
      channelId: "dm-sarah",
      senderId: "user1",
      senderName: "Sarah Chen",
      content: "Meeting with Series A lead tomorrow at 10am. Need the numbers by tonight.",
      type: "text",
      timestamp: Date.now() - 180000,
      edited: false,
      reactions: {},
      read: false,
      delivered: true,
    },
  ],
};

/**
 * Get last message preview for a channel
 */
export function getLastMessagePreview(channelId: string): string {
  const messages = MOCK_MESSAGES[channelId];
  if (!messages || messages.length === 0) return "No messages yet";
  const last = messages[messages.length - 1];
  if (last.type === "system") return `⚙️ ${last.content}`;
  if (last.type === "call") return `📞 ${last.content}`;
  const prefix = last.senderId === "me" ? "You: " : `${last.senderName.split(" ")[0]}: `;
  const text = last.content.length > 50 ? last.content.substring(0, 50) + "..." : last.content;
  return prefix + text;
}

/**
 * Format timestamp for chat display
 */
export function formatChatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60000) return "now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return days === 1 ? "Yesterday" : `${days}d`;
  }
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}
