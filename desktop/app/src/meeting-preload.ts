import { ipcRenderer } from 'electron';
import { ConnectionState, Participant, Room, RoomEvent, Track, supportsAudioOutputSelection, type LocalTrack } from 'livekit-client';
import { MeetingAudioOutputSequence } from './meeting-audio-output-sequence';
import { directMeetingOptionLabel, MEETING_CHANNELS, type PublicMeetingState, type PublicMeetingDirectPage, type MeetingPhotoScope, type MeetingProfilePhoto } from './meeting-channels';
import { MeetingMediaLifecycle, PrejoinCameraPreview } from './meeting-media-lifecycle';
import { PrejoinMicrophoneCheck } from './prejoin-microphone-check';
import { MeetingVideoSlot } from './meeting-video-slot';
import { DesktopMeetingChat, DesktopMeetingPhotos, type DesktopChatSnapshot } from './meeting-room-chat';
import { channelInviteMessage, channelInviteSelectionIsValid } from './channel-invite-selection';
import { DesktopMeetingRemovalClient, removalRow, type DesktopRemovalView } from './meeting-member-removal';
import type { RemovalMember } from '../../../lib/meetings/member-removal';
import { MAX_MEETING_AVATAR_BYTES, meetingPhotoBytesMatch } from './meeting-channels';
import type { DesktopMeetingGrant, DesktopMeetingChannelDetails, DesktopMeetingDirectDetails, DesktopMeetingDirectChat } from '../../src/authenticated-provider';
import { DesktopMeetingScreenShare, screenPublishingPermitted, type ScreenShareView } from './meeting-screen-share';
import type { ScreenChoices } from './meeting-screen-picker';

// This isolated preload is the only Chromium world that receives a media grant.
// The static page has no script and no bridge exposing the token or Room.
let room: Room | null = null;
let meetingChat: DesktopMeetingChat | null = null;
let meetingPhotos: DesktopMeetingPhotos | null = null;
let chatOpen = false;
let memberRemoval: DesktopMeetingRemovalClient | null = null;
let accessOpen = false;
let confirmRemoval: RemovalMember | null = null;
let accessPhoto: ((row: RemovalMember, avatar: HTMLElement) => void) | null = null;
let revision: string | null = null;
let meetingListRequest = 0;
let refreshingMeetings = false;
let meetingsChecked = false;
let meetingSelectionRequired = false;
const admittedMeetingIds = new Set<string>();
let busy = false;
let canPublish = false;
const mediaLifecycle = new MeetingMediaLifecycle();
const prejoinCamera = new PrejoinCameraPreview();
const prejoinMicrophone = new PrejoinMicrophoneCheck();
let speakerContext: AudioContext | null = null;
let speakerOscillator: OscillatorNode | null = null;
let speakerTimer: ReturnType<typeof setTimeout> | null = null;
let leaving: Promise<void> | null = null;
let channelLoad = 0;
let startingChannel = false;
let createdChannelMeeting = false;
let selectedChannelDetails: DesktopMeetingChannelDetails | null = null;
let directLoad = 0;
let directSearchLoad = 0;
let searchingDirect = false;
let loadingDirectPage = false;
let directHasMore = false;
let directActiveSearch = '';
const directLoadedIds = new Set<string>();
let startingDirect = false;
let selectedDirectDetails: DesktopMeetingDirectDetails | null = null;
const audioOutputSequence = new MeetingAudioOutputSequence();
type ParticipantTile = {
  participant: Participant;
  camera: MeetingVideoSlot;
  tile: HTMLElement;
  media: HTMLElement;
  placeholder: HTMLElement;
  name: HTMLElement;
  audioState: HTMLElement;
  rosterEntry: HTMLLIElement;
  rosterName: HTMLElement;
  rosterState: HTMLElement;
};
const participantTiles = new Map<string, ParticipantTile>();
const screenShares = new Map<string, { slot: MeetingVideoSlot; tile: HTMLElement; caption: HTMLElement }>();
let layoutMode: 'gallery' | 'speaker' = 'gallery';
let activeSpeakerSid: string | null = null;
const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const status = (message: string) => { el('status').textContent = message; };
const error = (message: string) => { el('prejoin-error').textContent = message; };
let screenOwner: DesktopMeetingScreenShare<LocalTrack> | null = null;
let screenScope: { revision: string; roomRevision: string } | null = null;
let screenConnected = false;
let screenChoices: (ScreenChoices & { revision: string; roomRevision: string }) | null = null;
let screenListeners: (() => void) | null = null;

function renderScreen(view: ScreenShareView): void {
  const active = view.status !== 'idle';
  const button = el<HTMLButtonElement>('share-screen');
  button.hidden = !view.available && !active;
  button.disabled = active ? view.status === 'stopping' && !view.error : !view.available;
  button.textContent = active ? 'Stop sharing' : 'Share screen';
  button.setAttribute('aria-pressed', String(view.status === 'sharing'));
  el('screen-status').textContent = view.error ?? (view.status === 'sharing' ? 'You are sharing your screen · screen audio off' :
    view.status === 'choosing' ? 'Choose a screen or window. Nothing is shared until you select it.' :
    view.status === 'publishing' ? 'Starting screen sharing…' : view.status === 'stopping' ? 'Stopping screen sharing…' : '');
  if (screenScope) ipcRenderer.send(MEETING_CHANNELS.screenState, { ...screenScope,
    available: view.available && (view.status === 'idle' || view.status === 'choosing') });
}

function screenAllowed(active: Room): boolean {
  const permissions = active.localParticipant.permissions;
  const source = Track.sourceToProto(Track.Source.ScreenShare);
  return room === active && screenPublishingPermitted({ interactive: canPublish,
    connected: screenConnected && active.state === ConnectionState.Connected,
    secure: globalThis.isSecureContext === true, captureApi: typeof navigator.mediaDevices?.getDisplayMedia === 'function', permissions, source });
}

function hideScreenChoices(): void {
  const wasOpen = screenChoices !== null;
  screenChoices = null; el('screen-picker').hidden = true; el('screen-choice-list').replaceChildren();
  if (wasOpen && !el('share-screen').hidden) el('share-screen').focus();
}
function chooseScreen(handle: string | null): void {
  const choices = screenChoices;
  if (!choices || !screenScope || choices.revision !== screenScope.revision || choices.roomRevision !== screenScope.roomRevision) return;
  const request = choices.request;
  hideScreenChoices();
  if (handle === null) { void screenOwner?.stop().catch(() => undefined); return; }
  void ipcRenderer.invoke(MEETING_CHANNELS.screenChoose, { ...screenScope, request, handle }).catch(() => {
    void screenOwner?.stop().catch(() => undefined);
  });
}
function showScreenChoices(choices: (ScreenChoices & { revision: string; roomRevision: string }) | null): void {
  hideScreenChoices();
  if (!choices) return;
  if (!screenOwner || screenOwner.getSnapshot().status !== 'choosing' || !screenScope ||
      choices.revision !== screenScope.revision || choices.roomRevision !== screenScope.roomRevision || !screenOwner.getSnapshot().available) {
    if (screenScope) ipcRenderer.send(MEETING_CHANNELS.screenCancel, screenScope);
    return;
  }
  screenChoices = choices;
  const list = el('screen-choice-list');
  for (const choice of choices.choices) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = choice.name;
    button.addEventListener('click', () => { if (screenChoices === choices) chooseScreen(choice.handle); });
    list.append(button);
  }
  el('screen-picker').hidden = false; el('screen-cancel').focus();
}

function startScreenOwner(active: Room, scope: MeetingPhotoScope, current: () => boolean): void {
  screenScope = { revision: revision!, roomRevision: scope.roomRevision }; screenConnected = true;
  const owner = new DesktopMeetingScreenShare<LocalTrack>({
    allowed: () => screenAllowed(active), capture: () => active.localParticipant.createScreenTracks({ audio: false }),
    publish: track => active.localParticipant.publishTrack(track),
    unpublish: track => active.localParticipant.unpublishTrack(track, true),
    publications: () => [...active.localParticipant.trackPublications.values()].flatMap(publication =>
      publication.track && (publication.source === Track.Source.ScreenShare || publication.source === Track.Source.ScreenShareAudio) ? [publication.track] : []),
    isPublished: track => [...active.localParticipant.trackPublications.values()].some(publication => publication.track === track && !publication.isMuted),
    cancelCapture: () => { hideScreenChoices(); if (screenScope) ipcRenderer.send(MEETING_CHANNELS.screenCancel, screenScope); },
  }, () => room === active && current(), renderScreen);
  screenOwner = owner;
  const refresh = () => { if (screenOwner === owner) owner.refresh(); };
  const reconnecting = () => { screenConnected = false; refresh(); };
  const reconnected = () => { screenConnected = true; refresh(); };
  const stateChanged = () => { if (active.state !== ConnectionState.Connected) reconnecting(); else refresh(); };
  const moved = () => {
    screenConnected = false;
    void owner.retire().catch(() => undefined);
    // A provider room move has no new Phone11 admission scope. Rejoin through main.
    void ipcRenderer.invoke(MEETING_CHANNELS.finished).catch(() => undefined);
  };
  const bindings: [RoomEvent, () => void][] = [
    [RoomEvent.Reconnecting, reconnecting], [RoomEvent.SignalReconnecting, reconnecting],
    [RoomEvent.Moved, moved],
    [RoomEvent.Reconnected, reconnected], [RoomEvent.ConnectionStateChanged, stateChanged],
    [RoomEvent.ParticipantPermissionsChanged, refresh], [RoomEvent.LocalTrackPublished, refresh], [RoomEvent.LocalTrackUnpublished, refresh],
  ];
  bindings.forEach(([event, listener]) => active.on(event, listener));
  screenListeners = () => bindings.forEach(([event, listener]) => active.off(event, listener));
  owner.refresh();
}

