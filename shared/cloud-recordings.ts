export type RecordingPolicyMode = "off" | "manual" | "automatic";
export type CloudRecordingStatus = "off" | "pending" | "recording" | "ready" | "failed";
export type CloudSummaryStatus = "off" | "queued" | "processing" | "ready" | "failed";
export interface CloudRecording {
  callUuid: string; tenantId: number; nativeHistoryId?: string; number: string;
  direction: "inbound" | "outbound"; startedAt: number; endedAt?: number;
  recordingStatus: CloudRecordingStatus; summaryStatus: CloudSummaryStatus;
}
export interface CloudRecordingDetail extends CloudRecording {
  playbackPath?: string; transcript?: string;
  participantNames?: { speaker1?: string; speaker2?: string };
  manualControls?: {canStart:boolean;canStop:boolean};
  summary?: { summary: string; actionItems: string[]; language: string };
}
export interface CloudRecordingPolicy {
  tenantId: number; mode: RecordingPolicyMode; aiEnabled: boolean;
  retentionDays: number; captureAvailable: boolean; analysisAvailable: boolean; canEdit: boolean;
}
