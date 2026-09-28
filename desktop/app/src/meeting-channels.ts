export const MEETING_CHANNELS = Object.freeze({ open: 'phone11:meeting-open',
  state: 'phone11:meeting-state', join: 'phone11:meeting-join', joinFailed: 'phone11:meeting-join-failed',
  channelDetails: 'phone11:meeting-channel-details', startChannel: 'phone11:meeting-start-channel',
  finished: 'phone11:meeting-finished',
  leaveNow: 'phone11:meeting-leave-now', left: 'phone11:meeting-left' });
export type PublicMeetingState = Readonly<{ revision: string;
  meetings: readonly Readonly<{ meetingId: string; title?: string }>[];
  channels: readonly Readonly<{ id: string; name: string }>[] }>;