function updateScreenShare(): void {
  const owner = screenOwner;
  if (!owner) return;
  const view = owner.getSnapshot();
  // start() invokes getDisplayMedia directly from this click; no IPC await or media queue precedes it.
  void (view.status === 'idle' ? owner.start() : owner.stop()).catch(() => undefined);
}

function showChat(open: boolean, focus = true): void {
  if (open) showAccess(false, false);
  chatOpen = open;
  el('chat-panel').hidden = !open;
  el('participant-roster').hidden = open;
  el('meeting-content').classList.toggle('chat-open', open);
  el('chat').setAttribute('aria-pressed', String(open));
  if (focus) (open ? el<HTMLTextAreaElement>('chat-text').disabled ? el('chat-messages') : el('chat-text') : el('chat')).focus();
}

function showAccess(open: boolean, focus = true): void {
  accessOpen = open;
  if (open) showChat(false, false);
  el('access-panel').hidden = !open;
  el('participant-roster').hidden = open || chatOpen;
  el('manage-access').setAttribute('aria-pressed', String(open));
  el('meeting-content').classList.toggle('access-open', open);
  if (!open) confirmRemoval = null;
  if (focus) (open ? el('access-panel') : el('manage-access')).focus();
}

function renderAccess(view: DesktopRemovalView): void {
  if (confirmRemoval && !view.members.includes(confirmRemoval)) confirmRemoval = null;
  const busy = view.loading || view.busyUserId !== null;
  el('manage-access').hidden = !view.available && !view.error;
  el<HTMLButtonElement>('refresh-access').disabled = busy;
  el('access-status').textContent = view.error ?? (view.loading ? 'Checking host permission…' :
    view.available ? 'Only the original meeting host can remove access.' : 'Meeting access controls are unavailable.');
  el('access-empty').hidden = !view.available || view.members.length > 0;
  const list = el('access-members');
  list.replaceChildren();
  const client = memberRemoval;
  for (const row of view.members) {
    const item = document.createElement('li'); item.className = 'access-member';
    const avatar = document.createElement('span'); avatar.className = 'person-avatar';
    const name = row.name ?? 'Meeting member'; avatar.textContent = name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
    accessPhoto?.(row, avatar);
    const body = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = name;
    const state = document.createElement('p'); state.textContent = row.state === 'admitted' ? 'Meeting access admitted' :
      row.state === 'pending' ? 'Access revoked · removal pending; departure is not confirmed' :
      row.state === 'completed' ? 'Access revoked · service acknowledged removal' : 'Access revoked · removal service failed';
    body.append(title, state);
    const button = (label: string, act: () => void) => {
      const action = document.createElement('button'); action.type = 'button'; action.textContent = label;
      action.setAttribute('aria-label', `${label} for ${name}`); action.disabled = busy;
      action.addEventListener('click', () => {
        if (memberRemoval === client && client?.current() && client.getSnapshot().members.includes(row)) act();
      }); body.append(action);
    };
    if (row.state === 'admitted') button('Remove meeting access', () => { confirmRemoval = row; renderAccess(client!.getSnapshot()); });
    if (row.state === 'pending') {
      button('Check status', () => { void client!.act(row, 'poll'); });
      button('Retry request', () => { void client!.act(row, 'request'); });
    }
    if (row === confirmRemoval) {
      const warning = document.createElement('p'); warning.textContent = 'Permanently block this membership from rejoining and request removal? A pending request does not confirm the member has left.';
      body.append(warning);
      button('Confirm permanent removal', () => { confirmRemoval = null; void client!.act(row, 'request'); });
      button('Cancel removal', () => { confirmRemoval = null; renderAccess(client!.getSnapshot()); });
    }
    item.append(avatar, body); list.append(item);
  }
}

function clearAccess(): void {
  const client = memberRemoval; memberRemoval = null;
  accessPhoto = null; confirmRemoval = null;
  client?.dispose(); showAccess(false, false);
  el('manage-access').hidden = true; el('access-members').replaceChildren();
}

function startAccess(active: Room, scope: MeetingPhotoScope, current: () => boolean): void {
  clearAccess();
  const binding = { revision, roomRevision: scope.roomRevision };
  const client = new DesktopMeetingRemovalClient(() => room === active && current() && active.state === ConnectionState.Connected,
    { refresh: () => ipcRenderer.invoke(MEETING_CHANNELS.hostControls, binding),
      act: (row, mode) => ipcRenderer.invoke(mode === 'request' ? MEETING_CHANNELS.removeMember : MEETING_CHANNELS.removalStatus, { ...binding, row }),
      retire: () => ipcRenderer.send(MEETING_CHANNELS.retireControls, binding) }, renderAccess);
  memberRemoval = client;
  // Observe loss synchronously. A later connected event cannot restore this controller.
  const check = () => { if (!client.current()) { active.off(RoomEvent.ConnectionStateChanged, check); showAccess(false, false); } };
  active.on(RoomEvent.ConnectionStateChanged, check);
  active.once(RoomEvent.Disconnected, () => { active.off(RoomEvent.ConnectionStateChanged, check); client.dispose(); });
  const photos = new Map<number, Promise<string | null>>();
  accessPhoto = (row, avatar) => {
    if (!client.current()) return;
    let photo = photos.get(row.userId);
    if (!photo) {
      photo = ipcRenderer.invoke(MEETING_CHANNELS.memberPhoto, { ...binding, row: removalRow(row) }).then((value: MeetingProfilePhoto | null) => {
        if (!client.current() || !value || value.identity !== `p11-t${scope.tenantId}-u${row.userId}` ||
            !(value.bytes instanceof Uint8Array) || value.bytes.length > MAX_MEETING_AVATAR_BYTES ||
            !meetingPhotoBytesMatch(value.bytes, value.mimeType)) return null;
        return `data:${value.mimeType};base64,${btoa(String.fromCharCode(...value.bytes))}`;
      }).catch(() => null);
      photos.set(row.userId, photo);
    }
    void photo.then(src => {
      if (!src || memberRemoval !== client || !client.current() || !client.getSnapshot().members.includes(row)) return;
      const image = document.createElement('img'); image.alt = ''; image.src = src;
      avatar.replaceChildren(image);
    });
  };
  void client.refresh();
}

function renderChat(snapshot: DesktopChatSnapshot): void {
  const list = el('chat-messages');
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  // Retain existing entries so permission updates do not re-announce the log.
  const existing = new Map(Array.from(list.children).map(node => [(node as HTMLElement).dataset.key, node]));
  const keys = new Set<string>();
  for (const message of snapshot.messages) {
    const key = `${message.senderIdentity}:${message.id}`;
    keys.add(key);
    const retained = existing.get(key) as HTMLElement | undefined;
    if (retained) { applyAvatar(retained.querySelector('.person-avatar') as HTMLElement, message.senderIdentity, message.senderName); continue; }
    const entry = document.createElement('li');
    entry.dataset.key = key;
    entry.className = 'chat-message';
    const avatar = document.createElement('span');
    avatar.className = 'person-avatar';
    applyAvatar(avatar, message.senderIdentity, message.senderName);
    const body = document.createElement('div');
    const sender = document.createElement('strong');
    sender.textContent = message.senderName;
    const text = document.createElement('p');
    text.textContent = message.text;
    body.append(sender, text);
    entry.append(avatar, body);
    list.appendChild(entry);
  }
  for (const [key, node] of existing) if (!key || !keys.has(key)) node.remove();
  if (nearBottom) list.scrollTop = list.scrollHeight;
  el('chat-empty').hidden = snapshot.messages.length > 0;
  el<HTMLTextAreaElement>('chat-text').disabled = !snapshot.canSend || snapshot.sending;
  el<HTMLButtonElement>('chat-send').disabled = !snapshot.canSend || snapshot.sending || !el<HTMLTextAreaElement>('chat-text').value.trim();
  el('chat-access').textContent = snapshot.canSend ? 'Everyone in this meeting' : 'Chat is receive-only while sending is unavailable.';
  el('chat-status').textContent = snapshot.error ?? (snapshot.sending ? 'Sending…' : '');
}

