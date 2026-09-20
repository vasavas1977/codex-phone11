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
const listeners = new Set<() => void>();
let unsubscribeSession: (() => void) | undefined;

function notifyRegistry(): void { listeners.forEach(listener => listener()); }

export function subscribeNativeMeetingRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setActiveNativeMeeting(meeting: ActiveNativeMeeting): void {
  unsubscribeSession?.();
  activeMeeting = meeting;
  // Production BrowserMeetingSession is subscribable. The optional guard keeps
  // lifecycle cleanup compatible with older restored/test registry records.
  unsubscribeSession = typeof meeting.session.subscribe === "function"
    ? meeting.session.subscribe(notifyRegistry) : undefined;
  notifyRegistry();
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
  if (activeMeeting === meeting) {
    activeMeeting = undefined;
    unsubscribeSession?.(); unsubscribeSession = undefined;
    notifyRegistry();
  }
}

/**
 * Logout makes the room unreachable before awaiting native teardown. The leave
 * implementation still releases tracks, audio, and its coordinator lease when
 * one cleanup step rejects.
 */
export async function clearNativeMeetingForAuth(): Promise<void> {
  const meeting = activeMeeting;
  activeMeeting = undefined;
  unsubscribeSession?.(); unsubscribeSession = undefined;
  notifyRegistry();
  if (meeting) await meeting.leave();
}
