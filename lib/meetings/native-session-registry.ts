import type { BrowserMeetingSession, BrowserRoom } from "./browser-session";

export type ActiveNativeMeeting = {
  /** Local authenticated account that owns this process-global room. */
  readonly ownerId: number;
  /** Exact admitted room; old restored records without it cannot offer host controls. */
  readonly meetingId?: string;
  session: BrowserMeetingSession;
  readonly room: BrowserRoom | undefined;
  readonly receiveOnly: boolean;
  readonly wasInterruptedBySip: boolean;
  /** Present only for a native room whose lifecycle owns the audio session. */
  getAudioOutputs?: () => Promise<string[]>;
  selectAudioOutput?: (deviceId: string) => Promise<void>;
  leave: () => Promise<void>;
};

let activeMeeting: ActiveNativeMeeting | undefined;
let retiredForAuth = false;
let authCleanup: { meeting: ActiveNativeMeeting; task: Promise<void> } | undefined;
const listeners = new Set<() => void>();
let unsubscribeSession: (() => void) | undefined;

function notifyRegistry(): void { listeners.forEach(listener => listener()); }

export function subscribeNativeMeetingRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setActiveNativeMeeting(meeting: ActiveNativeMeeting): void {
  if (activeMeeting && retiredForAuth && activeMeeting !== meeting)
    throw new Error("Meeting cleanup must finish before another room can be registered");
  // A failed lifecycle teardown may re-register this exact room for retry. It
  // must retain its logout retirement rather than become visible to a new user.
  const staysRetired = activeMeeting === meeting && retiredForAuth;
  unsubscribeSession?.();
  activeMeeting = meeting;
  retiredForAuth = staysRetired;
  // Production BrowserMeetingSession is subscribable. The optional guard keeps
  // lifecycle cleanup compatible with older restored/test registry records.
  unsubscribeSession = !retiredForAuth && typeof meeting.session.subscribe === "function"
    ? meeting.session.subscribe(notifyRegistry) : undefined;
  notifyRegistry();
}

/**
 * A route must provide its current authenticated owner. Omitting it is reserved
 * for lifecycle cleanup, including a retired room whose teardown still needs
 * retry, never for rendering another account's meeting.
 */
export function getActiveNativeMeeting(ownerId?: number): ActiveNativeMeeting | undefined {
  if (!activeMeeting) return undefined;
  if (ownerId === undefined) return activeMeeting;
  return !retiredForAuth && activeMeeting.ownerId === ownerId ? activeMeeting : undefined;
}

export function clearActiveNativeMeeting(meeting: ActiveNativeMeeting): void {
  if (activeMeeting === meeting) {
    activeMeeting = undefined;
    retiredForAuth = false;
    unsubscribeSession?.(); unsubscribeSession = undefined;
    notifyRegistry();
  }
}

/**
 * Logout hides the room from owner-filtered routes before awaiting teardown.
 * Failed cleanup retains the exact lifecycle for ownerless replacement/media
 * barriers and retry; it cannot be overwritten or exposed after reauthentication.
 */
export function clearNativeMeetingForAuth(): Promise<void> {
  const meeting = activeMeeting;
  if (!meeting) return Promise.resolve();
  if (authCleanup?.meeting === meeting) return authCleanup.task;
  retiredForAuth = true;
  unsubscribeSession?.(); unsubscribeSession = undefined;
  // Install the task before notifying routes, so a synchronous cleanup listener
  // coalesces with this exact teardown instead of starting another one.
  const task = Promise.resolve().then(() => meeting.leave()).then(() => {
    clearActiveNativeMeeting(meeting);
  }).finally(() => {
    if (authCleanup?.task === task) authCleanup = undefined;
  });
  authCleanup = { meeting, task };
  notifyRegistry();
  return task;
}
