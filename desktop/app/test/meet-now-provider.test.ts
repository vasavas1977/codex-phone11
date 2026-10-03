import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthenticatedDesktopProvider } from '../../src/authenticated-provider';
import { appendDirectMeetingPage, directMeetingOptionLabel } from '../src/meeting-channels';

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

test('Meet now permits authorized channels over 50 members while excluding the host and preserving capability denial', async () => {
  const roster = [
    { id: 7, name: 'Host' },
    ...Array.from({ length: 51 }, (_, index) => ({ id: index + 8, name: `Member ${index + 1}` })),
  ];
  let available = true;
  const provider = signed(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/chat.details')) return trpc({ members: roster });
    if (path.endsWith('/meetings.channelCapabilities'))
      return trpc({ available, canStart: available, maxSelectedMembers: 50 });
    if (path.endsWith('/meetings.startChannelMeeting')) {
      const body = JSON.parse(String(init?.body)).json;
      return trpc({ meetingId, channelId, invitedMemberIds: body.selectedMemberIds, replayed: false });
    }
    throw new Error(`Unexpected ${path}`);
  });

  const details = await provider.meetingChannelDetails('signed-a', channelId);
  assert.equal(details.members.length, 51);
  assert.equal(details.members.some(member => member.id === 7), false);
  assert.equal(details.canStart, true);
  const reducedSelection = Array.from({ length: 50 }, (_, index) => index + 8);
  assert.equal(await provider.startChannelMeeting('signed-a', channelId, reducedSelection, requestId), meetingId);

  available = false;
  const denied = await provider.meetingChannelDetails('signed-a', channelId);
  assert.equal(denied.members.length, 51);
  assert.equal(denied.canStart, false);
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

test('direct Meet now uses protected searched chats and validates the exact server room and peer', async () => {
  const directId = '72345678-1234-4234-8234-123456789012';
  const calls: { path: string; body?: any }[] = [];
  let returnedPeer = 8;
  const provider = signed(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)).json : undefined;
    calls.push({ path, body });
    if (path.endsWith('/chat.directMeetingChats')) {
      const query = new URL(String(input)).searchParams.get('input');
      const scope = JSON.parse(query!).json;
      assert.equal(scope.tenantId, 41);
      assert.ok(scope.search === undefined || scope.search === 'Contact A');
      return trpc([{ id: directId, name: 'Contact A', peerId: 8, extension: '108' }]);
    }
    if (path.endsWith('/meetings.directCapabilities'))
      return trpc({ available: true, canStart: true, maxSelectedMembers: 1 });
    if (path.endsWith('/meetings.startDirectMeeting'))
      return trpc({ meetingId, conversationId: directId, invitedMemberId: returnedPeer, replayed: false });
    throw new Error(`Unexpected ${path}`);
  });
  assert.deepEqual(await provider.meetingDirectChats('signed-a'),
    [{ id: directId, name: 'Contact A', peerId: 8, extension: '108' }]);
  assert.deepEqual(await provider.meetingDirectChats('signed-a', 'Contact A'),
    [{ id: directId, name: 'Contact A', peerId: 8, extension: '108' }]);
  const searchCall = calls.at(-1)!;
  assert.equal(searchCall.path, '/api/trpc/chat.directMeetingChats');
  assert.deepEqual(await provider.meetingDirectDetails('signed-a', directId, 8),
    { conversationId: directId, peerId: 8, canStart: true });
  assert.equal(await provider.startDirectMeeting('signed-a', directId, 8, requestId), meetingId);
  assert.deepEqual(calls.at(-1), { path: '/api/trpc/meetings.startDirectMeeting',
    body: { tenantId: 41, conversationId: directId, requestId } });
  assert.ok(calls.every(call => !call.body || call.body.tenantId === 41));
  await assert.rejects(provider.startDirectMeeting('signed-a', directId, 7, requestId));
  returnedPeer = 9;
  await assert.rejects(provider.startDirectMeeting('signed-a', directId, 8, requestId));
  await assert.rejects(provider.meetingDirectDetails('signed-b', directId, 8));
  assert.equal(calls.filter(call => call.path.endsWith('/meetings.startDirectMeeting')).length, 2);
});

test('channel chooser uses chat.list independently of the direct endpoint', async () => {
  let lists = 0;
  const provider = signed(async input => {
    const path = new URL(String(input)).pathname;
    assert.equal(path, '/api/trpc/chat.list');
    lists++;
    return trpc({ workspace: { id: 41 }, channels: [
      { id: channelId, kind: 'channel', name: 'Sales' },
    ] });
  });
  assert.deepEqual(await provider.meetingChannels('signed-a'), [{ id: channelId, name: 'Sales' }]);
  assert.equal(lists, 1);
});

