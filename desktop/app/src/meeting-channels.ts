export const MEETING_CHANNELS = Object.freeze({ open: 'phone11:meeting-open',
  state: 'phone11:meeting-state', join: 'phone11:meeting-join', joinFailed: 'phone11:meeting-join-failed',
  channelDetails: 'phone11:meeting-channel-details', startChannel: 'phone11:meeting-start-channel',
  directSearch: 'phone11:meeting-direct-search', directMore: 'phone11:meeting-direct-more',
  directDetails: 'phone11:meeting-direct-details',
  startDirect: 'phone11:meeting-start-direct',
  finished: 'phone11:meeting-finished',
  leaveNow: 'phone11:meeting-leave-now', left: 'phone11:meeting-left' });
export type PublicMeetingState = Readonly<{ revision: string;
  meetings: readonly Readonly<{ meetingId: string; title?: string }>[];
  channels: readonly Readonly<{ id: string; name: string }>[];
  directChats: readonly Readonly<{ id: string; name: string; peerId: number; extension: string }>[];
  directHasMore: boolean }>;
export type PublicMeetingDirectPage = Readonly<{
  chats: readonly Readonly<{ id: string; name: string; peerId: number; extension: string }>[];
  hasMore: boolean }>;

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
