import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { test } from 'node:test';

// Run the real isolated preload, with the SDK/IPC boundary replaced by a deterministic replay.
class Element {
  value = ''; textContent = ''; disabled = false; checked = false; hidden = false;
  srcObject: unknown = null; className = ''; style = {}; dataset = {};
  children: Element[] = []; parentElement: Element | null = null;
  listeners = new Map<string, () => void>();
  attributes = new Map<string, string>();
  classList = { toggle() {} };
  get firstChild() { return this.children[0] ?? null; }
  appendChild(child: Element) { child.parentElement = this; this.children.push(child); return child; }
  append(...children: Element[]) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children: Element[]) { this.children = []; this.append(...children); }
  querySelector(selector: string): Element | null {
    return this.children.find(child => child.className.split(' ').includes(selector.slice(1))) ??
      this.children.map(child => child.querySelector(selector)).find(Boolean) ?? null;
  }
  querySelectorAll() { return []; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  focus() {} pause() {}
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  addEventListener(event: string, listener: () => void) { this.listeners.set(event, listener); }
  click() { this.listeners.get('click')?.(); }
}

const meetingId = '12345678-1234-4234-8234-123456789012';
const otherMeetingId = '87654321-4321-4321-8321-210987654321';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise<void>(done => setImmediate(done));
  }
  assert.fail(`Replay did not reach ${label}`);
}

type MeetingState = { revision: string; meetings: { meetingId: string; title?: string }[];
  channels: { id: string; name: string }[]; directChats: { id: string; name: string; peerId: number; extension: string }[] };
async function harness(initialState: MeetingState | Promise<MeetingState> | Error = {
  revision: 'account-a', meetings: [{ meetingId }], channels: [], directChats: [],
}) {
  const elements = new Map<string, Element>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  element('mic-level').parentElement = new Element();
  const ipc = new EventEmitter() as EventEmitter & { invoke: (channel: string) => Promise<unknown>; send: (channel: string) => void };
  const calls: string[] = [];
  const inputs: { channel: string; input: unknown }[] = [];
  const rooms: FakeRoom[] = [];
  let meetingState = initialState;
  let directStart: Promise<{ meetingId: string }> | undefined;
  let admission: Promise<unknown> | undefined;
  let connection: Promise<void> | undefined;
  let microphone: Promise<void> | undefined;
  const grant = { url: 'wss://synthetic.invalid', token: 'synthetic-test-token',
    expiresAt: Math.floor(Date.now() / 1000) + 60, grantProfile: 'interactive' };
  ipc.invoke = async (channel, input?: unknown) => {
    calls.push(channel);
    inputs.push({ channel, input });
    if (channel === 'phone11:meeting-state') {
      if (meetingState instanceof Error) throw meetingState;
      return meetingState;
    }
    if (channel === 'phone11:meeting-join') return admission ?? grant;
    if (channel === 'phone11:meeting-direct-details') return { conversationId: otherMeetingId, peerId: 2, canStart: true };
    if (channel === 'phone11:meeting-start-direct') return directStart ?? { meetingId: otherMeetingId };
  };
  ipc.send = channel => { calls.push(channel); };
  class FakeRoom extends EventEmitter {
    state = 'connected'; remoteParticipants = new Map(); canPlaybackAudio = true;
    microphoneCalls = 0; cameraCalls = 0; disconnectCalls = 0;
    localParticipant = { identity: 'p11-t1-u1', sid: 'local', isLocal: true, isMicrophoneEnabled: false,
      isCameraEnabled: false, trackPublications: new Map(), permissions: {}, getTrackPublication: () => undefined,
      setMicrophoneEnabled: async (_enabled: boolean) => { this.microphoneCalls++; await microphone; },
      setCameraEnabled: async (_enabled: boolean) => { this.cameraCalls++; } };
    constructor() { super(); rooms.push(this); }
    async connect() {
      if (connection) { await connection; return; }
      // Exact LiveKit 2.22.3 initial failure ordering: Disconnected precedes connect rejection.
      this.emit('Disconnected');
      throw new Error('signaling failed with secret token that must not reach UI');
    }
    async disconnect() { this.disconnectCalls++; this.emit('Disconnected'); }
    async startAudio() {}
  }
  const sdk = { Room: FakeRoom, Participant: class {}, RoomEvent: new Proxy({}, { get: (_target, key) => key }),
    Track: { Kind: { Audio: 'audio', Video: 'video' }, Source: { Camera: 'camera', ScreenShare: 'screen' } },
    ConnectionState: { Connected: 'connected' }, DataPacket_Kind: { RELIABLE: 0 }, supportsAudioOutputSelection: () => false };
  const entry = resolve('src/meeting-preload.ts');
  const bundled = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['electron', 'livekit-client'], plugins: [{ name: 'meeting-recovery-exports', setup(plugin) {
      plugin.onLoad({ filter: /meeting-preload\.ts$/ }, async () => ({
        contents: `${await readFile(entry, 'utf8')}\nexport { join, leave, load, startDirectMeeting, loadDirectDetails };`, loader: 'ts', resolveDir: resolve('src'),
      }));
    } }] });
  const module = { exports: {} as { join: () => Promise<void>; leave: () => Promise<void>; load: () => Promise<void>;
    startDirectMeeting: () => Promise<void>; loadDirectDetails: () => Promise<void> } };
  runInNewContext(bundled.outputFiles[0].text, {
    module, exports: module.exports, require: (name: string) => name === 'electron' ? { ipcRenderer: ipc } : sdk,
    document: { readyState: 'loading', addEventListener() {}, getElementById: element, createElement: () => new Element() },
    window: { addEventListener() {} }, navigator: { mediaDevices: { addEventListener() {} } },
    Option: Element, setTimeout, clearTimeout, cancelAnimationFrame() {}, console, TextDecoder, TextEncoder,
  });
  await module.exports.load();
  if (element('meeting-select').children.some(option => option.value === meetingId)) element('meeting-select').value = meetingId;
  return { ...module.exports, element, ipc, calls, inputs, rooms, grant,
    setMeetingState: (value: MeetingState | Promise<MeetingState> | Error) => { meetingState = value; },
    setDirectStart: (value: Promise<{ meetingId: string }>) => { directStart = value; },
    setAdmission: (value: Promise<unknown>) => { admission = value; },
    setConnection: (value: Promise<void>) => { connection = value; },
    setMicrophone: (value: Promise<void>) => { microphone = value; } };
}

