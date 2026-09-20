/** Safe, non-diagnostic join milestones that can be shown to an operator. */
export const meetingJoinStages = [
  "admission",
  "bindings",
  "audio_start",
  "room_connect",
  "connected",
] as const;

export type MeetingJoinStage = (typeof meetingJoinStages)[number];

/**
 * Deliberately carries no SDK error, URL, token, room, or participant data.
 * Callers may show `stage` as a support reference while retaining friendly UI.
 */
export class MeetingJoinFailure extends Error {
  readonly name = "MeetingJoinFailure";

  constructor(readonly stage: MeetingJoinStage) {
    super(`Meeting join failed at ${stage}.`);
  }
}

export function meetingJoinFailureStage(error: unknown): MeetingJoinStage | undefined {
  return error instanceof MeetingJoinFailure ? error.stage : undefined;
}
