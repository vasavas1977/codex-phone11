import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthenticatedDesktopProvider } from '../../src/authenticated-provider';

const channelId = '22345678-1234-4234-8234-123456789012';
const requestId = '52345678-1234-4234-8234-123456789012';
const meetingId = '62345678-1234-4234-8234-123456789012';
const trpc = (value: unknown) => Response.json({ result: { data: { json: value } } });

function signed(fetcher: typeof fetch) {
  const provider = new AuthenticatedDesktopProvider({ origin: 'https://phone11.example', fetch: fetcher });
  (provider as any).token = 'private-test-token';
  (provider as any).session = { revision: 'signed-a', userId: '7', tenantId: 41,
    extensionId: 11, accountId: 'account-a' };
  return provider;
}

test('Meet now uses only the selected workspace and selected current channel members', async () => {
  const calls: { path: string; body?: any }[] = [];
  const provider = signed(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)).json : undefined;
    calls.push({ path, body });
    if (path.endsWith('/chat.list')) return trpc({ workspace: { id: 41 }, channels: [
      { id: channelId, kind: 'channel', name: 'Sales' },
      { id: '32345678-1234-4234-8234-123456789012', kind: 'direct', name: 'Private' },
    ] });
    if (path.endsWith('/chat.details')) return trpc({ members: [
      { id: 7, name: 'Host' }, { id: 8, name: 'A' }, { id: 9, name: 'B' },
    ] });
    if (path.endsWith('/meetings.channelCapabilities'))
      return trpc({ available: true, canStart: true, maxSelectedMembers: 50 });
    if (path.endsWith('/meetings.startChannelMeeting'))
      return trpc({ meetingId, channelId, invitedMemberIds: [9], replayed: false });
    throw new Error(`Unexpected ${path}`);
  });
  assert.deepEqual(await provider.meetingChannels('signed-a'), [{ id: channelId, name: 'Sales' }]);
  assert.deepEqual(await provider.meetingChannelDetails('signed-a', channelId), {
    channelId, members: [{ id: 8, name: 'A' }, { id: 9, name: 'B' }], canStart: true,
  });
  assert.equal(await provider.startChannelMeeting('signed-a', channelId, [9], requestId), meetingId);
  assert.deepEqual(calls.at(-1), { path: '/api/trpc/meetings.startChannelMeeting',
    body: { tenantId: 41, channelId, selectedMemberIds: [9], requestId } });
  assert.ok(calls.every(call => !call.body || call.body.tenantId === 41));
  await assert.rejects(provider.startChannelMeeting('signed-a', channelId, [10], requestId));
  assert.equal(calls.filter(call => call.path.endsWith('/meetings.startChannelMeeting')).length, 1);
});

test('sign-out invalidates an in-flight Meet now result before the desktop can use its room', async () => {
  let release!: (value: Response) => void;
  let started!: () => void;
  const received = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<Response>(resolve => { release = resolve; });
  const provider = signed(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/chat.details')) return trpc({ members: [{ id: 7, name: 'Host' }, { id: 8, name: 'A' }] });
    if (path.endsWith('/meetings.channelCapabilities'))
      return trpc({ available: true, canStart: true, maxSelectedMembers: 50 });
    if (path.endsWith('/meetings.startChannelMeeting')) { started(); return pending; }
    if (path === '/api/auth/sign-out') return Response.json({ ok: true });
    throw new Error(`Unexpected ${path}`);
  });
  const attempt = provider.startChannelMeeting('signed-a', channelId, [8], requestId);
  await received;
  await provider.signOut();
  release(trpc({ meetingId, channelId, invitedMemberIds: [8], replayed: false }));
  await assert.rejects(attempt);
});
