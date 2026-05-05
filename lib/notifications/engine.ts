/**
 * Push Notification Engine
 *
 * Handles push token registration with Flexisip push gateway,
 * FCM/APNs token management, local notification scheduling,
 * and notification dispatch for missed calls and voicemail.
 */

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  AppNotification,
  NotificationType,
  NotificationData,
  NotificationPreferences,
  PushTokenRegistration,
  FlexisipPushConfig,
} from "./types";
import { DEFAULT_PREFERENCES, NOTIFICATION_CONFIG } from "./types";

const STORAGE_KEYS = {
  NOTIFICATIONS: "@cloudphone11_notifications",
  PREFERENCES: "@cloudphone11_notification_prefs",
  PUSH_TOKEN: "@cloudphone11_push_token",
  DEVICE_ID: "@cloudphone11_device_id",
};

// Configure notification handler for foreground display
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

class PushNotificationEngine {
  private pushToken: string | null = null;
  private deviceId: string | null = null;
  private flexisipConfig: FlexisipPushConfig | null = null;
  private initialized = false;

  /**
   * Initialize the notification engine:
   * - Set up Android notification channels
   * - Request permissions
   * - Get push token
   * - Load saved device ID
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      // Set up Android notification channels
      if (Platform.OS === "android") {
        await this.setupAndroidChannels();
      }

      // Request permissions
      const granted = await this.requestPermissions();
      if (!granted) {
        console.warn("[PushEngine] Notification permissions not granted");
        return false;
      }

      // Get or generate device ID
      this.deviceId = await this.getOrCreateDeviceId();

      // Get push token
      this.pushToken = await this.getPushToken();

      this.initialized = true;
      console.log("[PushEngine] Initialized successfully, token:", this.pushToken?.substring(0, 20) + "...");
      return true;
    } catch (error) {
      console.error("[PushEngine] Initialization failed:", error);
      return false;
    }
  }

  /**
   * Set up Android notification channels for different notification types
   */
  private async setupAndroidChannels(): Promise<void> {
    const channels = [
      {
        id: "missed_calls",
        name: "Missed Calls",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FF3B30",
        sound: "default",
      },
      {
        id: "voicemail",
        name: "Voicemail",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
        lightColor: "#8B5CF6",
        sound: "default",
      },
      {
        id: "recordings",
        name: "Recordings",
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: "#FF9500",
      },
      {
        id: "sip_status",
        name: "SIP Status",
        importance: Notifications.AndroidImportance.LOW,
        lightColor: "#06B6D4",
      },
      {
        id: "system",
        name: "System",
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: "#6B7280",
      },
    ];

    for (const channel of channels) {
      await Notifications.setNotificationChannelAsync(channel.id, {
        name: channel.name,
        importance: channel.importance,
        vibrationPattern: channel.vibrationPattern || [0, 250],
        lightColor: channel.lightColor,
        sound: channel.sound || undefined,
      });
    }
  }

