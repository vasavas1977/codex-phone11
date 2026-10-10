import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { build } from 'esbuild';
import { ConnectionState, RoomEvent, Track } from 'livekit-client';
import { MEETING_CHANNELS } from '../src/meeting-channels';
import type { DesktopMeetingScreenShare, ScreenTrack } from '../src/meeting-screen-share';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(interactive = true) {
  class Element {
    textContent = ''; hidden = true; disabled = false; checked = false; value = ''; srcObject = null;
    style = { width: '' }; children: Element[] = []; parentElement: Element = this;
    classList = { toggle() {}, add() {}, remove() {} }; attributes = new Map<string, string>();
    listeners = new Map<string, () => void>();
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    addEventListener(event: string, fn: () => void) { this.listeners.set(event, fn); }
    replaceChildren(...values: Element[]) { this.children = values; }
    append(...values: Element[]) { this.children.push(...values); } focus() {} remove() {}
  }
  const elements = new Map<string, Element>();
  const el = (id: string) => { let value = elements.get(id); if (!value) { value = new Element(); elements.set(id, value); } return value; };
  const media = Object.assign(new EventTarget(), { readyState: 'live' as 'live' | 'ended' });
  const events: string[] = [], publications = new Map<string, { track: ScreenTrack; source: Track.Source; isMuted: boolean }>();
  const track: ScreenTrack = { kind: 'video', mediaStreamTrack: media, stop() { events.push('stop'); media.readyState = 'ended'; } };
  let capture = () => Promise.resolve([track]), unpublishFails = false;
  const permissions = { canPublish: true, canPublishSources: [] as number[] };
  const active = Object.assign(new EventEmitter(), { state: ConnectionState.Connected,
    localParticipant: { permissions, trackPublications: publications,
      createScreenTracks: (options: unknown) => { assert.deepEqual(JSON.parse(JSON.stringify(options)), { audio: false }); events.push('capture'); return capture(); },
      publishTrack: async (value: ScreenTrack) => { events.push('publish'); publications.set('screen', { track: value, source: Track.Source.ScreenShare, isMuted: false }); },
      unpublishTrack: async () => { events.push('unpublish'); if (unpublishFails) throw new Error('secret-url'); publications.clear(); } },
    disconnect: async () => { events.push('disconnect'); } });
  const sends: { channel: string; input: unknown }[] = [], invocations: { channel: string; input: unknown }[] = [];
  const ipcRenderer = Object.assign(new EventEmitter(), { send: (channel: string, input: unknown) => sends.push({ channel, input }),
    invoke: async (channel: string, input: unknown) => { invocations.push({ channel, input }); } });
  const bundle = await build({ entryPoints: [resolve('src/meeting-preload.ts')], bundle: true, platform: 'browser',
    format: 'cjs', write: false, external: ['electron', 'livekit-client'] });
  const require = createRequire(resolve('package.json'));
  const context = { module: { exports: {} }, exports: {}, require: (name: string) => name === 'electron' ? { ipcRenderer } : require(name),
    document: { readyState: 'loading', addEventListener() {}, getElementById: el, createElement: () => new Element() },
    navigator: { mediaDevices: { getDisplayMedia() {} } }, isSecureContext: true, setTimeout, clearTimeout, TextEncoder, TextDecoder,
    Option: Element, fixture: undefined as unknown as {
      setup(active: unknown, interactive: boolean): void; share(): void; leave(): Promise<void>; owner(): DesktopMeetingScreenShare<ScreenTrack>;
      choices(value: unknown): void },
  };
  // Test-only access to the actual bundled preload. No Electron process or media API executes.
  runInNewContext(bundle.outputFiles[0].text + '\n globalThis.fixture = { setup(active, interactive) { room = active; canPublish = interactive; revision = "login-a"; startScreenOwner(active, {roomRevision:"room-a", ownerId:7, tenantId:9}, () => true); }, share:updateScreenShare, leave, owner:() => screenOwner, choices:showScreenChoices };', context);
  context.fixture.setup(active, interactive);
  return { fixture: context.fixture, active, el, events, publications, sends, invocations, media, track,
    setCapture: (value: typeof capture) => { capture = value; }, setUnpublishFails: (value: boolean) => { unpublishFails = value; }, permissions };
}
test('actual preload Share calls capture directly and hides unsupported publishing', async () => {
  const f = await fixture(); assert.equal(f.events.length, 0); assert.equal(f.el('share-screen').hidden, false);
  f.fixture.share(); assert.equal(f.events[0], 'capture'); await new Promise<void>(done => setImmediate(done));
  assert.match(f.el('screen-status').textContent, /You are sharing/); await f.fixture.owner().stop();
  for (const mode of ['listener', 'sdk']) {
    const unsupported = await fixture(mode !== 'listener');
    if (mode === 'sdk') { unsupported.permissions.canPublishSources = [Track.sourceToProto(Track.Source.Camera)]; unsupported.fixture.owner().refresh(); }
    assert.equal(unsupported.el('share-screen').hidden, true); unsupported.fixture.share();
    await Promise.resolve(); assert.equal(unsupported.events.length, 0);
  }
});
test('actual chooser renders source names as text and submits only the selected opaque handle', async () => {
  const f = await fixture(), capture = deferred<ScreenTrack[]>(); f.setCapture(() => capture.promise); f.fixture.share();
  f.fixture.choices({ revision: 'login-a', roomRevision: 'room-a', request: 'request-handle', choices: [{ handle: 'choice-handle', name: '<script>title</script>' }] });
  assert.equal(f.el('screen-picker').hidden, false); const button = f.el('screen-choice-list').children[0];
  assert.equal(button.textContent, '<script>title</script>'); button.listeners.get('click')!();
  assert.deepEqual(JSON.parse(JSON.stringify(f.invocations[0])), { channel: MEETING_CHANNELS.screenChoose,
    input: { revision: 'login-a', roomRevision: 'room-a', request: 'request-handle', handle: 'choice-handle' } });
  capture.resolve([f.track]); await new Promise<void>(done => setImmediate(done)); await f.fixture.owner().stop();
});
test('reconnect cancels pending capture, stops late tracks, and never restarts sharing', async () => {
  const f = await fixture(), capture = deferred<ScreenTrack[]>(); f.setCapture(() => capture.promise); f.fixture.share();
  f.active.emit(RoomEvent.SignalReconnecting); capture.resolve([f.track]); await f.fixture.owner().stop();
  assert.equal(f.events.includes('publish'), false); assert.equal(f.media.readyState, 'ended');
  f.active.emit(RoomEvent.Reconnected); assert.equal(f.events.filter(value => value === 'capture').length, 1);
  assert.equal(f.fixture.owner().getSnapshot().status, 'idle'); assert.ok(f.sends.some(value => value.channel === MEETING_CHANNELS.screenCancel));
});
test('actual preload surfaces automatic cleanup errors and enables Stop retry', async () => {
  const f = await fixture(); f.fixture.share(); await new Promise<void>(done => setImmediate(done));
  f.setUnpublishFails(true); f.permissions.canPublish = false; f.active.emit(RoomEvent.ParticipantPermissionsChanged);
  await assert.rejects(f.fixture.owner().stop()); assert.match(f.el('screen-status').textContent, /Tap Stop sharing to retry/);
  assert.equal(f.el('share-screen').disabled, false); f.setUnpublishFails(false); f.fixture.share();
  await f.fixture.owner().stop(); assert.equal(f.publications.size, 0);
});
test('actual leave waits for late capture cleanup before disconnect', async () => {
  const f = await fixture(), capture = deferred<ScreenTrack[]>(); f.setCapture(() => capture.promise); f.fixture.share();
  const leaving = f.fixture.leave(); await Promise.resolve(); assert.equal(f.events.includes('disconnect'), false);
  capture.resolve([f.track]); await leaving; assert.ok(f.events.indexOf('stop') < f.events.indexOf('disconnect'));
  assert.equal(f.events.includes('publish'), false); assert.equal(f.fixture.owner(), null);
});
test('provider room move retires the screen owner and requests a new admission instead of resuming', async () => {
  const f = await fixture(); f.fixture.share(); await new Promise<void>(done => setImmediate(done));
  f.active.emit(RoomEvent.Moved); assert.equal(f.media.readyState, 'ended'); await f.fixture.owner().stop();
  f.active.emit(RoomEvent.Reconnected); f.fixture.share(); await Promise.resolve();
  assert.equal(f.events.filter(value => value === 'capture').length, 1);
  assert.equal(f.fixture.owner().getSnapshot().available, false);
  assert.ok(f.invocations.some(value => value.channel === MEETING_CHANNELS.finished));
});