function clearChat(): void {
  meetingPhotos?.dispose();
  meetingPhotos = null;
  const previous = meetingChat;
  meetingChat = null;
  previous?.dispose();
  el('chat-messages').replaceChildren();
  el<HTMLTextAreaElement>('chat-text').value = '';
  el<HTMLTextAreaElement>('chat-text').disabled = true;
  el<HTMLButtonElement>('chat-send').disabled = true;
  el('chat-status').textContent = '';
  el('chat-empty').hidden = false;
  showChat(false, false);
}

function applyAvatar(avatar: HTMLElement, identity: string, name: string): void {
  if (!avatar.firstChild) {
    const fallback = document.createElement('span');
    fallback.className = 'person-initials';
    avatar.appendChild(fallback);
  }
  const fallback = avatar.querySelector('.person-initials') as HTMLElement;
  fallback.textContent = initials(name);
  avatar.setAttribute('role', 'img');
  avatar.setAttribute('aria-label', `${name} initials`);
  const photo = meetingPhotos?.get(identity);
  const image = avatar.querySelector('img');
  if (!photo) { image?.remove(); fallback.hidden = false; return; }
  if (image) { if (!image.hidden) avatar.setAttribute('aria-label', `${name} profile photo`); return; }
  const owner = meetingPhotos;
  const next = document.createElement('img');
  next.alt = '';
  next.hidden = true;
  next.addEventListener('load', () => {
    if (meetingPhotos !== owner || owner?.get(identity) !== photo || !avatar.contains(next)) return;
    if (!next.naturalWidth || !next.naturalHeight || next.naturalWidth > 2048 || next.naturalHeight > 2048) return;
    next.hidden = false;
    fallback.hidden = true;
    avatar.setAttribute('aria-label', `${name} profile photo`);
  }, { once: true });
  next.addEventListener('error', () => { if (meetingPhotos === owner && avatar.contains(next)) { next.hidden = true; fallback.hidden = false; } }, { once: true });
  let binary = '';
  for (let offset = 0; offset < photo.bytes.length; offset += 8192) binary += String.fromCharCode(...photo.bytes.subarray(offset, offset + 8192));
  next.src = `data:${photo.mimeType};base64,${btoa(binary)}`;
  avatar.appendChild(next);
}

async function sendChat(): Promise<void> {
  const active = meetingChat;
  const input = el<HTMLTextAreaElement>('chat-text');
  if (!active || input.disabled) return;
  const text = input.value;
  const sent = await active.send(text);
  if (meetingChat !== active) return;
  if (sent && input.value === text) input.value = '';
  renderChat(active.getSnapshot());
  if (chatOpen && !input.disabled) input.focus();
}

function updatePrejoinState(): void {
  const mic = el<HTMLInputElement>('start-mic').checked ? 'on' : 'off';
  const camera = el<HTMLInputElement>('start-camera').checked ? 'on' : 'off';
  el('join-media-state').textContent = `Microphone ${mic} at join · Camera ${camera} at join`;
}

function resetAudioOutput(): void {
  audioOutputSequence.reset();
  const select = el<HTMLSelectElement>('audio-output');
  select.replaceChildren(new Option('System default', 'default'));
  select.disabled = true;
  el('audio-output-status').textContent = '';
}

async function refreshAudioOutputs(): Promise<void> {
  // A devicechange during switchActiveDevice must not re-enable the selector
  // before that SDK operation settles. Refresh against the final route instead.
  const revision = audioOutputSequence.beginRefresh();
  if (revision === null) return;
  const active = room;
  const select = el<HTMLSelectElement>('audio-output');
  if (!active || !supportsAudioOutputSelection()) {
    select.disabled = true;
    if (active) el('audio-output-status').textContent = 'Use your system sound settings to change speaker.';
    return;
  }
  try {
    // The meeting preload keeps device IDs local; no device metadata crosses IPC.
    const devices = await Room.getLocalDevices('audiooutput', false);
    if (room !== active || !audioOutputSequence.isCurrent(revision)) return;
    const options = [new Option('System default', 'default')];
    const seen = new Set(['default']);
    for (const device of devices) {
      if (!device.deviceId || seen.has(device.deviceId)) continue;
      seen.add(device.deviceId);
      options.push(new Option(device.label || `Speaker ${options.length}`, device.deviceId));
    }
    select.replaceChildren(...options);
    const currentDevice = active.getActiveDevice('audiooutput') ?? 'default';
    select.value = seen.has(currentDevice) ? currentDevice : 'default';
    select.disabled = false;
    el('audio-output-status').textContent = '';
  } catch {
    if (room !== active || !audioOutputSequence.isCurrent(revision)) return;
    select.disabled = true;
    el('audio-output-status').textContent = 'Speakers could not be listed. Use your system sound settings.';
  }
}

async function changeAudioOutput(): Promise<void> {
  const active = room;
  const select = el<HTMLSelectElement>('audio-output');
  if (!active || select.disabled) return;
  const revision = audioOutputSequence.beginSwitch();
  if (revision === null) return;
  const deviceId = select.value;
  // Invalidate an enumeration already awaiting the browser before it can
  // re-enable the selector during this switch.
  select.disabled = true;
  el('audio-output-status').textContent = 'Changing speaker…';
  try { await mediaLifecycle.run(async current => {
    try {
      const changed = await active.switchActiveDevice('audiooutput', deviceId);
      if (!current() || room !== active || !audioOutputSequence.isCurrent(revision)) return;
      el('audio-output-status').textContent = changed ? 'Speaker changed' : 'Could not change speaker. Check system sound settings.';
    } catch {
      if (!current() || room !== active || !audioOutputSequence.isCurrent(revision)) return;
      el('audio-output-status').textContent = 'Could not change speaker. Check system sound settings.';
    } finally {
      if (current() && room === active && audioOutputSequence.isCurrent(revision)) {
        const currentDevice = active.getActiveDevice('audiooutput') ?? 'default';
        select.value = Array.from(select.options).some(option => option.value === currentDevice) ? currentDevice : 'default';
        select.disabled = false;
      }
    }
  }).catch(() => undefined); }
  finally {
    if (audioOutputSequence.finishSwitch() && room === active) {
      void refreshAudioOutputs();
    }
  }
}

function clearPreview(): void {
  prejoinCamera.stop();
  const video = el<HTMLVideoElement>('prejoin-video');
  video.srcObject = null;
  video.hidden = true;
  el('preview-empty').hidden = false;
}

function stopSpeakerTest(): void {
  if (speakerTimer) clearTimeout(speakerTimer);
  speakerTimer = null;
  try { speakerOscillator?.stop(); } catch { /* The short test tone may already have ended. */ }
  try { speakerOscillator?.disconnect(); } catch { /* Context teardown continues. */ }
  speakerOscillator = null;
  const context = speakerContext;
  speakerContext = null;
  if (context) void context.close().catch(() => undefined);
  const button = el<HTMLButtonElement>('test-speaker');
  button.textContent = 'Play test sound';
  button.setAttribute('aria-pressed', 'false');
}

function stopPrejoinAudio(): void {
  prejoinMicrophone.stop(handle => cancelAnimationFrame(handle));
  stopSpeakerTest();
  const meter = el<HTMLDivElement>('mic-level').parentElement as HTMLDivElement;
  meter.setAttribute('aria-valuenow', '0');
  el('mic-level').style.width = '0%';
  el<HTMLButtonElement>('test-microphone').textContent = 'Test microphone';
  el<HTMLButtonElement>('test-microphone').setAttribute('aria-pressed', 'false');
}

async function playSpeakerTest(): Promise<void> {
  if (busy || room) return;
  if (speakerContext) {
    stopSpeakerTest();
    el('audio-check-status').textContent = 'Test sound stopped';
    return;
  }
  stopPrejoinAudio();
  try {
    const context = new AudioContext();
    speakerContext = context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 440;
    // Soft pulses are easier to recognize than a single click and still stop immediately.
    gain.gain.setValueAtTime(0, context.currentTime);
    for (const offset of [0, 0.8, 1.6]) {
      gain.gain.setValueAtTime(0, context.currentTime + offset);
      gain.gain.linearRampToValueAtTime(0.09, context.currentTime + offset + 0.04);
      gain.gain.setValueAtTime(0.09, context.currentTime + offset + 0.36);
      gain.gain.linearRampToValueAtTime(0, context.currentTime + offset + 0.42);
    }
    oscillator.connect(gain);
    gain.connect(context.destination);
    await context.resume();
    if (speakerContext !== context || busy || room) return;
    speakerOscillator = oscillator;
    oscillator.start();
    const button = el<HTMLButtonElement>('test-speaker');
    button.textContent = 'Stop test sound';
    button.setAttribute('aria-pressed', 'true');
    el('audio-check-status').textContent = 'Playing through your system sound output. Can you hear it?';
    speakerTimer = setTimeout(() => {
      stopSpeakerTest();
      el('audio-check-status').textContent = 'Test sound ended. If you heard nothing, check your system sound output.';
    }, 2500);
  } catch {
    stopSpeakerTest();
    el('audio-check-status').textContent = 'Test sound is unavailable. Check your system audio output.';
  }
}

