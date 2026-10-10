import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConnectionState, type Room } from 'livekit-client';
import { AuthenticatedDesktopProvider } from '../../src/authenticated-provider';
import { DesktopMeetingPhotos } from '../src/meeting-room-chat';
import { MAX_MEETING_AVATAR_BYTES, MAX_MEETING_PHOTO_BYTES, MAX_MEETING_PHOTO_PEOPLE, meetingPhotoBytesMatch, type MeetingProfilePhoto } from '../src/meeting-channels';

const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNIWfDhPwAGVAL0ONfvaAAAAABJRU5ErkJggg==', 'base64'));
const version = '12345678-1234-4234-8234-123456789012';
const path = `/api/profile/photo/9/8?v=${version}`;
const json = (value: unknown, headers?: HeadersInit) => new Response(JSON.stringify(value), { headers });
const trpc = (value: unknown) => json({ result: { data: { json: value } } });

async function providerFixture(options: { directory?: unknown; ownProfile?: unknown; metadataResponse?: () => Response | Promise<Response>; response?: () => Response | Promise<Response> } = {}) {
  const photos: { url: string; init?: RequestInit }[] = [];
  const lookups: string[] = [];
  const provider = new AuthenticatedDesktopProvider({ origin: 'https://phone11.example.test', fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/auth/sign-in/email') return json({ success: true }, { 'set-auth-token': 'synthetic-private-bearer' });
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-private-bearer');
    if (url.pathname === '/api/auth/me') return json({ user: { id: 7 } });
    if (url.pathname === '/api/trpc/pbx.memberships') return trpc([{ tenantId: 9, tenantName: 'Test', tenantStatus: 'active' }]);
    if (url.pathname === '/api/trpc/phone.getConfig') return trpc({ configured: true, tenantId: 9,
      extension: { id: 41, number: '1020' }, sip: { username: 'synthetic-sip', password: 'synthetic-password', domain: 'sip.example.test', transport: 'TLS' } });
    if (url.pathname === '/api/trpc/chat.directory' || url.pathname === '/api/trpc/profile.self') {
      lookups.push(url.pathname);
      assert.deepEqual(JSON.parse(url.searchParams.get('input')!), { json: { tenantId: 9 } });
      if (options.metadataResponse) return options.metadataResponse();
      return trpc(url.pathname.endsWith('self') ? options.ownProfile ?? { tenantId: 9, userId: 7, photoUrl: `/api/profile/photo/9/7?v=${version}` }
        : options.directory ?? [{ id: 8, name: 'Actual coworker', extension: '3001', photoUrl: path }]);
    }
    if (url.pathname.startsWith('/api/profile/photo/')) {
      photos.push({ url: url.href, init });
      return options.response ? options.response() : new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(png.length) } });
    }
    throw new Error('Unexpected synthetic request');
  } });
  const signed = await provider.signIn('synthetic@example.test', 'synthetic-login');
  if (!('revision' in signed)) throw new Error('Expected one workspace');
  return { provider, revision: signed.revision, photos, lookups };
}

test('trusted coworker and own profile resolve exact versioned paths; only bounded raster bytes leave main', async () => {
  const f = await providerFixture();
  const result = await f.provider.meetingProfilePhoto(f.revision, 'p11-t9-u7', 'p11-t9-u8');
  assert.deepEqual(result, { identity: 'p11-t9-u8', mimeType: 'image/png', bytes: png });
  assert.equal(f.photos[0].url, `https://phone11.example.test${path}`);
  assert.equal(f.photos[0].init?.redirect, 'error');
  assert.equal(f.photos[0].init?.credentials, 'omit');
  assert.equal(f.photos[0].init?.cache, 'no-store');
  assert.doesNotMatch(JSON.stringify(result), /bearer|token|password|https/);
  assert.equal((await f.provider.meetingProfilePhoto(f.revision, 'p11-t9-u7', 'p11-t9-u7'))?.identity, 'p11-t9-u7');
});

test('untrusted local owner, cross tenant, opaque and ambiguous identities start zero directory/photo requests', async () => {
  const f = await providerFixture();
  for (const [local, remote] of [['p11-t9-u6', 'p11-t9-u8'], ['p11-t8-u7', 'p11-t8-u8'],
    ['p11-t9-u7', 'p11-t8-u8'], ['p11-t9-u7', 'Actual coworker'], ['p11-t9-u7', 'p11-t9-u08'],
    ['p11-t9-u7', 'p11-t9-u8-u8'], ['provider-local', 'p11-t9-u8']]) {
    assert.equal(await f.provider.meetingProfilePhoto(f.revision, local, remote), null);
  }
  assert.deepEqual(f.lookups, []);
  assert.deepEqual(f.photos, []);
});

