/**
 * Presence Types — CloudPhone11
 *
 * Enhanced data models for contact presence status using SIP SUBSCRIBE/NOTIFY
 * and BLF (Busy Lamp Field) monitoring.
 */

/** Presence status values aligned with SIP/XMPP presence + BLF */
export type PresenceStatus =
  | "online"        // Available, ready to take calls
  | "busy"          // On a call or in a meeting
  | "away"          // Idle / stepped away
  | "dnd"           // Do Not Disturb
  | "ringing"       // Currently ringing (incoming call)
  | "offline"       // Not registered / unreachable
  | "unknown";      // Status not yet determined

/** Visual configuration for each presence status */
export interface PresenceStatusConfig {
  label: string;
  color: string;
  priority: number;  // Lower = more available (used for sorting)
}

/** Map of status to visual config */
export const PRESENCE_STATUS_CONFIG: Record<PresenceStatus, PresenceStatusConfig> = {
  online:  { label: "Available",       color: "#22C55E", priority: 1 },
  ringing: { label: "Ringing",         color: "#F59E0B", priority: 2 },
  busy:    { label: "Busy",            color: "#EF4444", priority: 3 },
  away:    { label: "Away",            color: "#F59E0B", priority: 4 },
  dnd:     { label: "Do Not Disturb",  color: "#8B5CF6", priority: 5 },
  offline: { label: "Offline",         color: "#9CA3AF", priority: 6 },
  unknown: { label: "Unknown",         color: "#9CA3AF", priority: 7 },
};

/** Get the color for a given presence status */
export function getPresenceColor(status: PresenceStatus): string {
  return PRESENCE_STATUS_CONFIG[status]?.color ?? "#9CA3AF";
}

/** Get the label for a given presence status */
export function getPresenceLabel(status: PresenceStatus): string {
  return PRESENCE_STATUS_CONFIG[status]?.label ?? "Unknown";
}

/** Get the sort priority for a given presence status (lower = more available) */
export function getPresencePriority(status: PresenceStatus): number {
  return PRESENCE_STATUS_CONFIG[status]?.priority ?? 7;
}

/** BLF Dialog State from SIP NOTIFY (RFC 4235) */
export type BLFDialogState =
  | "trying"       // Call attempt in progress
  | "proceeding"   // Ringing
  | "early"        // Early media
  | "confirmed"    // Call connected
  | "terminated";  // Call ended

/** Map BLF dialog state to presence status */
export function dialogStateToPresence(state: BLFDialogState): PresenceStatus {
  switch (state) {
    case "trying":
    case "proceeding":
    case "early":
      return "ringing";
    case "confirmed":
      return "busy";
    case "terminated":
      return "online";
    default:
      return "unknown";
  }
}

/** Active call information for busy/ringing contacts */
export interface ActiveCallInfo {
  remotePartyName: string;      // Display name of the other party
  remotePartyNumber: string;    // Phone number or extension of the other party
  direction: "inbound" | "outbound"; // Call direction
  startedAt: number;            // Unix timestamp when the call started
  isInternal: boolean;          // Whether the call is internal (extension-to-extension)
}

/** Get a human-readable call duration string from a start timestamp */
export function formatCallDuration(startedAt: number): string {
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

/** Presence event emitted when status changes */
export interface PresenceEvent {
  extension: string;
  previousStatus: PresenceStatus;
  newStatus: PresenceStatus;
  timestamp: number;
  source: "blf" | "subscribe" | "manual" | "timeout";
  activeCall?: ActiveCallInfo;  // Present when newStatus is busy or ringing
}
