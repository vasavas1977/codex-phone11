import { describe, expect, it } from 'vitest';
import { decodeRoomChatMessage, encodeRoomChatMessage, ROOM_CHAT_MAX_PACKET_BYTES } from '../lib/meetings/room-chat-message';
const id = '12345678-1234-4234-8234-123456789012';
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('versioned in-meeting text packets', () => {
  it('round-trips Thai, English, emoji and plaintext markup without sender or room fields', () => {
    const packet = encodeRoomChatMessage(id, '  สวัสดี team 👋\r\n<b>plain text</b>  ');
    expect(decodeRoomChatMessage(packet!)).toEqual({ version: 1, id, text: 'สวัสดี team 👋\n<b>plain text</b>' });
    expect(Object.keys(JSON.parse(new TextDecoder().decode(packet)))).toEqual(['version', 'id', 'text']);
  });
  it.each([
    { version: 2, id, text: 'hello' }, { version: 1, id: 'arbitrary', text: 'hello' },
    { version: 1, id, text: '' }, { version: 1, id, text: '   ' },
    { version: 1, id, text: 'hello', senderIdentity: 'spoof' },
    { version: 1, id, text: 'hello', displayName: 'CEO' },
    { version: 1, id, text: 'hello', applicationUserId: 3001 },
    { version: 1, id, text: 'hello', roomId: 'another-room' },
    { version: 1, id, text: 'x'.repeat(1001) }, { version: 1, id, text: 'bad\0text' },
    { version: 1, id, text: '\ud800' }, [], null,
  ])('rejects malformed, oversized or authority-bearing payload %j', value => {
    expect(decodeRoomChatMessage(bytes(value))).toBeUndefined();
  });
  it('rejects invalid UTF-8 and oversized bytes before parsing', () => {
    expect(decodeRoomChatMessage(new Uint8Array([0xc0, 0xaf]))).toBeUndefined();
    expect(decodeRoomChatMessage(new Uint8Array(ROOM_CHAT_MAX_PACKET_BYTES + 1))).toBeUndefined();
    expect(decodeRoomChatMessage(new TextEncoder().encode('{broken'))).toBeUndefined();
  });
  it('bounds outgoing text and preserves the full allowed Thai message', () => {
    expect(decodeRoomChatMessage(encodeRoomChatMessage(id, 'ก'.repeat(1000))!)?.text.length).toBe(1000);
    expect(encodeRoomChatMessage(id, 'ก'.repeat(1001))).toBeUndefined();
    expect(encodeRoomChatMessage(id, '\ud800')).toBeUndefined();
    expect(encodeRoomChatMessage(id, '\t\n ')).toBeUndefined();
  });
});
