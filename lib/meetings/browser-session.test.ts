import { describe, expect, it, vi } from 'vitest';
import { BrowserMeetingSession, type BrowserRoom, type BrowserLocalParticipant } from './browser-session';
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
  await session.disconnect(); pending.resolve();
  await expect(join).rejects.toThrow('cancelled');
  expect(session.getSnapshot().status).toBe('disconnected');
  expect(r.result.disconnect).toHaveBeenCalledTimes(2);
 });
 it('does not let an old join overwrite a newer room', async () => {
  const old = room(), next = room(), pending = deferred(); vi.mocked(old.result.connect).mockReturnValue(pending.promise);
  const factory = vi.fn().mockReturnValueOnce(old.result).mockReturnValueOnce(next.result);
  const session = new BrowserMeetingSession(factory), first = session.connect(credentials);
  await session.connect(credentials); pending.resolve(); await expect(first).rejects.toThrow('cancelled');
  expect(session.getSnapshot().status).toBe('connected'); expect(next.result.disconnect).not.toHaveBeenCalled();
 });
 it('cleans up tracks when initial capture fails', async () => {
  const r = room(); vi.mocked(r.result.localParticipant.setCameraEnabled).mockRejectedValue(new Error('denied'));
  const session = new BrowserMeetingSession(() => r.result);
  await expect(session.connect({ ...credentials, microphone: true, camera: true })).rejects.toThrow('denied');
  expect(session.getSnapshot().status).toBe('error'); expect(r.result.disconnect).toHaveBeenCalledWith(true);
  expect([...r.events.values()].every(set => set.size === 0)).toBe(true);
 });
 it('stops capture completed after leave', async () => {
  const r = room(), pending = deferred(), session = new BrowserMeetingSession(() => r.result);
  await session.connect(credentials); vi.mocked(r.result.localParticipant.setCameraEnabled).mockReturnValue(pending.promise);
  const capture = session.setCamera(true); await Promise.resolve(); await session.disconnect(); pending.resolve();
  await expect(capture).rejects.toThrow('cancelled'); expect(r.result.disconnect).toHaveBeenCalledTimes(2);
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
  r.emit('disconnected'); expect(session.getSnapshot()).toMatchObject({ status: 'disconnected', participants: [] });
  expect(session.getSnapshot().error).toBeTruthy(); expect([...r.events.values()].every(set => set.size === 0)).toBe(true);
 });
});