test('open empty prejoin discovers a later admitted invitation without reopening', async () => {
  const html = await readFile(resolve('src/meeting.html'), 'utf8');
  assert.match(html, /id="refresh-meetings" type="button" aria-describedby="meeting-list-status"/);
  assert.match(html, /id="meeting-list-status" role="status" aria-live="polite"/);
  const h = await harness({ revision: 'account-a', meetings: [], channels: [], directChats: [] });
  assert.equal(h.element('join').disabled, true);
  assert.equal(h.element('refresh-meetings').listeners.has('click'), true);
  h.setMeetingState({ revision: 'account-a', meetings: [{ meetingId, title: 'Invited room' }], channels: [], directChats: [] });
  h.element('refresh-meetings').click();
  await until(() => h.element('meeting-select').children.some(option => option.value === meetingId), 'new invitation');
  assert.equal(h.element('meeting-select').value, meetingId);
  assert.equal(h.element('join').disabled, false);
  assert.equal(h.element('refresh-meetings').attributes.get('aria-busy'), 'false');
  h.setConnection(Promise.resolve());
  await h.join();
  const admission = h.inputs.find(request => request.channel === 'phone11:meeting-join')!;
  assert.equal((admission.input as { meetingId: string }).meetingId, meetingId);
  assert.equal(h.element('room').hidden, false);
});

test('initial admitted-list failure has an in-window retry without duplicated handlers', async () => {
  const h = await harness(new Error('private backend detail'));
  assert.equal(h.element('refresh-meetings').listeners.has('click'), true);
  assert.match(h.element('prejoin-error').textContent, /try again/i);
  assert.equal(h.element('prejoin-error').textContent.includes('private backend detail'), false);
  h.setMeetingState({ revision: 'account-a', meetings: [{ meetingId }], channels: [], directChats: [] });
  h.element('refresh-meetings').click();
  await until(() => !h.element('join').disabled, 'recovered admission list');
  assert.equal(h.element('prejoin-error').textContent, '');
  assert.equal(h.calls.filter(channel => channel === 'phone11:meeting-state').length, 2);
  assert.equal(h.ipc.listenerCount('phone11:meeting-leave-now'), 1);
});

