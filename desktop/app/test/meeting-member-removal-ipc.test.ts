import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { MEETING_CHANNELS } from '../src/meeting-channels';
import type { DesktopMeetingWindow } from '../src/meeting-window';

const meetingId = '12345678-1234-4234-8234-123456789012';
const roomRevision = '22345678-1234-4234-8234-123456789012';
const operationId = '32345678-1234-4234-8234-123456789012';
const row = { userId: 8, expectedParticipantId: 'opaque', expectedRoomRevision: meetingId,
  expectedMemberRevision: meetingId, name: 'Coworker', state: 'admitted' };
const assertion = { userId: row.userId, expectedParticipantId: row.expectedParticipantId,
  expectedRoomRevision: row.expectedRoomRevision, expectedMemberRevision: row.expectedMemberRevision };
async function fixture() {
  const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
  const listeners = new Map<string, (event: unknown, input: unknown) => void>();
  const ipcMain = { handle: (name: string, handler: never) => handlers.set(name, handler), on: (name: string, handler: never) => listeners.set(name, handler) };
  const entry = resolve('src/meeting-window.ts');
  const bundle = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'] });
  const module = { exports: {} as { DesktopMeetingWindow: typeof DesktopMeetingWindow } };
  const require = createRequire(resolve('test/meeting-member-removal-ipc.test.ts'));
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, __dirname: '/synthetic',
    require: (name: string) => name === 'electron' ? { ipcMain } : require(name), setTimeout, clearTimeout, Buffer, AbortController });
  let session = { revision: 'login-a', userId: '7', tenantId: 9, accountId: 'account-a', extensionId: 41 };
  let snapshot = { available: true, meetingId, tenantId: 9, members: [row] };
  let response: (() => Promise<typeof snapshot>) | undefined;
  const calls: { mode: string; input: unknown }[] = [];
  const provider = { currentSession: () => session,
    meetingMemberPhoto: async (_revision: string, tenantId: number, userId: number) => { calls.push({ mode: 'photo', input: { tenantId, userId } }); return null; },
    meetingHostControls: async (_revision: string, id: string) => { calls.push({ mode: 'snapshot', input: id }); return response ? response() : snapshot; },
    meetingRemoveMember: async (_revision: string, input: unknown) => { calls.push({ mode: 'request', input }); return {
      operationId, expectedRoomRevision: meetingId, expectedMemberRevision: operationId, state: 'pending', providerAcknowledged: false }; } };
  const owner = new module.exports.DesktopMeetingWindow(provider as never,
    { snapshot: () => ({ call: null, dialState: 'idle', callActionState: 'idle' }) } as never, () => null);
  const frame = { url: 'file:///synthetic/meeting.html' };
  const wc = { mainFrame: frame, isDestroyed: () => false, getURL: () => frame.url };
  const state = owner as unknown as Record<string, unknown>;
  Object.assign(state, { win: { isDestroyed: () => false, webContents: wc }, revision: session.revision,
    joined: true, joinedMeetingId: meetingId, photoScope: { roomRevision, ownerId: 7, tenantId: 9 }, controlsRetired: false });
  owner.registerIpc();
  const event = { sender: wc, senderFrame: frame };
  const binding = { revision: session.revision, roomRevision };
  return { owner, calls, event, binding, handlers, listeners, state,
    invoke: (channel: string, input: unknown = binding, source: unknown = event) => handlers.get(channel)!(source, input),
    setSession: () => { session = { ...session, revision: 'login-b' }; },
    replaceSameTags: () => { session = { ...session }; },
    setOff: () => { snapshot = { available: false, meetingId, members: [] } as unknown as typeof snapshot; },
    defer: (next: () => Promise<typeof snapshot>) => { response = next; }, snapshot };
}

