export const MEETING_CHANNELS = Object.freeze({ open: 'phone11:meeting-open',
  state: 'phone11:meeting-state', join: 'phone11:meeting-join', joinFailed: 'phone11:meeting-join-failed',
  finished: 'phone11:meeting-finished',
  leaveNow: 'phone11:meeting-leave-now', left: 'phone11:meeting-left' });
export type PublicMeetingState = Readonly<{ revision: string;
  meetings: readonly Readonly<{ meetingId: string; title?: string }>[] }>;