test('direct search rejects malformed peer and a stale account before capability', async () => {
  const directId = '72345678-1234-4234-8234-123456789012';
  const calls: string[] = [];
  const provider = signed(async input => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    return trpc([{ id: directId, name: 'Invalid self', peerId: 7, extension: '107' }]);
  });
  await assert.rejects(provider.meetingDirectChats('signed-a'));
  await assert.rejects(provider.meetingDirectChats('signed-b'));
  await assert.rejects(provider.meetingDirectChats('signed-a', 'x'));
  assert.deepEqual(calls, ['/api/trpc/chat.directMeetingChats']);
});

test('direct chooser rejects an invalid or missing extension label', async () => {
  const directId = '72345678-1234-4234-8234-123456789012';
  let extension: unknown = 'office';
  const provider = signed(async () => trpc([{ id: directId, name: 'Alex', peerId: 8, extension }]));
  await assert.rejects(provider.meetingDirectChats('signed-a'));
  extension = undefined;
  await assert.rejects(provider.meetingDirectChats('signed-a'));
});

test('sign-out invalidates an in-flight direct start before its meeting can be admitted', async () => {
  const directId = '72345678-1234-4234-8234-123456789012';
  let release!: (value: Response) => void;
  let started!: () => void;
  const received = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<Response>(resolve => { release = resolve; });
  const provider = signed(async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/meetings.directCapabilities'))
      return trpc({ available: true, canStart: true, maxSelectedMembers: 1 });
    if (path.endsWith('/meetings.startDirectMeeting')) { started(); return pending; }
    if (path === '/api/auth/sign-out') return Response.json({ ok: true });
    throw new Error(`Unexpected ${path}`);
  });
  const attempt = provider.startDirectMeeting('signed-a', directId, 8, requestId);
  await received;
  await provider.signOut();
  release(trpc({ meetingId, conversationId: directId, invitedMemberId: 8, replayed: false }));
  await assert.rejects(attempt);
});

test('sign-out invalidates a late direct search result', async () => {
  const directId = '72345678-1234-4234-8234-123456789012';
  let release!: (value: Response) => void;
  let started!: () => void;
  const received = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<Response>(resolve => { release = resolve; });
  const provider = signed(async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/chat.directMeetingChats')) { started(); return pending; }
    if (path === '/api/auth/sign-out') return Response.json({ ok: true });
    throw new Error(`Unexpected ${path}`);
  });
  const search = provider.meetingDirectChats('signed-a', 'Contact A');
  await received;
  await provider.signOut();
  release(trpc([{ id: directId, name: 'Contact A', peerId: 8, extension: '108' }]));
  await assert.rejects(search);
});

test('same-name direct chats remain reachable after a full first page', async () => {
  const idFor = (n: number) => `72345678-1234-4234-8234-${String(n).padStart(12, '0')}`;
  const first = Array.from({ length: 50 }, (_, index) => ({
    id: idFor(index + 1), name: 'Alex', peerId: index + 8,
    extension: String(index + 108),
  }));
  const last = { id: idFor(51), name: 'Alex', peerId: 58, extension: '158' };
  const queries: any[] = [];
  const provider = signed(async input => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/trpc/chat.directMeetingChats');
    const scope = JSON.parse(url.searchParams.get('input')!).json;
    queries.push(scope);
    return trpc(scope.after ? [last] : first);
  });
  const firstPage = await provider.meetingDirectChats('signed-a', 'Alex');
  assert.equal(firstPage.length, 50);
  const after = { peerId: firstPage[49].peerId, id: firstPage[49].id };
  const cursorWithLabel = { ...after, name: 'Alex' };
  const secondPage = await provider.meetingDirectChats('signed-a', 'Alex', cursorWithLabel);
  assert.deepEqual(queries, [
    { tenantId: 41, search: 'Alex' },
    { tenantId: 41, search: 'Alex', after },
  ]);
  const current = new Map(firstPage.map(chat => [chat.id, chat.peerId]));
  const merged = appendDirectMeetingPage(current, secondPage);
  assert.equal(merged.choices.size, 51);
  assert.deepEqual(merged.added, [last]);
  const visibleOptions = [...firstPage, ...merged.added].map(directMeetingOptionLabel);
  assert.equal(new Set(visibleOptions).size, 51);
  assert.equal(visibleOptions[0], 'Alex · Ext 108');
  assert.equal(visibleOptions[50], 'Alex · Ext 158');
  assert.equal(current.size, 50);
  assert.deepEqual(appendDirectMeetingPage(merged.choices, [last]).added, []);
  assert.throws(() => appendDirectMeetingPage(merged.choices, [{ ...last, peerId: 59 }]));
  assert.equal(merged.choices.get(last.id), 58);
  await assert.rejects(provider.meetingDirectChats('signed-a', 'Alex', { peerId: 99, id: idFor(99) }));
  assert.equal(merged.choices.size, 51);
});
