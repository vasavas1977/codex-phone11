/** Exact-frame guard shared by all media-window IPC and permission decisions. */
import type { PublicSnapshot } from '../../src/call-boundary';

/** A queued or uncertain Siprix command owns the devices even before a call ID exists. */
export function phoneMediaBusy(snapshot: Pick<PublicSnapshot, 'call' | 'dialState' | 'callActionState'>): boolean {
  return !!snapshot.call || snapshot.dialState !== 'idle' || snapshot.callActionState !== 'idle';
}

export function validMeetingFrame(input: {
  sender: unknown;
  senderFrame: unknown;
  owner: { mainFrame: unknown; isDestroyed: () => boolean; getURL: () => string };
  frameUrl: string | undefined;
  localUrl: string;
  expectedRevision: string | null;
  currentRevision: string | null;
  closing: boolean;
}): boolean {
  return !!input.expectedRevision && input.currentRevision === input.expectedRevision &&
    !input.closing && input.sender === input.owner && !input.owner.isDestroyed() &&
    input.senderFrame === input.owner.mainFrame && input.frameUrl === input.localUrl &&
    input.owner.getURL() === input.localUrl;
}

export function permitMeetingMedia(permission: string, mediaTypes: readonly string[] | undefined,
  exactFrame: boolean, phoneBusy: boolean): boolean {
  return permission === 'media' && exactFrame && !phoneBusy && !!mediaTypes?.length &&
    mediaTypes.every(type => type === 'audio' || type === 'video');
}
