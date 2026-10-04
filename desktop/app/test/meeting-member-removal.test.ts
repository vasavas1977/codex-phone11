import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DesktopMeetingMemberRemoval, DesktopMeetingRemovalClient, readHostControls, removalRow } from '../src/meeting-member-removal';
import type { HostControlSnapshot, MemberRemovalInput, MemberRemovalResult, RemovalMember } from '../../../lib/meetings/member-removal';

const meetingId = '12345678-1234-4234-8234-123456789012';
const roomRevision = '22345678-1234-4234-8234-123456789012';
const admissionRevision = '32345678-1234-4234-8234-123456789012';
const operationId = '42345678-1234-4234-8234-123456789012';
const row: RemovalMember = { userId: 8, name: 'Coworker', expectedParticipantId: 'opaque_member',
  expectedRoomRevision: roomRevision, expectedMemberRevision: admissionRevision, state: 'admitted' };
const snapshot: HostControlSnapshot = { available: true, meetingId, tenantId: 9, members: [row] };
const result: MemberRemovalResult = { operationId, expectedRoomRevision: roomRevision,
  expectedMemberRevision: operationId, state: 'pending', providerAcknowledged: false };
function fixture() {
  let active = true; let scope = snapshot; let receipt = result;
  const calls: { mode: string; input: MemberRemovalInput }[] = [];
  const owner = new DesktopMeetingMemberRemoval(meetingId, 9, 7, () => active, {
    snapshot: async () => scope,
    request: async input => { calls.push({ mode: 'request', input }); return receipt; },
    poll: async input => { calls.push({ mode: 'poll', input }); return receipt; },
  });
  return { owner, calls, setScope: (value: HostControlSnapshot) => { scope = value; },
    setReceipt: (value: MemberRemovalResult) => { receipt = value; }, retire: () => { active = false; owner.dispose(); } };
}

test('default-off snapshot exposes zero admitted members and cannot invoke removal', async () => {
  const f = fixture(); f.setScope({ available: false, meetingId, members: [] });
  assert.equal((await f.owner.refresh()).available, false);
  await assert.rejects(f.owner.act(removalRow(row), 'request'));
  assert.equal(f.calls.length, 0);
});

test('untrusted snapshots fail closed on tenant, owner, duplicate, mixed room and unsafe presentation', () => {
  for (const value of [
    { ...snapshot, tenantId: 10 }, { ...snapshot, meetingId: operationId },
    { ...snapshot, members: [{ ...row, userId: 7 }] }, { ...snapshot, members: [row, row] },
    { ...snapshot, members: [row, { ...row, userId: 10, expectedRoomRevision: operationId }] },
    { ...snapshot, members: [{ ...row, name: 'Untrusted\u202e' }] },
    { available: false, meetingId, members: [row] },
    { ...snapshot, members: [{ ...row, expectedMemberRevision: 'no assertion' }] },
  ]) assert.throws(() => readHostControls(value, meetingId, 9, 7));
});

test('request, uncertain retry and poll retain exact operation assertions and never alter a media roster', async () => {
  const f = fixture(); await f.owner.refresh();
  const admitted = f.owner.controller.getSnapshot().members[0];
  const pending = (await f.owner.act(removalRow(admitted), 'request')).members[0];
  assert.equal(pending.state, 'pending'); assert.equal(pending.expectedMemberRevision, operationId);
  await assert.rejects(f.owner.act(removalRow(admitted), 'request'));
  await f.owner.act(removalRow(pending), 'request');
  const fresh = f.owner.controller.getSnapshot().members[0];
  f.setReceipt({ ...result, state: 'completed', providerAcknowledged: true });
  assert.equal((await f.owner.act(removalRow(fresh), 'poll')).members[0].state, 'completed');
  assert.deepEqual(f.calls.map(call => call.input.expectedMemberRevision), [admissionRevision, operationId, operationId]);
  assert.deepEqual(f.calls[0].input, { tenantId: 9, meetingId, targetUserId: 8,
    expectedParticipantId: row.expectedParticipantId, expectedRoomRevision: roomRevision, expectedMemberRevision: admissionRevision });
});

test('pending poll cannot inherit a different valid operation receipt', async () => {
  const f = fixture(); await f.owner.refresh();
  const pending = (await f.owner.act(removalRow(row), 'request')).members[0];
  f.setReceipt({ ...result, operationId: meetingId, expectedMemberRevision: meetingId });
  const view = await f.owner.act(removalRow(pending), 'poll');
  assert.equal(view.available, false); assert.deepEqual(view.members, []); assert.match(view.error!, /unavailable/);
});

test('refresh fences room lifetime changes and known denied subjects never become admitted', async () => {
  const f = fixture(); await f.owner.refresh(); await f.owner.act(removalRow(row), 'request');
  assert.equal((await f.owner.refresh()).available, false);
  const g = fixture(); await g.owner.refresh();
  g.setScope({ ...snapshot, members: [{ ...row, expectedRoomRevision: operationId }] });
  assert.equal((await g.owner.refresh()).available, false);
});

test('an account/room retirement suppresses late responses and all subsequent requests', async () => {
  let finish!: (value: HostControlSnapshot) => void;
  const owner = new DesktopMeetingMemberRemoval(meetingId, 9, 7, () => true, {
    snapshot: () => new Promise(resolve => { finish = resolve; }), request: async () => result, poll: async () => result });
  const loading = owner.refresh(); owner.dispose(); finish(snapshot); await loading;
  assert.equal(owner.controller.getSnapshot().available, false);
  await assert.rejects(owner.act(removalRow(row), 'request'));
});

test('isolated preload retires synchronously on loss; reconnect cannot revive stale callbacks or late authority', async () => {
  let connected = true; let calls = 0; let retire = 0;
  let finish!: (view: ReturnType<DesktopMeetingRemovalClient['getSnapshot']>) => void;
  const client = new DesktopMeetingRemovalClient(() => connected, {
    refresh: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
    act: async () => { calls++; throw new Error('should not send'); }, retire: () => { retire++; },
  }, () => undefined);
  const loading = client.refresh(); connected = false; assert.equal(client.current(), false);
  connected = true; finish({ available: true, loading: false, members: [row], busyUserId: null, error: null }); await loading;
  await client.refresh(); await client.act(row, 'request');
  assert.equal(calls, 1); assert.equal(retire, 1); assert.deepEqual(client.getSnapshot().members, []);
});

test('preload confirmation callbacks must match the currently loaded row object and errors clear authority', async () => {
  let count = 0;
  const client = new DesktopMeetingRemovalClient(() => true, {
    refresh: async () => ({ available: true, loading: false, members: [{ ...row }], busyUserId: null, error: null }),
    act: async () => { count++; throw new Error('private backend error'); }, retire() {},
  }, () => undefined);
  await client.refresh(); const old = client.getSnapshot().members[0]; await client.refresh();
  await client.act(old, 'request'); assert.equal(count, 0);
  await client.act(client.getSnapshot().members[0], 'request'); assert.equal(count, 1);
  assert.deepEqual(client.getSnapshot().members, []); assert.doesNotMatch(client.getSnapshot().error!, /private backend/);
});
