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
  setAttribute() {} focus() {} pause() {}
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  addEventListener(event: string, listener: () => void) { this.listeners.set(event, listener); }
  click() { this.listeners.get('click')?.(); }
}

const meetingId = '12345678-1234-4234-8234-123456789012';
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

async function harness() {
  const elements = new Map<string, Element>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  element('mic-level').parentElement = new Element();
  const ipc = new EventEmitter() as EventEmitter & { invoke: (channel: string) => Promise<unknown>; send: (channel: string) => void };
  const calls: string[] = [];
  const rooms: FakeRoom[] = [];
  let admission: Promise<unknown> | undefined;
  let connection: Promise<void> | undefined;
  let microphone: Promise<void> | undefined;
  const grant = { url: 'wss://synthetic.invalid', token: 'synthetic-test-token',
    expiresAt: Math.floor(Date.now() / 1000) + 60, grantProfile: 'interactive' };
  ipc.invoke = async channel => {
    calls.push(channel);
    if (channel === 'phone11:meeting-state') return { revision: 'account-a', meetings: [{ meetingId }], channels: [], directChats: [] };
    if (channel === 'phone11:meeting-join') return admission ?? grant;
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
        contents: `${await readFile(entry, 'utf8')}\nexport { join, leave, load };`, loader: 'ts', resolveDir: resolve('src'),
      }));
    } }] });
  const module = { exports: {} as { join: () => Promise<void>; leave: () => Promise<void>; load: () => Promise<void> } };
  runInNewContext(bundled.outputFiles[0].text, {
    module, exports: module.exports, require: (name: string) => name === 'electron' ? { ipcRenderer: ipc } : sdk,
    document: { readyState: 'loading', addEventListener() {}, getElementById: element, createElement: () => new Element() },
    window: { addEventListener() {} }, navigator: { mediaDevices: { addEventListener() {} } },
    Option: Element, setTimeout, clearTimeout, cancelAnimationFrame() {}, console, TextDecoder, TextEncoder,
  });
  await module.exports.load();
  element('meeting-select').value = meetingId;
  return { ...module.exports, element, ipc, calls, rooms, grant,
    setAdmission: (value: Promise<unknown>) => { admission = value; },
    setConnection: (value: Promise<void>) => { connection = value; },
    setMicrophone: (value: Promise<void>) => { microphone = value; } };
}

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
