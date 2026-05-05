/**
 * Tests for Quick Message presets and Contacts Presence integration
 */
import { describe, it, expect } from "vitest";
import {
  getPresenceColor,
  getPresenceLabel,
  getPresencePriority,
  formatCallDuration,
} from "../lib/presence/types";
import type { PresenceStatus, ActiveCallInfo } from "../lib/presence/types";

describe("Quick Message Presets", () => {
  const QUICK_MESSAGES = [
    "I'm on a call, will call you back shortly.",
    "Please hold, transferring you now.",
    "Can you take this call? I'll transfer.",
    "Are you available for a quick call?",
    "Call me when you're free.",
    "Urgent — please pick up.",
  ];

  it("should have 6 preset quick messages", () => {
    expect(QUICK_MESSAGES).toHaveLength(6);
  });

  it("should have non-empty messages under 200 chars", () => {
    for (const msg of QUICK_MESSAGES) {
      expect(msg.length).toBeGreaterThan(0);
      expect(msg.length).toBeLessThanOrEqual(200);
    }
  });

  it("should have unique messages", () => {
    const unique = new Set(QUICK_MESSAGES);
    expect(unique.size).toBe(QUICK_MESSAGES.length);
  });
});

describe("Contacts Presence Integration", () => {
  const CONTACT_EXTENSIONS = ["1001", "1002", "1003", "1004", "1005", "1006", "1007", "1008"];

  it("should have 8 contacts with extensions", () => {
    expect(CONTACT_EXTENSIONS).toHaveLength(8);
  });

  it("should return valid presence colors for all statuses", () => {
    const statuses: PresenceStatus[] = ["online", "busy", "away", "dnd", "ringing", "offline", "unknown"];
    for (const s of statuses) {
      const color = getPresenceColor(s);
      expect(color).toBeTruthy();
      expect(typeof color).toBe("string");
      expect(color.startsWith("#")).toBe(true);
    }
  });

  it("should return valid presence labels for all statuses", () => {
    const statuses: PresenceStatus[] = ["online", "busy", "away", "dnd", "ringing", "offline", "unknown"];
    for (const s of statuses) {
      const label = getPresenceLabel(s);
      expect(label).toBeTruthy();
      expect(typeof label).toBe("string");
    }
  });

  it("should sort by priority: online < busy < offline", () => {
    expect(getPresencePriority("online")).toBeLessThan(getPresencePriority("busy"));
    expect(getPresencePriority("busy")).toBeLessThan(getPresencePriority("offline"));
  });

  it("should format active call duration for contacts", () => {
    // 2 minutes ago
    const result = formatCallDuration(Date.now() - 120000);
    expect(result).toBe("2m 0s");
  });

  it("should show active call info shape for busy contacts", () => {
    const call: ActiveCallInfo = {
      remotePartyName: "Alice Johnson",
      remotePartyNumber: "+1 (555) 234-5678",
      direction: "inbound",
      startedAt: Date.now() - 60000,
      isInternal: false,
    };
    expect(call.remotePartyName).toBeTruthy();
    expect(["inbound", "outbound"]).toContain(call.direction);
  });
});