test('refresh preserves exact admitted selection and never substitutes a revoked room', async () => {
  const h = await harness();
  h.setMeetingState({ revision: 'account-a', meetings: [{ meetingId: otherMeetingId, title: 'Same title' },
    { meetingId, title: 'Same title' }], channels: [], directChats: [] });
  h.element('refresh-meetings').click();
  await until(() => !h.element('refresh-meetings').disabled, 'refreshed choices');
  assert.equal(h.element('meeting-select').value, meetingId);
  assert.equal(h.inputs.filter(request => request.channel === 'phone11:meeting-state')[1].input &&
    (h.inputs.filter(request => request.channel === 'phone11:meeting-state')[1].input as { revision: string }).revision, 'account-a');
  assert.ok(h.element('meeting-select').children.filter(option => option.value).every(option => option.textContent.includes(' · …')));
  h.setMeetingState({ revision: 'account-a', meetings: [{ meetingId: otherMeetingId }], channels: [], directChats: [] });
  h.element('refresh-meetings').click();
  await until(() => !h.element('refresh-meetings').disabled, 'revoked selection cleared');
  assert.equal(h.element('meeting-select').value, '');
  assert.equal(h.element('join').disabled, true);
  assert.equal(h.element('refresh-meetings').attributes.get('aria-busy'), 'false');
  await h.join();
  assert.equal(h.calls.includes('phone11:meeting-join'), false);
  h.element('refresh-meetings').click();
  await until(() => !h.element('refresh-meetings').disabled, 'repeated refresh');
  assert.equal(h.element('meeting-select').value, '');
  h.element('meeting-select').value = otherMeetingId;
  h.element('meeting-select').listeners.get('change')?.();
  assert.equal(h.element('join').disabled, false);
});

test('refresh failure blocks stale joining and retry preserves prejoin media choices', async () => {
  const h = await harness();
  h.element('start-mic').checked = true;
  h.element('start-camera').checked = true;
  h.setMeetingState(new Error('backend credential must not reach UI'));
  h.element('refresh-meetings').click();
  await until(() => h.element('refresh-meetings').textContent === 'Retry meeting access', 'retry');
  assert.equal(h.element('join').disabled, true);
  assert.equal(h.element('prejoin-error').textContent.includes('credential'), false);
  h.setMeetingState({ revision: 'account-a', meetings: [{ meetingId }], channels: [], directChats: [] });
  h.element('refresh-meetings').click();
  await until(() => !h.element('refresh-meetings').disabled, 'retry complete');
  assert.equal(h.element('start-mic').checked, true);
  assert.equal(h.element('start-camera').checked, true);
  assert.equal(h.element('meeting-select').value, meetingId);
  assert.equal(h.element('join').disabled, false);
  assert.equal(h.rooms.length, 0);
});

test('pending refresh coalesces repeats and blocks admission until current result', async () => {
  const h = await harness();
  const state = deferred<MeetingState>();
  h.setMeetingState(state.promise);
  h.element('refresh-meetings').click();
  h.element('refresh-meetings').click();
  await h.join();
  assert.equal(h.calls.filter(channel => channel === 'phone11:meeting-state').length, 2);
  assert.equal(h.calls.includes('phone11:meeting-join'), false);
  assert.equal(h.element('join').disabled, true);
  assert.equal(h.element('refresh-meetings').attributes.get('aria-busy'), 'true');
  state.resolve({ revision: 'account-a', meetings: [], channels: [], directChats: [] });
  await until(() => !h.element('refresh-meetings').disabled, 'pending refresh resolved');
  assert.equal(h.element('meeting-select').value, '');
  assert.equal(h.element('join').disabled, true);
});

