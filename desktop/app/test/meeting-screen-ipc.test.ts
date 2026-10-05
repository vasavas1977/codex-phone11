import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { build } from 'esbuild';
import { MEETING_CHANNELS } from '../src/meeting-channels';
import type { ScreenChoices } from '../src/meeting-screen-picker';
const meetingId = '12345678-1234-4234-8234-123456789012';
const tick = () => new Promise<void>(done => setImmediate(done));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(profile = 'interactive') {
  const handlers = new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>();
  const ipc = Object.assign(new EventEmitter(), { handle: (channel: string, handler: never) => handlers.set(channel, handler) });
  let session = { revision: 'login-a', userId: '7', tenantId: 9 };
  let phone = { call: null as null | object, dialState: 'idle', callActionState: 'idle' };
  const source = { id: 'screen:native-private-id', name: 'Desktop', thumbnail: 'must-not-leave-main' };
  let enumerate = () => Promise.resolve([source]);
  const options: unknown[] = [], messages: { channel: string; value: unknown }[] = [], streams: unknown[] = [];
  let display!: (request: Record<string, unknown>, callback: (streams: unknown) => void) => void;
  let permission!: (sender: unknown, permission: string, callback: (value: boolean) => void, details: unknown) => void;
  let check!: (sender: unknown, permission: string, origin: string, details: unknown) => boolean;
  let pickerOptions: unknown, window!: FakeWindow;
  class FakeWindow extends EventEmitter {
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: '' }, getURL: () => this.webContents.mainFrame.url, isDestroyed: () => this.destroyed,
      session: { setPermissionRequestHandler: (value: typeof permission) => { permission = value; },
        setPermissionCheckHandler: (value: typeof check) => { check = value; },
        setDisplayMediaRequestHandler: (value: typeof display, opts: unknown) => { display = value; pickerOptions = opts; } },
      setWindowOpenHandler() {}, send: (channel: string, value: unknown) => {
        messages.push({ channel, value });
        if (channel === MEETING_CHANNELS.leaveNow) ipc.emit(MEETING_CHANNELS.left, event());
      },
    });
    constructor() { super(); window = this; }
    async loadFile(path: string) { this.webContents.mainFrame.url = pathToFileURL(path).href; }
    isDestroyed() { return this.destroyed; } show() {} focus() {}
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const bundle = await build({ entryPoints: [resolve('src/meeting-window.ts')], bundle: true, platform: 'node',
    format: 'cjs', write: false, external: ['electron'] });
  const module = { exports: {} as { DesktopMeetingWindow: new (...args: unknown[]) => {
    registerIpc(): void; open(): Promise<void>; close(): Promise<void>; onPhoneSnapshot(): void } } };
  const require = createRequire(resolve('package.json'));
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, __dirname: resolve('src'),
    require: (name: string) => name === 'electron' ? { BrowserWindow: FakeWindow, ipcMain: ipc,
      desktopCapturer: { getSources: (opts: unknown) => { options.push(opts); return enumerate(); } },
      webContents: { fromFrame: (frame: unknown) => frame === window.webContents.mainFrame || (frame as { owner?: unknown }).owner === window.webContents
        ? window.webContents : undefined } } : require(name), setTimeout, clearTimeout, AbortController });
  const event = () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  const owner = new module.exports.DesktopMeetingWindow({ currentSession: () => session,
    joinMeeting: async () => ({ grantProfile: profile, expiresAt: 1, url: 'wss://synthetic.invalid', token: 'synthetic' }) },
  { snapshot: () => phone }, () => null);
  owner.registerIpc(); await owner.open();
  const state = owner as unknown as { admitted: Set<string>; screenAdmission: unknown; screenReady: boolean };
  state.admitted.add(meetingId);
  const invoke = (channel: string, input: unknown, sourceEvent: unknown = event()) => handlers.get(channel)!(sourceEvent, input);
  const admission = await invoke(MEETING_CHANNELS.join, { meetingId, revision: session.revision }) as { photoScope: { roomRevision: string } };
  const binding = { revision: session.revision, roomRevision: admission.photoScope.roomRevision };
  const ready = (available: boolean, sourceEvent: unknown = event(), input: unknown = { ...binding, available }) => ipc.emit(MEETING_CHANNELS.screenState, sourceEvent, input);
  ready(true);
  const request = (change: Record<string, unknown> = {}) => display({ frame: window.webContents.mainFrame,
    userGesture: true, videoRequested: true, audioRequested: false, ...change }, value => streams.push(value));
  const choices = () => messages.filter(message => message.channel === MEETING_CHANNELS.screenChoices).at(-1)?.value as ScreenChoices & typeof binding;
  return { owner, state, window, event, binding, invoke, ready, request, choices, streams, options,
    pickerOptions, permission, check, source, messages, ipc,
    setSources: (value: typeof enumerate) => { enumerate = value; }, replaceSession: (sameTags = false) => { session = { ...session, revision: sameTags ? session.revision : 'login-b' }; },
    busyPhone: () => { phone = { ...phone, call: { state: 'incoming' } }; owner.onPhoneSnapshot(); } };
}
test('actual display handler requires the exact requesting frame, user gesture, and video only', async () => {
  const f = await fixture();
  for (const change of [{ frame: null }, { frame: { url: f.window.webContents.mainFrame.url, owner: f.window.webContents } },
    { frame: { url: 'https://foreign.invalid' } }, { userGesture: false }, { videoRequested: false }, { audioRequested: true }]) f.request(change);
  assert.equal(f.options.length, 0); assert.equal(f.streams.length, 6);
  assert.ok(f.streams.every(value => Object.keys(value as object).length === 0));
  assert.equal((f.pickerOptions as { useSystemPicker: boolean }).useSystemPicker, false); await f.owner.close();
});
test('main picker waits for explicit opaque selection and grants no audio', async () => {
  const f = await fixture(); f.request(); await tick(); assert.equal(f.streams.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(f.options[0])), { types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  const choices = f.choices(); assert.ok(!JSON.stringify(choices).includes('native-private-id')); assert.ok(!JSON.stringify(choices).includes('thumbnail'));
  await f.invoke(MEETING_CHANNELS.screenChoose, { ...f.binding, request: choices.request, handle: choices.choices[0].handle });
  assert.equal((f.streams[0] as { video: unknown }).video, f.source);
  assert.equal(Object.keys(f.streams[0] as object).join(','), 'video');
  await f.invoke(MEETING_CHANNELS.screenChoose, { ...f.binding, request: choices.request, handle: choices.choices[0].handle });
  assert.equal(f.streams.length, 1); await f.owner.close();
});
test('listener admission cannot capture even if the renderer reports SDK availability', async () => {
  const f = await fixture('listener'); f.request(); assert.equal(f.options.length, 0); assert.equal(f.streams.length, 1); await f.owner.close();
});
test('permission checks do not grant display access to subframes or another URL', async () => {
  const f = await fixture(), wc = f.window.webContents;
  const details = { isMainFrame: true, requestingUrl: wc.mainFrame.url };
  assert.equal(f.check(wc, 'display-capture', 'file://', details), true);
  assert.equal(f.check(wc, 'display-capture', 'file://', { ...details, isMainFrame: false }), false);
  assert.equal(f.check(wc, 'display-capture', 'file://', { ...details, requestingUrl: 'file:///foreign.html' }), false);
  assert.equal(f.check({}, 'display-capture', 'file://', details), false);
  let permitted = true; f.permission(wc, 'display-capture', value => { permitted = value; }, { ...details, isMainFrame: false });
  assert.equal(permitted, false); await f.owner.close();
});
test('choice IPC refuses wrong frame, stale room, and injected source coordinates', async () => {
  const f = await fixture(); f.request(); await tick(); const choices = f.choices();
  const input = { ...f.binding, request: choices.request, handle: choices.choices[0].handle };
  for (const [value, event] of [[input, { ...f.event(), senderFrame: { ...f.event().senderFrame } }],
    [{ ...input, roomRevision: meetingId }, f.event()], [{ ...input, sourceId: f.source.id }, f.event()]])
    await assert.rejects(f.invoke(MEETING_CHANNELS.screenChoose, value, event));
  assert.equal(f.streams.length, 0); f.ipc.emit(MEETING_CHANNELS.screenCancel, f.event(), f.binding);
  assert.equal(f.streams.length, 1); await f.owner.close();
});
test('auth identity replacement and room closure refuse late enumeration and selection', async () => {
  for (const sameTags of [true, false]) {
    const f = await fixture(), enumeration = deferred<(typeof f.source)[]>(); f.setSources(() => enumeration.promise);
    f.request(); await tick(); f.replaceSession(sameTags); enumeration.resolve([f.source]); await tick();
    assert.equal(f.streams.length, 1); assert.equal(Object.keys(f.streams[0] as object).length, 0); await f.owner.close();
  }
  const f = await fixture(); f.request(); await tick(); const choices = f.choices(); f.replaceSession(true);
  await f.invoke(MEETING_CHANNELS.screenChoose, { ...f.binding, request: choices.request, handle: choices.choices[0].handle });
  assert.equal(Object.keys(f.streams[0] as object).length, 0); await f.owner.close();
});
test('SDK revocation, navigation, SIP takeover, and window closure cancel a pending picker', async () => {
  for (const mode of ['sdk', 'navigation', 'sip', 'close']) {
    const f = await fixture(), enumeration = deferred<(typeof f.source)[]>(); f.setSources(() => enumeration.promise);
    f.request(); await tick();
    if (mode === 'sdk') f.ready(false);
    else if (mode === 'navigation') f.window.webContents.emit('will-navigate', { preventDefault() {} });
    else if (mode === 'sip') f.busyPhone(); else await f.owner.close();
    enumeration.resolve([f.source]); await tick(); assert.equal(f.streams.length, 1);
    assert.equal(Object.keys(f.streams[0] as object).length, 0); await f.owner.close();
  }
});
test('source disappearance during the choice denies capture instead of selecting another source', async () => {
  const f = await fixture(); f.request(); await tick(); const choices = f.choices(); f.setSources(() => Promise.resolve([]));
  await f.invoke(MEETING_CHANNELS.screenChoose, { ...f.binding, request: choices.request, handle: choices.choices[0].handle });
  assert.equal(Object.keys(f.streams[0] as object).length, 0); await f.owner.close();
});
