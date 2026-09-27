import { applyTaggedSnapshot, signInFailureMessage, type PublicState, type TaggedSnapshot } from './ipc';
import type { DesktopCallHistory } from '../../src/authenticated-provider';
import { VoicemailPlayer } from './voicemail-player';

declare global { interface Window { phone11: {
  state(): Promise<PublicState>; signIn(email: string, password: string): Promise<PublicState>;
  action(input: unknown): Promise<TaggedSnapshot>; signOut(): Promise<PublicState>;
  openMeetings(): Promise<void>;
  historyList?(sessionRevision: string): Promise<{sessionRevision: string; items: DesktopCallHistory[]}>;
  voicemailAudio?(sessionRevision: string, id: number): Promise<{sessionRevision: string; id: number; mimeType: 'audio/wav'; bytes: Uint8Array}>;
  voicemailMarkRead?(sessionRevision: string, id: number): Promise<unknown>;
  voicemailList?(sessionRevision: string): Promise<{ sessionRevision: string; items: Array<{
    id: number; callerName: string | null; callerNumber: string | null; durationSeconds: number;
    status: 'new' | 'read'; createdAt: string;
  }> }>;
  onUpdate(listener: (snapshot: TaggedSnapshot) => void): () => void;
} } }
const byId = (id: string): HTMLElement => document.getElementById(id)!;
const maybeById = (id: string): HTMLElement | null => document.getElementById(id);
let state: PublicState | null = null;
let busy = false;
let accountEpoch = 0;
let currentTab: 'phone' | 'meetings' = 'phone';
let currentPhoneSection: 'history' | 'voicemail' | 'lines' = 'history';
let meetingOpening = false;
let meetingMessage = '';
let voicemailLoading = false;
let voicemailLoadingFor = '';
let voicemailLoadedFor = '';
let voicemailMessage = 'Open Voicemail to load your messages.';
let voicemailItems: Array<{ id: number; callerName: string | null; callerNumber: string | null; durationSeconds: number; status: 'new' | 'read'; createdAt: string }> = [];
let voicemailRequest = 0;
let historyRequest = 0;
let historyLoadedFor = '';
let historyLoading = false;
let historyMessage = '';
let historyItems: DesktopCallHistory[] = [];
const audio = maybeById('voicemail-audio') as HTMLAudioElement | null;
const player = audio ? new VoicemailPlayer({
  audio,
  fetchAudio: async (revision, id) => {
    if (!window.phone11.voicemailAudio) throw new Error('Unavailable');
    return window.phone11.voicemailAudio(revision, id);
  },
  markRead: async (revision, id) => {
    if (!window.phone11.voicemailMarkRead) throw new Error('Unavailable');
    await window.phone11.voicemailMarkRead(revision, id);
    if (state?.sessionRevision === revision) {
      voicemailItems = voicemailItems.map(item => item.id === id ? {...item, status: 'read'} : item);
      render();
    }
  },
  onState: value => {
    const panel = byId('voicemail-player');
    panel.hidden = value.id === null && !value.loading && !value.error;
    byId('voicemail-player-title').textContent = voicemailItems.find(item => item.id === value.id)?.callerName
      || voicemailItems.find(item => item.id === value.id)?.callerNumber || 'Voicemail';
    byId('voicemail-playback-state').textContent = value.loading ? 'Loading audio…' : value.error ?? '';
    audio.hidden = value.loading || value.id === null;
  },
}) : null;
maybeById('voicemail-stop')?.addEventListener('click', () => player?.stop());
window.addEventListener?.('pagehide', () => player?.dispose());
function callbackNumber(item: DesktopCallHistory): string | null {
  const candidate = item.direction === 'inbound' ? item.callerNumber : item.direction === 'outbound' ? item.calleeNumber
    : item.callerNumber === state?.extensionNumber ? item.calleeNumber
    : item.calleeNumber === state?.extensionNumber ? item.callerNumber : null;
  return candidate && /^[+0-9*#]{1,32}$/.test(candidate) ? candidate : null;
}
function renderHistory(): void {
  const status = maybeById('history-state');
  if (status) status.textContent = historyMessage;
  const refresh = maybeById('history-refresh') as HTMLButtonElement | null;
  if (refresh) refresh.disabled = historyLoading;
  const list = maybeById('history-list');
  if (!list) return;
  list.replaceChildren();
  if (!historyMessage && !historyLoading && historyLoadedFor && historyItems.length === 0) {
    const empty = document.createElement('p'); empty.className = 'empty-message';
    empty.textContent = 'No calls in the last 30 days.'; list.append(empty);
  }
  for (const item of historyItems) {
    const number = callbackNumber(item);
    const missed = ['missed', 'no_answer', 'no-answer', 'busy', 'failed'].includes(item.disposition ?? '');
    const row = document.createElement('button'); row.type = 'button'; row.className = 'history-row';
    row.dataset.missed = String(missed);
    const display = number || [item.callerNumber, item.calleeNumber].filter(Boolean).join(' → ') || 'Unknown caller';
    row.disabled = !number || !!state?.calling.call || busy || state?.calling.dialState !== 'idle';
    row.setAttribute('aria-label', number ? `Use ${number} on dialpad` : display);
    const icon = document.createElement('img'); icon.alt = ''; icon.src = `icons/${missed ? 'phone-missed' : item.direction === 'inbound' ? 'phone-incoming' : 'phone-outgoing'}.svg`;
    const text = document.createElement('span'); const title = document.createElement('strong'); title.textContent = display;
    const meta = document.createElement('small');
    const outcome = item.disposition === 'busy' ? 'Busy' : item.disposition === 'failed' ? 'Failed'
      : missed ? 'Missed' : `${item.durationSeconds}s`;
    meta.textContent = `${item.direction[0].toUpperCase()}${item.direction.slice(1)} · ${outcome} · ${new Date(item.startedAt).toLocaleString()}`;
    text.append(title, meta); row.append(icon, text);
    row.addEventListener('click', () => {
      if (!number || !state?.signedIn || state.calling.call || busy || state.calling.dialState !== 'idle') return;
      const field = byId('destination') as HTMLInputElement; field.value = number; field.focus();
    }); list.append(row);
  }
}
async function loadHistory(force = false): Promise<void> {
  if (!state?.signedIn || !state.sessionRevision || historyLoading || (!force && historyLoadedFor === state.sessionRevision)) return;
  const revision = state.sessionRevision; const request = ++historyRequest;
  historyLoading = true; historyMessage = 'Loading call history…'; renderHistory();
  try {
    if (!window.phone11.historyList) throw new Error('Unavailable');
    const response = await window.phone11.historyList(revision);
    if (request !== historyRequest || state?.sessionRevision !== revision) return;
    if (response.sessionRevision !== revision) throw new Error('Session changed');
    historyItems = response.items; historyLoadedFor = revision; historyMessage = '';
  } catch {
    if (request === historyRequest && state?.sessionRevision === revision)
      historyMessage = 'Call history could not load. Refresh to try again.';
  } finally { if (request === historyRequest && state?.sessionRevision === revision) { historyLoading = false; renderHistory(); } }
}
function render(): void {
  const signed = !!state?.signedIn;
  const call = signed ? state?.calling.call : null;
  // An incoming or active call must never be hidden behind an inbox or meeting tab.
  if (call) currentTab = 'phone';
  byId('login').hidden = signed;
  byId('workspace').hidden = !signed;
  byId('phone').hidden = !signed || currentTab !== 'phone';
  byId('meetings').hidden = !signed || currentTab !== 'meetings';
  for (const tab of ['phone', 'meetings'] as const) {
    const button = byId(`${tab}-tab`);
    if (tab === currentTab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const section of ['history', 'voicemail', 'lines'] as const) {
    const button = maybeById(`${section}-tab`);
    const panel = maybeById(`${section}-panel`);
    if (!button || !panel) continue;
    if (section === currentPhoneSection) {
      button.setAttribute('aria-current', 'page');
      panel.hidden = false;
    } else {
      button.removeAttribute('aria-current');
      panel.hidden = true;
    }
  }
  if (!signed || !state) { player?.stop(); return; }
  renderHistory();
  const phoneBusy = !!call || state.calling.dialState !== 'idle' || state.calling.callActionState !== 'idle';
  if (phoneBusy) player?.stop();
  (byId('open-meetings') as HTMLButtonElement).disabled = meetingOpening || phoneBusy;
  byId('meeting-open-message').textContent = phoneBusy
    ? 'Finish your Phone call or pending action before opening a meeting.' : meetingMessage;
  byId('identity').textContent = `Extension ${state.extensionNumber ?? 'unavailable'}`;
  const assignedExtension = maybeById('assigned-extension');
  if (assignedExtension) assignedExtension.textContent = state.extensionNumber ?? 'Extension unavailable';
  byId('status').textContent = call ? `${call.state[0].toUpperCase()}${call.state.slice(1)} call` :
    state.calling.registered ? 'Ready to call' : 'Connecting to calling service';
  const statusMark = maybeById('phone-status-mark');
  if (statusMark) statusMark.dataset.state = call?.state ?? (state.calling.registered ? 'ready' : 'connecting');
  byId('call-id').textContent = call ? 'Phone call' : '';
  byId('notice').textContent = 'Trial · Calls limited to 60 seconds';
  byId('hold-message').textContent = state.calling.holdMessage ?? '';
  byId('dial').hidden = !!call;
  (byId('dial') as HTMLButtonElement).disabled = busy || !!call || !state.calling.registered || state.calling.dialState !== 'idle';
  (byId('answer') as HTMLButtonElement).hidden = call?.state !== 'incoming';
  (byId('end') as HTMLButtonElement).hidden = !call;
  (byId('mute') as HTMLButtonElement).hidden = !call || !['connected', 'held'].includes(call.state);
  (byId('hold') as HTMLButtonElement).hidden = !call || !['connected', 'held'].includes(call.state);
  const canEnterDestination = !busy && !call && state.calling.registered && state.calling.dialState === 'idle';
  (byId('destination') as HTMLInputElement).disabled = !canEnterDestination;
  const backspace = maybeById('backspace') as HTMLButtonElement | null;
  if (backspace) backspace.disabled = !canEnterDestination;
  const canSendDtmf = !!call && ['connected', 'held'].includes(call.state);
  (byId('keypad') as HTMLElement).hidden = !canEnterDestination && !canSendDtmf;
  (maybeById('mute-label') ?? byId('mute')).textContent = call?.muted ? 'Unmute' : 'Mute';
  (maybeById('hold-label') ?? byId('hold')).textContent = call?.state === 'held' ? 'Resume' : 'Hold';
  const voicemailRefresh = maybeById('voicemail-refresh');
  if (voicemailRefresh) (voicemailRefresh as HTMLButtonElement).disabled = voicemailLoading;
  const voicemailState = maybeById('voicemail-state');
  if (voicemailState) voicemailState.textContent = voicemailMessage;
  const voicemailList = maybeById('voicemail-list');
  if (voicemailList && 'replaceChildren' in voicemailList && typeof document.createElement === 'function') {
    voicemailList.replaceChildren();
    if (!voicemailLoading && voicemailItems.length === 0 && voicemailLoadedFor && !voicemailMessage) {
      const empty = document.createElement('p');
      empty.className = 'empty-message';
      empty.textContent = 'No voicemail messages.';
      voicemailList.append(empty);
    }
    for (const item of voicemailItems) {
      const row = document.createElement('article');
      row.className = 'voicemail-item';
      const caller = document.createElement('strong');
      caller.textContent = item.callerName?.trim() || item.callerNumber?.trim() || 'Unknown caller';
      const meta = document.createElement('span');
      const date = new Date(item.createdAt);
      const dateText = Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
      const duration = Number.isFinite(item.durationSeconds) ? `${Math.max(0, Math.floor(item.durationSeconds))} sec` : '';
      meta.textContent = [item.status === 'new' ? 'New' : 'Read', duration, dateText].filter(Boolean).join(' · ');
      const play = document.createElement('button'); play.type = 'button'; play.className = 'voicemail-play';
      play.setAttribute('aria-label', `Play voicemail from ${caller.textContent}`);
      play.disabled = phoneBusy;
      const playIcon = document.createElement('img'); playIcon.src = 'icons/play.svg'; playIcon.alt = '';
      play.append(playIcon);
      play.addEventListener('click', () => {
        if (state?.sessionRevision && !state.calling.call && state.calling.dialState === 'idle' && state.calling.callActionState === 'idle')
          void player?.play(state.sessionRevision, item.id);
      });
      row.append(caller, meta, play);
      voicemailList.append(row);
    }
  }
}
async function loadVoicemail(force = false): Promise<void> {
  if (!state?.signedIn || !state.sessionRevision) return;
  if (!force && voicemailLoadedFor === state.sessionRevision) return;
  if (!force && voicemailLoading && voicemailLoadingFor === state.sessionRevision) return;
  const revision = state.sessionRevision;
  const requestId = ++voicemailRequest;
  voicemailLoading = true;
  voicemailLoadingFor = revision;
  voicemailMessage = 'Loading voicemail…';
  if (force || voicemailLoadedFor !== revision) voicemailItems = [];
  render();
  try {
    if (!window.phone11.voicemailList) throw new Error('unavailable');
    const response = await window.phone11.voicemailList(revision);
    if (requestId !== voicemailRequest || state?.sessionRevision !== revision) return;
    if (response.sessionRevision !== revision) throw new Error('stale session');
    voicemailItems = Array.isArray(response.items) ? response.items : [];
    voicemailLoadedFor = revision;
    voicemailMessage = '';
  } catch {
    if (requestId === voicemailRequest && state?.sessionRevision === revision) {
      voicemailMessage = 'Voicemail could not load. Refresh to try again.';
      voicemailLoadedFor = '';
    }
  } finally {
    if (requestId === voicemailRequest && state?.sessionRevision === revision) {
      voicemailLoading = false;
      voicemailLoadingFor = '';
      render();
    }
  }
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
    if (accountEpoch === epoch) { state = signedIn; busy = false; meetingOpening = false; meetingMessage = ''; message(''); render(); void loadHistory(); }
  } catch (error) { if (accountEpoch === epoch) message(signInFailureMessage(error)); }
});
for (const tab of ['phone', 'meetings'] as const) {
  byId(`${tab}-tab`).addEventListener('click', () => { currentTab = tab; if (tab !== 'phone') player?.stop(); render(); });
}
for (const section of ['history', 'voicemail', 'lines'] as const) {
  maybeById(`${section}-tab`)?.addEventListener('click', () => {
    currentPhoneSection = section;
    if (section !== 'voicemail') player?.stop();
    render();
    if (section === 'voicemail') void loadVoicemail();
    if (section === 'history') void loadHistory();
  });
}
maybeById('history-refresh')?.addEventListener('click', () => { void loadHistory(true); });
maybeById('voicemail-refresh')?.addEventListener('click', () => { void loadVoicemail(true); });
byId('open-meetings').addEventListener('click', async () => {
  if (!state?.signedIn || !state.sessionRevision || state.calling.call ||
      state.calling.dialState !== 'idle' || state.calling.callActionState !== 'idle' || meetingOpening) return;
  const sessionRevision = state.sessionRevision;
  const epoch = accountEpoch;
  player?.stop();
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
  player?.stop(); historyRequest++; historyLoading = false; historyLoadedFor = ''; historyItems = []; historyMessage = '';
  state = null; busy = false; meetingOpening = false; meetingMessage = ''; currentTab = 'phone'; currentPhoneSection = 'history'; voicemailRequest += 1; voicemailLoading = false; voicemailLoadingFor = ''; voicemailLoadedFor = ''; voicemailItems = []; voicemailMessage = 'Open Voicemail to load your messages.'; render();
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
maybeById('backspace')?.addEventListener('click', () => {
  if (busy || !state?.signedIn || state.calling.call || !state.calling.registered || state.calling.dialState !== 'idle') return;
  const destination = byId('destination') as HTMLInputElement;
  destination.value = destination.value.slice(0, -1);
  destination.focus();
});
byId('keypad').addEventListener('click', event => {
  const target = event.target as HTMLElement;
  const digit = target.closest<HTMLElement>('[data-digit]')?.dataset.digit;
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
window.phone11.onUpdate(update => {
  const previousRevision = state?.sessionRevision;
  const previousCall = state?.calling.call;
  state = applyTaggedSnapshot(state, update);
  if (previousRevision && previousRevision !== state?.sessionRevision) {
    player?.stop(); historyRequest++; historyLoading = false; historyLoadedFor = ''; historyItems = []; historyMessage = '';
    voicemailRequest += 1; voicemailLoading = false; voicemailLoadingFor = ''; voicemailLoadedFor = ''; voicemailItems = [];
    voicemailMessage = 'Open Voicemail to load your messages.';
  }
  render();
  if (previousCall && !state?.calling.call) void loadHistory(true);
  if (currentPhoneSection === 'voicemail' && state?.signedIn) void loadVoicemail();
});
const initialEpoch = accountEpoch;
window.phone11.state().then(value => {
  if (accountEpoch === initialEpoch) { state = value; render(); void loadHistory(); }
}).catch(() => { if (accountEpoch === initialEpoch) message('Desktop service unavailable.'); });
