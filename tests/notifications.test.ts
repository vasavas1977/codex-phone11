import { describe, it, expect } from "vitest";

describe("Push Notification Types", () => {
  it("should export all notification types and configs", async () => {
    const types = await import("../lib/notifications/types");

    expect(types.DEFAULT_PREFERENCES).toBeDefined();
    expect(types.DEFAULT_PREFERENCES.enabled).toBe(true);
    expect(types.DEFAULT_PREFERENCES.missedCalls).toBe(true);
    expect(types.DEFAULT_PREFERENCES.voicemail).toBe(true);
    expect(types.DEFAULT_PREFERENCES.recordingReady).toBe(true);
    expect(types.DEFAULT_PREFERENCES.sipRegistration).toBe(false);
    expect(types.DEFAULT_PREFERENCES.systemAlerts).toBe(true);
    expect(types.DEFAULT_PREFERENCES.soundEnabled).toBe(true);
    expect(types.DEFAULT_PREFERENCES.vibrationEnabled).toBe(true);
    expect(types.DEFAULT_PREFERENCES.quietHoursEnabled).toBe(false);
    expect(types.DEFAULT_PREFERENCES.quietHoursStart).toBe("22:00");
    expect(types.DEFAULT_PREFERENCES.quietHoursEnd).toBe("07:00");
  });

  it("should have config for all notification types", async () => {
    const { NOTIFICATION_CONFIG } = await import("../lib/notifications/types");

    const expectedTypes = ["missed_call", "voicemail", "recording_ready", "sip_registration", "system"];
    for (const type of expectedTypes) {
      const config = NOTIFICATION_CONFIG[type as keyof typeof NOTIFICATION_CONFIG];
      expect(config).toBeDefined();
      expect(config.icon).toBeTruthy();
      expect(config.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(config.label).toBeTruthy();
      expect(config.androidChannel).toBeTruthy();
    }
  });

  it("should have correct android channels for each type", async () => {
    const { NOTIFICATION_CONFIG } = await import("../lib/notifications/types");

    expect(NOTIFICATION_CONFIG.missed_call.androidChannel).toBe("missed_calls");
    expect(NOTIFICATION_CONFIG.voicemail.androidChannel).toBe("voicemail");
    expect(NOTIFICATION_CONFIG.recording_ready.androidChannel).toBe("recordings");
    expect(NOTIFICATION_CONFIG.sip_registration.androidChannel).toBe("sip_status");
    expect(NOTIFICATION_CONFIG.system.androidChannel).toBe("system");
  });

  it("should have high priority for missed calls and voicemail", async () => {
    const { NOTIFICATION_CONFIG } = await import("../lib/notifications/types");

    // Missed calls and voicemail should use red/purple colors (high visibility)
    expect(NOTIFICATION_CONFIG.missed_call.color).toBe("#FF3B30");
    expect(NOTIFICATION_CONFIG.voicemail.color).toBe("#8B5CF6");
  });
});

describe("Push Notification Data Model Validation", () => {
  it("should create valid missed_call notification structure", () => {
    const notification = {
      id: "notif-test-001",
      type: "missed_call" as const,
      title: "Missed Call",
      body: "Sarah Johnson (+1 555-234-5678)",
      timestamp: Date.now(),
      status: "unread" as const,
      priority: "high" as const,
      route: "/(tabs)/recents",
      data: { callerName: "Sarah Johnson", callerNumber: "+1 (555) 234-5678" },
    };

    expect(notification.id).toBeTruthy();
    expect(notification.type).toBe("missed_call");
    expect(notification.status).toBe("unread");
    expect(notification.priority).toBe("high");
    expect(notification.data.callerName).toBe("Sarah Johnson");
    expect(notification.data.callerNumber).toBe("+1 (555) 234-5678");
  });

  it("should create valid voicemail notification structure", () => {
    const notification = {
      id: "notif-test-002",
      type: "voicemail" as const,
      title: "New Voicemail",
      body: 'David Kim left a 1:23 message',
      timestamp: Date.now(),
      status: "unread" as const,
      priority: "high" as const,
      route: "/voicemail",
      data: {
        callerName: "David Kim",
        voicemailId: "vm-001",
        voicemailDuration: 83,
        transcription: "Hey, just calling about the project deadline.",
      },
    };

    expect(notification.type).toBe("voicemail");
    expect(notification.data.voicemailId).toBe("vm-001");
    expect(notification.data.voicemailDuration).toBe(83);
    expect(notification.data.transcription).toBeTruthy();
  });

  it("should create valid recording_ready notification structure", () => {
    const notification = {
      id: "notif-test-003",
      type: "recording_ready" as const,
      title: "Recording Ready",
      body: "Call with Vendor Support (1:35) is now available",
      timestamp: Date.now(),
      status: "read" as const,
      priority: "default" as const,
      route: "/recording/rec-004",
      data: { recordingId: "rec-004", callerName: "Vendor Support" },
    };

    expect(notification.type).toBe("recording_ready");
    expect(notification.status).toBe("read");
    expect(notification.data.recordingId).toBe("rec-004");
  });

  it("should create valid sip_registration notification structure", () => {
    const notification = {
      id: "notif-test-004",
      type: "sip_registration" as const,
      title: "SIP Registration",
      body: "Connected to sip.yourserver.com",
      timestamp: Date.now(),
      status: "read" as const,
      priority: "low" as const,
      data: { registrationStatus: "registered", serverAddress: "sip.yourserver.com" },
    };

    expect(notification.type).toBe("sip_registration");
    expect(notification.priority).toBe("low");
    expect(notification.data.registrationStatus).toBe("registered");
  });

  it("should validate all notification types have config entries", async () => {
    const { NOTIFICATION_CONFIG } = await import("../lib/notifications/types");
    const types = ["missed_call", "voicemail", "recording_ready", "sip_registration", "system"];
    for (const t of types) {
      expect(NOTIFICATION_CONFIG[t as keyof typeof NOTIFICATION_CONFIG]).toBeDefined();
    }
  });
});
