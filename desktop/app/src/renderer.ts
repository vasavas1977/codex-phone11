import { applyTaggedSnapshot, signInFailureMessage, type PublicState, type TaggedSnapshot } from './ipc';
import type { PublicSnapshot } from '../../src/call-boundary';

declare global { interface Window { phone11: {
  state(): Promise<PublicState>; signIn(email: string, password: string): Promise<PublicState>;
  action(input: unknown): Promise<TaggedSnapshot>; signOut(): Promise<PublicState>;
  openMeetings(): Promise<void>;
  onUpdate(listener: (snapshot: TaggedSnapshot) => void): () => void;
} } }
const byId = (id: string): HTMLElement => document.getElementById(id)!;
let state: PublicState | null = null;
let busy = false;
let accountEpoch = 0;
let currentTab: 'phone' | 'meetings' = 'phone';
let meetingOpening = false;
let meetingMessage = '';
function render(): void {
  const signed = !!state?.signedIn;
  byId('login').hidden = signed;
  byId('workspace').hidden = !signed;
  byId('phone').hidden = !signed || currentTab !== 'phone';
  byId('meetings').hidden = !signed || currentTab !== 'meetings';
  for (const tab of ['phone', 'meetings'] as const) {
    const button = byId(`${tab}-tab`);
    if (tab === currentTab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  if (!signed || !state) return;
  const call = state.calling.call;
  const phoneBusy = !!call || state.calling.dialState !== 'idle' || state.calling.callActionState !== 'idle';
  (byId('open-meetings') as HTMLButtonElement).disabled = meetingOpening || phoneBusy;
  byId('meeting-open-message').textContent = phoneBusy
    ? 'Finish your Phone call or pending action before opening a meeting.' : meetingMessage;
  byId('identity').textContent = `Tenant ${state.tenantId} · Extension ${state.extensionNumber ?? 'unavailable'}`;
  byId('status').textContent = call ? `${call.state[0].toUpperCase()}${call.state.slice(1)} call` :
    state.calling.registered ? 'Ready to call' : 'Connecting to calling service';
  byId('call-id').textContent = call ? `Call ${call.id}` : 'No active call';
  byId('notice').textContent = 'Siprix official trial: calls may end after 60 seconds. For testing only.';
  byId('hold-message').textContent = state.calling.holdMessage ?? '';
  (byId('dial') as HTMLButtonElement).disabled = busy || !!call || !state.calling.registered || state.calling.dialState !== 'idle';
  (byId('answer') as HTMLButtonElement).hidden = call?.state !== 'incoming';
  (byId('end') as HTMLButtonElement).hidden = !call;
  (byId('mute') as HTMLButtonElement).hidden = !call || !['connected', 'held'].includes(call.state);
  (byId('hold') as HTMLButtonElement).hidden = !call || !['connected', 'held'].includes(call.state);
  const canEnterDestination = !busy && !call && state.calling.registered && state.calling.dialState === 'idle';
  const canSendDtmf = !!call && ['connected', 'held'].includes(call.state);
  (byId('keypad') as HTMLElement).hidden = !canEnterDestination && !canSendDtmf;
  byId('mute').textContent = call?.muted ? 'Unmute' : 'Mute';
  byId('hold').textContent = call?.state === 'held' ? 'Resume' : 'Hold';
}
function message(text: string): void { byId('message').textContent = text; }
async function request(input: unknown): Promise<void> {
  if (!state?.sessionRevision || !state.generation) return;
  const sessionRevision = state.sessionRevision;
  const generation = state.generation;
  busy = true; render();
  try {
    const response = await window.phone11.action({ ...input as object, sessionRevision });
    if (state?.sessionRevision === sessionRevision && state.generation === generation &&
        response.sessionRevision === sessionRevision && response.generation === generation) {
      state = applyTaggedSnapshot(state, response); message('');
    }
  } catch {
    if (state?.sessionRevision === sessionRevision && state.generation === generation)
      message('Calling action unavailable. Check call state and try again.');
  }
  finally {
    if (state?.sessionRevision === sessionRevision && state.generation === generation) busy = false;
    render();
  }
}
byId('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const epoch = ++accountEpoch;
  const email = (byId('email') as HTMLInputElement).value;
  const passwordField = byId('password') as HTMLInputElement;
  const password = passwordField.value;
  passwordField.value = '';
  message('Signing in…');
  try {
    const signedIn = await window.phone11.signIn(email, password);
    if (accountEpoch === epoch) { state = signedIn; busy = false; meetingOpening = false; meetingMessage = ''; message(''); render(); }
  } catch (error) { if (accountEpoch === epoch) message(signInFailureMessage(error)); }
});
for (const tab of ['phone', 'meetings'] as const) {
  byId(`${tab}-tab`).addEventListener('click', () => { currentTab = tab; render(); });
}
byId('open-meetings').addEventListener('click', async () => {
  if (!state?.signedIn || !state.sessionRevision || state.calling.call ||
      state.calling.dialState !== 'idle' || state.calling.callActionState !== 'idle' || meetingOpening) return;
  const sessionRevision = state.sessionRevision;
  const epoch = accountEpoch;
  meetingOpening = true;
  meetingMessage = 'Opening meeting setup…';
  render();
  try {
    await window.phone11.openMeetings();
    if (epoch === accountEpoch && state?.sessionRevision === sessionRevision)
      meetingMessage = 'Meeting window opened.';
  } catch {
    if (epoch === accountEpoch && state?.sessionRevision === sessionRevision)
      meetingMessage = 'Meetings could not open. Try again.';
  } finally {
    if (epoch === accountEpoch && state?.sessionRevision === sessionRevision) {
      meetingOpening = false;
      render();
    }
  }
});
byId('sign-out').addEventListener('click', async () => {
  const epoch = ++accountEpoch;
  state = null; busy = false; meetingOpening = false; meetingMessage = ''; currentTab = 'phone'; render();
  try {
    const signedOut = await window.phone11.signOut();
    if (accountEpoch === epoch) { state = signedOut; message('Signed out.'); render(); }
  } catch {
    if (accountEpoch === epoch) message('Signed out; helper exit could not be verified. Restart before calling.');
  }
});
byId('dial-form').addEventListener('submit', event => {
  event.preventDefault(); void request({ operation: 'dial', destination: (byId('destination') as HTMLInputElement).value.trim() });
});
for (const operation of ['answer', 'end', 'mute', 'hold'] as const) {
  byId(operation).addEventListener('click', () => {
    const call = state?.calling.call;
    if (!call || !state?.generation) return;
    void request({ operation, generation: state.generation, callId: call.id,
      ...operation === 'mute' ? { value: !call.muted } : operation === 'hold' ? { value: call.state !== 'held' } : {} });
  });
}
byId('keypad').addEventListener('click', event => {
  const target = event.target as HTMLElement;
  const digit = target.dataset.digit;
  if (!digit || !/^[0-9*#]$/.test(digit)) return;
  const call = state?.calling.call;
  if (call) {
    if (busy || !['connected', 'held'].includes(call.state) || !state?.generation) return;
    void request({ operation: 'dtmf', generation: state.generation, callId: call.id, digits: digit });
    return;
  }
  if (busy || !state?.signedIn || !state.calling.registered || state.calling.dialState !== 'idle') return;
  const destination = byId('destination') as HTMLInputElement;
  if (destination.value.length >= 32) return;
  destination.value += digit;
  destination.focus();
});
window.phone11.onUpdate(update => { state = applyTaggedSnapshot(state, update); render(); });
const initialEpoch = accountEpoch;
window.phone11.state().then(value => {
  if (accountEpoch === initialEpoch) { state = value; render(); }
}).catch(() => { if (accountEpoch === initialEpoch) message('Desktop service unavailable.'); });
