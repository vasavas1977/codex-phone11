import type { RecordingAnalysisFailureCode, RecordingAnalysisStage } from "./gemini";

export interface RecordingFailure {
  code: RecordingAnalysisFailureCode | "recording_read_failed" | "analysis_failed";
  stage: RecordingAnalysisStage | "read" | "validate" | "analyze" | "persist";
}

const codes = new Set<string>(["not_configured", "invalid_audio", "provider_failed", "provider_rate_limited",
  "provider_unavailable", "provider_rejected", "provider_timeout", "invalid_result", "recording_read_failed", "analysis_failed"]);
const stages = new Set<string>(["configuration", "upload_start", "upload", "processing", "generate", "parse", "read", "validate", "analyze", "persist"]);
const transientCodes = new Set<string>(["provider_failed", "provider_rate_limited", "provider_unavailable", "provider_timeout"]);

/** Runtime allowlist: raw exception text is never retained in the job ledger. */
export function recordingFailureCode(failure?: RecordingFailure): string {
  return failure && codes.has(failure.code) && stages.has(failure.stage)
    ? `${failure.code}:${failure.stage}` : "analysis_failed";
}

/** Existing three-attempt budget: retry transient provider failures after about 1 minute, then 5 minutes. */
export function recordingRetryDelaySeconds(failure: RecordingFailure | undefined, attempts: number): number {
  if (!failure || !transientCodes.has(failure.code)) return 30;
  return attempts <= 1 ? 60 : 300;
}