async function testMicrophone(): Promise<void> {
  if (busy || room) return;
  const button = el<HTMLButtonElement>('test-microphone');
  if (button.getAttribute('aria-pressed') === 'true') {
    stopPrejoinAudio();
    el('audio-check-status').textContent = 'Microphone test stopped';
    return;
  }
  stopPrejoinAudio();
  button.textContent = 'Cancel microphone test';
  button.setAttribute('aria-pressed', 'true');
  el('audio-check-status').textContent = 'Requesting microphone access…';
  try {
    const started = await prejoinMicrophone.start(
      () => navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
      () => new AudioContext(),
      callback => requestAnimationFrame(callback),
      handle => cancelAnimationFrame(handle),
      level => {
        const meter = el<HTMLDivElement>('mic-level').parentElement as HTMLDivElement;
        meter.setAttribute('aria-valuenow', String(level));
        el('mic-level').style.width = `${level}%`;
      },
    );
    if (!started || busy || room) return;
    button.textContent = 'Stop microphone test';
    button.setAttribute('aria-pressed', 'true');
    el('audio-check-status').textContent = 'Speak now. Audio is not recorded or sent.';
  } catch (cause) {
    button.textContent = 'Test microphone';
    button.setAttribute('aria-pressed', 'false');
    const denied = cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'PermissionDeniedError');
    el('audio-check-status').textContent = denied
      ? 'Microphone permission denied. Allow access in system settings.'
      : 'Microphone test unavailable. Check your microphone and permissions.';
  }
}

async function changePrejoinCamera(): Promise<void> {
  const choice = el<HTMLInputElement>('start-camera');
  clearPreview();
  updatePrejoinState();
  if (!choice.checked || busy || room) {
    el('preview-message').textContent = 'Camera is off';
    return;
  }
  error('');
  el('preview-message').textContent = 'Requesting camera access…';
  await mediaLifecycle.run(async current => {
    if (!current() || !choice.checked || busy || room) return;
    try {
      const stream = await prejoinCamera.start(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
      if (!stream || !current() || !choice.checked || busy || room) return;
      const video = el<HTMLVideoElement>('prejoin-video');
      video.srcObject = stream;
      video.hidden = false;
      el('preview-empty').hidden = true;
    } catch (cause) {
      if (!current() || !choice.checked || busy || room) return;
      choice.checked = false;
      updatePrejoinState();
      const denied = cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'PermissionDeniedError');
      error(denied
        ? 'Camera permission denied. Allow camera access in system settings, or join with camera off.'
        : 'Camera preview is unavailable. Check your camera, or join with camera off.');
      el('preview-message').textContent = 'Camera is off';
    }
  }).catch(() => undefined);
}

function participantKey(participant: Participant): string {
  return participant.sid || participant.identity;
}

export function participantName(participant: Participant): string {
  if (participant.isLocal) return 'You';
  const name = participant.name?.trim();
  const identity = participant.identity.trim();
  if (!name || name.toLowerCase() === identity.toLowerCase()) return 'Participant';
  // Provider identities can be copied into `name` when no display name exists.
  if (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(name) ||
      /^[0-9a-f]{16,}(?:::|$)/i.test(name) || /^p11-t\d+-u\d+$/i.test(name)) {
    return 'Participant';
  }
  return name;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2)).toUpperCase();
}

function detachTrack(track?: { detach: () => HTMLElement[] }): void {
  try { track?.detach().forEach(element => element.remove()); }
  catch { /* Renderer cleanup continues even if LiveKit already disposed the track. */ }
}

function createParticipantTile(participant: Participant): ParticipantTile {
  const tile = document.createElement('article');
  tile.className = 'participant-tile';
  tile.setAttribute('aria-label', participantName(participant));
  const media = document.createElement('div');
  media.className = 'tile-media';
  const placeholder = document.createElement('span');
  placeholder.className = 'tile-placeholder person-avatar';
  placeholder.setAttribute('aria-hidden', 'true');
  media.appendChild(placeholder);
  const caption = document.createElement('div');
  caption.className = 'tile-caption';
  const name = document.createElement('span');
  name.className = 'tile-name';
  const audioState = document.createElement('span');
  audioState.className = 'tile-audio-state';
  caption.append(name, audioState);
  tile.append(media, caption);

  const rosterEntry = document.createElement('li');
  rosterEntry.className = 'roster-entry';
  const avatar = document.createElement('span');
  avatar.className = 'person-avatar';
  const rosterName = document.createElement('span');
  rosterName.className = 'roster-name';
  const rosterState = document.createElement('span');
  rosterState.className = 'roster-media';
  rosterEntry.append(avatar, rosterName, rosterState);
  return { participant, camera: new MeetingVideoSlot(), tile, media, placeholder, name, audioState, rosterEntry, rosterName, rosterState };
}

function renderLayout(): void {
  const gallery = el('gallery-grid');
  const speakerView = el('speaker-view');
  const tiles = [...participantTiles.entries()];
  const selected = tiles.find(([key]) => key === activeSpeakerSid) ?? tiles[0];
  const galleryButton = el<HTMLButtonElement>('layout-gallery');
  const speakerButton = el<HTMLButtonElement>('layout-speaker');
  galleryButton.setAttribute('aria-pressed', String(layoutMode === 'gallery'));
  speakerButton.setAttribute('aria-pressed', String(layoutMode === 'speaker'));
  gallery.hidden = layoutMode !== 'gallery';
  speakerView.hidden = layoutMode !== 'speaker';
  if (layoutMode === 'gallery') {
    gallery.replaceChildren(...tiles.map(([, item]) => item.tile));
    el('stage').setAttribute('aria-label', 'Meeting video, gallery view');
  } else {
    const main = el('speaker-main');
    const strip = el('speaker-strip');
    main.replaceChildren();
    strip.replaceChildren();
    if (selected) main.appendChild(selected[1].tile);
    for (const [key, item] of tiles) if (!selected || key !== selected[0]) strip.appendChild(item.tile);
    el('stage').setAttribute('aria-label', 'Meeting video, speaker view');
  }
  el('empty-stage').hidden = tiles.length > 0;
}

function attachCamera(participant: Participant, item: ParticipantTile): void {
  const publication = participant.getTrackPublication(Track.Source.Camera);
  const track = participant.isCameraEnabled ? publication?.videoTrack : undefined;
  item.camera.update(track, video => {
    video.className = 'participant-video';
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-label', `${participantName(participant)} video`);
    if (participant.isLocal) { video.id = 'self-preview'; video.muted = true; }
    item.media.appendChild(video);
  });
  item.media.classList.toggle('has-video', Boolean(track));
  applyAvatar(item.placeholder, participant.identity, participantName(participant));
}

function syncScreenShares(participants: Participant[]): void {
  const live = new Set<string>();
  for (const participant of participants) {
    const publication = participant.getTrackPublication(Track.Source.ScreenShare);
    const track = publication?.isMuted ? undefined : publication?.videoTrack;
    if (!track) continue;
    const key = participantKey(participant);
    live.add(key);
    let share = screenShares.get(key);
    if (!share) {
      const tile = document.createElement('article');
      tile.className = 'screen-share';
      const caption = document.createElement('div');
      caption.className = 'tile-caption';
      tile.appendChild(caption);
      share = { slot: new MeetingVideoSlot(), tile, caption };
      screenShares.set(key, share);
      el('screen-shares').appendChild(tile);
    }
    share.caption.textContent = `${participantName(participant)} is sharing`;
    const tile = share.tile;
    share.slot.update(track, video => {
      video.setAttribute('playsinline', '');
      video.setAttribute('aria-label', `${participantName(participant)} shared screen`);
      video.muted = true;
      tile.prepend(video);
    });
  }
  for (const [key, share] of screenShares) {
    if (live.has(key)) continue;
    share.slot.clear();
    share.tile.remove();
    screenShares.delete(key);
  }
  el('screen-shares').hidden = screenShares.size === 0;
}

