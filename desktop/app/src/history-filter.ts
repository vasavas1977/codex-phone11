import type { DesktopCallHistory } from '../../src/authenticated-provider';

export const HISTORY_QUERY_LIMIT = 64;
export const HISTORY_DIRECTIONS = ['all', 'inbound', 'outbound', 'internal', 'emergency'] as const;
export const HISTORY_OUTCOMES = ['all', 'answered', 'missed', 'busy', 'failed', 'other'] as const;
export type HistoryDirection = typeof HISTORY_DIRECTIONS[number];
export type HistoryOutcome = typeof HISTORY_OUTCOMES[number];

export function historyDirectionLabel(direction: DesktopCallHistory['direction']): string {
  return { inbound: 'Incoming', outbound: 'Outgoing', internal: 'Internal', emergency: 'Emergency' }[direction];
}

/** Use only the recorded disposition; duration and direction do not prove an outcome. */
export function historyOutcome(item: DesktopCallHistory): Exclude<HistoryOutcome, 'all'> {
  switch (item.disposition?.toLowerCase().replace(/-/g, '_')) {
    case 'answered': return 'answered';
    case 'missed': case 'no_answer': return 'missed';
    case 'busy': return 'busy';
    case 'failed': return 'failed';
    default: return 'other';
  }
}

export function historyOutcomeLabel(outcome: Exclude<HistoryOutcome, 'all'>): string {
  return { answered: 'Answered', missed: 'Missed', busy: 'Busy', failed: 'Failed', other: 'Other / unknown' }[outcome];
}

export function boundedHistoryQuery(query: string): string {
  return query.slice(0, HISTORY_QUERY_LIMIT).replace(/[\u0000-\u001f\u007f-\u009f]/gu, '');
}

function searchText(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

/** Filters only this loaded page set; preserves source order, references and callback authority. */
export function filterHistoryItems(items: readonly DesktopCallHistory[], query: string,
  direction: HistoryDirection, outcome: HistoryOutcome): readonly DesktopCallHistory[] {
  const needle = searchText(boundedHistoryQuery(query).trim());
  const phoneNeedle = /^[+0-9*#(). -]+$/u.test(needle) ? needle.replace(/[(). -]/gu, '') : '';
  return items.filter(item => {
    const recordedOutcome = historyOutcome(item);
    if ((direction !== 'all' && item.direction !== direction) ||
        (outcome !== 'all' && recordedOutcome !== outcome)) return false;
    if (!needle) return true;
    const numbers = [item.callbackNumber, item.callerNumber, item.calleeNumber];
    const visibleText = [...numbers, historyDirectionLabel(item.direction), historyOutcomeLabel(recordedOutcome)]
      .filter((value): value is string => value !== null).join(' ');
    return searchText(visibleText).includes(needle) || (!!phoneNeedle && numbers.some(number =>
      number !== null && searchText(number).replace(/[(). -]/gu, '').includes(phoneNeedle)));
  });
}

/** The opaque session revision identifies the account; the selected workspace must also match. */
export function historyScopeKey(state: Readonly<{ signedIn: boolean; sessionRevision: string | null;
  tenantId: number | null }> | null): string {
  return state?.signedIn && state.sessionRevision && state.tenantId
    ? JSON.stringify([state.sessionRevision, state.tenantId]) : '';
}
