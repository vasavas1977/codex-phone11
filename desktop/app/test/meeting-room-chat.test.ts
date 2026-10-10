import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { ConnectionState, DataPacket_Kind, RoomEvent, type Room } from 'livekit-client';
import { DesktopMeetingChat, type DesktopChatSnapshot } from '../src/meeting-room-chat';
import { decodeRoomChatMessage, encodeRoomChatMessage, ROOM_CHAT_MAX_MESSAGES, ROOM_CHAT_TOPIC } from '../../../lib/meetings/room-chat-message';

function fixture(interactive = true) {
  const events = new EventEmitter();
  const publishes: { payload: Uint8Array; options: unknown }[] = [];
  const local = { identity: 'local-sdk-identity', sid: 'local-sid', permissions: { canPublishData: true, canSubscribe: true },
    publishData: async (payload: Uint8Array, options: unknown) => { publishes.push({ payload, options }); } };
  const peer = { identity: 'remote-sdk-identity', sid: 'remote-sid', name: 'Actual SDK participant' };
  const room = Object.assign(events, { state: ConnectionState.Connected, localParticipant: local,
    remoteParticipants: new Map([[peer.identity, peer]]) });
  let current = true;
  const snapshots: DesktopChatSnapshot[] = [];
  const chat = new DesktopMeetingChat(room as unknown as Room, interactive, () => current, state => snapshots.push(state));
  const receive = (id = '12345678-1234-4234-8234-123456789012', text = 'hello', participant: unknown = peer,
    topic = ROOM_CHAT_TOPIC, kind = DataPacket_Kind.RELIABLE) =>
    events.emit(RoomEvent.DataReceived, encodeRoomChatMessage(id, text), participant, kind, topic);
  return { events, room, local, peer, chat, snapshots, publishes, receive, stale: () => { current = false; } };
}
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

test('publishes real room data with reliable topic and echoes only after SDK success', async () => {
  const f = fixture();
  const pending = deferred();
  f.local.publishData = async (payload, options) => { f.publishes.push({ payload, options }); await pending.promise; };
  const sending = f.chat.send('สวัสดี');
  assert.equal(f.chat.getSnapshot().messages.length, 0);
  assert.equal(f.chat.getSnapshot().sending, true);
  assert.equal(await f.chat.send('duplicate click'), false);
  assert.equal(f.publishes.length, 1);
  assert.deepEqual(f.publishes[0].options, { reliable: true, topic: ROOM_CHAT_TOPIC });
  pending.resolve();
  assert.equal(await sending, true);
  assert.equal(f.chat.getSnapshot().messages[0].text, 'สวัสดี');
  assert.equal(f.chat.getSnapshot().messages[0].senderIdentity, f.local.identity);
});

test('attributes receive to the exact SDK participant and rejects payload impersonation', () => {
  const f = fixture();
  f.receive();
  assert.equal(f.chat.getSnapshot().messages[0].senderName, 'Actual SDK participant');
  assert.equal(f.chat.getSnapshot().messages[0].senderIdentity, f.peer.identity);
  f.receive('22345678-1234-4234-8234-123456789012', 'spoof object', { ...f.peer, name: 'CEO' });
  f.events.emit(RoomEvent.DataReceived, encodeRoomChatMessage('32345678-1234-4234-8234-123456789012', 'server packet'), undefined, DataPacket_Kind.RELIABLE, ROOM_CHAT_TOPIC);
  f.events.emit(RoomEvent.DataReceived, new TextEncoder().encode(JSON.stringify({ version: 1,
    id: '42345678-1234-4234-8234-123456789012', text: 'spoof payload', displayName: 'CEO' })), f.peer, DataPacket_Kind.RELIABLE, ROOM_CHAT_TOPIC);
  f.receive('52345678-1234-4234-8234-123456789012', 'another topic', f.peer, 'unrelated');
  f.receive('62345678-1234-4234-8234-123456789012', 'lossy', f.peer, ROOM_CHAT_TOPIC, DataPacket_Kind.LOSSY);
  assert.equal(f.chat.getSnapshot().messages.length, 1);
  f.room.remoteParticipants.clear();
  f.receive('72345678-1234-4234-8234-123456789012', 'removed member');
  assert.equal(f.chat.getSnapshot().messages.length, 1);
});

test('listen-only grant can receive but cannot publish even with a permissive SDK value', async () => {
  const f = fixture(false);
  f.receive();
  assert.equal(f.chat.getSnapshot().messages.length, 1);
  assert.equal(await f.chat.send('no'), false);
  assert.equal(f.publishes.length, 0);
});

