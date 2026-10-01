export const MEETING_CHANNELS = Object.freeze({ open: 'phone11:meeting-open',
  state: 'phone11:meeting-state', join: 'phone11:meeting-join', joinFailed: 'phone11:meeting-join-failed',
  channelDetails: 'phone11:meeting-channel-details', startChannel: 'phone11:meeting-start-channel',
  directSearch: 'phone11:meeting-direct-search', directMore: 'phone11:meeting-direct-more',
  directDetails: 'phone11:meeting-direct-details',
  startDirect: 'phone11:meeting-start-direct',
  photo: 'phone11:meeting-profile-photo', finished: 'phone11:meeting-finished',
  leaveNow: 'phone11:meeting-leave-now', left: 'phone11:meeting-left' });
export type PublicMeetingState = Readonly<{ revision: string;
  meetings: readonly Readonly<{ meetingId: string; title?: string }>[];
  channels: readonly Readonly<{ id: string; name: string }>[];
  directChats: readonly Readonly<{ id: string; name: string; peerId: number; extension: string }>[];
  directHasMore: boolean }>;
export type PublicMeetingDirectPage = Readonly<{
  chats: readonly Readonly<{ id: string; name: string; peerId: number; extension: string }>[];
  hasMore: boolean }>;

export type MeetingPhotoScope = Readonly<{ roomRevision: string; ownerId: number; tenantId: number }>;
export type MeetingProfilePhoto = Readonly<{ identity: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: Uint8Array }>;
export const MAX_MEETING_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_MEETING_AVATAR_BYTES = 64 * 1024;
export const MAX_MEETING_PHOTO_PEOPLE = 64;
export const MAX_MEETING_PHOTO_CACHE_BYTES = 4 * 1024 * 1024;

/** Reject other formats and oversized images before handing bytes to an image decoder. */
export function meetingPhotoBytesMatch(bytes: Uint8Array, mimeType: string): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 24 || bytes.byteLength > MAX_MEETING_PHOTO_BYTES) return false;
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (mimeType === 'image/png') {
    if (bytes.byteLength < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) ||
        ascii(12, 16) !== 'IHDR') return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    return view.getUint32(8) === 13 && width > 0 && height > 0 && width <= 2048 && height <= 2048;
  }
  if (mimeType === 'image/jpeg') {
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) return false;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) return false;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return false;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) return false;
        const height = view.getUint16(offset + 3), width = view.getUint16(offset + 5);
        return width > 0 && height > 0 && width <= 2048 && height <= 2048;
      }
      offset += length;
    }
    return false;
  }
  if (mimeType === 'image/webp') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.byteLength) return false;
    let offset = 12, raster = false;
    while (offset + 8 <= bytes.length) {
      const kind = ascii(offset, offset + 4), length = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (start + length > bytes.length) return false;
      let width = 0, height = 0;
      if (kind === 'VP8X') {
        if (length !== 10 || (bytes[start] & 2)) return false; // Animation is outside this avatar decoder.
        width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
        height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
      } else if (kind === 'VP8L') {
        if (length < 5 || bytes[start] !== 0x2f) return false;
        const dimensions = view.getUint32(start + 1, true);
        width = (dimensions & 0x3fff) + 1; height = ((dimensions >>> 14) & 0x3fff) + 1; raster = true;
      } else if (kind === 'VP8 ') {
        if (length < 10 || !(bytes[start + 3] === 0x9d && bytes[start + 4] === 1 && bytes[start + 5] === 0x2a)) return false;
        width = view.getUint16(start + 6, true) & 0x3fff; height = view.getUint16(start + 8, true) & 0x3fff; raster = true;
      } else if (!['ALPH', 'ICCP', 'EXIF', 'XMP '].includes(kind)) return false;
      if (['VP8X', 'VP8L', 'VP8 '].includes(kind) && (!width || !height || width > 2048 || height > 2048)) return false;
      offset = start + length + (length % 2);
    }
    return raster && offset === bytes.length;
  }
  return false;
}

export const directMeetingOptionLabel = (chat: PublicMeetingDirectPage['chats'][number]): string =>
  `${chat.name} · Ext ${chat.extension}`;

/** Build a new admitted chooser map only after an entire page has passed validation. */
export function appendDirectMeetingPage(current: ReadonlyMap<string, number>,
  page: PublicMeetingDirectPage['chats']): { choices: Map<string, number>; added: PublicMeetingDirectPage['chats'] } {
  const choices = new Map(current);
  const added: PublicMeetingDirectPage['chats'][number][] = [];
  for (const chat of page) {
    const existing = choices.get(chat.id);
    if (existing !== undefined && existing !== chat.peerId) throw new Error('Meeting unavailable');
    if (existing !== undefined) continue;
    choices.set(chat.id, chat.peerId);
    added.push(chat);
  }
  return { choices, added };
}
