import { ipcRenderer } from 'electron';
import { Participant, Room, RoomEvent, Track } from 'livekit-client';
import { MEETING_CHANNELS, type PublicMeetingState } from './meeting-channels';
import { MeetingMediaLifecycle, PrejoinCameraPreview } from './meeting-media-lifecycle';
import { PrejoinMicrophoneCheck } from './prejoin-microphone-check';
import { MeetingVideoSlot } from './meeting-video-slot';
import type { DesktopMeetingGrant } from '../../src/authenticated-provider';

// This isolated preload is the only Chromium world that receives a media grant.
// The static page has no script and no bridge exposing the token or Room.
let room: Room | null = null;
let revision: string | null = null;
let busy = false;
let canPublish = false;
const mediaLifecycle = new MeetingMediaLifecycle();
const prejoinCamera = new PrejoinCameraPreview();
const prejoinMicrophone = new PrejoinMicrophoneCheck();
let speakerContext: AudioContext | null = null;
let speakerOscillator: OscillatorNode | null = null;
let speakerTimer: ReturnType<typeof setTimeout> | null = null;
let leaving: Promise<void> | null = null;
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
    gain.gain.value = 0.12;
    oscillator.connect(gain);
    gain.connect(context.destination);
    await context.resume();
    if (speakerContext !== context || busy || room) return;
    speakerOscillator = oscillator;
    oscillator.start();
    const button = el<HTMLButtonElement>('test-speaker');
    button.textContent = 'Stop test sound';
    button.setAttribute('aria-pressed', 'true');
    el('audio-check-status').textContent = 'Playing a short test sound';
    speakerTimer = setTimeout(() => {
      stopSpeakerTest();
      el('audio-check-status').textContent = 'Test sound finished';
    }, 900);
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
  placeholder.className = 'tile-placeholder';
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
  const rosterName = document.createElement('span');
  rosterName.className = 'roster-name';
  const rosterState = document.createElement('span');
  rosterState.className = 'roster-media';
  rosterEntry.append(rosterName, rosterState);
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
  item.placeholder.textContent = initials(participantName(participant));
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
  const active = room;
  room = null;
  canPublish = false;
  clearPreview();
  stopPrejoinAudio();
  leaving = (async () => {
    // In-flight getUserMedia/publish must settle before disconnect and the main-process ack.
    await mediaLifecycle.cancelAndDrain();
    await prejoinCamera.stopAndDrain();
    if (active) {
      try { await active.disconnect(true); } catch { /* Window teardown remains authoritative. */ }
    }
    clearParticipantUi();
    busy = false;
    el('remote-audio').replaceChildren();
    el('room').hidden = true;
    el('prejoin').hidden = false;
  })();
  return leaving;
}

