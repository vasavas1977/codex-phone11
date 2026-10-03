/** Report the exact current selection before starting a channel meeting. */
export const MAX_CHANNEL_INVITEES = 50;

export function channelInviteSelectionIsValid(selected: number): boolean {
  return Number.isSafeInteger(selected) && selected >= 0 && selected <= MAX_CHANNEL_INVITEES;
}

export function channelInviteMessage(selected: number, total: number): string {
  if (selected > MAX_CHANNEL_INVITEES)
    return `${selected} selected. Select up to ${MAX_CHANNEL_INVITEES} members to start.`;
  if (selected === 0) return 'No members selected. Only you will be admitted.';
  return `${selected} of ${total} members selected. Deselect anyone you do not want to invite.`;
}