function syncParticipants(): void {
  if (!room) return;
  const participants = [room.localParticipant, ...room.remoteParticipants.values()];
  syncScreenShares(participants);
  const liveKeys = new Set(participants.map(participantKey));
  for (const [key, item] of participantTiles) {
    if (liveKeys.has(key)) continue;
    for (const publication of item.participant.trackPublications.values()) {
      detachTrack(publication.track);
    }
    item.camera.clear();
    item.tile.remove();
    item.rosterEntry.remove();
    participantTiles.delete(key);
  }
  const list = el('participant-list');
  for (const participant of participants) {
    const key = participantKey(participant);
    const item = participantTiles.get(key) ?? createParticipantTile(participant);
    item.participant = participant;
    const name = participantName(participant);
    item.tile.setAttribute('aria-label', `${name}${participant.isSpeaking ? ', speaking' : ''}`);
    item.name.textContent = name;
    item.rosterName.textContent = name;
    applyAvatar(item.rosterEntry.querySelector('.person-avatar') as HTMLElement, participant.identity, name);
    const micState = participant.isMicrophoneEnabled ? 'Mic on' : 'Mic off';
    const cameraState = participant.isCameraEnabled ? 'Camera on' : 'Camera off';
    item.audioState.textContent = `${micState} · ${cameraState}`;
    item.rosterState.textContent = `${micState} · ${cameraState}`;
    item.rosterState.setAttribute('aria-label', `${name}: ${micState}, ${cameraState}`);
    item.tile.classList.toggle('is-speaking', participant.isSpeaking);
    item.rosterEntry.classList.toggle('is-speaking', participant.isSpeaking);
    attachCamera(participant, item);
    if (!participantTiles.has(key)) {
      participantTiles.set(key, item);
      list.appendChild(item.rosterEntry);
    }
  }
  if (!participantTiles.has(activeSpeakerSid ?? '')) {
    activeSpeakerSid = participants.find(participant => !participant.isLocal)?.sid ?? participantKey(room.localParticipant);
  }
  el('roster-count').textContent = String(participants.length);
  el('participant-count').textContent = `${participants.length} participant${participants.length === 1 ? '' : 's'}`;
  renderLayout();
}

function clearParticipantUi(): void {
  syncScreenShares([]);
  for (const item of participantTiles.values()) {
    item.camera.clear();
    for (const publication of item.participant.trackPublications.values()) {
      detachTrack(publication.track);
    }
  }
  participantTiles.clear();
  el('gallery-grid').replaceChildren();
  el('speaker-main').replaceChildren();
  el('speaker-strip').replaceChildren();
  el('participant-list').replaceChildren();
  el('roster-count').textContent = '0';
  el('participant-count').textContent = 'You';
  el('empty-stage').hidden = false;
}

function updateRoomUi(): void {
  if (!room) return;
  const local = room.localParticipant;
  syncParticipants();
  const mic = el<HTMLButtonElement>('mic');
  const camera = el<HTMLButtonElement>('camera');
  el<HTMLButtonElement>('enable-audio').hidden = room.canPlaybackAudio;
  mic.disabled = !canPublish || busy;
  camera.disabled = !canPublish || busy;
  mic.textContent = local.isMicrophoneEnabled ? 'Mute' : 'Unmute';
  camera.textContent = local.isCameraEnabled ? 'Stop video' : 'Start video';
  el('media-note').textContent = canPublish
    ? `Microphone ${local.isMicrophoneEnabled ? 'on' : 'off'} · Camera ${local.isCameraEnabled ? 'on' : 'off'}`
    : 'Listening only';
}

function attachRemote(track: { kind: Track.Kind; attach: () => HTMLElement }, _participant: Participant): void {
  if (track.kind === Track.Kind.Audio) el('remote-audio').appendChild(track.attach());
  else if (track.kind === Track.Kind.Video) syncParticipants();
}

function leave(): Promise<void> {
  if (leaving) return leaving;
  invalidateMeetingList();
  el<HTMLButtonElement>('refresh-meetings').disabled = true;
  const active = room;
  screenConnected = false;
  screenListeners?.(); screenListeners = null;
  const screensStopped = screenOwner?.retire();
  // Attach immediately even while another media operation is still draining.
  const screenCleanup = screensStopped ? Promise.allSettled([screensStopped]) : Promise.resolve([]);
  // Main cancels its pending picker immediately; the owner still drains late capture/publication.
  if (screenScope) ipcRenderer.send(MEETING_CHANNELS.screenState, { ...screenScope, available: false });
  room = null;
  canPublish = false;
  clearAccess();
  clearChat();
  resetAudioOutput();
  clearPreview();
  stopPrejoinAudio();
  el<HTMLInputElement>('start-mic').checked = false;
  el<HTMLInputElement>('start-camera').checked = false;
  updatePrejoinState();
  el('preview-message').textContent = 'Camera is off';
  leaving = (async () => {
    // In-flight getUserMedia/publish must settle before disconnect and the main-process ack.
    await mediaLifecycle.cancelAndDrain();
    await prejoinCamera.stopAndDrain();
    const screenResults = await screenCleanup;
    if (active) {
      try { await active.disconnect(true); } catch { /* Window teardown remains authoritative. */ }
    }
    if (screenResults.some(result => result.status === 'rejected')) throw new Error('Screen cleanup requires window closure');
    clearParticipantUi();
    screenOwner = null; screenScope = null; hideScreenChoices(); renderScreen({ available: false, status: 'idle', error: null });
    busy = false;
    el('remote-audio').replaceChildren();
    el('room').hidden = true;
    el('prejoin').hidden = false;
  })();
  return leaving;
}

function closeMeeting(): void {
  status('Leaving…');
  // Invalidate pending admission/media now. The main owner bounds the cleanup
  // wait and destroys this window if an OS prompt or connection never settles.
  void leave().catch(() => undefined);
  void ipcRenderer.invoke(MEETING_CHANNELS.finished).catch(() => undefined);
}

