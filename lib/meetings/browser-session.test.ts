import { describe, expect, it, vi } from 'vitest';
import { BrowserMeetingConnectionFailure, BrowserMeetingSession, type BrowserRoom, type BrowserLocalParticipant } from './browser-session';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
function room() {
 const events = new Map<string, Set<(...args: unknown[]) => void>>();
 const localParticipant: BrowserLocalParticipant = { identity: 'me', isMicrophoneEnabled: false, isCameraEnabled: false,
  setMicrophoneEnabled: vi.fn(async (value: boolean) => { localParticipant.isMicrophoneEnabled = value; }),
  setCameraEnabled: vi.fn(async (value: boolean) => { localParticipant.isCameraEnabled = value; }),
  setAttributes: vi.fn(async () => {}) };
 const result: BrowserRoom = { localParticipant, remoteParticipants: new Map(), connect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}),
  on(event, fn) { if (!events.has(event)) events.set(event, new Set()); events.get(event)!.add(fn); },
  off(event, fn) { events.get(event)?.delete(fn); } };
 return { result, events, emit: (event: string) => events.get(event)?.forEach(fn => fn()) };
}
const credentials = { url: 'wss://meeting.example', token: 'private' };
describe('browser meeting session', () => {
 it('joins with capture off and updates participants from room events', async () => {
  const r = room(), session = new BrowserMeetingSession(() => r.result), listener = vi.fn();
  const unsubscribe = session.subscribe(listener);
  await session.connect(credentials);
  expect(r.result.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  expect(r.result.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  expect(session.getSnapshot().status).toBe('connected');
  (r.result.remoteParticipants as Map<string, {identity: string}>).set('other', { identity: 'other' });
  r.emit('participantConnected'); expect(session.getSnapshot().participants).toHaveLength(2);
  unsubscribe(); const calls = listener.mock.calls.length;
  await session.disconnect(); expect(listener).toHaveBeenCalledTimes(calls);
  expect([...r.events.values()].every(set => set.size === 0)).toBe(true);
 });
 it('publishes only explicit consent and shows permission failures without claiming enabled', async () => {
  const r = room(), session = new BrowserMeetingSession(() => r.result);
  await session.connect({ ...credentials, microphone: true });
  expect(session.getSnapshot().participants[0].microphone).toBe(true);
  vi.mocked(r.result.localParticipant.setCameraEnabled).mockRejectedValue(new Error('permission denied token=private'));
  await expect(session.setCamera(true)).rejects.toThrow('permission denied');
  expect(session.getSnapshot().participants[0].camera).toBe(false);
  expect(session.getSnapshot().error).toBeTruthy(); expect(session.getSnapshot().error).not.toContain('private');
 });
 it('stops a delayed connection after leave and never resurrects state', async () => {
  const r = room(), pending = deferred(); vi.mocked(r.result.connect).mockReturnValue(pending.promise);
  const session = new BrowserMeetingSession(() => r.result), join = session.connect(credentials);
  const leave = session.disconnect();
  pending.resolve();
  await leave;
  await expect(join).rejects.toMatchObject({
   name: 'BrowserMeetingConnectionFailure', stage: 'post_connect_guard',
   cause: expect.objectContaining({ message: 'Meeting connection cancelled' }),
  });
  expect(session.getSnapshot().status).toBe('disconnected');
  expect(r.result.disconnect).toHaveBeenCalledTimes(3);
 });
 it('does not let an old join overwrite a newer room', async () => {
  const old = room(), next = room(), pending = deferred(); vi.mocked(old.result.connect).mockReturnValue(pending.promise);
  const factory = vi.fn().mockReturnValueOnce(old.result).mockReturnValueOnce(next.result);
  const session = new BrowserMeetingSession(factory), first = session.connect(credentials);
  await session.connect(credentials); pending.resolve();
  await expect(first).rejects.toMatchObject({ stage: 'post_connect_guard' });
  expect(session.getSnapshot().status).toBe('connected'); expect(next.result.disconnect).not.toHaveBeenCalled();
 });
 it('keeps receiving media when initial camera permission is unavailable', async () => {
  const r = room(); vi.mocked(r.result.localParticipant.setCameraEnabled).mockRejectedValue(new Error('denied'));
  const session = new BrowserMeetingSession(() => r.result);
  await expect(session.connect({ ...credentials, microphone: true, camera: true })).resolves.toBeUndefined();
  expect(session.getSnapshot().status).toBe('connected');
  expect(session.getSnapshot().participants[0]).toMatchObject({ microphone: true, camera: false });
  expect(session.getSnapshot().error).toBe('Camera unavailable. You joined with video off.');
  expect(r.result.disconnect).not.toHaveBeenCalled();
 });
 it('keeps a listener receive-only even when preferences request capture', async () => {
  const r = room(), session = new BrowserMeetingSession(() => r.result);
  await session.connect({ ...credentials, microphone: true, camera: true, receiveOnly: true });
  expect(r.result.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
  expect(r.result.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
  await expect(session.setMicrophone(true)).rejects.toThrow('listen-only');
  await expect(session.setCamera(true)).rejects.toThrow('listen-only');
 });
 it('stops capture completed after leave', async () => {
  const r = room(), pending = deferred(), session = new BrowserMeetingSession(() => r.result);
  await session.connect(credentials); vi.mocked(r.result.localParticipant.setCameraEnabled).mockReturnValue(pending.promise);
  const capture = session.setCamera(true); await Promise.resolve();
  let released = false;
  const leave = session.disconnect().then(() => { released = true; });
  await Promise.resolve();
  expect(released).toBe(false);
  pending.resolve();
  await leave;
  await expect(capture).rejects.toThrow('cancelled');
  expect(r.result.disconnect).toHaveBeenCalledTimes(3);
 });
 it('gates language writes on adapter capabilities and validates language', async () => {
  const r = room(), session = new BrowserMeetingSession(() => r.result);
  await session.connect(credentials); await expect(session.setLanguage('th')).rejects.toThrow('unsupported');
  expect(r.result.localParticipant.setAttributes).not.toHaveBeenCalled(); await session.disconnect();
  const supported = new BrowserMeetingSession(() => r.result, { languageAttribute: 'language' });
  await supported.connect(credentials); await supported.setLanguage('th');
  expect(r.result.localParticipant.setAttributes).toHaveBeenCalledWith({ language: 'th' });
  await expect(supported.setLanguage('invalid language')).rejects.toThrow('Invalid');
 });
 it('cleans up on unexpected disconnect and exposes disconnected state', async () => {
  const r = room(), session = new BrowserMeetingSession(() => r.result);
  await session.connect(credentials); r.emit('reconnecting'); expect(session.getSnapshot().status).toBe('reconnecting');
  r.emit('reconnected'); expect(session.getSnapshot().status).toBe('connected');
  r.emit('disconnected');
  await session.disconnect();
  expect(session.getSnapshot()).toMatchObject({ status: 'disconnected', participants: [] });
  expect(session.getSnapshot().error).toBeTruthy(); expect([...r.events.values()].every(set => set.size === 0)).toBe(true);
 });

 it('waits for a late camera publish after external disconnection before cleanup completes', async () => {
  const r = room(), pending = deferred(), session = new BrowserMeetingSession(() => r.result);
  await session.connect(credentials);
  vi.mocked(r.result.localParticipant.setCameraEnabled).mockReturnValue(pending.promise);
  const capture = session.setCamera(true);
  await Promise.resolve();
  r.emit('disconnected');
  let stopped = false;
  const cleanup = session.disconnect().then(() => { stopped = true; });
  await Promise.resolve();
  expect(stopped).toBe(false);
  pending.resolve();
  await cleanup;
  await expect(capture).rejects.toThrow('cancelled');
  expect(r.result.disconnect).toHaveBeenCalledTimes(3);
 });

 it('stops local capture and retains a failed room for a later disconnect retry', async () => {
  const r = room(), stop = vi.fn(), session = new BrowserMeetingSession(() => r.result);
  r.result.localParticipant.trackPublications = new Map([['audio', { track: { stop } }]]);
  await session.connect(credentials);
  vi.mocked(r.result.disconnect).mockRejectedValueOnce(new Error('sendLeave failed'));
  await expect(session.disconnect()).rejects.toThrow('sendLeave failed');
  expect(stop).toHaveBeenCalledTimes(1);
  expect(session.getRoom()).toBe(r.result);
  await expect(session.disconnect()).resolves.toBeUndefined();
  expect(session.getRoom()).toBeUndefined();
 });
 it('rechecks a room restored by failed connect cleanup before leave completes', async () => {
  const r = room(), stop = vi.fn(), session = new BrowserMeetingSession(() => r.result);
  let rejectStop!: (error: Error) => void;
  const pendingStop = new Promise<void>((_resolve, reject) => { rejectStop = reject; });
  r.result.localParticipant.trackPublications = new Map([['audio', { track: { stop } }]]);
  vi.mocked(r.result.connect).mockRejectedValue(new Error('connect failed'));
  vi.mocked(r.result.disconnect).mockReturnValueOnce(pendingStop);
  const join = session.connect(credentials).catch(error => error);
  await vi.waitFor(() => expect(r.result.disconnect).toHaveBeenCalledTimes(1));
  const leave = session.disconnect();
  rejectStop(new Error('first stop failed'));
  expect(await join).toMatchObject({ message: 'first stop failed' });
  await expect(leave).resolves.toBeUndefined();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(r.result.disconnect).toHaveBeenCalledTimes(2);
  expect(session.getRoom()).toBeUndefined();
 });
 it('rejects leave when late-room teardown also fails, allowing another retry', async () => {
  const r = room(), session = new BrowserMeetingSession(() => r.result);
  let rejectStop!: (error: Error) => void;
  const pendingStop = new Promise<void>((_resolve, reject) => { rejectStop = reject; });
  r.result.localParticipant.trackPublications = new Map();
  vi.mocked(r.result.connect).mockRejectedValue(new Error('connect failed'));
  vi.mocked(r.result.disconnect).mockReturnValueOnce(pendingStop)
    .mockRejectedValueOnce(new Error('late stop failed'));
  const join = session.connect(credentials).catch(error => error);
  await vi.waitFor(() => expect(r.result.disconnect).toHaveBeenCalledTimes(1));
  const leave = session.disconnect();
  rejectStop(new Error('first stop failed'));
  await join;
  await expect(leave).rejects.toThrow('late stop failed');
  expect(session.getRoom()).toBe(r.result);
  await expect(session.disconnect()).resolves.toBeUndefined();
 });

 it.each([
  ['room_create', (r: ReturnType<typeof room>) => () => { throw new Error('private room constructor detail'); }],
  ['event_bind', (r: ReturnType<typeof room>) => () => {
   r.result.on = () => { throw new Error('private event detail'); };
   return r.result;
  }],
  ['signal_connect', (r: ReturnType<typeof room>) => () => {
   vi.mocked(r.result.connect).mockRejectedValue(new Error('private signal detail'));
   return r.result;
  }],
  ['participant_refresh', (r: ReturnType<typeof room>) => () => {
   Object.defineProperty(r.result.localParticipant, 'identity', {
    configurable: true,
    get: () => { throw new Error('private participant detail'); },
   });
   return r.result;
  }],
 ] as const)('reports the fixed %s boundary while retaining the original cause', async (stage, arrange) => {
  const r = room();
  const session = new BrowserMeetingSession(arrange(r));
  const failure = await session.connect(credentials).catch(error => error);

  expect(failure).toBeInstanceOf(BrowserMeetingConnectionFailure);
  expect(failure).toMatchObject({ stage });
  expect(failure.cause).toBeInstanceOf(Error);
  expect(failure.message).not.toContain('private');
 });

 it('reports prior-room cleanup separately from constructing the replacement', async () => {
  const first = room(), next = room();
  const session = new BrowserMeetingSession(vi.fn().mockReturnValueOnce(first.result).mockReturnValueOnce(next.result));
  await session.connect(credentials);
  vi.mocked(first.result.disconnect).mockRejectedValueOnce(new Error('private cleanup detail'));

  await expect(session.connect(credentials)).rejects.toMatchObject({ stage: 'room_cleanup' });
  expect(next.result.connect).not.toHaveBeenCalled();
 });
});
