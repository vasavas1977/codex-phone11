/** Room transport supplies the scope and sender; neither belongs in this payload. */
export const ROOM_CHAT_TOPIC = 'phone11.meeting.chat.v1';
export const ROOM_CHAT_MAX_TEXT_LENGTH = 1000;
export const ROOM_CHAT_MAX_PACKET_BYTES = 4096;
export const ROOM_CHAT_MAX_MESSAGES = 200;

export type RoomChatMessage = Readonly<{ version: 1; id: string; text: string }>;
const messageId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function validMessage(value: unknown): value is RoomChatMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const packet = value as Record<string, unknown>;
  return Object.keys(packet).length === 3 && packet.version === 1 &&
    typeof packet.id === 'string' && messageId.test(packet.id) &&
    typeof packet.text === 'string' && packet.text.length > 0 &&
    packet.text.length <= ROOM_CHAT_MAX_TEXT_LENGTH && packet.text === packet.text.trim() &&
    !controls.test(packet.text) && decoder.decode(encoder.encode(packet.text)) === packet.text;
}

export function encodeRoomChatMessage(id: string, text: string): Uint8Array<ArrayBuffer> | undefined {
  const message = { version: 1, id, text: text.replace(/\r\n?/g, '\n').trim() };
  if (!validMessage(message)) return undefined;
  const packet = encoder.encode(JSON.stringify(message));
  return packet.byteLength <= ROOM_CHAT_MAX_PACKET_BYTES ? packet : undefined;
}

export function decodeRoomChatMessage(payload: Uint8Array): RoomChatMessage | undefined {
  if (!(payload instanceof Uint8Array) || payload.byteLength === 0 ||
      payload.byteLength > ROOM_CHAT_MAX_PACKET_BYTES) return undefined;
  try {
    const value: unknown = JSON.parse(decoder.decode(payload));
    return validMessage(value) ? Object.freeze({ version: 1, id: value.id, text: value.text }) : undefined;
  } catch { return undefined; }
}