async function join(): Promise<void> {
  if (busy || room || !revision || refreshingMeetings || startingChannel || startingDirect || leaving || !meetingsChecked) return;
  const select = el<HTMLSelectElement>('meeting-select');
  const meetingId = select.value;
  if (!admittedMeetingIds.has(meetingId)) return;
  const wantsMic = el<HTMLInputElement>('start-mic').checked;
  const wantsCamera = el<HTMLInputElement>('start-camera').checked;
  busy = true;
  invalidateMeetingList();
  updateMeetingListControls();
  select.disabled = true;
  el<HTMLButtonElement>('join').disabled = true;
  el<HTMLInputElement>('start-mic').disabled = true;
  el<HTMLInputElement>('start-camera').disabled = true;
  error('');
  status('Joining…');
  // Stop local prejoin checks synchronously before requesting admission or meeting media.
  stopPrejoinAudio();
  await mediaLifecycle.run(async current => {
  let next: Room | null = null;
  let connected = false;
  try {
    clearPreview();
    await prejoinCamera.stopAndDrain();
    if (!current()) return;
    const grant = await ipcRenderer.invoke(MEETING_CHANNELS.join, { meetingId, revision }) as DesktopMeetingGrant & { photoScope?: MeetingPhotoScope };
    if (!current()) return;
    if (!grant || typeof grant.url !== 'string' || typeof grant.token !== 'string' ||
        grant.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('Invalid admission');
    next = new Room({ adaptiveStream: true, dynacast: true });
    room = next;
    next.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (room === next && current()) attachRemote(track, participant);
    });
    next.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      if (room !== next || !current()) return;
      detachTrack(track);
      syncParticipants();
      void participant;
    });
    next.on(RoomEvent.TrackPublished, (_publication, participant) => {
      if (room === next && current()) syncParticipants();
      void participant;
    });
    next.on(RoomEvent.TrackUnpublished, (publication, participant) => {
      if (room !== next || !current()) return;
      detachTrack(publication.track);
      syncParticipants();
      void participant;
    });
    next.on(RoomEvent.TrackMuted, (_publication, participant) => {
      if (room === next && current()) syncParticipants();
      void participant;
    });
    next.on(RoomEvent.TrackUnmuted, (_publication, participant) => {
      if (room === next && current()) syncParticipants();
      void participant;
    });
    next.on(RoomEvent.ParticipantConnected, () => { if (room === next && current()) syncParticipants(); });
    next.on(RoomEvent.ParticipantDisconnected, participant => {
      if (room !== next || !current()) return;
      const item = participantTiles.get(participantKey(participant));
      for (const publication of participant.trackPublications.values()) {
        detachTrack(publication.track);
      }
      item?.camera.clear();
      item?.tile.remove();
      item?.rosterEntry.remove();
      participantTiles.delete(participantKey(participant));
      syncParticipants();
    });
    next.on(RoomEvent.ActiveSpeakersChanged, speakers => {
      if (room !== next || !current()) return;
      activeSpeakerSid = speakers[0] ? participantKey(speakers[0]) : activeSpeakerSid;
      syncParticipants();
    });
    next.on(RoomEvent.ParticipantNameChanged, () => {
      if (room === next && current()) syncParticipants();
    });
    next.on(RoomEvent.Disconnected, () => {
      // LiveKit also emits Disconnected before rejecting an initial connect.
      // That failure belongs to the retry path below, not permanent teardown.
      if (connected && room === next && current()) {
        status('Meeting disconnected');
        void leave().catch(() => undefined);
        void ipcRenderer.invoke(MEETING_CHANNELS.finished).catch(() => undefined);
      }
    });
    await next.connect(grant.url, grant.token, { autoSubscribe: true });
    if (!current() || room !== next) return;
    connected = true;
    canPublish = grant.grantProfile === 'interactive';
    clearChat();
    const chatRoom = next;
    const photoScope = grant.photoScope;
    if (photoScope && canPublish) startScreenOwner(chatRoom, photoScope, current);
    if (photoScope) startAccess(chatRoom, photoScope, current);
    if (photoScope) meetingPhotos = new DesktopMeetingPhotos(chatRoom, photoScope,
      () => room === chatRoom && current(),
      (localIdentity, identity) => ipcRenderer.invoke(MEETING_CHANNELS.photo,
        { revision, roomRevision: photoScope.roomRevision, localIdentity, identity }) as Promise<MeetingProfilePhoto | null>,
      () => { if (room === chatRoom && current()) { if (meetingChat) renderChat(meetingChat.getSnapshot()); syncParticipants(); } });
    meetingChat = new DesktopMeetingChat(chatRoom, canPublish,
      () => room === chatRoom && current(), renderChat);
    // The Join click supplies the user gesture needed for Chromium audio playback.
    try { await next.startAudio(); }
    catch { if (current()) status('Connected. Tap Enable audio to hear participants.'); }
    if (!current() || room !== next) return;
    if (canPublish) {
      try { if (wantsMic) await next.localParticipant.setMicrophoneEnabled(true); }
      catch { if (current()) status('Joined, but microphone access is unavailable.'); }
      if (!current() || room !== next) return;
      try { if (wantsCamera) await next.localParticipant.setCameraEnabled(true); }
      catch { if (current()) status('Joined, but camera access is unavailable.'); }
      if (!current() || room !== next) return;
    }
    el('prejoin').hidden = true;
    el('room').hidden = false;
    el('title').textContent = 'In meeting';
    activeSpeakerSid = participantKey(next.localParticipant);
    if (el('status').textContent === 'Joining…') status('Connected');
    updateRoomUi();
    void refreshAudioOutputs();
  } catch {
    if (!current()) return;
    room = null;
    canPublish = false;
    clearChat();
    clearAccess();
    if (next) {
      try { await next.disconnect(true); }
      catch {
        // A room whose media cleanup failed cannot be safely kept open for retry.
        void ipcRenderer.invoke(MEETING_CHANNELS.finished).catch(() => undefined);
        return;
      }
    }
    if (!current()) return;
    clearParticipantUi();
    el('remote-audio').replaceChildren();
    try { await ipcRenderer.invoke(MEETING_CHANNELS.joinFailed); } catch { /* The window may be closing. */ }
    if (!current()) return;
    el<HTMLInputElement>('start-camera').checked = false;
    updatePrejoinState();
    el('preview-message').textContent = 'Camera is off';
    error('Could not join this meeting. Check your connection and try again.');
    status('Could not join');
  } finally {
    busy = false;
    if (current()) {
      updateMeetingListControls();
      el<HTMLInputElement>('start-mic').disabled = false;
      el<HTMLInputElement>('start-camera').disabled = false;
      updateRoomUi();
    }
  }
  }).catch(() => undefined);
}

async function toggle(kind: 'mic' | 'camera'): Promise<void> {
  const active = room;
  if (!active || !canPublish || busy) return;
  busy = true;
  updateRoomUi();
  await mediaLifecycle.run(async current => {
  try {
    if (kind === 'mic') await active.localParticipant.setMicrophoneEnabled(!active.localParticipant.isMicrophoneEnabled);
    else await active.localParticipant.setCameraEnabled(!active.localParticipant.isCameraEnabled);
    if (current() && room === active) status('Connected');
  } catch { if (current()) status(kind === 'mic' ? 'Microphone could not be changed' : 'Camera could not be changed'); }
  finally { busy = false; if (current()) updateRoomUi(); }
  }).catch(() => undefined);
}

async function loadChannelDetails(): Promise<void> {
  const sequence = ++channelLoad;
  const channelId = el<HTMLSelectElement>('channel-select').value;
  selectedChannelDetails = null;
  el('invite-members').replaceChildren();
  el<HTMLFieldSetElement>('invite-picker').disabled = true;
  el<HTMLButtonElement>('start-channel-meeting').disabled = true;
  if (!revision || !channelId) return;
  el('meet-now-message').textContent = 'Checking channel members…';
  try {
    const details = await ipcRenderer.invoke(MEETING_CHANNELS.channelDetails,
      { channelId, revision }) as DesktopMeetingChannelDetails;
    if (sequence !== channelLoad || createdChannelMeeting || channelId !== el<HTMLSelectElement>('channel-select').value ||
        details.channelId !== channelId) return;
    selectedChannelDetails = details;
    const list = el('invite-members');
    for (const member of details.members) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = String(member.id);
      checkbox.checked = true;
      label.append(checkbox, document.createTextNode(member.name));
      list.appendChild(label);
    }
    el<HTMLFieldSetElement>('invite-picker').disabled = !details.canStart || startingChannel;
    el<HTMLButtonElement>('start-channel-meeting').disabled = !details.canStart || startingChannel ||
      !channelInviteSelectionIsValid(details.members.length);
    el('meet-now-message').textContent = details.canStart
      ? channelInviteMessage(details.members.length, details.members.length)
      : 'You cannot start a meeting in this channel.';
  } catch {
    if (sequence === channelLoad) el('meet-now-message').textContent = 'Channel members are unavailable. Try again.';
  }
}

function updateChannelInviteSelection(): void {
  if (!selectedChannelDetails?.canStart || startingChannel || createdChannelMeeting) return;
  const selected = el('invite-members').querySelectorAll('input:checked').length;
  el('meet-now-message').textContent = channelInviteMessage(selected, selectedChannelDetails.members.length);
  el<HTMLButtonElement>('start-channel-meeting').disabled = !channelInviteSelectionIsValid(selected);
}

async function startChannelMeeting(): Promise<void> {
  const details = selectedChannelDetails;
  const channelId = el<HTMLSelectElement>('channel-select').value;
  if (!revision || !details?.canStart || details.channelId !== channelId || startingChannel || startingDirect || busy || room) return;
  const selectedMemberIds = Array.from(el('invite-members').querySelectorAll<HTMLInputElement>('input:checked'))
    .map(checkbox => Number(checkbox.value));
  if (!channelInviteSelectionIsValid(selectedMemberIds.length)) {
    el('meet-now-message').textContent = channelInviteMessage(selectedMemberIds.length, details.members.length);
    el<HTMLButtonElement>('start-channel-meeting').disabled = true;
    return;
  }
  startingChannel = true;
  invalidateMeetingList();
  updateMeetingListControls();
  el<HTMLButtonElement>('start-channel-meeting').disabled = true;
  el<HTMLSelectElement>('channel-select').disabled = true;
  el<HTMLFieldSetElement>('invite-picker').disabled = true;
  el('meet-now-message').textContent = 'Starting meeting…';
  try {
    const result = await ipcRenderer.invoke(MEETING_CHANNELS.startChannel,
      { channelId, selectedMemberIds, revision }) as { meetingId: string };
    if (channelId !== el<HTMLSelectElement>('channel-select').value) return;
    const select = el<HTMLSelectElement>('meeting-select');
    const option = document.createElement('option');
    option.value = result.meetingId;
    option.textContent = `New channel meeting · …${result.meetingId.slice(-6).toUpperCase()}`;
    option.title = `Room ID: ${result.meetingId}`;
    select.appendChild(option);
    select.value = result.meetingId;
    admittedMeetingIds.add(result.meetingId);
    meetingsChecked = true;
    select.disabled = false;
    el<HTMLButtonElement>('join').disabled = false;
    createdChannelMeeting = true;
    updateDirectMore();
    el<HTMLButtonElement>('start-direct-meeting').disabled = true;
    el<HTMLSelectElement>('direct-select').disabled = true;
    el<HTMLButtonElement>('search-direct').disabled = true;
    el<HTMLInputElement>('direct-search').disabled = true;
    el('meet-now-message').textContent = 'Meeting started. Review your audio and video, then join.';
    status('Ready to join your new meeting');
  } catch {
    el('meet-now-message').textContent = 'Meeting could not start. Check your access and try again.';
  } finally {
    startingChannel = false;
    updateMeetingListControls();
    el<HTMLSelectElement>('channel-select').disabled = createdChannelMeeting;
    if (!createdChannelMeeting && selectedChannelDetails?.channelId === channelId && selectedChannelDetails.canStart && !room) {
      el<HTMLButtonElement>('start-channel-meeting').disabled = false;
      el<HTMLFieldSetElement>('invite-picker').disabled = false;
    }
  }
}

