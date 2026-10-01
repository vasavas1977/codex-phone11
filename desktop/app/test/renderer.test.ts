import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type ElementStub = {
  hidden: boolean; disabled: boolean; textContent: string; value: string; dataset: Record<string, string>;
  children: ElementStub[]; className: string;
  attributes: Record<string, string>;
  focused: boolean; listeners: Map<string, (event: any) => void>; addEventListener(type: string, listener: (event: any) => void): void;
  focus(): void; setAttribute(name: string, value: string): void; removeAttribute(name: string): void;
  append(...children: ElementStub[]): void; replaceChildren(): void;
};
const element = (): ElementStub => ({ hidden: false, disabled: false, textContent: '', value: '', dataset: {},
  children: [], className: '', attributes: {}, focused: false, listeners: new Map(),
  addEventListener(type, listener) { this.listeners.set(type, listener); },
  focus() { this.focused = true; }, setAttribute(name, value) { this.attributes[name] = value; },
  removeAttribute(name) { delete this.attributes[name]; },
  append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; } });

test('dialpad enters a bounded destination while idle and sends DTMF only in an established call', async () => {
  const ids = ['login', 'workspace', 'phone', 'meetings', 'phone-tab', 'meetings-tab',
    'backspace', 'mute-label', 'hold-label', 'history-tab', 'directory-tab', 'voicemail-tab', 'lines-tab',
    'dialpad-panel', 'history-panel', 'directory-panel', 'voicemail-panel', 'lines-panel', 'phone-status-mark',
    'directory-search', 'directory-state', 'directory-list', 'directory-refresh', 'directory-more',
    'voicemail-state', 'voicemail-list', 'voicemail-refresh', 'history-list', 'history-state', 'history-refresh', 'history-more',
    'history-search', 'history-direction', 'history-outcome', 'history-clear', 'history-count', 'history-scope',
    'open-meetings', 'meeting-open-message', 'identity', 'status', 'call-id', 'notice', 'hold-message', 'dial', 'answer',
    'end', 'mute', 'hold', 'keypad', 'destination', 'message', 'login-form', 'email', 'password', 'sign-out', 'dial-form'];
  const elements = new Map(ids.map(id => [id, element()]));
  const keypad = elements.get('keypad')!;
  const destination = elements.get('destination')!;
  const listeners = new Map<string, (snapshot: any) => void>();
  const actions: unknown[] = [];
  let meetingOpens = 0;
  let voicemailLists = 0;
  const directoryCalls: unknown[] = [];
  const historyCalls: unknown[] = [];
  const calling = { version: 1, registered: true, call: null, dialState: 'idle', callActionState: 'idle', holdMessage: null };
  let publicState: any = { signedIn: true, sessionRevision: 'session-a', generation: 'generation-a', tenantId: 1,
    extensionNumber: '1020', calling };
  const historyPage = (revision: string, cursor?: { startedAt: string; id: number }) => ({
    sessionRevision: revision, items: [{ id: cursor ? 2 : 1, direction: 'inbound', callerNumber: cursor ? '3002' : '3001',
      calleeNumber: '1020', callbackNumber: cursor ? '3002' : '3001', durationSeconds: 0, disposition: 'missed',
      startedAt: '2026-09-27T10:00:00.000Z' }],
    nextCursor: cursor ? null : { startedAt: '2026-09-27T10:00:00.000001Z', id: 1 },
  });
  let historyImplementation = async (revision: string, cursor?: { startedAt: string; id: number }): Promise<any> => historyPage(revision, cursor);
  const previousDocument = (globalThis as any).document;
  const previousWindow = (globalThis as any).window;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const reconciliationTimers = new Map<number, { delay: number; callback: () => void; active: boolean }>();
  let nextTimer = 1;
  (globalThis as any).setTimeout = (callback: () => void, delay: number) => {
    if (![1000, 3000, 10000].includes(delay)) return previousSetTimeout(callback, delay);
    const id = nextTimer++;
    reconciliationTimers.set(id, { delay, callback, active: true });
    return id;
  };
  (globalThis as any).clearTimeout = (id: number) => {
    const timer = reconciliationTimers.get(id);
    if (timer) timer.active = false;
    else previousClearTimeout(id as any);
  };
  (globalThis as any).document = { getElementById: (id: string) => elements.get(id) ?? null,
    createElement: () => element() };
  (globalThis as any).window = { phone11: {
    state: async () => publicState,
    signIn: async () => publicState,
    signOut: async () => ({ signedIn: false, sessionRevision: null, generation: null, tenantId: null, extensionNumber: null, calling }),
    action: async (input: unknown) => {
      actions.push(input);
      return { sessionRevision: 'session-a', generation: 'generation-a', snapshot: calling };
    },
    openMeetings: async () => { meetingOpens++; throw new Error('private admission token'); },
    historyList: async (revision: string, cursor?: {startedAt: string; id: number}) => {
      historyCalls.push(cursor);
      return historyImplementation(revision, cursor);
    },
    directoryList: async (revision: string, search: string, offset: number) => {
      directoryCalls.push({ revision, search, offset });
      return { sessionRevision: revision, tenantId: 1,
        items: [{ id: 41, name: 'Som', number: '3001' }], nextOffset: null };
    },
    voicemailList: async (revision: string) => {
      voicemailLists++;
      return { sessionRevision: revision, items: [{ id: 4, callerName: 'Som-O', callerNumber: '1020',
        durationSeconds: 23, status: 'new', createdAt: '2026-09-27T10:00:00.000Z' }] };
    },
    onUpdate: (listener: (snapshot: any) => void) => { listeners.set('update', listener); return () => listeners.delete('update'); },
  } };
  try {
    await import('../src/renderer');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('history-list')!.children.length, 1);
    assert.equal(elements.get('history-more')!.hidden, false);
    assert.equal(elements.get('history-count')!.textContent, 'Showing 1 of 1 loaded calls.');
    elements.get('history-search')!.value = '3002';
    elements.get('history-search')!.listeners.get('input')!({});
    assert.match(elements.get('history-list')!.children[0].textContent, /^No loaded calls match/);
    assert.equal(elements.get('history-more')!.hidden, false, 'filtering never hides the authoritative next page');
    assert.equal(elements.get('history-clear')!.disabled, false);
    elements.get('history-more')!.listeners.get('click')!({});
    assert.equal(elements.get('history-state')!.textContent, 'Loading older calls…');
    assert.equal(elements.get('history-more')!.disabled, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('history-list')!.children.length, 1);
    assert.equal(elements.get('history-count')!.textContent, 'Showing 1 of 2 loaded calls.');
    assert.equal(elements.get('history-search')!.value, '3002');
    elements.get('history-direction')!.value = 'outbound';
    elements.get('history-direction')!.listeners.get('change')!({});
    assert.match(elements.get('history-list')!.children[0].textContent, /^No loaded calls match/);
    elements.get('history-clear')!.listeners.get('click')!({});
    assert.equal(elements.get('history-search')!.value, '');
    assert.equal(elements.get('history-direction')!.value, 'all');
    assert.equal(elements.get('history-outcome')!.value, 'all');
    assert.equal(elements.get('history-search')!.focused, true);
    assert.equal(elements.get('history-list')!.children.length, 2);
    assert.deepEqual(historyCalls, [undefined, {startedAt:'2026-09-27T10:00:00.000001Z', id:1}]);
    elements.get('history-list')!.children[0].listeners.get('click')!({});
    assert.equal(destination.value, '3001', 'history selects a callback number without dialing');
    assert.equal(actions.length, 0);
    destination.value = '';
    assert.equal(keypad.hidden, false, 'the keypad is available after calling registration');
    assert.equal(elements.get('voicemail-tab')!.disabled, true);
    elements.get('voicemail-tab')!.listeners.get('click')!({});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(voicemailLists, 0, 'disabled voicemail does not query the provider');
    assert.equal(elements.get('voicemail-panel')!.hidden, true);
    elements.get('history-tab')!.listeners.get('click')!({});
    assert.equal(elements.get('history-panel')!.hidden, false);
    elements.get('directory-tab')!.listeners.get('click')!({});
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(directoryCalls, [{ revision: 'session-a', search: '', offset: 0 }]);
    assert.equal(elements.get('directory-list')!.children.length, 1);
    destination.value = '';
    elements.get('directory-list')!.children[0].listeners.get('click')!({});
    assert.equal(destination.value, '3001', 'contact selection fills the dialpad');
    assert.equal(actions.length, 0, 'contact selection does not dial');
    elements.get('directory-search')!.value = 'Som';
    elements.get('directory-search')!.listeners.get('input')!({});
    await new Promise(resolve => setTimeout(resolve, 280));
    assert.deepEqual(directoryCalls[1], { revision: 'session-a', search: 'Som', offset: 0 });
    destination.value = '';
    elements.get('history-tab')!.listeners.get('click')!({});
    elements.get('meetings-tab')!.listeners.get('click')!({});
    assert.equal(elements.get('meetings')!.hidden, false);
    assert.equal(elements.get('phone')!.hidden, true);
    await elements.get('open-meetings')!.listeners.get('click')!({});
    assert.equal(meetingOpens, 1);
    assert.equal(elements.get('meeting-open-message')!.textContent, 'Meetings could not open. Try again.');
    elements.get('phone-tab')!.listeners.get('click')!({});
    assert.equal(elements.get('phone')!.hidden, false);
    keypad.listeners.get('click')!({ target: { closest: () => ({ dataset: { digit: '1' } }) } });
    keypad.listeners.get('click')!({ target: { closest: () => ({ dataset: { digit: '0' } }) } });
    keypad.listeners.get('click')!({ target: { closest: () => ({ dataset: { digit: '#' } }) } });
    assert.equal(destination.value, '10#');
    assert.equal(destination.focused, true);
    assert.equal(actions.length, 0, 'idle keypad taps edit the destination without issuing call actions');

    elements.get('backspace')!.listeners.get('click')!({});
    assert.equal(destination.value, '10', 'backspace removes only the last digit');
    keypad.listeners.get('click')!({ target: { closest: () => null } });
    assert.equal(destination.value, '10', 'clicking keypad spacing does not enter a digit');

    destination.value = '7'.repeat(32);
    keypad.listeners.get('click')!({ target: { closest: () => ({ dataset: { digit: '2' } }) } });
    assert.equal(destination.value, '7'.repeat(32), 'the destination remains within the 32 character field limit');

    publicState = { ...publicState, calling: { ...calling, call: { id: '81', state: 'ringing', muted: false }, dialState: 'requesting' } };
    listeners.get('update')!({ sessionRevision: 'session-a', generation: 'generation-a', snapshot: publicState.calling });
    assert.equal(elements.get('status')!.textContent, 'Calling…',
      'a SIP proceeding response does not prove the destination handset alerted');
    assert.equal(elements.get('dialpad-panel')!.hidden, false, 'an active call returns to the dialpad');
    assert.equal(elements.get('history-panel')!.hidden, false, 'history stays beside the visible call controls');
    assert.equal(keypad.hidden, true, 'the keypad is unavailable while the destination is ringing');
    assert.equal(elements.get('open-meetings')!.disabled, true, 'a pending Phone action blocks meeting entry');
    const ringingDestination = destination.value;
    elements.get('backspace')!.listeners.get('click')!({});
    assert.equal(destination.value, ringingDestination, 'backspace cannot edit an active call destination');
    assert.equal(destination.disabled, true);
    keypad.listeners.get('click')!({ target: { closest: () => ({ dataset: { digit: '3' } }) } });
    assert.equal(destination.value, ringingDestination);
    assert.equal(actions.length, 0, 'ringing keypad taps do not issue DTMF');

    const connected = { ...calling, call: { id: '81', state: 'connected', muted: false } };
    listeners.get('update')!({ sessionRevision: 'session-a', generation: 'generation-a', snapshot: connected });
    assert.equal(keypad.hidden, false, 'the keypad returns for an established call');
    assert.equal(elements.get('open-meetings')!.disabled, true, 'a Phone call prevents opening meeting media');
    keypad.listeners.get('click')!({ target: { closest: () => ({ dataset: { digit: '5' } }) } });
    assert.deepEqual(actions[0], { operation: 'dtmf', generation: 'generation-a', callId: '81', digits: '5', sessionRevision: 'session-a' });
    listeners.get('update')!({ sessionRevision: 'session-a', generation: 'generation-a', snapshot: calling });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([...reconciliationTimers.values()].map(timer => timer.delay), [1000, 3000, 10000]);
    const afterImmediate = historyCalls.length;
    reconciliationTimers.get(1)!.callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(historyCalls.length, afterImmediate + 1, 'CDR reconciliation retries after call end');
    listeners.get('update')!({ sessionRevision: 'session-a', generation: 'generation-a', snapshot: connected });
    assert.equal(reconciliationTimers.get(2)!.active, false, 'a new call cancels later history retries');
    assert.equal(reconciliationTimers.get(3)!.active, false);
    await new Promise(resolve => setImmediate(resolve));

    const retainedRow = elements.get('history-list')!.children[0];
    elements.get('history-search')!.value = '<img src=x onerror=alert(1)> ส้ม';
    elements.get('history-search')!.listeners.get('input')!({});
    assert.match(elements.get('history-list')!.children[0].textContent, /^No loaded calls match/);
    assert.equal(elements.get('history-list')!.children[0].children.length, 0, 'no-match text never parses the query as markup');
    elements.get('history-outcome')!.value = 'busy';
    elements.get('history-outcome')!.listeners.get('change')!({});
    let finishOldPage!: (value: any) => void;
    historyImplementation = () => new Promise(resolve => { finishOldPage = resolve; });
    elements.get('history-refresh')!.listeners.get('click')!({});
    assert.equal(elements.get('history-state')!.textContent, 'Loading call history…');
    const signingOut = elements.get('sign-out')!.listeners.get('click')!({});
    assert.equal(elements.get('history-search')!.value, '', 'sign-out clears the search before awaiting its response');
    assert.equal(elements.get('history-outcome')!.value, 'all');
    assert.equal(elements.get('history-list')!.children.length, 0, 'signed-out DOM retains no hidden owned history');
    assert.equal(elements.get('history-count')!.textContent, '');
    await signingOut;

    publicState = { ...publicState, sessionRevision: 'session-b', generation: 'generation-b', tenantId: 2, calling };
    historyImplementation = async revision => ({ ...historyPage(revision), nextCursor: null,
      items: [{ ...historyPage(revision).items[0], id: 7, callbackNumber: '5555', callerNumber: '5555', disposition: 'answered' }] });
    await elements.get('login-form')!.listeners.get('submit')!({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('history-count')!.textContent, 'Showing 1 of 1 loaded calls.');
    assert.equal(elements.get('history-search')!.value, '');
    assert.equal(elements.get('history-direction')!.value, 'all');
    assert.equal(elements.get('history-clear')!.disabled, true);
    destination.value = 'untouched';
    retainedRow.listeners.get('click')!({});
    assert.equal(destination.value, 'untouched', 'retained rows from the previous owner cannot fill the new dialpad');
    finishOldPage(historyPage('session-a'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('history-list')!.children[0].children[1].children[0].textContent, '5555', 'late old-owner history is discarded');

    elements.get('history-search')!.value = '5555';
    elements.get('history-search')!.listeners.get('input')!({});
    elements.get('history-direction')!.value = 'inbound';
    elements.get('history-direction')!.listeners.get('change')!({});
    let rejectOldWorkspace!: (error: Error) => void;
    historyImplementation = () => new Promise((_resolve, reject) => { rejectOldWorkspace = reject; });
    elements.get('history-refresh')!.listeners.get('click')!({});
    publicState = { ...publicState, tenantId: 3 }; // Workspace must be guarded independently of the opaque revision.
    historyImplementation = async revision => ({ sessionRevision: revision, items: [], nextCursor: null });
    await elements.get('login-form')!.listeners.get('submit')!({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('history-search')!.value, '');
    assert.equal(elements.get('history-direction')!.value, 'all');
    assert.equal(elements.get('history-list')!.children[0].textContent, 'No calls yet.');
    rejectOldWorkspace(new Error('private obsolete workspace error'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('history-state')!.textContent, '', 'late workspace errors cannot overwrite the new empty state');

    elements.get('history-search')!.value = 'answered';
    elements.get('history-search')!.listeners.get('input')!({});
    publicState = { ...publicState, sessionRevision: 'session-c' }; // A fresh account/session revision also clears controls.
    await elements.get('login-form')!.listeners.get('submit')!({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('history-search')!.value, '');
    assert.equal(elements.get('history-list')!.children[0].textContent, 'No calls yet.');
    historyImplementation = async () => { throw new Error('PHONE11_HISTORY_FORBIDDEN private details'); };
    elements.get('history-refresh')!.listeners.get('click')!({});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('history-list')!.children.length, 0, 'request failure is not represented as no history');
    assert.equal(elements.get('history-state')!.textContent, 'Your account cannot access call history in this workspace.');
    assert.equal(elements.get('history-state')!.textContent.includes('private'), false);
  } finally {
    (globalThis as any).setTimeout = previousSetTimeout;
    (globalThis as any).clearTimeout = previousClearTimeout;
    (globalThis as any).document = previousDocument;
    (globalThis as any).window = previousWindow;
  }
});

test('keypad hidden state wins over its grid layout', async () => {
  const css = await readFile(join(__dirname, '../src/style.css'), 'utf8');
  assert.match(css, /\.keypad\[hidden\]\s*\{\s*display\s*:\s*none;?\s*\}/);
});

test('history controls have explicit labels, loaded scope and native keyboard affordances', async () => {
  const html = await readFile(join(__dirname, '../src/index.html'), 'utf8');
  assert.match(html, /for="history-search">Search loaded calls by number, direction or outcome/);
  assert.match(html, /id="history-search"[^>]*type="search"[^>]*maxlength="64"/);
  assert.match(html, /<label for="history-direction">Direction\s*<select id="history-direction">/);
  assert.match(html, /<label for="history-outcome">Outcome\s*<select id="history-outcome">/);
  assert.match(html, /Search and filters apply to loaded calls only\. Load more to include older calls\./);
  assert.match(html, /id="history-count"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="history-clear"[^>]*type="button"[^>]*>Clear search and filters/);
  assert.match(html, /id="history-more"[^>]*aria-describedby="history-scope"/);
});
