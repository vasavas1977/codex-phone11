/**
 * AI Transcript Analysis Engine (Client-Side)
 *
 * Calls the server-side tRPC endpoint for LLM-powered transcript analysis.
 * A missing or failed server result is surfaced to the caller; this client
 * never invents an analysis from transcript keywords.
 */

import type { CallAnalysis, AnalyzeTranscriptRequest } from "./ai-types";

export class AnalysisUnavailableError extends Error {
  readonly retryable = true;

  constructor(message = "AI analysis is unavailable. Please try again.") {
    super(message);
    this.name = "AnalysisUnavailableError";
  }
}

function isCallAnalysis(value: unknown): value is CallAnalysis {
  if (!value || typeof value !== "object") return false;
  const analysis = value as Partial<CallAnalysis>;
  return (
    typeof analysis.recordingId === "string" &&
    typeof analysis.analyzedAt === "number" &&
    analysis.status === "completed" &&
    typeof analysis.summary === "string" &&
    analysis.summary.trim().length > 0 &&
    Array.isArray(analysis.topics) &&
    Array.isArray(analysis.keyPoints) &&
    ["positive", "neutral", "negative", "mixed"].includes(String(analysis.sentiment)) &&
    typeof analysis.sentimentScore === "number" &&
    analysis.sentimentScore >= -1 &&
    analysis.sentimentScore <= 1 &&
    Array.isArray(analysis.actionItems) &&
    typeof analysis.language === "string" &&
    analysis.language.trim().length > 0 &&
    typeof analysis.category === "string" &&
    analysis.category.trim().length > 0
  );
}

class AiAnalysisEngine {
  private serverUrl = "";
  private cache: Map<string, CallAnalysis> = new Map();

  /** Set the tRPC server URL for API calls. */
  setServerUrl(url: string) {
    this.serverUrl = url.replace(/\/$/, "");
  }

  /** Get cached, completed server analysis for a recording. */
  getCached(recordingId: string): CallAnalysis | null {
    return this.cache.get(recordingId) || null;
  }

  /** Analyze a call transcript using the server-side LLM. */
  async analyzeTranscript(request: AnalyzeTranscriptRequest): Promise<CallAnalysis> {
    const cached = this.cache.get(request.recordingId);
    if (cached && cached.status === "completed") return cached;
    if (!this.serverUrl) throw new AnalysisUnavailableError();

    let response: Response;
    try {
      response = await fetch(`${this.serverUrl}/trpc/recording.analyzeTranscript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: request }),
      });
    } catch {
      throw new AnalysisUnavailableError();
    }

    if (!response.ok) throw new AnalysisUnavailableError();

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AnalysisUnavailableError();
    }
    const result = (payload as { result?: { data?: { json?: unknown } | unknown } })?.result;
    const data = result?.data;
    const value =
      data && typeof data === "object" && "json" in data
        ? (data as { json?: unknown }).json
        : data;
    const analysis =
      value && typeof value === "object" && "analysis" in value
        ? (value as { analysis?: unknown }).analysis
        : undefined;
    if (
      !value ||
      typeof value !== "object" ||
      (value as { success?: unknown }).success !== true ||
      !isCallAnalysis(analysis)
    ) {
      throw new AnalysisUnavailableError();
    }

    this.cache.set(request.recordingId, analysis);
    return analysis;
  }

  /** Clear cached analysis for a recording. */
  clearCache(recordingId?: string) {
    if (recordingId) this.cache.delete(recordingId);
    else this.cache.clear();
  }
}

export const aiAnalysisEngine = new AiAnalysisEngine();
