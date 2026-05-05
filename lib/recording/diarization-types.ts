/**
 * Speaker Diarization Types
 *
 * Data models for speaker identification and segmentation
 * in call recording transcripts. Supports 2+ speakers with
 * timestamped segments, confidence scores, and speaker metadata.
 */

/** Status of the diarization process */
export type DiarizationStatus = "idle" | "processing" | "completed" | "failed";

/** A single speaker identified in the call */
export interface Speaker {
  /** Unique speaker identifier (e.g., "speaker_0", "speaker_1") */
  id: string;
  /** Display label (e.g., "Caller", "Agent", "Speaker 3") */
  label: string;
  /** Resolved name if matched to a known contact */
  name?: string;
  /** Assigned color for UI display */
  color: string;
  /** Total speaking time in seconds */
  totalDuration: number;
  /** Percentage of total call time this speaker spoke */
  talkPercentage: number;
  /** Average sentiment for this speaker's segments */
  averageSentiment: number;
  /** Number of segments attributed to this speaker */
  segmentCount: number;
}

/** A single timestamped segment of speech attributed to a speaker */
export interface DiarizedSegment {
  /** Segment index */
  index: number;
  /** Speaker ID this segment belongs to */
  speakerId: string;
  /** Start time in seconds from recording start */
  startTime: number;
  /** End time in seconds from recording start */
  endTime: number;
  /** Duration in seconds */
  duration: number;
  /** Transcribed text for this segment */
  text: string;
  /** Confidence score for speaker attribution (0-1) */
  confidence: number;
  /** Per-segment sentiment score (-1 to 1) */
  sentimentScore?: number;
}

/** Full diarization result for a call recording */
export interface DiarizationResult {
  /** Recording ID this result belongs to */
  recordingId: string;
  /** When diarization was performed (ms timestamp) */
  processedAt: number;
  /** Processing status */
  status: DiarizationStatus;
  /** Error message if processing failed */
  error?: string;
  /** List of identified speakers */
  speakers: Speaker[];
  /** Ordered list of diarized transcript segments */
  segments: DiarizedSegment[];
  /** Total number of speaker turns (transitions) */
  turnCount: number;
  /** Average segment duration in seconds */
  averageSegmentDuration: number;
  /** Overlap percentage (how much speakers talked over each other) */
  overlapPercentage: number;
}

/** Speaker colors palette for up to 6 speakers */
export const SPEAKER_COLORS = [
  "#0A7EA4", // Teal (Caller / primary)
  "#8B5CF6", // Purple (Agent / secondary)
  "#F59E0B", // Amber
  "#22C55E", // Green
  "#EF4444", // Red
  "#EC4899", // Pink
];

/** A manual correction applied to a speaker label */
export interface SpeakerCorrection {
  /** The speaker ID being corrected */
  speakerId: string;
  /** Original label before correction */
  originalLabel: string;
  /** Original name before correction */
  originalName?: string;
  /** Corrected label */
  newLabel: string;
  /** Corrected name */
  newName?: string;
  /** When the correction was made (ms timestamp) */
  correctedAt: number;
}

/** A segment reassignment — moving a segment to a different speaker */
export interface SegmentReassignment {
  /** Segment index being reassigned */
  segmentIndex: number;
  /** Original speaker ID */
  fromSpeakerId: string;
  /** New speaker ID */
  toSpeakerId: string;
  /** When the reassignment was made (ms timestamp) */
  reassignedAt: number;
}

/** Full correction history for a recording's diarization */
export interface DiarizationCorrections {
  recordingId: string;
  speakerCorrections: SpeakerCorrection[];
  segmentReassignments: SegmentReassignment[];
  lastModified: number;
}

/** Request payload for diarization */
export interface DiarizeTranscriptRequest {
  recordingId: string;
  transcription: string;
  callerName: string;
  calleeName: string;
  duration: number;
}
