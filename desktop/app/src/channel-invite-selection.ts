/** Report the exact current selection before starting a channel meeting. */
export function channelInviteMessage(selected: number, total: number): string {
  if (selected === 0) return 'No members selected. Only you will be admitted.';
  return `${selected} of ${total} members selected. Deselect anyone you do not want to invite.`;
}
