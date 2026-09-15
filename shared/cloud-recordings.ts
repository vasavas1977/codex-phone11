export type RecordingPolicyMode = "off" | "manual" | "automatic";
export type CloudRecordingStatus = "off" | "pending" | "recording" | "ready" | "failed";
export type CloudSummaryStatus = "off" | "queued" | "processing" | "ready" | "failed";
export interface CloudRecording {
  callUuid: string; tenantId: number; nativeHistoryId?: string; number: string;
  direction: "inbound" | "outbound"; startedAt: number; endedAt?: number;
  recordingStatus: CloudRecordingStatus; summaryStatus: CloudSummaryStatus;
  /** The PBX has confirmed that capture stopped and the private WAV is being
   * finalized. This is durable server state, so clients must not offer Stop
   * again while upload or call-history correlation is retried. */
  recordingFinalizing?: boolean;
}
export interface CloudRecordingDetail extends CloudRecording {
  playbackPath?: string; transcript?: string;
  /** Present only after the capture service has persisted a verified
   * diarized-speaker-to-participant mapping. Contact/direction guesses are
   * intentionally excluded. */
  participantNames?: { speaker1?: string; speaker2?: string };
  manualControls?: {canStart:boolean;canStop:boolean};
  summary?: { summary: string; actionItems: string[]; language: string };
}
export interface CloudRecordingPolicy {
  tenantId: number; mode: RecordingPolicyMode; aiEnabled: boolean;
  retentionDays: number; captureAvailable: boolean; analysisAvailable: boolean; canEdit: boolean;
}
