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
  "abort_controller_missing",
  "event_emitter_incompatible",
] as const;

export type MeetingJoinReason = (typeof meetingJoinReasons)[number];

/** Built-in JavaScript error classes only; arbitrary SDK names are discarded. */
export const meetingJoinErrorTypes = [
  "reference_error",
  "type_error",
  "range_error",
  "syntax_error",
  "eval_error",
  "uri_error",
  "error",
] as const;

export type MeetingJoinErrorType = (typeof meetingJoinErrorTypes)[number];

/** Fixed constructor areas derived only from allowlisted installed-SDK frame names. */
export const meetingJoinConstructorSites = [
  "data_channel",
  "data_stream",
  "data_track",
  "signal_client",
  "engine",
  "rpc",
  "participant",
  "frame_metadata",
  "room",
] as const;

export type MeetingJoinConstructorSite =
  (typeof meetingJoinConstructorSites)[number];

export type MeetingJoinDiagnostic = Readonly<{
  reason?: MeetingJoinReason;
  errorType?: MeetingJoinErrorType;
  constructorSite?: MeetingJoinConstructorSite;
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
    this.errorType = meetingJoinErrorTypes.find(
      (errorType) => errorType === diagnostic.errorType,
    );
    this.constructorSite = meetingJoinConstructorSites.find(
      (constructorSite) => constructorSite === diagnostic.constructorSite,
    );
    this.httpStatus = safeMeetingJoinHttpStatus(diagnostic.httpStatus);
  }

  readonly reason?: MeetingJoinReason;
  readonly errorType?: MeetingJoinErrorType;
  readonly constructorSite?: MeetingJoinConstructorSite;
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
  const constructorSite = error.constructorSite
    ? ` / ${error.constructorSite}`
    : "";
  const errorType = error.errorType ? ` / ${error.errorType}` : "";
  const status = error.httpStatus ? ` / ${error.httpStatus}` : "";
  return `${error.stage}${reason}${constructorSite}${errorType}${status}`;
}

export function safeMeetingJoinHttpStatus(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 400 &&
    value <= 599
    ? value
    : undefined;
}