for (const close of ['cancel', 'account/workspace'] as const) test(`late refresh after ${close} cannot repopulate prejoin`, async () => {
  const h = await harness();
  const state = deferred<MeetingState>();
  h.setMeetingState(state.promise);
  h.element('refresh-meetings').click();
  if (close === 'cancel') h.element('cancel').click();
  else h.ipc.emit('phone11:meeting-leave-now');
  state.resolve({ revision: 'account-a', meetings: [{ meetingId: otherMeetingId }], channels: [], directChats: [] });
  await h.leave();
  await new Promise<void>(done => setImmediate(done));
  assert.equal(h.element('meeting-select').value, meetingId);
  assert.equal(h.element('meeting-select').children.some(option => option.value === otherMeetingId), false);
  assert.equal(h.element('refresh-meetings').disabled, true);
  assert.equal(h.element('refresh-meetings').attributes.get('aria-busy'), 'false');
  assert.equal(h.rooms.length, 0);
});

test('refresh refuses a replacement account revision and leaves old-room admission blocked', async () => {
  const h = await harness();
  h.setMeetingState({ revision: 'account-b', meetings: [{ meetingId: otherMeetingId }], channels: [], directChats: [] });
  h.element('refresh-meetings').click();
  await until(() => !h.element('refresh-meetings').disabled, 'mismatched session refused');
  assert.equal(h.element('meeting-select').value, meetingId);
  assert.equal(h.element('join').disabled, true);
  assert.equal(h.element('meeting-select').children.some(option => option.value === otherMeetingId), false);
});

test('meeting start wins over a pending refresh and keeps its exact returned room', async () => {
  const h = await harness({ revision: 'account-a', meetings: [{ meetingId }], channels: [],
    directChats: [{ id: otherMeetingId, name: 'Contact', peerId: 2, extension: '1020' }] });
  h.element('direct-select').value = otherMeetingId;
  await h.loadDirectDetails();
  const state = deferred<MeetingState>();
  const started = deferred<{ meetingId: string }>();
  h.setMeetingState(state.promise);
  h.setDirectStart(started.promise);
  h.element('refresh-meetings').click();
  const start = h.startDirectMeeting();
  assert.equal(h.element('refresh-meetings').disabled, true);
  state.resolve({ revision: 'account-a', meetings: [], channels: [], directChats: [] });
  started.resolve({ meetingId: otherMeetingId });
  await start;
  await new Promise<void>(done => setImmediate(done));
  assert.equal(h.element('meeting-select').value, otherMeetingId);
  assert.equal(h.element('join').disabled, false);
  assert.equal(h.element('refresh-meetings').disabled, true);
  h.element('refresh-meetings').click();
  assert.equal(h.calls.filter(channel => channel === 'phone11:meeting-state').length, 2);
});

test('refresh cannot run during pending join or alter the connected room', async () => {
  const h = await harness();
  const connection = deferred<void>();
  h.setConnection(connection.promise);
  const joining = h.join();
  await until(() => h.rooms.length > 0, 'pending connection');
  h.element('refresh-meetings').click();
  assert.equal(h.calls.filter(channel => channel === 'phone11:meeting-state').length, 1);
  connection.resolve();
  await joining;
  h.element('refresh-meetings').click();
  assert.equal(h.calls.filter(channel => channel === 'phone11:meeting-state').length, 1);
  assert.equal(h.rooms.length, 1);
  assert.equal(h.element('room').hidden, false);
});

test('initial SDK disconnect on connection refusal keeps safe retry usable', async () => {
  const h = await harness();
  await h.join();
  assert.match(h.element('prejoin-error').textContent, /Check your connection and try again/);
  assert.equal(h.element('join').disabled, false);
  assert.equal(h.calls.includes('phone11:meeting-finished'), false);
  assert.equal(h.rooms[0].disconnectCalls, 1);
  assert.equal(h.calls.filter(channel => channel === 'phone11:meeting-join-failed').length, 1);
  h.setConnection(Promise.resolve());
  await h.join();
  assert.equal(h.rooms.length, 2);
  assert.equal(h.element('prejoin').hidden, true);
  assert.equal(h.element('room').hidden, false);
  assert.equal(h.element('media-note').textContent, 'Microphone off · Camera off');
  assert.equal(h.element('prejoin-error').textContent.includes('secret token'), false);
});