  /**
   * Request notification permissions from the user
   */
  async requestPermissions(): Promise<boolean> {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    if (existingStatus === "granted") return true;

    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        allowCriticalAlerts: true,
      },
    });

    return status === "granted";
  }

  /**
   * Get the device push token (Expo push token for simplicity)
   */
  private async getPushToken(): Promise<string | null> {
    try {
      // Try to get Expo push token first (works with Expo Push Service)
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: "cloudphone11",
      });
      const token = tokenData.data;
      await AsyncStorage.setItem(STORAGE_KEYS.PUSH_TOKEN, token);
      return token;
    } catch (error) {
      // Fallback: try to get device push token (FCM/APNs)
      try {
        const tokenData = await Notifications.getDevicePushTokenAsync();
        const token = tokenData.data as string;
        await AsyncStorage.setItem(STORAGE_KEYS.PUSH_TOKEN, token);
        return token;
      } catch (innerError) {
        console.warn("[PushEngine] Could not get push token:", innerError);
        // Return saved token if available
        return await AsyncStorage.getItem(STORAGE_KEYS.PUSH_TOKEN);
      }
    }
  }

  /**
   * Get or create a unique device identifier
   */
  private async getOrCreateDeviceId(): Promise<string> {
    let deviceId = await AsyncStorage.getItem(STORAGE_KEYS.DEVICE_ID);
    if (!deviceId) {
      deviceId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      await AsyncStorage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
    }
    return deviceId;
  }

  /**
   * Register push token with Flexisip push gateway
   */
  async registerWithFlexisip(sipUri: string, config: FlexisipPushConfig): Promise<boolean> {
    this.flexisipConfig = config;

    if (!this.pushToken || !this.deviceId) {
      console.warn("[PushEngine] Cannot register: no push token or device ID");
      return false;
    }

    const registration: PushTokenRegistration = {
      pushToken: this.pushToken,
      tokenType: Platform.OS === "ios" ? "apns" : Platform.OS === "android" ? "fcm" : "expo",
      sipUri,
      deviceId: this.deviceId,
      bundleId: config.apnsBundleId || "space.manus.cloudphone11",
      platform: Platform.OS as "ios" | "android" | "web",
    };

    try {
      // POST to Flexisip push gateway registration endpoint
      const response = await fetch(`${config.gatewayUrl}/api/v1/push/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registration),
      });

      if (response.ok) {
        console.log("[PushEngine] Registered with Flexisip gateway");
        return true;
      }

      console.warn("[PushEngine] Flexisip registration failed:", response.status);
      return false;
    } catch (error) {
      // Expected to fail in demo mode without a real Flexisip server
      console.warn("[PushEngine] Flexisip gateway unreachable (demo mode):", error);
      return false;
    }
  }

  /**
   * Unregister push token from Flexisip
   */
  async unregisterFromFlexisip(): Promise<void> {
    if (!this.flexisipConfig || !this.pushToken) return;

    try {
      await fetch(`${this.flexisipConfig.gatewayUrl}/api/v1/push/unregister`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pushToken: this.pushToken }),
      });
    } catch (error) {
      console.warn("[PushEngine] Flexisip unregister failed:", error);
    }
  }

  /**
   * Dispatch a local notification for a missed call
   */
  async dispatchMissedCall(callerName: string, callerNumber: string): Promise<AppNotification> {
    const notification = this.createNotification("missed_call", {
      title: "Missed Call",
      body: `${callerName} (${callerNumber})`,
      data: { callerName, callerNumber },
      route: "/(tabs)/recents",
    });

    await this.scheduleLocalNotification(notification);
    return notification;
  }

  /**
   * Dispatch a local notification for a new voicemail
   */
  async dispatchVoicemail(
    callerName: string,
    duration: number,
    voicemailId: string,
    transcription?: string
  ): Promise<AppNotification> {
    const durationStr = `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, "0")}`;
    const body = transcription
      ? `${callerName} left a ${durationStr} message: "${transcription.substring(0, 80)}${transcription.length > 80 ? "..." : ""}"`
      : `${callerName} left a ${durationStr} voicemail`;

    const notification = this.createNotification("voicemail", {
      title: "New Voicemail",
      body,
      data: { callerName, voicemailId, voicemailDuration: duration, transcription },
      route: "/voicemail",
    });

    await this.scheduleLocalNotification(notification);
    return notification;
  }

  /**
   * Dispatch a local notification for a recording being ready
   */
  async dispatchRecordingReady(
    contactName: string,
    recordingId: string,
    duration: number
  ): Promise<AppNotification> {
    const durationStr = `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, "0")}`;
    const notification = this.createNotification("recording_ready", {
      title: "Recording Ready",
      body: `Call with ${contactName} (${durationStr}) is now available`,
      data: { recordingId, callerName: contactName },
      route: `/recording/${recordingId}`,
    });

    await this.scheduleLocalNotification(notification);
    return notification;
  }

  /**
   * Dispatch a SIP registration status notification
   */
  async dispatchSipStatus(status: string, serverAddress: string): Promise<AppNotification> {
    const notification = this.createNotification("sip_registration", {
      title: "SIP Registration",
      body: `${status === "registered" ? "Connected to" : "Disconnected from"} ${serverAddress}`,
      data: { registrationStatus: status, serverAddress },
      priority: "low",
    });

    await this.scheduleLocalNotification(notification);
    return notification;
  }

  /**
   * Create a notification object
   */
  private createNotification(
    type: NotificationType,
    params: {
      title: string;
      body: string;
      data?: NotificationData;
      route?: string;
      priority?: "high" | "default" | "low";
    }
  ): AppNotification {
    return {
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      type,
      title: params.title,
      body: params.body,
      timestamp: Date.now(),
      status: "unread",
      priority: params.priority || (type === "missed_call" || type === "voicemail" ? "high" : "default"),
      route: params.route,
      data: params.data,
    };
  }

  /**
   * Schedule a local notification using expo-notifications
   */
  private async scheduleLocalNotification(notification: AppNotification): Promise<void> {
    const config = NOTIFICATION_CONFIG[notification.type];

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: notification.title,
          body: notification.body,
          data: {
            notificationId: notification.id,
            type: notification.type,
            route: notification.route,
            ...notification.data,
          },
          sound: true,
          ...(Platform.OS === "android" && {
            channelId: config.androidChannel,
          }),
        },
        trigger: null, // Show immediately
      });
    } catch (error) {
      console.warn("[PushEngine] Failed to schedule local notification:", error);
    }
  }

  /**
   * Update the app badge count
   */
  async setBadgeCount(count: number): Promise<void> {
    try {
      await Notifications.setBadgeCountAsync(count);
    } catch (error) {
      console.warn("[PushEngine] Failed to set badge count:", error);
    }
  }

  /**
   * Dismiss all notifications from the notification tray
   */
  async dismissAll(): Promise<void> {
    try {
      await Notifications.dismissAllNotificationsAsync();
    } catch (error) {
      console.warn("[PushEngine] Failed to dismiss notifications:", error);
    }
  }

  /**
   * Load saved notifications from AsyncStorage
   */
  async loadNotifications(): Promise<AppNotification[]> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  /**
   * Save notifications to AsyncStorage
   */
  async saveNotifications(notifications: AppNotification[]): Promise<void> {
    try {
      // Keep only the last 100 notifications
      const trimmed = notifications.slice(0, 100);
      await AsyncStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(trimmed));
    } catch (error) {
      console.warn("[PushEngine] Failed to save notifications:", error);
    }
  }

  /**
   * Load notification preferences from AsyncStorage
   */
  async loadPreferences(): Promise<NotificationPreferences> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.PREFERENCES);
      return raw ? { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) } : DEFAULT_PREFERENCES;
    } catch {
      return DEFAULT_PREFERENCES;
    }
  }

  /**
   * Save notification preferences to AsyncStorage
   */
  async savePreferences(prefs: NotificationPreferences): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.PREFERENCES, JSON.stringify(prefs));
    } catch (error) {
      console.warn("[PushEngine] Failed to save preferences:", error);
    }
  }

  /**
   * Generate mock notifications for demo purposes
   */
  generateMockNotifications(): AppNotification[] {
    const now = Date.now();
    const hour = 3600000;
    const day = 86400000;

    return [
      {
        id: "notif-001",
        type: "missed_call",
        title: "Missed Call",
        body: "Sarah Johnson (+1 555-234-5678)",
        timestamp: now - 15 * 60000,
        status: "unread",
        priority: "high",
        route: "/(tabs)/recents",
        data: { callerName: "Sarah Johnson", callerNumber: "+1 (555) 234-5678" },
      },
      {
        id: "notif-002",
        type: "voicemail",
        title: "New Voicemail",
        body: 'David Kim left a 1:23 message: "Hey, just calling about the project deadline tomorrow..."',
        timestamp: now - 45 * 60000,
        status: "unread",
        priority: "high",
        route: "/voicemail",
        data: {
          callerName: "David Kim",
          voicemailId: "vm-001",
          voicemailDuration: 83,
          transcription: "Hey, just calling about the project deadline tomorrow. Can you give me a callback when you get a chance?",
        },
      },
      {
        id: "notif-003",
        type: "missed_call",
        title: "Missed Call",
        body: "+44 20 7946 0958",
        timestamp: now - 2 * hour,
        status: "unread",
        priority: "high",
        route: "/(tabs)/recents",
        data: { callerName: "Unknown", callerNumber: "+44 20 7946 0958" },
      },
      {
        id: "notif-004",
        type: "recording_ready",
        title: "Recording Ready",
        body: "Call with Vendor Support (1:35) is now available",
        timestamp: now - 3 * hour,
        status: "read",
        priority: "default",
        route: "/recording/rec-004",
        data: { recordingId: "rec-004", callerName: "Vendor Support" },
      },
      {
        id: "notif-005",
        type: "voicemail",
        title: "New Voicemail",
        body: "Mike Chen left a 0:45 voicemail",
        timestamp: now - 5 * hour,
        status: "read",
        priority: "high",
        route: "/voicemail",
        data: {
          callerName: "Mike Chen",
          voicemailId: "vm-002",
          voicemailDuration: 45,
        },
      },
      {
        id: "notif-006",
        type: "missed_call",
        title: "Missed Call",
        body: "Acme Corp (+1 800-555-0123)",
        timestamp: now - 1 * day,
        status: "read",
        priority: "high",
        route: "/(tabs)/recents",
        data: { callerName: "Acme Corp", callerNumber: "+1 (800) 555-0123" },
      },
      {
        id: "notif-007",
        type: "sip_registration",
        title: "SIP Registration",
        body: "Connected to sip.yourserver.com",
        timestamp: now - 1 * day - 2 * hour,
        status: "read",
        priority: "low",
        data: { registrationStatus: "registered", serverAddress: "sip.yourserver.com" },
      },
      {
        id: "notif-008",
        type: "system",
        title: "System Update",
        body: "CloudPhone11 v1.8 is now available with AI transcript analysis",
        timestamp: now - 2 * day,
        status: "read",
        priority: "default",
      },
    ];
  }

  /**
   * Get the current push token
   */
  getToken(): string | null {
    return this.pushToken;
  }

  /**
   * Check if engine is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

export const pushEngine = new PushNotificationEngine();