test('actual main IPC rejects foreign frames, stale login/room/row and caller-selected provider coordinates', async () => {
  const f = await fixture();
  for (const [source, input] of [
    [{ ...f.event, sender: {} }, f.binding], [{ ...f.event, senderFrame: { ...f.event.senderFrame } }, f.binding],
    [f.event, { ...f.binding, revision: 'old' }], [f.event, { ...f.binding, roomRevision: meetingId }],
    [f.event, { ...f.binding, tenantId: 10 }],
  ]) await assert.rejects(f.invoke(MEETING_CHANNELS.hostControls, input, source));
  assert.equal(f.calls.length, 0);
  await f.invoke(MEETING_CHANNELS.hostControls);
  await assert.rejects(f.invoke(MEETING_CHANNELS.removeMember, { ...f.binding, row: { ...assertion, expectedParticipantId: 'other' } }));
  await assert.rejects(f.invoke(MEETING_CHANNELS.removeMember, { ...f.binding, row: { ...assertion, providerRoom: 'fake' } }));
  await f.invoke(MEETING_CHANNELS.removeMember, { ...f.binding, row: assertion });
  assert.equal(f.calls.filter(call => call.mode === 'request').length, 1);
  await assert.rejects(f.invoke(MEETING_CHANNELS.removeMember, { ...f.binding, row: assertion }));
  f.setSession(); await assert.rejects(f.invoke(MEETING_CHANNELS.hostControls));
});

test('default-off IPC has no removable rows and cannot issue a provider mutation', async () => {
  const f = await fixture(); f.setOff();
  const view = await f.invoke(MEETING_CHANNELS.hostControls) as { available: boolean; members: unknown[] };
  assert.equal(view.available, false); assert.deepEqual(Array.from(view.members), []);
  await assert.rejects(f.invoke(MEETING_CHANNELS.removeMember, { ...f.binding, row: assertion }));
  assert.equal(f.calls.filter(call => call.mode === 'request').length, 0);
});

test('trusted reconnect retirement is permanent and late host responses cannot resurrect authority', async () => {
  const f = await fixture(); let finish!: (value: typeof f.snapshot) => void;
  f.defer(() => new Promise(done => { finish = done; }));
  const loading = f.invoke(MEETING_CHANNELS.hostControls);
  f.listeners.get(MEETING_CHANNELS.retireControls)!(f.event, f.binding);
  finish(f.snapshot); await assert.rejects(loading);
  await assert.rejects(f.invoke(MEETING_CHANNELS.hostControls));
  await assert.rejects(f.invoke(MEETING_CHANNELS.removeMember, { ...f.binding, row: assertion }));
  assert.equal(f.calls.length, 1);
});

test('same-tag owner replacement retires host authority instead of returning the retained snapshot', async () => {
  const f = await fixture(); await f.invoke(MEETING_CHANNELS.hostControls);
  f.replaceSameTags(); await assert.rejects(f.invoke(MEETING_CHANNELS.hostControls));
  await assert.rejects(f.invoke(MEETING_CHANNELS.removeMember, { ...f.binding, row: assertion }));
  assert.equal(f.calls.length, 1); assert.equal(f.state.controlsRetired, true);
});

test('member photos resolve only exact authorized tenant/user rows and coalesce their bounded lookups', async () => {
  const f = await fixture(); await f.invoke(MEETING_CHANNELS.hostControls);
  assert.equal(await f.invoke(MEETING_CHANNELS.memberPhoto, { ...f.binding, row: { ...assertion, userId: 99 } }), null);
  await assert.rejects(f.invoke(MEETING_CHANNELS.memberPhoto, { ...f.binding, row: assertion, tenantId: 10 }));
  assert.equal(await f.invoke(MEETING_CHANNELS.memberPhoto, { ...f.binding, row: assertion }), null);
  assert.equal(await f.invoke(MEETING_CHANNELS.memberPhoto, { ...f.binding, row: assertion }), null);
  const photos = f.calls.filter(call => call.mode === 'photo'); assert.equal(photos.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(photos[0].input)), { tenantId: 9, userId: 8 });
});