test('missing/duplicate directory members and untrusted photo descriptors never reach image fetch', async () => {
  for (const photoUrl of ['https://evil.example/avatar.png', `//evil.example${path}`, `${path}&x=1`,
    `/api/profile/photo/8/8?v=${version}`, `/api/profile/photo/9/7?v=${version}`, `/api/profile/photo/9/8?v=invalid`,
    'data:image/svg+xml,<svg onload=alert(1)>']) {
    const f = await providerFixture({ directory: [{ id: 8, name: 'Coworker', extension: null, photoUrl }] });
    await f.provider.meetingProfilePhoto(f.revision, 'p11-t9-u7', 'p11-t9-u8').catch(() => null);
    assert.equal(f.photos.length, 0);
  }
  for (const directory of [[], [{ id: 8, name: 'A', extension: null, photoUrl: path }, { id: 8, name: 'B', extension: null, photoUrl: path }]]) {
    const f = await providerFixture({ directory });
    await f.provider.meetingProfilePhoto(f.revision, 'p11-t9-u7', 'p11-t9-u8').catch(() => null);
    assert.equal(f.photos.length, 0);
  }
});

test('malformed, oversized, truncated, non-image and mismatched image bytes fail closed', async () => {
  const enormousDimensions = png.slice();
  new DataView(enormousDimensions.buffer).setUint32(16, 2049);
  const responses = [
    () => new Response('<svg onload=alert(1)>', { headers: { 'content-type': 'image/svg+xml' } }),
    () => new Response('<html>not image</html>', { headers: { 'content-type': 'image/png' } }),
    () => new Response(png, { headers: { 'content-type': 'image/jpeg' } }),
    () => new Response(enormousDimensions, { headers: { 'content-type': 'image/png' } }),
    () => new Response(png, { headers: { 'content-type': 'image/png', 'content-length': '999' } }),
    () => new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(MAX_MEETING_PHOTO_BYTES + 1) } }),
    () => new Response(new Uint8Array(MAX_MEETING_PHOTO_BYTES + 1), { headers: { 'content-type': 'image/png' } }),
  ];
  for (const response of responses) {
    const f = await providerFixture({ response });
    assert.equal(await f.provider.meetingProfilePhoto(f.revision, 'p11-t9-u7', 'p11-t9-u8'), null);
  }
  assert.equal(meetingPhotoBytesMatch(png.subarray(0, 20), 'image/png'), false);
});

test('JPEG and WebP dimensions are bounded before the platform decoder can allocate a raster', () => {
  const jpeg = new Uint8Array(24);
  jpeg.set([255, 216, 255, 192, 0, 8, 8, 0, 1, 0, 1, 1]);
  jpeg.set([255, 217], 22);
  assert.equal(meetingPhotoBytesMatch(jpeg, 'image/jpeg'), true);
  new DataView(jpeg.buffer).setUint16(9, 2049);
  assert.equal(meetingPhotoBytesMatch(jpeg, 'image/jpeg'), false);
  const webp = new Uint8Array(26);
  webp.set(new TextEncoder().encode('RIFF'), 0);
  new DataView(webp.buffer).setUint32(4, 18, true);
  webp.set(new TextEncoder().encode('WEBPVP8L'), 8);
  new DataView(webp.buffer).setUint32(16, 5, true);
  webp[20] = 0x2f;
  assert.equal(meetingPhotoBytesMatch(webp, 'image/webp'), true);
  new DataView(webp.buffer).setUint32(21, 2048, true);
  assert.equal(meetingPhotoBytesMatch(webp, 'image/webp'), false);
  webp[20] = 0;
  assert.equal(meetingPhotoBytesMatch(webp, 'image/webp'), false);
});

