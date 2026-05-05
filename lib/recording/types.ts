/** Call recording data models for FreeSWITCH server-side recording */

export type RecordingFormat = "wav" | "mp3" | "ogg";
export type RecordingStatus = "recording" | "completed" | "failed" | "processing" | "deleted";
export type RecordingDirection = "inbound" | "outbound" | "conference";

export interface CallRecording {
  id: string;
  /** Associated call UUID from FreeSWITCH */
  callUuid: string;
  /** Caller extension or phone number */
  callerNumber: string;
  callerName: string;
  /** Callee extension or phone number */
  calleeNumber: string;
  calleeName: string;
  /** Call direction */
  direction: RecordingDirection;
  /** Recording start timestamp (ms) */
  startedAt: number;
  /** Recording end timestamp (ms) */
  endedAt: number;
  /** Duration in seconds */
  duration: number;
  /** File size in bytes */
  fileSize: number;
  /** Audio format */
  format: RecordingFormat;
  /** Server-side file path on FreeSWITCH */
  serverPath: string;
  /** Download URL for playback */
  downloadUrl: string;
  /** Recording status */
  status: RecordingStatus;
  /** Whether this recording has been listened to */
  isPlayed: boolean;
  /** Whether this recording is starred/bookmarked */
  isStarred: boolean;
  /** Optional transcription text */
  transcription?: string;
  /** Optional notes added by user */
  notes?: string;
  /** Tags for categorization */
  tags: string[];
}

export interface RecordingFilter {
  search?: string;
  direction?: RecordingDirection | "all";
  dateFrom?: number;
  dateTo?: number;
  minDuration?: number;
  maxDuration?: number;
  isStarred?: boolean;
  status?: RecordingStatus;
}

export interface RecordingPlaybackState {
  recordingId: string | null;
  isPlaying: boolean;
  currentPosition: number; // seconds
  duration: number; // seconds
  playbackSpeed: number; // 0.5, 1.0, 1.5, 2.0
}

export interface FreeSwitchRecordingConfig {
  /** Recording format */
  format: RecordingFormat;
  /** Recording directory on FreeSWITCH server */
  recordDir: string;
  /** Max recording duration in seconds (0 = unlimited) */
  maxDuration: number;
  /** Silence detection threshold (0 = disabled) */
  silenceThreshold: number;
  /** Silence duration before auto-stop (seconds) */
  silenceHits: number;
  /** Enable stereo recording (separate channels per leg) */
  stereo: boolean;
  /** Auto-record all calls */
  autoRecord: boolean;
  /** Record announcement before recording starts */
  playBeep: boolean;
}

/** FreeSWITCH ESL command for recording control */
export interface RecordingCommand {
  type: "start" | "stop" | "pause" | "resume" | "mask" | "unmask";
  callUuid: string;
  filePath?: string;
}
