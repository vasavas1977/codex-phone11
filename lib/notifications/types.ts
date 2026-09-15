export type NotificationType =
  | "missed_call"
  | "voicemail"
  | "recording_ready"
  | "sip_registration"
  | "system";

export type NotificationStatus = "unread" | "read" | "dismissed";

export type NotificationPriority = "high" | "default" | "low";

export interface NotificationData {
  callerName?: string;
  callerNumber?: string;
  voicemailId?: string;
  voicemailDuration?: number;
  transcription?: string;
  recordingId?: string;
  registrationStatus?: string;
  serverAddress?: string;
  [key: string]: unknown;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: number;
  status: NotificationStatus;
  priority: NotificationPriority;
  route?: string;
  data?: NotificationData;
}

export interface NotificationPreferences {
  enabled: boolean;
  missedCalls: boolean;
  voicemail: boolean;
  recordingReady: boolean;
  sipRegistration: boolean;
  systemAlerts: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

export interface PushTokenRegistration {
  pushToken: string;
  tokenType: "apns" | "fcm" | "expo";
  sipUri: string;
  deviceId: string;
  bundleId: string;
  platform: "ios" | "android" | "web";
}

export interface FlexisipPushConfig {
  gatewayUrl: string;
  apnsBundleId?: string;
  authToken?: string;
}

export interface NotificationConfig {
  icon: string;
  color: string;
  label: string;
  androidChannel: string;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  missedCalls: true,
  voicemail: true,
  recordingReady: true,
  sipRegistration: false,
  systemAlerts: true,
  soundEnabled: true,
  vibrationEnabled: true,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
};

export const NOTIFICATION_CONFIG: Record<NotificationType, NotificationConfig> = {
  missed_call: {
    icon: "phone.fill.arrow.down.left",
    color: "#FF3B30",
    label: "Missed Call",
    androidChannel: "missed_calls",
  },
  voicemail: {
    icon: "voicemail",
    color: "#8B5CF6",
    label: "Voicemail",
    androidChannel: "voicemail",
  },
  recording_ready: {
    icon: "record.circle.fill",
    color: "#FF9500",
    label: "Recording Ready",
    androidChannel: "recordings",
  },
  sip_registration: {
    icon: "antenna.radiowaves.left.and.right",
    color: "#06B6D4",
    label: "SIP Registration",
    androidChannel: "sip_status",
  },
  system: {
    icon: "info.circle",
    color: "#6B7280",
    label: "System",
    androidChannel: "system",
  },
};
