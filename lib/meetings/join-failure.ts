/** Safe, non-diagnostic join milestones that can be shown to an operator. */
export const meetingJoinStages = [
  "admission",
  "bindings",
  "audio_start",
  "room_cleanup",
  "room_create",
  "event_bind",
  "signal_connect",
  "post_connect_guard",
  "participant_refresh",
  "connected",
] as const;

export type MeetingJoinStage = (typeof meetingJoinStages)[number];

/** Coarse SDK categories only. Raw errors can contain URLs and credentials. */
export const meetingJoinReasons = [
  "not_allowed",
  "server_unreachable",
  "internal",
  "cancelled",
  "server_leave",
  "timeout",
  "websocket",
  "service_not_found",
] as const;

export type MeetingJoinReason = (typeof meetingJoinReasons)[number];

export type MeetingJoinDiagnostic = Readonly<{
  reason?: MeetingJoinReason;
  /** A validated HTTP status from the SDK, never its message or context. */
  httpStatus?: number;
}>;

/**
 * Public fields deliberately carry no SDK error, URL, token, room, or
 * participant data. The original cause stays in memory for local control flow;
 * callers may render only meetingJoinFailureReference().
 */
export class MeetingJoinFailure extends Error {
  readonly name = "MeetingJoinFailure";

  constructor(
    readonly stage: MeetingJoinStage,
    diagnostic: MeetingJoinDiagnostic = {},
    cause?: unknown,
  ) {
    super(
      `Meeting join failed at ${stage}.`,
      cause === undefined ? undefined : { cause },
    );
    this.reason = meetingJoinReasons.find(
      (reason) => reason === diagnostic.reason,
    );
    this.httpStatus = safeMeetingJoinHttpStatus(diagnostic.httpStatus);
  }

  readonly reason?: MeetingJoinReason;
  readonly httpStatus?: number;
}

export function meetingJoinFailureStage(
  error: unknown,
): MeetingJoinStage | undefined {
  return error instanceof MeetingJoinFailure ? error.stage : undefined;
}

/** Formats only fields that were already reduced to the public allowlist. */
export function meetingJoinFailureReference(
  error: unknown,
): string | undefined {
  if (!(error instanceof MeetingJoinFailure)) return undefined;
  const reason = error.reason ? ` / ${error.reason}` : "";
  const status = error.httpStatus ? ` / ${error.httpStatus}` : "";
  return `${error.stage}${reason}${status}`;
}

export function safeMeetingJoinHttpStatus(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 400 &&
    value <= 599
    ? value
    : undefined;
}
