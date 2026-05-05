/** Conference participant role */
export type ParticipantRole = "moderator" | "speaker" | "listener";

/** Conference participant status */
export type ParticipantStatus = "connected" | "muted" | "on-hold" | "ringing" | "disconnected";

/** Conference state */
export type ConferenceState = "idle" | "creating" | "active" | "ended" | "error";

/** Conference type */
export type ConferenceType = "instant" | "scheduled" | "recurring";

/** A participant in a conference */
export interface Participant {
  id: string;
  name: string;
  extension: string;
  avatar?: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  isMuted: boolean;
  isOnHold: boolean;
  isSpeaking: boolean;
  joinedAt: number;
  /** Audio level 0-100 for visual indicator */
  audioLevel: number;
}

/** Conference room configuration */
export interface ConferenceConfig {
  maxParticipants: number;
  pin?: string;
  moderatorPin?: string;
  recordEnabled: boolean;
  muteOnEntry: boolean;
  announceJoinLeave: boolean;
  waitForModerator: boolean;
  endWhenModeratorLeaves: boolean;
}

/** A conference room */
export interface Conference {
  id: string;
  name: string;
  type: ConferenceType;
  state: ConferenceState;
  bridgeNumber: string;
  config: ConferenceConfig;
  participants: Participant[];
  createdBy: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  scheduledAt?: number;
  duration: number;
  isRecording: boolean;
  recordingUrl?: string;
}

/** Conference action events */
export type ConferenceAction =
  | { type: "mute_participant"; participantId: string }
  | { type: "unmute_participant"; participantId: string }
  | { type: "kick_participant"; participantId: string }
  | { type: "mute_all" }
  | { type: "unmute_all" }
  | { type: "start_recording" }
  | { type: "stop_recording" }
  | { type: "lock_conference" }
  | { type: "unlock_conference" }
  | { type: "promote_to_moderator"; participantId: string }
  | { type: "demote_to_listener"; participantId: string };
