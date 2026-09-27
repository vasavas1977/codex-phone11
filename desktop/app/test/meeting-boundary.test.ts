import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permitMeetingMedia, phoneMediaBusy, validMeetingFrame } from '../src/meeting-boundary';
import { DesktopMeetingWindow } from '../src/meeting-window';

const url = 'file:///app/meeting.html';
const frame = { url };
const owner = { mainFrame: frame, isDestroyed: () => false, getURL: () => url };
const allowed = () => validMeetingFrame({ sender: owner, senderFrame: frame, owner,
  frameUrl: frame.url, localUrl: url, expectedRevision: 'signed-a',
  currentRevision: 'signed-a', closing: false });

test('meeting admission IPC accepts only the exact local top-level frame and current account', () => {
  assert.equal(allowed(), true);
  const baseline = { sender: owner, senderFrame: frame, owner,
    frameUrl: frame.url, localUrl: url, expectedRevision: 'signed-a',
    currentRevision: 'signed-a', closing: false };
  assert.equal(validMeetingFrame({ ...baseline, sender: {} }), false);
  assert.equal(validMeetingFrame({ ...baseline, senderFrame: { url } }), false);
  assert.equal(validMeetingFrame({ ...baseline, frameUrl: 'https://untrusted.example' }), false);
  assert.equal(validMeetingFrame({ ...baseline, currentRevision: 'signed-b' }), false);
  assert.equal(validMeetingFrame({ ...baseline, closing: true }), false);
  assert.equal(validMeetingFrame({ ...baseline, owner: { ...owner, isDestroyed: () => true } }), false);
});

test('only microphone or camera permission in the exact meeting frame is allowed', () => {
  assert.equal(permitMeetingMedia('media', ['audio'], allowed(), false), true);
  assert.equal(permitMeetingMedia('media', ['video'], allowed(), false), true);
  assert.equal(permitMeetingMedia('media', ['audio', 'video'], allowed(), false), true);
  assert.equal(permitMeetingMedia('media', ['audio'], false, false), false);
  assert.equal(permitMeetingMedia('media', ['audio'], true, true), false);
  assert.equal(permitMeetingMedia('media', ['audio', 'display'], true, false), false);
  assert.equal(permitMeetingMedia('notifications', ['audio'], true, false), false);
  assert.equal(permitMeetingMedia('media', undefined, true, false), false);
});

test('outbound SIP request and reconciliation reserve media before a call ID exists', () => {
  const idle = { call: null, dialState: 'idle' as const, callActionState: 'idle' as const };
  assert.equal(phoneMediaBusy(idle), false);
  assert.equal(phoneMediaBusy({ ...idle, dialState: 'requesting' }), true);
  assert.equal(phoneMediaBusy({ ...idle, dialState: 'reconcile' }), true);
  assert.equal(phoneMediaBusy({ ...idle, callActionState: 'requesting' }), true);
  assert.equal(phoneMediaBusy({ ...idle, callActionState: 'reconcile' }), true);
  assert.equal(phoneMediaBusy({ ...idle, call: { id: '1', state: 'incoming', muted: false } }), true);
});

test('meeting window refuses to open while an outbound dial is still requesting a call ID', async () => {
  const provider = { currentSession: () => ({ revision: 'signed-a' }) };
  const helper = { snapshot: () => ({ call: null, dialState: 'requesting', callActionState: 'idle' }) };
  const meeting = new DesktopMeetingWindow(provider as never, helper as never, () => null);
  await assert.rejects(meeting.open(), /during a Phone call/);
  assert.equal(meeting.blocksPhoneMedia(), false);
});
