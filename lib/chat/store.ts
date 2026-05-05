/**
 * CloudPhone11 Chat Store
 * 
 * Zustand store for team chat state management.
 * In production: connects to SIP MESSAGE or XMPP backend via Kamailio.
 */

import { create } from "zustand";
import {
  type ChatChannel,
  type ChatMessage,
  MOCK_CHANNELS,
  MOCK_MESSAGES,
} from "./types";

interface ChatState {
  channels: ChatChannel[];
  messages: Record<string, ChatMessage[]>;
  activeChannelId: string | null;
  searchQuery: string;
  filter: "all" | "channels" | "direct" | "unread";

  // Actions
  loadChannels: () => void;
  loadMessages: (channelId: string) => void;
  sendMessage: (channelId: string, content: string, type?: ChatMessage["type"]) => void;
  markAsRead: (channelId: string) => void;
  setActiveChannel: (channelId: string | null) => void;
  setSearchQuery: (query: string) => void;
  setFilter: (filter: ChatState["filter"]) => void;
  togglePin: (channelId: string) => void;
  toggleMute: (channelId: string) => void;
  addReaction: (channelId: string, messageId: string, emoji: string) => void;
  getTotalUnread: () => number;
}

export const useChatStore = create<ChatState>((set, get) => ({
  channels: [],
  messages: {},
  activeChannelId: null,
  searchQuery: "",
  filter: "all",

  loadChannels: () => {
    set({ channels: MOCK_CHANNELS });
  },

  loadMessages: (channelId) => {
    const existing = MOCK_MESSAGES[channelId] || [];
    set((state) => ({
      messages: { ...state.messages, [channelId]: existing },
    }));
  },

  sendMessage: (channelId, content, type = "text") => {
    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      channelId,
      senderId: "me",
      senderName: "Me",
      content,
      type,
      timestamp: Date.now(),
      edited: false,
      reactions: {},
      read: true,
      delivered: true,
    };

    set((state) => {
      const channelMessages = [...(state.messages[channelId] || []), newMessage];
      const updatedChannels = state.channels.map((ch) =>
        ch.id === channelId ? { ...ch, lastMessageAt: Date.now() } : ch
      );

      return {
        messages: { ...state.messages, [channelId]: channelMessages },
        channels: updatedChannels,
      };
    });
  },

  markAsRead: (channelId) => {
    set((state) => ({
      channels: state.channels.map((ch) =>
        ch.id === channelId ? { ...ch, unreadCount: 0 } : ch
      ),
      messages: {
        ...state.messages,
        [channelId]: (state.messages[channelId] || []).map((msg) => ({
          ...msg,
          read: true,
        })),
      },
    }));
  },

  setActiveChannel: (channelId) => {
    set({ activeChannelId: channelId });
    if (channelId) {
      get().markAsRead(channelId);
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilter: (filter) => set({ filter }),

  togglePin: (channelId) => {
    set((state) => ({
      channels: state.channels.map((ch) =>
        ch.id === channelId ? { ...ch, pinned: !ch.pinned } : ch
      ),
    }));
  },

  toggleMute: (channelId) => {
    set((state) => ({
      channels: state.channels.map((ch) =>
        ch.id === channelId ? { ...ch, muted: !ch.muted } : ch
      ),
    }));
  },

  addReaction: (channelId, messageId, emoji) => {
    set((state) => {
      const channelMessages = (state.messages[channelId] || []).map((msg) => {
        if (msg.id !== messageId) return msg;
        const reactions = { ...msg.reactions };
        if (reactions[emoji]?.includes("me")) {
          reactions[emoji] = reactions[emoji].filter((id) => id !== "me");
          if (reactions[emoji].length === 0) delete reactions[emoji];
        } else {
          reactions[emoji] = [...(reactions[emoji] || []), "me"];
        }
        return { ...msg, reactions };
      });
      return { messages: { ...state.messages, [channelId]: channelMessages } };
    });
  },

  getTotalUnread: () => {
    return get().channels.reduce((sum, ch) => sum + ch.unreadCount, 0);
  },
}));
