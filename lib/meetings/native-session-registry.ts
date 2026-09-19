import type { BrowserMeetingSession, BrowserRoom } from "./browser-session";

export type ActiveNativeMeeting = {
  /** Local authenticated account that owns this process-global room. */
  readonly ownerId: number;
  session: BrowserMeetingSession;
  readonly room: BrowserRoom | undefined;
  readonly receiveOnly: boolean;
  readonly wasInterruptedBySip: boolean;
  leave: () => Promise<void>;
};

let activeMeeting: ActiveNativeMeeting | undefined;

export function setActiveNativeMeeting(meeting: ActiveNativeMeeting): void {
  activeMeeting = meeting;
}

/**
 * A route must provide its current authenticated owner. Omitting it is reserved
 * for lifecycle cleanup, never for rendering another account's meeting.
 */
export function getActiveNativeMeeting(ownerId?: number): ActiveNativeMeeting | undefined {
  if (!activeMeeting) return undefined;
  return ownerId === undefined || activeMeeting.ownerId === ownerId ? activeMeeting : undefined;
}

export function clearActiveNativeMeeting(meeting: ActiveNativeMeeting): void {
  if (activeMeeting === meeting) activeMeeting = undefined;
}

/**
 * Logout makes the room unreachable before awaiting native teardown. The leave
 * implementation still releases tracks, audio, and its coordinator lease when
 * one cleanup step rejects.
 */
export async function clearNativeMeetingForAuth(): Promise<void> {
  const meeting = activeMeeting;
  activeMeeting = undefined;
  if (meeting) await meeting.leave();
}
