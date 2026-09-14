import type { RecordingAnalysisFailureCode, RecordingAnalysisStage } from "./gemini";

export interface RecordingFailure {
  code: RecordingAnalysisFailureCode | "recording_read_failed" | "analysis_failed";
  stage: RecordingAnalysisStage | "read" | "validate" | "analyze" | "persist";
}
const codes = new Set(["not_configured", "invalid_audio", "provider_failed", "provider_rate_limited",
  "provider_unavailable", "provider_rejected", "provider_timeout", "invalid_result", "recording_read_failed", "analysis_failed"]);
const stages = new Set(["configuration", "upload_start", "upload", "processing", "generate", "parse", "read", "validate", "analyze", "persist"]);

/** Runtime allowlist: raw exception text is never retained in the job ledger. */
export function recordingFailureCode(failure?: RecordingFailure): string {
  return failure && codes.has(failure.code) && stages.has(failure.stage)
    ? `${failure.code}:${failure.stage}` : "analysis_failed";
}
