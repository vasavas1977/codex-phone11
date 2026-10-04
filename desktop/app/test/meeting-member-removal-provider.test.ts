import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthenticatedDesktopProvider } from '../../src/authenticated-provider';
import type { MemberRemovalInput } from '../../../lib/meetings/member-removal';

const meetingId = '12345678-1234-4234-8234-123456789012';
const operationId = '22345678-1234-4234-8234-123456789012';
const input: MemberRemovalInput = { tenantId: 9, meetingId, targetUserId: 8,
  expectedParticipantId: 'opaque', expectedRoomRevision: meetingId, expectedMemberRevision: meetingId };
const receipt = { operationId, expectedRoomRevision: meetingId, expectedMemberRevision: operationId,
  state: 'pending', providerAcknowledged: false };
const json = (value: unknown, headers?: HeadersInit) => new Response(JSON.stringify(value), { headers });
const trpc = (value: unknown) => json({ result: { data: { json: value } } });
async function fixture() {
  let value: unknown = { available: false, meetingId, members: [] };
  let response: (() => Promise<Response>) | undefined;
  const calls: { path: string; input: unknown; init?: RequestInit }[] = [];
  const provider = new AuthenticatedDesktopProvider({ origin: 'https://phone11.example.test', fetch: async (url, init) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === '/api/auth/sign-in/email') return json({ success: true }, { 'set-auth-token': 'synthetic-bearer' });
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-bearer');
    if (parsed.pathname === '/api/auth/me') return json({ user: { id: 7 } });
    if (parsed.pathname === '/api/trpc/pbx.memberships') return trpc([{ tenantId: 9, tenantName: 'Test', tenantStatus: 'active' }]);
    if (parsed.pathname === '/api/trpc/phone.getConfig') return trpc({ configured: true, tenantId: 9,
      extension: { id: 41, number: '1020' }, sip: { username: 'synthetic', password: 'synthetic', domain: 'sip.example.test', transport: 'TLS' } });
    if (parsed.pathname === '/api/auth/sign-out') return json({});
    calls.push({ path: parsed.pathname, input: JSON.parse(parsed.searchParams.get('input') ?? String(init?.body)), init });
    return response ? response() : trpc(value);
  } });
  const signed = await provider.signIn('synthetic@example.test', 'synthetic');
  if (!('revision' in signed)) throw new Error('Expected one workspace');
  return { provider, revision: signed.revision, calls, set: (next: unknown) => { value = next; },
    defer: (next: () => Promise<Response>) => { response = next; } };
}

test('desktop uses fresh protected host query, exact mutation/poll body and private auth transport', async () => {
  const f = await fixture();
  assert.equal((await f.provider.meetingHostControls(f.revision, meetingId)).available, false);
  assert.equal((await f.provider.meetingHostControls(f.revision, meetingId)).available, false);
  f.set(receipt); await f.provider.meetingRemoveMember(f.revision, input);
  await f.provider.meetingRemovalStatus(f.revision, { ...input, expectedMemberRevision: operationId });
  assert.deepEqual(f.calls.map(call => call.path), ['/api/trpc/meetings.hostControls', '/api/trpc/meetings.hostControls',
    '/api/trpc/meetings.removeMember', '/api/trpc/meetings.removalStatus']);
  assert.deepEqual(f.calls[0].input, { json: { meetingId } });
  assert.deepEqual(f.calls[2].input, { json: input }); assert.equal(f.calls[2].init?.method, 'POST');
  for (const call of f.calls) { assert.equal(call.init?.cache, 'no-store'); assert.equal(call.init?.credentials, 'omit'); assert.equal(call.init?.redirect, 'error'); }
});

test('cross-tenant, owner, forged payload and old login are refused before network', async () => {
  const f = await fixture();
  for (const bad of [{ ...input, tenantId: 10 }, { ...input, targetUserId: 7 }, { ...input, expectedMemberRevision: 'fake' },
    { ...input, providerMeetingId: 'forged' }]) await assert.rejects(f.provider.meetingRemoveMember(f.revision, bad));
  await assert.rejects(f.provider.meetingHostControls('old-login', meetingId));
  assert.equal(f.calls.length, 0);
});

test('malformed host/result assertions clear authority instead of exposing remote diagnostics', async () => {
  const f = await fixture(); f.set({ available: true, meetingId, tenantId: 10, members: [] });
  await assert.rejects(f.provider.meetingHostControls(f.revision, meetingId));
  f.set({ ...receipt, expectedRoomRevision: operationId });
  await assert.rejects(f.provider.meetingRemoveMember(f.revision, input));
  f.set({ ...receipt, state: 'pending', providerAcknowledged: true });
  await assert.rejects(f.provider.meetingRemovalStatus(f.revision, input));
});

test('account replacement during a host read discards a late signed response', async () => {
  const f = await fixture(); let finish!: (response: Response) => void;
  let started!: () => void; const ready = new Promise<void>(done => { started = done; });
  f.defer(() => { started(); return new Promise(done => { finish = done; }); });
  const reading = f.provider.meetingHostControls(f.revision, meetingId); await ready;
  await f.provider.signOut(); finish(trpc({ available: true, meetingId, tenantId: 9, members: [] }));
  await assert.rejects(reading); assert.equal(f.provider.currentSession(), null);
});