async function join(): Promise<void> {
  if (busy || room || !revision) return;
  const select = el<HTMLSelectElement>('meeting-select');
  const meetingId = select.value;
  if (!meetingId) return;
  const wantsMic = el<HTMLInputElement>('start-mic').checked;
  const wantsCamera = el<HTMLInputElement>('start-camera').checked;
  busy = true;
  el<HTMLButtonElement>('join').disabled = true;
  el<HTMLInputElement>('start-mic').disabled = true;
  el<HTMLInputElement>('start-camera').disabled = true;
  error('');
  status('Joining…');
  // Stop local prejoin checks synchronously before requesting admission or meeting media.
  stopPrejoinAudio();
  await mediaLifecycle.run(async current => {
  let next: Room | null = null;
  try {
    clearPreview();
    await prejoinCamera.stopAndDrain();
    if (!current()) return;
    const grant = await ipcRenderer.invoke(MEETING_CHANNELS.join, { meetingId, revision }) as DesktopMeetingGrant;
    if (!current()) return;
    if (!grant || typeof grant.url !== 'string' || typeof grant.token !== 'string' ||
        grant.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('Invalid admission');
    next = new Room({ adaptiveStream: true, dynacast: true });
    room = next;
    next.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (room === next && current()) attachRemote(track, participant);
    });
    next.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      detachTrack(track);
      if (room === next && current()) syncParticipants();
      void participant;
    });
    next.on(RoomEvent.TrackPublished, (_publication, participant) => {
      if (room === next && current()) syncParticipants();
      void participant;
    });
    next.on(RoomEvent.TrackUnpublished, (publication, participant) => {
      detachTrack(publication.track);
      if (room === next && current()) syncParticipants();
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
      const item = participantTiles.get(participantKey(participant));
      for (const publication of participant.trackPublications.values()) {
        detachTrack(publication.track);
      }
      item?.camera.clear();
      item?.tile.remove();
      item?.rosterEntry.remove();
      participantTiles.delete(participantKey(participant));
      if (room === next && current()) syncParticipants();
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
      if (room === next) {
        status('Meeting disconnected');
        void leave().then(() => ipcRenderer.invoke(MEETING_CHANNELS.finished)).catch(() => undefined);
      }
    });
    await next.connect(grant.url, grant.token, { autoSubscribe: true });
    if (!current() || room !== next) return;
    canPublish = grant.grantProfile === 'interactive';
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
  } catch {
    if (!current()) return;
    room = null;
    canPublish = false;
    if (next) {
      try { await next.disconnect(true); }
      catch {
        // A room whose media cleanup failed cannot be safely kept open for retry.
        void ipcRenderer.invoke(MEETING_CHANNELS.finished).catch(() => undefined);
        return;
      }
    }
    if (!current()) return;
    try { await ipcRenderer.invoke(MEETING_CHANNELS.joinFailed); } catch { /* The window may be closing. */ }
    if (!current()) return;
    el<HTMLInputElement>('start-camera').checked = false;
    el('preview-message').textContent = 'Camera is off';
    error('Could not join this meeting. Check your connection and try again.');
    status('Could not join');
  } finally {
    busy = false;
    if (current()) {
      el<HTMLButtonElement>('join').disabled = false;
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

async function load(): Promise<void> {
  el<HTMLButtonElement>('join').addEventListener('click', () => { void join(); });
  el<HTMLInputElement>('start-camera').addEventListener('change', () => { void changePrejoinCamera(); });
  el<HTMLButtonElement>('test-speaker').addEventListener('click', () => { void playSpeakerTest(); });
  el<HTMLButtonElement>('test-microphone').addEventListener('click', () => { void testMicrophone(); });
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
  el<HTMLButtonElement>('leave').addEventListener('click', () => {
    void (async () => { await leave(); await ipcRenderer.invoke(MEETING_CHANNELS.finished); })();
  });
  el<HTMLButtonElement>('enable-audio').addEventListener('click', () => {
    const active = room;
    if (!active) return;
    void mediaLifecycle.run(async current => {
      try { await active.startAudio(); if (current() && room === active) { status('Connected'); updateRoomUi(); } }
      catch { if (current()) status('Audio output is unavailable. Check your system sound settings.'); }
    }).catch(() => undefined);
  });
  ipcRenderer.on(MEETING_CHANNELS.leaveNow, () => {
    void leave().finally(() => ipcRenderer.send(MEETING_CHANNELS.left));
  });
  try {
    const state = await ipcRenderer.invoke(MEETING_CHANNELS.state) as PublicMeetingState;
    revision = state.revision;
    const select = el<HTMLSelectElement>('meeting-select');
    select.replaceChildren();
    const meetingIds = [...state.meetingIds].sort();
    for (const [index, id] of meetingIds.entries()) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = `Meeting ${index + 1} · …${id.slice(-6).toUpperCase()}`;
      option.title = `Room ID: ${id}`;
      select.appendChild(option);
    }
    if (!state.meetingIds.length) {
      const option = document.createElement('option');
      option.textContent = 'No admitted meetings';
      select.appendChild(option);
    }
    select.disabled = !state.meetingIds.length;
    el<HTMLButtonElement>('join').disabled = !state.meetingIds.length;
    status(state.meetingIds.length ? 'Ready to join' : 'No admitted meetings for this account');
  } catch {
    error('Meeting access could not be checked. Close this window and try again.');
    status('Meeting access unavailable');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void load(); });
else void load();
