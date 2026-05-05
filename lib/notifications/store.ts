/**
 * Notification Store
 *
 * Zustand store for managing push notifications, unread counts,
 * preferences, and notification lifecycle.
 */

import { create } from "zustand";
import type {
  AppNotification,
  NotificationPreferences,
  NotificationType,
} from "./types";
import { DEFAULT_PREFERENCES } from "./types";
import { pushEngine } from "./engine";

interface NotificationState {
  notifications: AppNotification[];
  preferences: NotificationPreferences;
  isLoading: boolean;
  unreadCount: number;

  // Data actions
  initialize: () => Promise<void>;
  addNotification: (notification: AppNotification) => void;
  markAsRead: (notificationId: string) => void;
  markAllAsRead: () => void;
  dismissNotification: (notificationId: string) => void;
  clearAll: () => void;
  clearByType: (type: NotificationType) => void;

  // Preference actions
  updatePreferences: (prefs: Partial<NotificationPreferences>) => void;
  toggleCategory: (category: keyof NotificationPreferences) => void;

  // Dispatch actions (create + schedule notification)
  dispatchMissedCall: (callerName: string, callerNumber: string) => Promise<void>;
  dispatchVoicemail: (callerName: string, duration: number, voicemailId: string, transcription?: string) => Promise<void>;
  dispatchRecordingReady: (contactName: string, recordingId: string, duration: number) => Promise<void>;
}

const computeUnreadCount = (notifications: AppNotification[]): number =>
  notifications.filter((n) => n.status === "unread").length;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  preferences: DEFAULT_PREFERENCES,
  isLoading: false,
  unreadCount: 0,

  initialize: async () => {
    set({ isLoading: true });
    try {
      // Initialize push engine
      await pushEngine.initialize();

      // Load saved notifications and preferences
      const [savedNotifications, savedPreferences] = await Promise.all([
        pushEngine.loadNotifications(),
        pushEngine.loadPreferences(),
      ]);

      // If no saved notifications, use mock data for demo
      const notifications = savedNotifications.length > 0
        ? savedNotifications
        : pushEngine.generateMockNotifications();

      set({
        notifications,
        preferences: savedPreferences,
        unreadCount: computeUnreadCount(notifications),
        isLoading: false,
      });

      // Update badge count
      const unread = computeUnreadCount(notifications);
      await pushEngine.setBadgeCount(unread);
    } catch (error) {
      console.error("[NotificationStore] Init failed:", error);
      // Fall back to mock data
      const mockNotifications = pushEngine.generateMockNotifications();
      set({
        notifications: mockNotifications,
        preferences: DEFAULT_PREFERENCES,
        unreadCount: computeUnreadCount(mockNotifications),
        isLoading: false,
      });
    }
  },

  addNotification: (notification) => {
    set((state) => {
      const updated = [notification, ...state.notifications];
      const unreadCount = computeUnreadCount(updated);
      // Persist in background
      pushEngine.saveNotifications(updated);
      pushEngine.setBadgeCount(unreadCount);
      return { notifications: updated, unreadCount };
    });
  },

  markAsRead: (notificationId) => {
    set((state) => {
      const updated = state.notifications.map((n) =>
        n.id === notificationId ? { ...n, status: "read" as const } : n
      );
      const unreadCount = computeUnreadCount(updated);
      pushEngine.saveNotifications(updated);
      pushEngine.setBadgeCount(unreadCount);
      return { notifications: updated, unreadCount };
    });
  },

  markAllAsRead: () => {
    set((state) => {
      const updated = state.notifications.map((n) => ({
        ...n,
        status: "read" as const,
      }));
      pushEngine.saveNotifications(updated);
      pushEngine.setBadgeCount(0);
      return { notifications: updated, unreadCount: 0 };
    });
  },

  dismissNotification: (notificationId) => {
    set((state) => {
      const updated = state.notifications.filter((n) => n.id !== notificationId);
      const unreadCount = computeUnreadCount(updated);
      pushEngine.saveNotifications(updated);
      pushEngine.setBadgeCount(unreadCount);
      return { notifications: updated, unreadCount };
    });
  },

  clearAll: () => {
    pushEngine.saveNotifications([]);
    pushEngine.setBadgeCount(0);
    pushEngine.dismissAll();
    set({ notifications: [], unreadCount: 0 });
  },

  clearByType: (type) => {
    set((state) => {
      const updated = state.notifications.filter((n) => n.type !== type);
      const unreadCount = computeUnreadCount(updated);
      pushEngine.saveNotifications(updated);
      pushEngine.setBadgeCount(unreadCount);
      return { notifications: updated, unreadCount };
    });
  },

  updatePreferences: (prefs) => {
    set((state) => {
      const updated = { ...state.preferences, ...prefs };
      pushEngine.savePreferences(updated);
      return { preferences: updated };
    });
  },

  toggleCategory: (category) => {
    set((state) => {
      const current = state.preferences[category];
      if (typeof current !== "boolean") return state;
      const updated = { ...state.preferences, [category]: !current };
      pushEngine.savePreferences(updated);
      return { preferences: updated };
    });
  },

  // Dispatch actions — check preferences before sending
  dispatchMissedCall: async (callerName, callerNumber) => {
    const { preferences } = get();
    if (!preferences.enabled || !preferences.missedCalls) return;

    const notification = await pushEngine.dispatchMissedCall(callerName, callerNumber);
    get().addNotification(notification);
  },

  dispatchVoicemail: async (callerName, duration, voicemailId, transcription) => {
    const { preferences } = get();
    if (!preferences.enabled || !preferences.voicemail) return;

    const notification = await pushEngine.dispatchVoicemail(callerName, duration, voicemailId, transcription);
    get().addNotification(notification);
  },

  dispatchRecordingReady: async (contactName, recordingId, duration) => {
    const { preferences } = get();
    if (!preferences.enabled || !preferences.recordingReady) return;

    const notification = await pushEngine.dispatchRecordingReady(contactName, recordingId, duration);
    get().addNotification(notification);
  },
}));