test('current permission, subscription and connection changes close actions immediately', async () => {
  const f = fixture();
  f.local.permissions.canPublishData = false;
  f.events.emit(RoomEvent.ParticipantPermissionsChanged, undefined, f.local);
  assert.equal(f.snapshots.at(-1)?.canSend, false);
  assert.equal(await f.chat.send('revoked'), false);
  f.local.permissions.canSubscribe = false;
  f.receive();
  assert.equal(f.chat.getSnapshot().messages.length, 0);
  f.local.permissions.canPublishData = true;
  f.room.state = ConnectionState.Reconnecting;
  f.events.emit(RoomEvent.ConnectionStateChanged, f.room.state);
  assert.equal(await f.chat.send('reconnecting'), false);
  assert.equal(f.publishes.length, 0);
});

test('permission revoked during publication cannot produce a successful local acknowledgement', async () => {
  const f = fixture();
  const pending = deferred();
  f.local.publishData = async () => pending.promise;
  const sending = f.chat.send('pending');
  f.local.permissions.canPublishData = false;
  pending.resolve();
  assert.equal(await sending, false);
  assert.equal(f.chat.getSnapshot().messages.length, 0);
});

test('failed publish exposes no SDK details and explicit same-text retry reuses its message ID', async () => {
  const f = fixture();
  f.local.publishData = async (payload, options) => { f.publishes.push({ payload, options }); throw new Error('private token endpoint'); };
  assert.equal(await f.chat.send('try again'), false);
  assert.doesNotMatch(f.chat.getSnapshot().error!, /private|token|endpoint/);
  assert.equal(f.chat.getSnapshot().messages.length, 0);
  f.local.publishData = async (payload, options) => { f.publishes.push({ payload, options }); };
  assert.equal(await f.chat.send('try again'), true);
  assert.equal(decodeRoomChatMessage(f.publishes[0].payload)?.id, decodeRoomChatMessage(f.publishes[1].payload)?.id);
});

test('teardown clears content, removes handlers and discards late send and retained receive callbacks', async () => {
  const f = fixture();
  f.receive();
  const receive = f.events.listeners(RoomEvent.DataReceived)[0];
  const pending = deferred();
  f.local.publishData = async () => pending.promise;
  const sending = f.chat.send('late');
  f.chat.dispose();
  assert.equal(f.events.listenerCount(RoomEvent.DataReceived), 0);
  assert.equal(f.events.listenerCount(RoomEvent.ParticipantPermissionsChanged), 0);
  receive(encodeRoomChatMessage('22345678-1234-4234-8234-123456789012', 'late packet'), f.peer, DataPacket_Kind.RELIABLE, ROOM_CHAT_TOPIC);
  pending.resolve();
  assert.equal(await sending, false);
  assert.deepEqual(f.chat.getSnapshot().messages, []);
  assert.equal(f.snapshots.at(-1)?.canSend, false);
});

test('session cancellation and exact room replacement discard stale callbacks without affecting a new chat', async () => {
  const old = fixture();
  const fresh = fixture();
  old.stale();
  old.receive();
  assert.equal(await old.chat.send('stale session'), false);
  fresh.receive(undefined, 'fresh room');
  old.events.emit(RoomEvent.Disconnected);
  assert.deepEqual(old.chat.getSnapshot().messages, []);
  assert.equal(fresh.chat.getSnapshot().messages[0].text, 'fresh room');
});

test('rejects malformed outgoing text before SDK call and deduplicates received retries', async () => {
  const f = fixture();
  assert.equal(await f.chat.send('x'.repeat(1001)), false);
  assert.equal(await f.chat.send('\ud800'), false);
  assert.equal(f.publishes.length, 0);
  f.receive(); f.receive();
  assert.equal(f.chat.getSnapshot().messages.length, 1);
});

test('bounds retained history and suppresses packet floods before decoding', () => {
  const f = fixture();
  const originalNow = Date.now;
  let now = 20_000;
  Date.now = () => now;
  try {
    for (let index = 0; index < ROOM_CHAT_MAX_MESSAGES + 5; index++) {
      if (index % 90 === 0) now += 10_001;
      f.receive(`${index.toString(16).padStart(8, '0')}-1234-4234-8234-123456789012`, String(index));
    }
    assert.equal(f.chat.getSnapshot().messages.length, ROOM_CHAT_MAX_MESSAGES);
    assert.equal(f.chat.getSnapshot().messages[0].text, '5');
    const storm = fixture();
    for (let index = 0; index < 500; index++) storm.receive(`${index.toString(16).padStart(8, '0')}-1234-4234-8234-123456789012`);
    assert.equal(storm.chat.getSnapshot().messages.length, 100);
  } finally { Date.now = originalNow; }
});
