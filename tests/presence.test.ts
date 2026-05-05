/**
 * Tests for Presence Types and Configuration
 */
import { describe, it, expect } from "vitest";
import {
  PRESENCE_STATUS_CONFIG,
  getPresenceColor,
  getPresenceLabel,
  getPresencePriority,
  dialogStateToPresence,
  formatCallDuration,
} from "../lib/presence/types";
import type { PresenceStatus, BLFDialogState, ActiveCallInfo } from "../lib/presence/types";

describe("Presence Types", () => {
  it("should have config for all 7 status values", () => {
    const statuses: PresenceStatus[] = [
      "online", "busy", "away", "dnd", "ringing", "offline", "unknown",
    ];
    for (const s of statuses) {
      expect(PRESENCE_STATUS_CONFIG[s]).toBeDefined();
      expect(PRESENCE_STATUS_CONFIG[s].label).toBeTruthy();
      expect(PRESENCE_STATUS_CONFIG[s].color).toMatch(/^#/);
      expect(PRESENCE_STATUS_CONFIG[s].priority).toBeGreaterThan(0);
    }
  });

  it("should return correct colors for each status", () => {
    expect(getPresenceColor("online")).toBe("#22C55E");
    expect(getPresenceColor("busy")).toBe("#EF4444");
    expect(getPresenceColor("away")).toBe("#F59E0B");
    expect(getPresenceColor("dnd")).toBe("#8B5CF6");
    expect(getPresenceColor("ringing")).toBe("#F59E0B");
    expect(getPresenceColor("offline")).toBe("#9CA3AF");
    expect(getPresenceColor("unknown")).toBe("#9CA3AF");
  });

  it("should return correct labels for each status", () => {
    expect(getPresenceLabel("online")).toBe("Available");
    expect(getPresenceLabel("busy")).toBe("Busy");
    expect(getPresenceLabel("dnd")).toBe("Do Not Disturb");
    expect(getPresenceLabel("ringing")).toBe("Ringing");
    expect(getPresenceLabel("offline")).toBe("Offline");
  });

  it("should sort by priority: online < ringing < busy < away < dnd < offline < unknown", () => {
    const priorities = [
      getPresencePriority("online"),
      getPresencePriority("ringing"),
      getPresencePriority("busy"),
      getPresencePriority("away"),
      getPresencePriority("dnd"),
      getPresencePriority("offline"),
      getPresencePriority("unknown"),
    ];
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1]);
    }
  });

  it("should map BLF dialog states to presence statuses", () => {
    const mappings: [BLFDialogState, PresenceStatus][] = [
      ["trying", "ringing"],
      ["proceeding", "ringing"],
      ["early", "ringing"],
      ["confirmed", "busy"],
      ["terminated", "online"],
    ];
    for (const [dialog, expected] of mappings) {
      expect(dialogStateToPresence(dialog)).toBe(expected);
    }
  });

  it("should handle unknown dialog state gracefully", () => {
    expect(dialogStateToPresence("invalid" as BLFDialogState)).toBe("unknown");
  });

  it("should have unique priority values for distinct availability tiers", () => {
    const onlinePriority = getPresencePriority("online");
    const busyPriority = getPresencePriority("busy");
    const offlinePriority = getPresencePriority("offline");
    expect(onlinePriority).toBeLessThan(busyPriority);
    expect(busyPriority).toBeLessThan(offlinePriority);
  });
});

describe("ActiveCallInfo", () => {
  it("should have correct shape for active call info", () => {
    const call: ActiveCallInfo = {
      remotePartyName: "Alice Johnson",
      remotePartyNumber: "+1 (555) 234-5678",
      direction: "inbound",
      startedAt: Date.now() - 120000,
      isInternal: false,
    };
    expect(call.remotePartyName).toBe("Alice Johnson");
    expect(call.direction).toBe("inbound");
    expect(call.isInternal).toBe(false);
    expect(call.startedAt).toBeLessThan(Date.now());
  });

  it("should support internal extension calls", () => {
    const call: ActiveCallInfo = {
      remotePartyName: "Bob Williams",
      remotePartyNumber: "ext. 102",
      direction: "outbound",
      startedAt: Date.now() - 30000,
      isInternal: true,
    };
    expect(call.isInternal).toBe(true);
    expect(call.direction).toBe("outbound");
    expect(call.remotePartyNumber).toBe("ext. 102");
  });

  it("should format call duration correctly for seconds", () => {
    const now = Date.now();
    // 45 seconds ago
    const result = formatCallDuration(now - 45000);
    expect(result).toBe("45s");
  });

  it("should format call duration correctly for minutes", () => {
    const now = Date.now();
    // 3 minutes 15 seconds ago
    const result = formatCallDuration(now - 195000);
    expect(result).toBe("3m 15s");
  });

  it("should handle zero duration gracefully", () => {
    const result = formatCallDuration(Date.now());
    expect(result).toBe("0s");
  });

  it("should handle future timestamps gracefully", () => {
    const result = formatCallDuration(Date.now() + 10000);
    expect(result).toBe("0s");
  });
});
