import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { build } from 'esbuild';

const roomA = '12345678-1234-4234-8234-123456789012';
const roomB = '87654321-4321-4321-8321-210987654321';
const conversationId = '11223344-1234-4234-8234-123456789012';
const stateChannel = 'phone11:meeting-state';
const joinChannel = 'phone11:meeting-join';
type Listing = { meetingId: string }[];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

// Execute the actual privileged IPC owner; only Electron and authenticated I/O are fixtures.
async function harness() {
  const handlers = new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>();
  const ipc = Object.assign(new EventEmitter(), {
    handle: (channel: string, handler: (event: unknown, input?: unknown) => Promise<unknown>) => { handlers.set(channel, handler); },
  });
  let window!: FakeWindow;
  const session = { revision: 'account-a', userId: '1', tenantId: 1 };
  let list: Listing | Promise<Listing> = [{ meetingId: roomA }];
  let start: Promise<string> | undefined;
  const calls: string[] = [];
  class FakeWindow extends EventEmitter {
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: '' },
      session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDisplayMediaRequestHandler() {} },
      getURL: () => this.webContents.mainFrame.url,
      isDestroyed: () => this.destroyed,
      setWindowOpenHandler() {},
      send: (channel: string) => {
        if (channel === 'phone11:meeting-leave-now') ipc.emit('phone11:meeting-left', event());
      },
    });
    constructor() { super(); window = this; }
    async loadFile(path: string) { this.webContents.mainFrame.url = pathToFileURL(path).href; }
    isDestroyed() { return this.destroyed; }
    show() {} focus() {}
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const event = () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  const provider = {
    currentSession: () => session,
    availableMeetings: async (revision: string) => { calls.push(`list:${revision}`); return list; },
    meetingChannels: async () => { calls.push('channels'); return [{ id: conversationId, name: 'Team' }]; },
    meetingDirectChats: async () => { calls.push('direct'); return [{ id: conversationId, peerId: 2, name: 'Contact' }]; },
    meetingDirectDetails: async () => ({ conversationId, peerId: 2, canStart: true }),
    startDirectMeeting: async () => start ?? roomB,
    startChannelMeeting: async () => start ?? roomB,
    joinMeeting: async (_revision: string, meetingId: string) => {
      calls.push(`join:${meetingId}`);
      return { grantProfile: 'interactive' };
    },
  };
  const bundle = await build({ entryPoints: [resolve('src/meeting-window.ts')], bundle: true,
    platform: 'node', format: 'cjs', write: false, external: ['electron'] });
  const module = { exports: {} as { DesktopMeetingWindow: new (...args: unknown[]) => {
    open: () => Promise<void>; close: () => Promise<void>; registerIpc: () => void;
  } } };
  const require = createRequire(resolve('package.json'));
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, __dirname: resolve('src'),
    require: (name: string) => name === 'electron' ? { BrowserWindow: FakeWindow, ipcMain: ipc } : require(name),
    setTimeout, clearTimeout, console, AbortController });
  const owner = new module.exports.DesktopMeetingWindow(provider,
    { snapshot: () => ({ call: null, dialState: 'idle', callActionState: 'idle' }) }, () => null);
  owner.registerIpc();
  await owner.open();
  const invoke = (channel: string, input?: unknown, source: unknown = event()) => handlers.get(channel)!(source, input);
  await invoke(stateChannel);
  return { owner, event, invoke, calls, session,
    setList: (value: Listing | Promise<Listing>) => { list = value; },
    setStart: (value: Promise<string>) => { start = value; },
    refresh: () => invoke(stateChannel, { revision: 'account-a', refreshMeetings: true }),
    join: (meetingId: string) => invoke(joinChannel, { revision: 'account-a', meetingId }) };
}

test('room-only refresh updates admission without resetting channel/direct choices', async () => {
  const h = await harness();
  h.setList([{ meetingId: roomB }]);
  const result = await h.refresh() as { revision: string; meetings: Listing };
  assert.equal(result.revision, 'account-a');
  assert.equal(result.meetings[0].meetingId, roomB);
  assert.equal(h.calls.filter(call => call === 'channels').length, 1);
  assert.equal(h.calls.filter(call => call === 'direct').length, 1);
  await assert.rejects(h.join(roomA), /Meeting unavailable/);
  await h.invoke('phone11:meeting-direct-details', { revision: 'account-a', conversationId });
  await h.join(roomB);
  assert.ok(h.calls.includes(`join:${roomB}`));
  await assert.rejects(h.refresh(), /Meeting session changed/);
  await h.owner.close();
});

test('refresh requires exact current frame and strict revision-bound input before I/O', async () => {
  const h = await harness();
  const before = h.calls.length;
  for (const input of [null, {}, { revision: 'account-b', refreshMeetings: true },
    { revision: 'account-a', refreshMeetings: true, tenantId: 2 },
    { revision: 'account-a', refreshMeetings: false }]) {
    await assert.rejects(h.invoke(stateChannel, input), /Meeting session changed/);
  }
  await assert.rejects(h.invoke(stateChannel, { revision: 'account-a', refreshMeetings: true },
    { ...h.event(), senderFrame: { url: h.event().senderFrame.url } }), /Meeting session changed/);
  assert.equal(h.calls.length, before);
  await h.owner.close();
});

test('SDK failure acknowledgment reopens refresh and same-room retry after successful admission', async () => {
  const h = await harness();
  await h.join(roomA);
  await assert.rejects(h.refresh(), /Meeting session changed/);
  await h.invoke('phone11:meeting-join-failed');
  await h.refresh();
  await h.join(roomA);
  assert.equal(h.calls.filter(call => call === `join:${roomA}`).length, 2);
  await h.owner.close();
});

test('older refresh cannot overwrite admission after a newer request completes', async () => {
  const h = await harness();
  const older = deferred<Listing>();
  const newer = deferred<Listing>();
  h.setList(older.promise);
  const oldRequest = assert.rejects(h.refresh(), /Meeting session changed/);
  h.setList(newer.promise);
  const newRequest = h.refresh();
  newer.resolve([{ meetingId: roomB }]);
  await newRequest;
  older.resolve([{ meetingId: roomA }]);
  await oldRequest;
  await assert.rejects(h.join(roomA), /Meeting unavailable/);
  await h.join(roomB);
  await h.owner.close();
});

for (const replacement of ['close', 'session', 'join', 'direct-start', 'channel-start'] as const) {
  test(`pending refresh cannot publish admission after ${replacement}`, async () => {
    const h = await harness();
    const list = deferred<Listing>();
    h.setList(list.promise);
    const refreshed = assert.rejects(h.refresh(), /Meeting session changed/);
    if (replacement === 'close') await h.owner.close();
    else if (replacement === 'session') h.session.revision = 'account-b';
    else if (replacement === 'join') {
      await h.join(roomA);
      await h.invoke('phone11:meeting-join-failed');
    } else {
      const start = deferred<string>();
      h.setStart(start.promise);
      const starting = h.invoke(replacement === 'direct-start'
        ? 'phone11:meeting-start-direct' : 'phone11:meeting-start-channel',
      replacement === 'direct-start' ? { conversationId, revision: 'account-a' }
        : { channelId: conversationId, selectedMemberIds: [2], revision: 'account-a' });
      await assert.rejects(h.refresh(), /Meeting session changed/);
      start.resolve(roomA);
      await starting;
    }
    list.resolve([{ meetingId: roomB }]);
    await refreshed;
    if (replacement !== 'close' && replacement !== 'session') {
      await assert.rejects(h.join(roomB), /Meeting unavailable/);
      await h.join(roomA);
    }
    await h.owner.close();
  });
}