test('session replacement and room cancellation discard a late streamed photo', async () => {
  let release!: () => void;
  let requested!: () => void;
  const started = new Promise<void>(resolve => { requested = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const f = await providerFixture({ response: async () => { requested(); await wait; return new Response(png, { headers: { 'content-type': 'image/png' } }); } });
  const pending = f.provider.meetingProfilePhoto(f.revision, 'p11-t9-u7', 'p11-t9-u8');
  await started;
  await f.provider.signIn('synthetic@example.test', 'synthetic-login');
  release();
  assert.equal(await pending, null);
  const aborted = new AbortController(); aborted.abort();
  const fresh = f.provider.currentSession()!;
  const before = f.photos.length;
  assert.equal(await f.provider.meetingProfilePhoto(fresh.revision, 'p11-t9-u7', 'p11-t9-u8', aborted.signal), null);
  assert.equal(f.photos.length, before);
});

test('room cancellation aborts a stalled metadata body before any image request', async () => {
  let reading!: () => void;
  let cancelled = false;
  const started = new Promise<void>(resolve => { reading = resolve; });
  const f = await providerFixture({ metadataResponse: () => new Response(new ReadableStream({
    pull() { reading(); }, cancel() { cancelled = true; },
  })) });
  const room = new AbortController();
  const pending = f.provider.meetingProfilePhoto(f.revision, 'p11-t9-u7', 'p11-t9-u8', room.signal);
  await started;
  room.abort();
  assert.equal(await pending, null);
  assert.equal(cancelled, true);
  assert.deepEqual(f.photos, []);
});

function photoRoomFixture(fetchPhoto: (local: string, identity: string) => Promise<MeetingProfilePhoto | null>) {
  const localParticipant = { identity: 'p11-t9-u7' };
  const peer = { identity: 'p11-t9-u8' };
  const room = { state: ConnectionState.Connected, localParticipant, remoteParticipants: new Map([[peer.identity, peer]]) };
  let current = true; let changes = 0;
  const cache = new DesktopMeetingPhotos(room as unknown as Room,
    { roomRevision: 'synthetic-room', ownerId: 7, tenantId: 9 }, () => current, fetchPhoto, () => { changes++; });
  return { room, peer, cache, stale: () => { current = false; }, changes: () => changes };
}

test('room photo cache accepts only actual known SDK identity and coalesces lookups', async () => {
  const identities: string[] = [];
  const f = photoRoomFixture(async (_local, identity) => { identities.push(identity); return { identity, mimeType: 'image/png', bytes: png }; });
  assert.equal(f.cache.get('p11-t8-u8'), null);
  assert.equal(f.cache.get('SDK name'), null);
  assert.equal(f.cache.get('p11-t9-u08'), null);
  assert.equal(f.cache.get('p11-t9-u99'), null);
  assert.deepEqual(identities, []);
  f.cache.get(f.peer.identity); f.cache.get(f.peer.identity);
  await Promise.resolve();
  assert.deepEqual(identities, [f.peer.identity]);
  assert.equal(f.cache.get(f.peer.identity)?.mimeType, 'image/png');
  assert.equal(f.changes(), 1);
});

test('disposed/stale rooms and replaced SDK participants reject late photos', async () => {
  for (const action of ['dispose', 'stale', 'replace', 'disconnect']) {
    let release!: (photo: MeetingProfilePhoto) => void;
    const waiting = new Promise<MeetingProfilePhoto>(resolve => { release = resolve; });
    const f = photoRoomFixture(async () => waiting);
    f.cache.get(f.peer.identity);
    if (action === 'dispose') f.cache.dispose();
    if (action === 'stale') f.stale();
    if (action === 'replace') f.room.remoteParticipants.set(f.peer.identity, { ...f.peer });
    if (action === 'disconnect') f.room.state = ConnectionState.Disconnected;
    release({ identity: f.peer.identity, mimeType: 'image/png', bytes: png });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(f.cache.get(f.peer.identity), null);
    assert.equal(f.changes(), 0);
  }
});

test('image cache rejects response identity injection, malformed types and a mismatched owner scope', async () => {
  const f = photoRoomFixture(async () => ({ identity: 'p11-t9-u99', mimeType: 'image/png', bytes: png }));
  f.cache.get(f.peer.identity); await Promise.resolve();
  assert.equal(f.cache.get(f.peer.identity), null);
  const fake = photoRoomFixture(async (_local, identity) => ({ identity, mimeType: 'image/svg+xml' as 'image/png', bytes: png }));
  fake.cache.get(fake.peer.identity); await Promise.resolve();
  assert.equal(fake.cache.get(fake.peer.identity), null);
  fake.room.localParticipant.identity = 'p11-t9-u6';
  assert.equal(fake.cache.get('p11-t9-u6'), null);
});

test('room cache bounds identity lookups and rejects an oversized IPC avatar', async () => {
  let requests = 0;
  const f = photoRoomFixture(async () => { requests++; return null; });
  for (let id = 100; id < 100 + MAX_MEETING_PHOTO_PEOPLE + 1; id++) {
    const identity = `p11-t9-u${id}`;
    f.room.remoteParticipants.set(identity, { identity });
    f.cache.get(identity);
  }
  assert.equal(requests, MAX_MEETING_PHOTO_PEOPLE);
  const bytes = new Uint8Array(MAX_MEETING_AVATAR_BYTES + 1); bytes.set(png);
  const oversized = photoRoomFixture(async (_local, identity) => ({ identity, mimeType: 'image/png', bytes }));
  oversized.cache.get(oversized.peer.identity); await Promise.resolve();
  assert.equal(oversized.cache.get(oversized.peer.identity), null);
});
