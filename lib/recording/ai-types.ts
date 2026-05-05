/**
 * AI Call Transcript Analysis Types
 *
 * Data models for AI-powered transcript analysis including
 * topic extraction, summarization, sentiment analysis, and action items.
 */

/** Sentiment classification for the overall call or individual segments */
export type SentimentLabel = "positive" | "neutral" | "negative" | "mixed";

/** Urgency level for action items */
export type UrgencyLevel = "high" | "medium" | "low";

/** Status of the AI analysis process */
export type AnalysisStatus = "idle" | "analyzing" | "completed" | "failed";

/** A single extracted topic from the call */
export interface CallTopic {
  /** Short label for the topic (e.g., "Billing Issue", "Product Demo") */
  label: string;
  /** Confidence score 0–100 */
  confidence: number;
  /** Brief description of what was discussed about this topic */
  description: string;
}

/** A key point or highlight from the call */
export interface KeyPoint {
  /** The key point text */
  text: string;
  /** Who said it (caller or callee) */
  speaker: "caller" | "callee" | "unknown";
}

/** An action item extracted from the call */
export interface ActionItem {
  /** Description of the action to take */
  task: string;
  /** Who is responsible */
  assignee: string;
  /** Urgency level */
  urgency: UrgencyLevel;
  /** Whether the action has been completed (user-toggleable) */
  completed: boolean;
}

/** Full AI analysis result for a call recording */
export interface CallAnalysis {
  /** Recording ID this analysis belongs to */
  recordingId: string;
  /** When the analysis was performed (ms timestamp) */
  analyzedAt: number;
  /** Analysis status */
  status: AnalysisStatus;
  /** Error message if analysis failed */
  error?: string;

  /** One-paragraph executive summary of the call */
  summary: string;

  /** Extracted topics discussed during the call */
  topics: CallTopic[];

  /** Key points and highlights */
  keyPoints: KeyPoint[];

  /** Overall sentiment of the call */
  sentiment: SentimentLabel;
  /** Sentiment score from -1.0 (very negative) to 1.0 (very positive) */
  sentimentScore: number;

  /** Action items extracted from the conversation */
  actionItems: ActionItem[];

  /** Detected language of the transcript */
  language: string;

  /** Call category (e.g., "Support", "Sales", "Internal", "Conference") */
  category: string;
}

/** Request payload for transcript analysis */
export interface AnalyzeTranscriptRequest {
  recordingId: string;
  transcription: string;
  callerName: string;
  calleeName: string;
  direction: string;
  duration: number;
}

/** Response from the AI analysis endpoint */
export interface AnalyzeTranscriptResponse {
  success: boolean;
  analysis?: CallAnalysis;
  error?: string;
}
