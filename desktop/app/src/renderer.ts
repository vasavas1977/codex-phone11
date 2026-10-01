import { applyTaggedSnapshot, callHistoryFailureMessage, signInFailureMessage, VOICEMAIL_ENABLED, type PublicState, type TaggedSnapshot, type TaggedDirectory, type DirectoryEntry } from './ipc';
import type { DesktopCallHistory, DesktopCallHistoryCursor, DesktopTenantSelection } from '../../src/authenticated-provider';
import { VoicemailPlayer } from './voicemail-player';
import { boundedHistoryQuery, filterHistoryItems, HISTORY_DIRECTIONS, HISTORY_OUTCOMES,
  historyDirectionLabel, historyOutcome, historyOutcomeLabel, historyScopeKey,
  type HistoryDirection, type HistoryOutcome } from './history-filter';

declare global { interface Window { phone11: {
  state(): Promise<PublicState>; signIn(email: string, password: string): Promise<PublicState | DesktopTenantSelection>;
  selectTenant(selectionRevision: string, tenantId: number): Promise<PublicState>;
  action(input: unknown): Promise<TaggedSnapshot>; signOut(): Promise<PublicState>;
  openMeetings(): Promise<void>;
  historyList?(sessionRevision: string, cursor?: DesktopCallHistoryCursor): Promise<{
    sessionRevision: string; items: DesktopCallHistory[]; nextCursor: DesktopCallHistoryCursor | null }>;
  directoryList(sessionRevision: string, search: string, offset: number): Promise<TaggedDirectory>;
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
let pendingSelection: DesktopTenantSelection | null = null;
let selectionBusy = false;
let currentTab: 'phone' | 'meetings' = 'phone';
let currentPhoneSection: 'history' | 'directory' | 'voicemail' | 'lines' = 'history';
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
let historyRefreshQueued = false;
let historyMessage = '';
let historyItems: DesktopCallHistory[] = [];
let historyNextCursor: DesktopCallHistoryCursor | null = null;
let historyScope = '';
let historyQuery = '';
let historyDirection: HistoryDirection = 'all';
let historyResult: HistoryOutcome = 'all';
let historyReconcileTimers: Array<ReturnType<typeof setTimeout>> = [];
function clearHistoryFilters(): void {
  historyQuery = ''; historyDirection = 'all'; historyResult = 'all';
}
function resetHistory(): void {
  cancelHistoryReconciliation();
  historyRequest++; historyLoading = false; historyRefreshQueued = false; historyLoadedFor = '';
  historyItems = []; historyNextCursor = null; historyMessage = ''; clearHistoryFilters();
}
function syncHistoryScope(): string {
  const scope = historyScopeKey(state);
  if (scope !== historyScope) { historyScope = scope; resetHistory(); }
  return scope;
}
function cancelHistoryReconciliation(): void {
  for (const timer of historyReconcileTimers) clearTimeout(timer);
  historyReconcileTimers = [];
}
function reconcileCompletedCall(): void {
  cancelHistoryReconciliation();
  const revision = state?.sessionRevision;
  const generation = state?.generation;
  if (!revision || !generation) return;
  void loadHistory(true);
  for (const delay of [1000, 3000, 10000]) {
    historyReconcileTimers.push(setTimeout(() => {
      if (state?.sessionRevision === revision && state.generation === generation && !state.calling.call)
        void loadHistory(true);
    }, delay));
  }
}
let directoryRequest = 0;
let directoryLoadedFor = '';
let directoryLoading = false;
let directoryMessage = '';
let directoryItems: DirectoryEntry[] = [];
let directoryNextOffset: number | null = null;
let directorySearchTimer: ReturnType<typeof setTimeout> | null = null;
function directoryKey(revision: string, tenantId: number, search: string): string {
  return JSON.stringify([revision, tenantId, search]);
}
function resetDirectory(): void {
  directoryRequest++;
  if (directorySearchTimer) clearTimeout(directorySearchTimer);
  directorySearchTimer = null;
  directoryLoadedFor = ''; directoryLoading = false; directoryMessage = '';
  directoryItems = []; directoryNextOffset = null;
  const search = maybeById('directory-search') as HTMLInputElement | null;
  if (search) search.value = '';
  renderDirectory();
}
function directoryFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes('PHONE11_DIRECTORY_UNAUTHORIZED')) return 'Your session has expired. Sign in again to load contacts.';
  if (text.includes('PHONE11_DIRECTORY_FORBIDDEN')) return 'Your account cannot access contacts in this workspace.';
  if (text.includes('PHONE11_DIRECTORY_TENANT_MISMATCH')) return 'Phone11 could not verify the workspace for contacts.';
  if (text.includes('PHONE11_DIRECTORY_UNAVAILABLE')) return 'Contacts are unavailable in this Phone11 version.';
  if (text.includes('PHONE11_DIRECTORY_SESSION_CHANGED')) return 'Your session changed. Sign in again to load contacts.';
  return 'Contacts could not load. Refresh to try again.';
}
function renderDirectory(): void {
  const status = maybeById('directory-state');
  if (status) status.textContent = directoryMessage;
  const refresh = maybeById('directory-refresh') as HTMLButtonElement | null;
  if (refresh) refresh.disabled = directoryLoading;
  const more = maybeById('directory-more') as HTMLButtonElement | null;
  if (more) { more.hidden = directoryNextOffset === null; more.disabled = directoryLoading; }
  const list = maybeById('directory-list');
  if (!list) return;
  list.replaceChildren();
  if (!directoryLoading && !directoryMessage && directoryLoadedFor && directoryItems.length === 0) {
    const empty = document.createElement('p'); empty.className = 'empty-message';
    empty.textContent = 'No contacts found in this workspace.'; list.append(empty);
  }
  for (const item of directoryItems) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'directory-row';
    row.setAttribute('aria-label', `Use ${item.name}, extension ${item.number} on dialpad`);
    const name = document.createElement('strong'); name.textContent = item.name;
    const number = document.createElement('small'); number.textContent = `Extension ${item.number}`;
    row.append(name, number);
    row.disabled = !state?.signedIn || !!state.calling.call || busy ||
      state.calling.dialState !== 'idle' || state.calling.callActionState !== 'idle';
    row.addEventListener('click', () => {
      if (!state?.signedIn || !state.calling.registered || state.calling.call || busy ||
          state.calling.dialState !== 'idle' || state.calling.callActionState !== 'idle' ||
          directoryLoadedFor !== directoryKey(state.sessionRevision!, state.tenantId!,
            (byId('directory-search') as HTMLInputElement).value.trim())) return;
      const field = byId('destination') as HTMLInputElement;
      field.value = item.number; field.focus();
    });
    list.append(row);
  }
}
async function loadDirectory(more = false): Promise<void> {
  if (!state?.signedIn || !state.sessionRevision || !state.tenantId) return;
  const search = (byId('directory-search') as HTMLInputElement).value.trim();
  const key = directoryKey(state.sessionRevision, state.tenantId, search);
  if (more && (directoryNextOffset === null || directoryLoadedFor !== key)) return;
  const offset = more ? directoryNextOffset! : 0;
  const revision = state.sessionRevision; const tenantId = state.tenantId;
  const request = ++directoryRequest;
  directoryLoading = true; directoryMessage = 'Loading contacts…';
  if (!more) { directoryItems = []; directoryNextOffset = null; directoryLoadedFor = ''; }
  renderDirectory();
  try {
    const response = await window.phone11.directoryList(revision, search, offset);
    if (request !== directoryRequest || state?.sessionRevision !== revision || state.tenantId !== tenantId ||
        (byId('directory-search') as HTMLInputElement).value.trim() !== search) return;
    if (response.sessionRevision !== revision || response.tenantId !== tenantId) throw new Error('PHONE11_DIRECTORY_TENANT_MISMATCH');
    directoryItems = more ? [...directoryItems, ...response.items] : [...response.items];
    directoryNextOffset = response.nextOffset; directoryLoadedFor = key; directoryMessage = '';
  } catch (error) {
    if (request === directoryRequest && state?.sessionRevision === revision && state.tenantId === tenantId)
      directoryMessage = directoryFailureMessage(error);
  } finally {
    if (request === directoryRequest && state?.sessionRevision === revision && state.tenantId === tenantId) {
      directoryLoading = false; renderDirectory();
    }
  }
}
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
window.addEventListener?.('pagehide', () => { cancelHistoryReconciliation(); player?.dispose(); });
function callbackNumber(item: DesktopCallHistory): string | null {
  const candidate = item.callbackNumber;
  return candidate && /^[+0-9*#]{1,32}$/.test(candidate) ? candidate : null;
}
function renderHistory(): void {
  const scope = syncHistoryScope();
  const search = maybeById('history-search') as HTMLInputElement | null;
  if (search) { search.value = historyQuery; search.disabled = !scope; }
  const direction = maybeById('history-direction') as HTMLSelectElement | null;
  if (direction) { direction.value = historyDirection; direction.disabled = !scope; }
  const outcome = maybeById('history-outcome') as HTMLSelectElement | null;
  if (outcome) { outcome.value = historyResult; outcome.disabled = !scope; }
  const clear = maybeById('history-clear') as HTMLButtonElement | null;
  if (clear) clear.disabled = !scope || (!historyQuery && historyDirection === 'all' && historyResult === 'all');
  const visibleItems = filterHistoryItems(historyItems, historyQuery, historyDirection, historyResult);
  const count = maybeById('history-count');
  if (count) count.textContent = historyLoadedFor
    ? `Showing ${visibleItems.length} of ${historyItems.length} loaded calls.` : '';
  const status = maybeById('history-state');
  if (status) status.textContent = historyMessage;
  const refresh = maybeById('history-refresh') as HTMLButtonElement | null;
  if (refresh) refresh.disabled = historyLoading || !scope;
  const more = maybeById('history-more') as HTMLButtonElement | null;
  if (more) { more.hidden = !historyNextCursor; more.disabled = historyLoading || !historyNextCursor; }
  const list = maybeById('history-list');
  if (!list) return;
  list.setAttribute('aria-busy', String(historyLoading));
  list.replaceChildren();
  if (!historyMessage && !historyLoading && historyLoadedFor && visibleItems.length === 0) {
    const empty = document.createElement('p'); empty.className = 'empty-message';
    empty.textContent = historyItems.length === 0 ? 'No calls yet.' : historyNextCursor
      ? 'No loaded calls match. Clear search and filters, or load more calls.'
      : 'No loaded calls match. Clear search and filters to see all loaded calls.';
    list.append(empty);
  }
  for (const item of visibleItems) {
    const number = callbackNumber(item);
    const recordedOutcome = historyOutcome(item);
    const missed = recordedOutcome === 'missed';
    const row = document.createElement('button'); row.type = 'button'; row.className = 'history-row';
    row.dataset.missed = String(missed);
    const display = number || [item.callerNumber, item.calleeNumber].filter(Boolean).join(' → ') || 'Unknown caller';
    row.disabled = !number || !scope || !!state?.calling.call || busy || state?.calling.dialState !== 'idle';
    row.setAttribute('aria-label', number ? `Use ${number} on dialpad` : display);
    const icon = document.createElement('img'); icon.alt = ''; icon.src = `icons/${missed ? 'phone-missed' : item.direction === 'inbound' ? 'phone-incoming' : 'phone-outgoing'}.svg`;
    const text = document.createElement('span'); const title = document.createElement('strong'); title.textContent = display;
    const meta = document.createElement('small');
    const outcome = historyOutcomeLabel(recordedOutcome) + (recordedOutcome === 'answered' ? ` · ${item.durationSeconds}s` : '');
    meta.textContent = `${historyDirectionLabel(item.direction)} · ${outcome} · ${new Date(item.startedAt).toLocaleString()}`;
    text.append(title, meta); row.append(icon, text);
    row.addEventListener('click', () => {
      if (!number || !state?.signedIn || state.calling.call || busy || state.calling.dialState !== 'idle' ||
          historyScopeKey(state) !== scope || historyLoadedFor !== scope) return;
      const field = byId('destination') as HTMLInputElement; field.value = number; field.focus();
    }); list.append(row);
  }
}
async function loadHistory(force = false, more = false): Promise<void> {
  const scope = syncHistoryScope();
  if (historyLoading) { if (force) historyRefreshQueued = true; return; }
  if (!scope || !state?.signedIn || !state.sessionRevision ||
      (more && (!historyNextCursor || historyLoadedFor !== scope)) ||
      (!force && !more && historyLoadedFor === scope)) return;
  const revision = state.sessionRevision; const request = ++historyRequest;
  const cursor = more ? historyNextCursor! : undefined;
  if (!more) { historyItems = []; historyNextCursor = null; historyLoadedFor = ''; }
  historyLoading = true; historyMessage = more ? 'Loading older calls…' : 'Loading call history…'; renderHistory();
  try {
    if (!window.phone11.historyList) throw new Error('Unavailable');
    const response = await window.phone11.historyList(revision, cursor);
    if (request !== historyRequest || historyScopeKey(state) !== scope) return;
    if (response.sessionRevision !== revision) throw new Error('Session changed');
    const existing = new Set(historyItems.map(item => item.id));
    if (response.items.some(item => existing.has(item.id)) ||
        (cursor && response.nextCursor &&
          (response.nextCursor.startedAt > cursor.startedAt ||
            (response.nextCursor.startedAt === cursor.startedAt && response.nextCursor.id >= cursor.id))))
      throw new Error('Invalid call history page');
    historyItems = more ? [...historyItems, ...response.items] : response.items;
    historyNextCursor = response.nextCursor;
    historyLoadedFor = scope; historyMessage = '';
  } catch (error) {
    if (request === historyRequest && historyScopeKey(state) === scope)
      historyMessage = callHistoryFailureMessage(error);
  } finally {
    if (request === historyRequest && historyScopeKey(state) === scope) {
      historyLoading = false; renderHistory();
      if (historyRefreshQueued) { historyRefreshQueued = false; void loadHistory(true); }
    }
  }
}
function render(): void {
  if (!VOICEMAIL_ENABLED && currentPhoneSection === 'voicemail') currentPhoneSection = 'history';
  const voicemailTab = maybeById('voicemail-tab') as HTMLButtonElement | null;
  if (voicemailTab) voicemailTab.disabled = !VOICEMAIL_ENABLED;
  const signed = !!state?.signedIn;
  const call = signed ? state?.calling.call : null;
  // An incoming or active call must never be hidden behind an inbox or meeting tab.
  if (call) currentTab = 'phone';
  byId('login').hidden = signed;
  const picker = maybeById('tenant-picker');
  if (picker) picker.hidden = signed || !pendingSelection;
  const loginForm = maybeById('login-form');
  if (loginForm) loginForm.hidden = !!pendingSelection;
  byId('workspace').hidden = !signed;
  byId('phone').hidden = !signed || currentTab !== 'phone';
  byId('meetings').hidden = !signed || currentTab !== 'meetings';
  for (const tab of ['phone', 'meetings'] as const) {
    const button = byId(`${tab}-tab`);
    if (tab === currentTab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const section of ['history', 'directory', 'voicemail', 'lines'] as const) {
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
  renderDirectory();
  renderHistory();
  if (!signed || !state) { player?.stop(); return; }
  const phoneBusy = !!call || state.calling.dialState !== 'idle' || state.calling.callActionState !== 'idle';
  if (phoneBusy) player?.stop();
  (byId('open-meetings') as HTMLButtonElement).disabled = meetingOpening || phoneBusy;
  byId('meeting-open-message').textContent = phoneBusy
    ? 'Finish your Phone call or pending action before opening a meeting.' : meetingMessage;
  byId('identity').textContent = `Extension ${state.extensionNumber ?? 'unavailable'}`;
  const assignedExtension = maybeById('assigned-extension');
  if (assignedExtension) assignedExtension.textContent = state.extensionNumber ?? 'Extension unavailable';
  // Siprix proceeding covers any SIP 1xx response, including a proxy's 180.
  // It does not prove the recipient's device alerted, so keep this neutral.
  byId('status').textContent = call ? (call.state === 'ringing' ? 'Calling…' :
    `${call.state[0].toUpperCase()}${call.state.slice(1)} call`) :
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
  if (!VOICEMAIL_ENABLED) return;
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
  resetHistory(); renderHistory();
  const email = (byId('email') as HTMLInputElement).value;
  const passwordField = byId('password') as HTMLInputElement;
  const password = passwordField.value;
  passwordField.value = '';
  message('Signing in…');
  try {
    const result = await window.phone11.signIn(email, password);
    if (accountEpoch !== epoch) return;
    if ('selectionRevision' in result) {
      pendingSelection = result;
      selectionBusy = false;
      renderTenantChoices();
      message(''); render();
      return;
    }
    state = result; busy = false; meetingOpening = false; meetingMessage = ''; message(''); render(); void loadHistory();
  } catch (error) { if (accountEpoch === epoch) message(signInFailureMessage(error)); }
});
function renderTenantChoices(): void {
  const list = maybeById('tenant-choices');
  const back = maybeById('tenant-picker-back') as HTMLButtonElement | null;
  if (back) back.disabled = selectionBusy;
  if (!list) return;
  list.replaceChildren();
  const selection = pendingSelection;
  if (!selection) return;
  for (const tenant of selection.tenants) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'tenant-choice'; button.textContent = tenant.name;
    button.disabled = selectionBusy;
    button.addEventListener('click', async () => {
      if (pendingSelection !== selection || selectionBusy) return;
      const epoch = accountEpoch;
      selectionBusy = true; renderTenantChoices(); message('Connecting to workspace…');
      try {
        const signedIn = await window.phone11.selectTenant(selection.selectionRevision, tenant.tenantId);
        if (accountEpoch !== epoch || pendingSelection !== selection) return;
        pendingSelection = null; selectionBusy = false; state = signedIn; busy = false;
        meetingOpening = false; meetingMessage = ''; message(''); render(); void loadHistory();
      } catch (error) {
        if (accountEpoch !== epoch || pendingSelection !== selection) return;
        pendingSelection = null; selectionBusy = false;
        message(signInFailureMessage(error)); render();
      }
    });
    list.append(button);
  }
}
maybeById('tenant-picker-back')?.addEventListener('click', async () => {
  if (selectionBusy) return;
  resetHistory();
  ++accountEpoch; pendingSelection = null; selectionBusy = false; message(''); render();
  try { await window.phone11.signOut(); }
  catch { message('Sign-out could not be verified. Restart before calling.'); }
});
for (const tab of ['phone', 'meetings'] as const) {
  byId(`${tab}-tab`).addEventListener('click', () => { currentTab = tab; if (tab !== 'phone') player?.stop(); render(); });
}
for (const section of ['history', 'directory', 'voicemail', 'lines'] as const) {
  maybeById(`${section}-tab`)?.addEventListener('click', () => {
    if (section === 'voicemail' && !VOICEMAIL_ENABLED) return;
    currentPhoneSection = section;
    if (section !== 'voicemail') player?.stop();
    render();
    if (section === 'voicemail') void loadVoicemail();
    if (section === 'history') void loadHistory();
    if (section === 'directory' && !directoryLoadedFor) void loadDirectory();
  });
}
maybeById('directory-search')?.addEventListener('input', () => {
  directoryRequest++; directoryLoading = false; directoryItems = []; directoryNextOffset = null;
  directoryLoadedFor = ''; directoryMessage = ''; renderDirectory();
  if (directorySearchTimer) clearTimeout(directorySearchTimer);
  directorySearchTimer = setTimeout(() => { directorySearchTimer = null; void loadDirectory(); }, 250);
});
maybeById('directory-refresh')?.addEventListener('click', () => { void loadDirectory(); });
maybeById('directory-more')?.addEventListener('click', () => { void loadDirectory(true); });
maybeById('history-refresh')?.addEventListener('click', () => { void loadHistory(true); });
maybeById('history-more')?.addEventListener('click', () => { void loadHistory(false, true); });
maybeById('history-search')?.addEventListener('input', () => {
  historyQuery = boundedHistoryQuery((byId('history-search') as HTMLInputElement).value);
  renderHistory();
});
maybeById('history-direction')?.addEventListener('change', () => {
  const value = (byId('history-direction') as HTMLSelectElement).value;
  historyDirection = HISTORY_DIRECTIONS.find(direction => direction === value) ?? 'all';
  renderHistory();
});
maybeById('history-outcome')?.addEventListener('change', () => {
  const value = (byId('history-outcome') as HTMLSelectElement).value;
  historyResult = HISTORY_OUTCOMES.find(outcome => outcome === value) ?? 'all';
  renderHistory();
});
maybeById('history-clear')?.addEventListener('click', () => {
  clearHistoryFilters(); renderHistory(); maybeById('history-search')?.focus();
});
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
  resetHistory(); player?.stop(); resetDirectory();
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
    resetHistory(); player?.stop(); resetDirectory();
    voicemailRequest += 1; voicemailLoading = false; voicemailLoadingFor = ''; voicemailLoadedFor = ''; voicemailItems = [];
    voicemailMessage = 'Open Voicemail to load your messages.';
  }
  render();
  if (state?.calling.call) { cancelHistoryReconciliation(); historyRefreshQueued = false; }
  if (previousCall && !state?.calling.call) reconcileCompletedCall();
  if (currentPhoneSection === 'voicemail' && state?.signedIn) void loadVoicemail();
});
const initialEpoch = accountEpoch;
window.phone11.state().then(value => {
  if (accountEpoch === initialEpoch) { state = value; render(); void loadHistory(); }
}).catch(() => { if (accountEpoch === initialEpoch) message('Desktop service unavailable.'); });