test('initial SDK refusal keeps room refresh and the original exact-room retry usable', async () => {
  const h = await harness();
  await h.join();
  assert.equal(h.element('refresh-meetings').disabled, false);
  h.element('refresh-meetings').click();
  await until(() => !h.element('refresh-meetings').disabled, 'refresh after SDK failure');
  assert.equal(h.element('meeting-select').value, meetingId);
  assert.equal(h.element('join').disabled, false);
  h.setConnection(Promise.resolve());
  await h.join();
  assert.equal(h.element('room').hidden, false);
  assert.equal(h.inputs.filter(request => request.channel === 'phone11:meeting-join').length, 2);
  for (const request of h.inputs.filter(request => request.channel === 'phone11:meeting-join'))
    assert.equal((request.input as { meetingId: string }).meetingId, meetingId);
});

test('retired room events cannot remove participants or detach media from the successful retry', async () => {
  const h = await harness();
  await h.join();
  h.setConnection(Promise.resolve());
  await h.join();
  const participant = { ...h.rooms[1].localParticipant, isLocal: false, sid: 'persistent-remote', identity: 'p11-t1-u2' };
  h.rooms[1].remoteParticipants.set(participant.identity, participant);
  h.rooms[1].emit('ParticipantConnected', participant);
  assert.equal(h.element('participant-list').children.length, 2);
  let detached = 0;
  const track = { detach: () => { detached++; return []; } };
  const retiredParticipant = { ...participant };
  h.rooms[0].emit('TrackUnsubscribed', track, {}, retiredParticipant);
  h.rooms[0].emit('TrackUnpublished', { track }, retiredParticipant);
  h.rooms[0].emit('ParticipantDisconnected', retiredParticipant);
  assert.equal(detached, 0);
  assert.equal(h.element('participant-list').children.length, 2);
});

test('an established meeting disconnect still closes and releases its exact room', async () => {
  const h = await harness();
  h.setConnection(Promise.resolve());
  await h.join();
  h.rooms[0].emit('Disconnected');
  assert.equal(h.calls.includes('phone11:meeting-finished'), true);
  await h.leave();
  assert.equal(h.rooms[0].disconnectCalls, 1);
  assert.equal(h.element('room').hidden, true);
});

test('account or workspace close during admission never connects or publishes a late grant', async () => {
  const h = await harness();
  const admission = deferred<unknown>();
  h.setAdmission(admission.promise);
  const joining = h.join();
  await until(() => h.calls.includes('phone11:meeting-join'), 'pending admission');
  h.ipc.emit('phone11:meeting-leave-now');
  admission.resolve(h.grant);
  await joining;
  await h.leave();
  assert.equal(h.rooms.length, 0);
  assert.equal(h.calls.includes('phone11:meeting-left'), true);
  assert.equal(h.element('room').hidden, true);
});

test('cancel during connect requests bounded main-process close and prevents late publication', async () => {
  const h = await harness();
  const connection = deferred<void>();
  h.setConnection(connection.promise);
  h.element('start-mic').checked = true;
  h.element('start-camera').checked = true;
  const joining = h.join();
  await until(() => h.rooms.length > 0, 'pending connect');
  assert.equal(h.element('meeting-select').disabled, true);
  h.element('cancel').click();
  assert.equal(h.calls.includes('phone11:meeting-finished'), true);
  connection.resolve();
  await joining;
  await h.leave();
  assert.equal(h.rooms[0].microphoneCalls, 0);
  assert.equal(h.rooms[0].cameraCalls, 0);
  assert.equal(h.rooms[0].disconnectCalls, 1);
  assert.equal(h.element('room').hidden, true);
});

test('cancel drains pending microphone publication before disconnect and blocks camera publication', async () => {
  const h = await harness();
  const microphone = deferred<void>();
  h.setConnection(Promise.resolve());
  h.setMicrophone(microphone.promise);
  h.element('start-mic').checked = true;
  h.element('start-camera').checked = true;
  const joining = h.join();
  await until(() => h.rooms[0]?.microphoneCalls > 0, 'pending microphone publication');
  h.element('cancel').click();
  assert.equal(h.rooms[0].disconnectCalls, 0);
  microphone.resolve();
  await joining;
  await h.leave();
  assert.equal(h.rooms[0].cameraCalls, 0);
  assert.equal(h.rooms[0].disconnectCalls, 1);
});
