import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type ElementStub = {
  hidden: boolean; disabled: boolean; textContent: string; value: string; dataset: Record<string, string>;
  focused: boolean; listeners: Map<string, (event: any) => void>; addEventListener(type: string, listener: (event: any) => void): void;
  focus(): void; setAttribute(name: string, value: string): void; removeAttribute(name: string): void;
};
const element = (): ElementStub => ({ hidden: false, disabled: false, textContent: '', value: '', dataset: {},
  focused: false, listeners: new Map(), addEventListener(type, listener) { this.listeners.set(type, listener); },
  focus() { this.focused = true; }, setAttribute() {}, removeAttribute() {} });

test('dialpad enters a bounded destination while idle and sends DTMF only in an established call', async () => {
  const ids = ['login', 'workspace', 'phone', 'meetings', 'phone-tab', 'meetings-tab', 'open-meetings', 'meeting-open-message', 'identity', 'status', 'call-id', 'notice', 'hold-message', 'dial', 'answer',
    'end', 'mute', 'hold', 'keypad', 'destination', 'message', 'login-form', 'email', 'password', 'sign-out', 'dial-form'];
  const elements = new Map(ids.map(id => [id, element()]));
  const keypad = elements.get('keypad')!;
  const destination = elements.get('destination')!;
  const listeners = new Map<string, (snapshot: any) => void>();
  const actions: unknown[] = [];
  let meetingOpens = 0;
  const calling = { version: 1, registered: true, call: null, dialState: 'idle', callActionState: 'idle', holdMessage: null };
  let publicState: any = { signedIn: true, sessionRevision: 'session-a', generation: 'generation-a', tenantId: 1,
    extensionNumber: '1020', calling };
  const previousDocument = (globalThis as any).document;
  const previousWindow = (globalThis as any).window;
  (globalThis as any).document = { getElementById: (id: string) => elements.get(id)! };
  (globalThis as any).window = { phone11: {
    state: async () => publicState,
    signIn: async () => publicState,
    signOut: async () => ({ signedIn: false, sessionRevision: null, generation: null, tenantId: null, extensionNumber: null, calling }),
    action: async (input: unknown) => {
      actions.push(input);
      return { sessionRevision: 'session-a', generation: 'generation-a', snapshot: calling };
    },
    openMeetings: async () => { meetingOpens++; throw new Error('private admission token'); },
    onUpdate: (listener: (snapshot: any) => void) => { listeners.set('update', listener); return () => listeners.delete('update'); },
  } };
  try {
    await import('../src/renderer');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(keypad.hidden, false, 'the keypad is available after calling registration');
    elements.get('meetings-tab')!.listeners.get('click')!({});
    assert.equal(elements.get('meetings')!.hidden, false);
    assert.equal(elements.get('phone')!.hidden, true);
    await elements.get('open-meetings')!.listeners.get('click')!({});
    assert.equal(meetingOpens, 1);
    assert.equal(elements.get('meeting-open-message')!.textContent, 'Meetings could not open. Try again.');
    elements.get('phone-tab')!.listeners.get('click')!({});
    assert.equal(elements.get('phone')!.hidden, false);
    keypad.listeners.get('click')!({ target: { dataset: { digit: '1' } } });
    keypad.listeners.get('click')!({ target: { dataset: { digit: '0' } } });
    keypad.listeners.get('click')!({ target: { dataset: { digit: '#' } } });
    assert.equal(destination.value, '10#');
    assert.equal(destination.focused, true);
    assert.equal(actions.length, 0, 'idle keypad taps edit the destination without issuing call actions');

    destination.value = '7'.repeat(32);
    keypad.listeners.get('click')!({ target: { dataset: { digit: '2' } } });
    assert.equal(destination.value, '7'.repeat(32), 'the destination remains within the 32 character field limit');

    publicState = { ...publicState, calling: { ...calling, call: { id: '81', state: 'ringing', muted: false }, dialState: 'requesting' } };
    listeners.get('update')!({ sessionRevision: 'session-a', generation: 'generation-a', snapshot: publicState.calling });
    assert.equal(keypad.hidden, true, 'the keypad is unavailable while the destination is ringing');
    assert.equal(elements.get('open-meetings')!.disabled, true, 'a pending Phone action blocks meeting entry');
    const ringingDestination = destination.value;
    keypad.listeners.get('click')!({ target: { dataset: { digit: '3' } } });
    assert.equal(destination.value, ringingDestination);
    assert.equal(actions.length, 0, 'ringing keypad taps do not issue DTMF');

    const connected = { ...calling, call: { id: '81', state: 'connected', muted: false } };
    listeners.get('update')!({ sessionRevision: 'session-a', generation: 'generation-a', snapshot: connected });
    assert.equal(keypad.hidden, false, 'the keypad returns for an established call');
    assert.equal(elements.get('open-meetings')!.disabled, true, 'a Phone call prevents opening meeting media');
    keypad.listeners.get('click')!({ target: { dataset: { digit: '5' } } });
    assert.deepEqual(actions[0], { operation: 'dtmf', generation: 'generation-a', callId: '81', digits: '5', sessionRevision: 'session-a' });
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    (globalThis as any).document = previousDocument;
    (globalThis as any).window = previousWindow;
  }
});

test('keypad hidden state wins over its grid layout', async () => {
  const css = await readFile(join(__dirname, '../src/style.css'), 'utf8');
  assert.match(css, /\.keypad\[hidden\]\s*\{\s*display\s*:\s*none\s*\}/);
});