async function loadDirectDetails(): Promise<void> {
  const sequence = ++directLoad;
  const conversationId = el<HTMLSelectElement>('direct-select').value;
  selectedDirectDetails = null;
  el<HTMLButtonElement>('start-direct-meeting').disabled = true;
  if (!revision || !conversationId || createdChannelMeeting || searchingDirect) return;
  el('direct-meet-message').textContent = 'Checking contact meeting access…';
  try {
    const details = await ipcRenderer.invoke(MEETING_CHANNELS.directDetails,
      { conversationId, revision }) as DesktopMeetingDirectDetails;
    if (sequence !== directLoad || searchingDirect || createdChannelMeeting ||
        conversationId !== el<HTMLSelectElement>('direct-select').value ||
        details.conversationId !== conversationId) return;
    selectedDirectDetails = details;
    el<HTMLButtonElement>('start-direct-meeting').disabled = !details.canStart || startingDirect;
    el('direct-meet-message').textContent = details.canStart
      ? 'Start a meeting and invite this contact.'
      : 'Meeting hosting is unavailable for this direct chat.';
  } catch {
    if (sequence === directLoad) el('direct-meet-message').textContent = 'Contact meeting access is unavailable. Try again.';
  }
}

function updateDirectMore(): void {
  const button = el<HTMLButtonElement>('more-direct');
  button.hidden = !directHasMore || createdChannelMeeting;
  button.disabled = loadingDirectPage || searchingDirect;
}

function showDirectChats(chats: readonly DesktopMeetingDirectChat[], hasMore: boolean): void {
  const select = el<HTMLSelectElement>('direct-select');
  select.replaceChildren();
  directLoadedIds.clear();
  directHasMore = hasMore;
  selectedDirectDetails = null;
  el<HTMLButtonElement>('start-direct-meeting').disabled = true;
  for (const chat of chats) {
    if (directLoadedIds.has(chat.id)) continue;
    directLoadedIds.add(chat.id);
    const option = document.createElement('option');
    option.value = chat.id;
    option.textContent = directMeetingOptionLabel(chat);
    select.appendChild(option);
  }
  if (!chats.length) {
    const option = document.createElement('option');
    option.textContent = 'No direct chats found';
    select.appendChild(option);
  }
  select.disabled = !chats.length || createdChannelMeeting;
  updateDirectMore();
  if (chats.length && !createdChannelMeeting) void loadDirectDetails();
}

async function loadMoreDirectChats(): Promise<void> {
  if (!revision || !directHasMore || loadingDirectPage || searchingDirect ||
      createdChannelMeeting || startingDirect || startingChannel || room) return;
  const sequence = directSearchLoad;
  const search = directActiveSearch;
  loadingDirectPage = true;
  updateDirectMore();
  el('direct-meet-message').textContent = 'Loading more direct chats…';
  try {
    const page = await ipcRenderer.invoke(MEETING_CHANNELS.directMore,
      { search, revision }) as PublicMeetingDirectPage;
    if (sequence !== directSearchLoad || search !== directActiveSearch || createdChannelMeeting) return;
    const select = el<HTMLSelectElement>('direct-select');
    for (const chat of page.chats) {
      if (directLoadedIds.has(chat.id)) continue;
      directLoadedIds.add(chat.id);
      const option = document.createElement('option');
      option.value = chat.id;
      option.textContent = directMeetingOptionLabel(chat);
      select.appendChild(option);
    }
    directHasMore = page.hasMore;
    el('direct-meet-message').textContent = page.chats.length
      ? 'More direct chats loaded.' : 'No more direct chats found.';
  } catch {
    if (sequence === directSearchLoad)
      el('direct-meet-message').textContent = 'More direct chats could not be loaded. Try again.';
  } finally {
    loadingDirectPage = false;
    updateDirectMore();
  }
}

async function searchDirectChats(): Promise<void> {
  const search = el<HTMLInputElement>('direct-search').value.trim();
  if (!revision || createdChannelMeeting || startingDirect || startingChannel || room) return;
  if (search.length === 1 || search.length > 100) {
    el('direct-meet-message').textContent = 'Enter at least two characters, or clear search to show recent chats.';
    return;
  }
  const sequence = ++directSearchLoad;
  let failed = false;
  ++directLoad;
  searchingDirect = true;
  el<HTMLSelectElement>('direct-select').disabled = true;
  el<HTMLButtonElement>('start-direct-meeting').disabled = true;
  el<HTMLButtonElement>('search-direct').disabled = true;
  updateDirectMore();
  el('direct-meet-message').textContent = search ? 'Searching direct chats…' : 'Loading recent direct chats…';
  try {
    const page = await ipcRenderer.invoke(MEETING_CHANNELS.directSearch,
      { search, revision }) as PublicMeetingDirectPage;
    if (sequence !== directSearchLoad || search !== el<HTMLInputElement>('direct-search').value.trim() ||
        createdChannelMeeting) return;
    searchingDirect = false;
    directActiveSearch = search;
    showDirectChats(page.chats, page.hasMore);
    el('direct-meet-message').textContent = page.chats.length
      ? 'Select a direct chat to check meeting access.' : 'No matching direct chats. Try another name.';
  } catch {
    if (sequence === directSearchLoad) {
      failed = true;
      el<HTMLSelectElement>('direct-select').disabled = directLoadedIds.size === 0;
      el('direct-meet-message').textContent = 'Direct chats could not be searched. Try again.';
    }
  } finally {
    if (sequence === directSearchLoad) {
      searchingDirect = false;
      el<HTMLButtonElement>('search-direct').disabled = createdChannelMeeting;
      updateDirectMore();
      if (failed && directLoadedIds.size) void loadDirectDetails();
    }
  }
}

async function startDirectMeeting(): Promise<void> {
  const details = selectedDirectDetails;
  const conversationId = el<HTMLSelectElement>('direct-select').value;
  if (!revision || !details?.canStart || details.conversationId !== conversationId ||
      startingDirect || startingChannel || createdChannelMeeting || busy || room) return;
  startingDirect = true;
  invalidateMeetingList();
  updateMeetingListControls();
  el<HTMLButtonElement>('start-direct-meeting').disabled = true;
  el<HTMLSelectElement>('direct-select').disabled = true;
  el('direct-meet-message').textContent = 'Starting meeting…';
  try {
    const result = await ipcRenderer.invoke(MEETING_CHANNELS.startDirect,
      { conversationId, revision }) as { meetingId: string };
    if (conversationId !== el<HTMLSelectElement>('direct-select').value) return;
    const select = el<HTMLSelectElement>('meeting-select');
    const option = document.createElement('option');
    option.value = result.meetingId;
    option.textContent = `New contact meeting · …${result.meetingId.slice(-6).toUpperCase()}`;
    option.title = `Room ID: ${result.meetingId}`;
    select.appendChild(option);
    select.value = result.meetingId;
    admittedMeetingIds.add(result.meetingId);
    meetingsChecked = true;
    select.disabled = false;
    el<HTMLButtonElement>('join').disabled = false;
    createdChannelMeeting = true;
    updateDirectMore();
    el<HTMLButtonElement>('search-direct').disabled = true;
    el<HTMLInputElement>('direct-search').disabled = true;
    el<HTMLButtonElement>('start-channel-meeting').disabled = true;
    el<HTMLSelectElement>('channel-select').disabled = true;
    el<HTMLFieldSetElement>('invite-picker').disabled = true;
    el('direct-meet-message').textContent = 'Meeting started. Review your audio and video, then join.';
    status('Ready to join your new meeting');
  } catch {
    el('direct-meet-message').textContent = 'Meeting could not start. Check your access and try again.';
  } finally {
    startingDirect = false;
    updateMeetingListControls();
    el<HTMLSelectElement>('direct-select').disabled = createdChannelMeeting;
    if (!createdChannelMeeting && selectedDirectDetails?.conversationId === conversationId &&
        selectedDirectDetails.canStart && !room)
      el<HTMLButtonElement>('start-direct-meeting').disabled = false;
  }
}

function invalidateMeetingList(): void {
  ++meetingListRequest;
  refreshingMeetings = false;
  el<HTMLButtonElement>('refresh-meetings').setAttribute('aria-busy', 'false');
  el('meeting-list-status').textContent = '';
}

function updateMeetingListControls(): void {
  const blocked = busy || !!room || startingChannel || startingDirect || !!leaving;
  el<HTMLButtonElement>('refresh-meetings').disabled = blocked || refreshingMeetings || createdChannelMeeting;
  el<HTMLSelectElement>('meeting-select').disabled = blocked || refreshingMeetings || !admittedMeetingIds.size;
  el<HTMLButtonElement>('join').disabled = blocked || refreshingMeetings || !meetingsChecked ||
    !admittedMeetingIds.has(el<HTMLSelectElement>('meeting-select').value);
}

