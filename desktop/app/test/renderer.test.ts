import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type ElementStub = {
  hidden: boolean; disabled: boolean; textContent: string; value: string; dataset: Record<string, string>;
  children: ElementStub[]; className: string;
  focused: boolean; listeners: Map<string, (event: any) => void>; addEventListener(type: string, listener: (event: any) => void): void;
  focus(): void; setAttribute(name: string, value: string): void; removeAttribute(name: string): void;
  append(...children: ElementStub[]): void; replaceChildren(): void;
};
const element = (): ElementStub => ({ hidden: false, disabled: false, textContent: '', value: '', dataset: {},
  children: [], className: '', focused: false, listeners: new Map(),
  addEventListener(type, listener) { this.listeners.set(type, listener); },
  focus() { this.focused = true; }, setAttribute() {}, removeAttribute() {},
  append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; } });

test('dialpad enters a bounded destination while idle and sends DTMF only in an established call', async () => {
  const ids = ['login', 'workspace', 'phone', 'meetings', 'phone-tab', 'meetings-tab',
    'backspace', 'mute-label', 'hold-label', 'history-tab', 'voicemail-tab', 'lines-tab',
    'dialpad-panel', 'history-panel', 'voicemail-panel', 'lines-panel', 'phone-status-mark',
    'voicemail-state', 'voicemail-list', 'voicemail-refresh', 'history-list', 'history-state', 'history-refresh',
    'open-meetings', 'meeting-open-message', 'identity', 'status', 'call-id', 'notice', 'hold-message', 'dial', 'answer',
    'end', 'mute', 'hold', 'keypad', 'destination', 'message', 'login-form', 'email', 'password', 'sign-out', 'dial-form'];
  const elements = new Map(ids.map(id => [id, element()]));
  const keypad = elements.get('keypad')!;
  const destination = elements.get('destination')!;
  const listeners = new Map<string, (snapshot: any) => void>();
  const actions: unknown[] = [];
  let meetingOpens = 0;
  let voicemailLists = 0;
  const calling = { version: 1, registered: true, call: null, dialState: 'idle', callActionState: 'idle', holdMessage: null };
  let publicState: any = { signedIn: true, sessionRevision: 'session-a', generation: 'generation-a', tenantId: 1,
    extensionNumber: '1020', calling };
  const previousDocument = (globalThis as any).document;
  const previousWindow = (globalThis as any).window;
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
    historyList: async (revision: string) => ({sessionRevision: revision, items: [{id:1, direction:'inbound', callerNumber:'3001', calleeNumber:'1020', durationSeconds:0, disposition:'missed', startedAt:'2026-09-27T10:00:00.000Z'}]}),
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
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    (globalThis as any).document = previousDocument;
    (globalThis as any).window = previousWindow;
  }
});

test('keypad hidden state wins over its grid layout', async () => {
  const css = await readFile(join(__dirname, '../src/style.css'), 'utf8');
  assert.match(css, /\.keypad\[hidden\]\s*\{\s*display\s*:\s*none;?\s*\}/);
});