async function refreshMeetings(): Promise<void> {
  if (refreshingMeetings || busy || room || startingChannel || startingDirect || createdChannelMeeting || leaving) return;
  const request = ++meetingListRequest;
  const expectedRevision = revision;
  const initial = revision === null;
  const current = () => request === meetingListRequest && !busy && !room && !startingChannel &&
    !startingDirect && !createdChannelMeeting && !leaving;
  refreshingMeetings = true;
  meetingsChecked = false;
  updateMeetingListControls();
  const refresh = el<HTMLButtonElement>('refresh-meetings');
  refresh.setAttribute('aria-busy', 'true');
  el('meeting-list-status').textContent = 'Checking admitted meetings…';
  error('');
  try {
    // A room-only refresh preserves channel invite choices and direct-search paging.
    const state = await ipcRenderer.invoke(MEETING_CHANNELS.state,
      initial ? undefined : { revision: expectedRevision, refreshMeetings: true }) as PublicMeetingState;
    if (!current()) return;
    if (!state || typeof state.revision !== 'string' || !state.revision ||
        (expectedRevision !== null && state.revision !== expectedRevision)) throw new Error('Meeting session changed');
    revision = state.revision;
    const select = el<HTMLSelectElement>('meeting-select');
    const previous = initial ? '' : select.value;
    const meetings = [...state.meetings].sort((a, b) => a.meetingId.localeCompare(b.meetingId));
    admittedMeetingIds.clear();
    for (const { meetingId } of meetings) admittedMeetingIds.add(meetingId);
    if (previous && !admittedMeetingIds.has(previous)) meetingSelectionRequired = true;
    if (admittedMeetingIds.has(previous)) meetingSelectionRequired = false;
    const selected = admittedMeetingIds.has(previous) ? previous : meetingSelectionRequired ? '' : meetings[0]?.meetingId ?? '';
    select.replaceChildren();
    // A revoked selection must not silently become an unrelated admitted room.
    if (!selected) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = meetings.length ? 'Choose a meeting' : 'No admitted meetings';
      select.appendChild(option);
    }
    const titleCounts = new Map<string, number>();
    for (const { title } of meetings) if (title) titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
    for (const [index, { meetingId, title }] of meetings.entries()) {
      const option = document.createElement('option');
      option.value = meetingId;
      option.textContent = title
        ? `${title}${(titleCounts.get(title) ?? 0) > 1 ? ` · …${meetingId.slice(-6).toUpperCase()}` : ''}`
        : `Meeting ${index + 1} · …${meetingId.slice(-6).toUpperCase()}`;
      option.title = `Room ID: ${meetingId}`;
      select.appendChild(option);
    }
    select.value = selected;
    meetingsChecked = true;
    if (initial) {
      const channelSelect = el<HTMLSelectElement>('channel-select');
      channelSelect.replaceChildren();
      for (const channel of state.channels) {
        const option = document.createElement('option');
        option.value = channel.id;
        option.textContent = channel.name;
        channelSelect.appendChild(option);
      }
      if (!state.channels.length) {
        const option = document.createElement('option');
        option.textContent = 'No channels available';
        channelSelect.appendChild(option);
      }
      channelSelect.disabled = !state.channels.length;
      if (state.channels.length) void loadChannelDetails();
      showDirectChats(state.directChats, state.directHasMore);
    }
    refresh.textContent = 'Refresh meetings';
    el('meeting-list-status').textContent = previous && !admittedMeetingIds.has(previous)
      ? 'The selected meeting is no longer available. Choose an admitted meeting or refresh again.'
      : meetings.length ? 'Meeting list is up to date.' : 'No admitted meetings. Refresh after someone invites you.';
    status(selected ? 'Ready to join' : meetings.length ? 'Choose a meeting' : 'No admitted meetings for this account');
  } catch {
    if (!current()) return;
    refresh.textContent = 'Retry meeting access';
    error('Meeting access could not be checked. Check your connection and try again.');
    el('meeting-list-status').textContent = 'Could not refresh meetings. Retry meeting access.';
    status('Meeting access unavailable');
  } finally {
    if (current()) {
      refreshingMeetings = false;
      refresh.setAttribute('aria-busy', 'false');
      updateMeetingListControls();
    }
  }
}

async function load(): Promise<void> {
  el('manage-access').addEventListener('click', () => { if (memberRemoval?.current()) showAccess(!accessOpen); });
  el('close-access').addEventListener('click', () => showAccess(false));
  el('refresh-access').addEventListener('click', () => { confirmRemoval = null; void memberRemoval?.refresh(); });
  el('access-panel').addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); showAccess(false); } });
  window.addEventListener('beforeunload', clearAccess, { once: true });
  el<HTMLButtonElement>('refresh-meetings').addEventListener('click', () => { void refreshMeetings(); });
  el<HTMLSelectElement>('meeting-select').addEventListener('change', updateMeetingListControls);
  el<HTMLButtonElement>('join').addEventListener('click', () => { void join(); });
  el<HTMLButtonElement>('cancel').addEventListener('click', closeMeeting);
  el<HTMLSelectElement>('channel-select').addEventListener('change', () => { void loadChannelDetails(); });
  el('invite-members').addEventListener('change', updateChannelInviteSelection);
  el<HTMLButtonElement>('start-channel-meeting').addEventListener('click', () => { void startChannelMeeting(); });
  el<HTMLSelectElement>('direct-select').addEventListener('change', () => { void loadDirectDetails(); });
  el<HTMLButtonElement>('search-direct').addEventListener('click', () => { void searchDirectChats(); });
  el<HTMLButtonElement>('more-direct').addEventListener('click', () => { void loadMoreDirectChats(); });
  el<HTMLInputElement>('direct-search').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); void searchDirectChats(); }
  });
  el<HTMLButtonElement>('start-direct-meeting').addEventListener('click', () => { void startDirectMeeting(); });
  el<HTMLInputElement>('start-mic').addEventListener('change', updatePrejoinState);
  el<HTMLInputElement>('start-camera').addEventListener('change', () => { void changePrejoinCamera(); });
  el<HTMLButtonElement>('test-speaker').addEventListener('click', () => { void playSpeakerTest(); });
  el<HTMLButtonElement>('test-microphone').addEventListener('click', () => { void testMicrophone(); });
  el<HTMLSelectElement>('audio-output').addEventListener('change', () => { void changeAudioOutput(); });
  navigator.mediaDevices?.addEventListener('devicechange', () => { if (room) void refreshAudioOutputs(); });
  window.addEventListener('beforeunload', stopPrejoinAudio, { once: true });
  el<HTMLButtonElement>('layout-gallery').addEventListener('click', () => {
    layoutMode = 'gallery';
    if (room) renderLayout();
  });
  el<HTMLButtonElement>('layout-speaker').addEventListener('click', () => {
    layoutMode = 'speaker';
    if (room) renderLayout();
  });
  el<HTMLButtonElement>('mic').addEventListener('click', () => { void toggle('mic'); });
  el<HTMLButtonElement>('camera').addEventListener('click', () => { void toggle('camera'); });
  el<HTMLButtonElement>('share-screen').addEventListener('click', updateScreenShare);
  el('screen-cancel').addEventListener('click', () => chooseScreen(null));
  el('screen-picker').addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); chooseScreen(null); } });
  ipcRenderer.on(MEETING_CHANNELS.screenChoices, (_event, choices) => showScreenChoices(choices));
  el<HTMLButtonElement>('chat').addEventListener('click', () => { if (meetingChat) showChat(!chatOpen); });
  el<HTMLButtonElement>('close-chat').addEventListener('click', () => showChat(false));
  el('chat-panel').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); showChat(false); }
  });
  el<HTMLTextAreaElement>('chat-text').addEventListener('input', () => {
    if (meetingChat) renderChat(meetingChat.getSnapshot());
  });
  el<HTMLTextAreaElement>('chat-text').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void sendChat(); }
  });
  el<HTMLButtonElement>('chat-send').addEventListener('click', () => { void sendChat(); });
  window.addEventListener('beforeunload', clearChat, { once: true });
  el<HTMLButtonElement>('leave').addEventListener('click', closeMeeting);
  el<HTMLButtonElement>('enable-audio').addEventListener('click', () => {
    const active = room;
    if (!active) return;
    void mediaLifecycle.run(async current => {
      try { await active.startAudio(); if (current() && room === active) { status('Connected'); updateRoomUi(); } }
      catch { if (current()) status('Audio output is unavailable. Check your system sound settings.'); }
    }).catch(() => undefined);
  });
  ipcRenderer.on(MEETING_CHANNELS.leaveNow, () => {
    void leave().finally(() => ipcRenderer.send(MEETING_CHANNELS.left)).catch(() => undefined);
  });
  await refreshMeetings();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void load(); });
else void load();
