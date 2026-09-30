import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validSender, createHandlers, applyTaggedSnapshot, callHistoryFailureMessage, signInFailureMessage, type PublicState } from '../src/ipc';
import { helperExecutable, verifyPackagedHelper } from '../src/helper-verifier';
import { DesktopAuthenticationError, DesktopCallHistoryError } from '../../src/authenticated-provider';
import type { DesktopSession } from '../../src/call-boundary';
const empty = { version: 1 as const, registered: false, call: null, dialState: 'idle' as const,
  callActionState: 'idle' as const, holdMessage: null };
test('IPC rejects a different sender, subframe, and URL', () => {
  const frame = { url: 'file:///app/index.html' };
  const owner = { mainFrame: frame, isDestroyed: () => false };
  assert.equal(validSender({ sender: owner, senderFrame: frame } as never, owner as never, frame.url), true);
  assert.equal(validSender({ sender: {}, senderFrame: frame } as never, owner as never, frame.url), false);
  assert.equal(validSender({ sender: owner, senderFrame: { url: frame.url } } as never, owner as never, frame.url), false);
  assert.equal(validSender({ sender: owner, senderFrame: frame } as never, owner as never, 'https://evil.test/'), false);
});
test('directory IPC binds requests and responses to the current selected tenant session', async () => {
  let current: DesktopSession | null = { revision: 'r1', accountId: 'a1', userId: 'u1', tenantId: 9, extensionId: 2 };
  let resolvePage!: (page: { tenantId: number; items: { id: number; name: string; number: string }[]; nextOffset: null }) => void;
  const calls: unknown[] = [];
  const provider = { currentSession: () => current, currentExtensionNumber: () => '1020',
    listDirectory: (revision: string, search: string, offset: number) => {
      calls.push({ revision, search, offset });
      return new Promise(resolve => { resolvePage = resolve; });
    } };
  const helper = { snapshot: () => empty };
  const handlers = createHandlers(provider as never, helper as never, () => 'g1', () => {});
  await assert.rejects(handlers.directoryList({ sessionRevision: 'old', search: '', offset: 0 }));
  await assert.rejects(handlers.directoryList({ sessionRevision: 'r1', search: '', offset: -1 }));
  assert.equal(calls.length, 0);
  const pending = handlers.directoryList({ sessionRevision: 'r1', search: 'Som', offset: 0 });
  assert.deepEqual(calls, [{ revision: 'r1', search: 'Som', offset: 0 }]);
  resolvePage({ tenantId: 10, items: [], nextOffset: null });
  await assert.rejects(pending, /PHONE11_DIRECTORY_TENANT_MISMATCH/);
  const oldPage = handlers.directoryList({ sessionRevision: 'r1', search: 'Som', offset: 0 });
  current = { revision: 'r2', accountId: 'a1', userId: 'u1', tenantId: 10, extensionId: 3 };
  resolvePage({ tenantId: 9, items: [{ id: 41, name: 'Som', number: '1020' }], nextOffset: null });
  await assert.rejects(oldPage, /session changed/);
});
test('sign out stops helper and clears public session without secret emission', async () => {
  const secret = 'VERY_PRIVATE_SIP_PASSWORD';
  const session: DesktopSession = { revision: 'r1', accountId: 'a1', userId: 'u1', tenantId: 1, extensionId: 2 };
  let current: DesktopSession | null = session;
  let stopped = false;
  let receivedPassword: string | null = null;
  const provider = { currentSession: () => current, currentExtensionNumber: () => current ? '1001' : null,
    signOut: async () => { current = null; },
    signIn: async (_email: string, password: string) => { receivedPassword = password; current = session; return session; } };
  const helper = { stop: async () => { stopped = true; return true; }, snapshot: () => empty,
    start: async () => 'g1', handleRendererAction: async () => empty };
  let generation: string | null = 'g1';
  const handlers = createHandlers(provider as never, helper as never, () => generation, value => { generation = value; });
  const signedIn = await handlers.signIn({ email: 'person@example.test', password: secret });
  assert.equal(receivedPassword, secret);
  assert.equal(JSON.stringify(signedIn).includes(secret), false);
  assert.equal(JSON.stringify(handlers.state()).includes(secret), false);
  assert.equal(JSON.stringify(await handlers.signOut()).includes(secret), false);
  assert.equal(stopped, true);
  assert.equal(current, null);
  assert.equal(generation, null);
});
test('multi-workspace IPC waits for explicit selection and rejects stale tenant choice', async () => {
  const session: DesktopSession = { revision: 'r1', accountId: 'a1', userId: 'u1', tenantId: 10, extensionId: 2 };
  let current: DesktopSession | null = null;
  let starts = 0;
  let selections = 0;
  const provider = { currentSession: () => current, currentExtensionNumber: () => current ? '1020' : null,
    signOut: async () => { current = null; },
    signIn: async () => ({ selectionRevision: 'choice-1', tenants: [
      { tenantId: 9, name: 'One' }, { tenantId: 10, name: 'Two' },
    ] }),
    selectTenant: async (revision: string, tenantId: number) => {
      selections++;
      if (revision !== 'choice-1' || tenantId !== 10) throw new DesktopAuthenticationError('phone_access_unavailable');
      current = session; return session;
    } };
  const helper = { stop: async () => true, snapshot: () => empty, start: async () => { starts++; return 'g1'; } };
  let generation: string | null = null;
  const handlers = createHandlers(provider as never, helper as never, () => generation, value => { generation = value; });
  const pending = await handlers.signIn({ email: 'person@example.test', password: 'private-login' });
  assert.deepEqual(pending, { selectionRevision: 'choice-1', tenants: [
    { tenantId: 9, name: 'One' }, { tenantId: 10, name: 'Two' },
  ] });
  assert.equal(starts, 0);
  assert.equal(handlers.state().signedIn, false);
  await assert.rejects(handlers.selectTenant({ selectionRevision: 'stale', tenantId: 10 }),
    /PHONE11_PHONE_ACCESS_UNAVAILABLE/);
  assert.equal(starts, 0);
  assert.equal(selections, 1);
  assert.equal(handlers.state().signedIn, false);
});
test('queued sign-out cancels workspace selection before SIP helper starts', async () => {
  const session: DesktopSession = { revision: 'r1', accountId: 'a1', userId: 'u1', tenantId: 10, extensionId: 2 };
  let releaseSelection!: () => void;
  let enteredSelection!: () => void;
  const entered = new Promise<void>(resolve => { enteredSelection = resolve; });
  const selected = new Promise<DesktopSession>(resolve => { releaseSelection = () => resolve(session); });
  let current: DesktopSession | null = null;
  let starts = 0;
  let stops = 0;
  let cancellationEpoch = 0;
  const provider = { currentSession: () => current, currentExtensionNumber: () => current ? '1020' : null,
    signOut: async () => { current = null; },
    signIn: async () => ({ selectionRevision: 'choice-1', tenants: [{ tenantId: 10, name: 'Two' }] }),
    selectTenant: async () => { enteredSelection(); current = await selected; return current; } };
  const helper = { stop: async () => { stops++; return true; }, snapshot: () => empty,
    start: async () => { starts++; return 'g1'; } };
  let generation: string | null = null;
  const handlers = createHandlers(provider as never, helper as never, () => generation, value => { generation = value; });
  const cancelled = () => cancellationEpoch !== 0;
  await handlers.signIn({ email: 'person@example.test', password: 'private-login' }, cancelled);
  const selecting = handlers.selectTenant({ selectionRevision: 'choice-1', tenantId: 10 }, cancelled);
  await entered;
  cancellationEpoch++;
  releaseSelection();
  await assert.rejects(selecting, /PHONE11_PHONE_ACCESS_UNAVAILABLE/);
  assert.equal(starts, 0, 'SIP helper cannot start after sign-out was requested');
  assert.equal(generation, null);
  assert.equal(current, null);
  assert.ok(stops >= 2);
});
test('window-close cancellation during helper startup stops the helper before publishing a session', async () => {
  const session: DesktopSession = { revision: 'r1', accountId: 'a1', userId: 'u1', tenantId: 10, extensionId: 2 };
  let releaseStart!: () => void;
  let enteredStart!: () => void;
  const entered = new Promise<void>(resolve => { enteredStart = resolve; });
  const started = new Promise<string>(resolve => { releaseStart = () => resolve('g1'); });
  let current: DesktopSession | null = null;
  let stops = 0;
  let cancelled = false;
  const provider = { currentSession: () => current, currentExtensionNumber: () => current ? '1020' : null,
    signOut: async () => { current = null; },
    selectTenant: async () => { current = session; return session; } };
  const helper = { stop: async () => { stops++; return true; }, snapshot: () => empty,
    start: async () => { enteredStart(); return started; } };
  let generation: string | null = null;
  const handlers = createHandlers(provider as never, helper as never, () => generation, value => { generation = value; });
  const selecting = handlers.selectTenant({ selectionRevision: 'choice-1', tenantId: 10 }, () => cancelled);
  await entered;
  cancelled = true;
  releaseStart();
  await assert.rejects(selecting, /PHONE11_CALLING_UNAVAILABLE/);
  assert.ok(stops >= 1);
  assert.equal(generation, null);
  assert.equal(current, null);
});
test('sign-in errors identify the safe failing stage without showing upstream details', () => {
  assert.equal(signInFailureMessage(new Error('PHONE11_CREDENTIALS_REJECTED')), 'Email or password was not accepted.');
  assert.match(signInFailureMessage(new Error('PHONE11_ORIGIN_REJECTED')), /origin check/);
  assert.match(signInFailureMessage(new Error('PHONE11_EMAIL_UNVERIFIED')), /Verify your Phone11 email/);
  assert.match(signInFailureMessage(new Error('PHONE11_AUTH_BLOCKED')), /blocked this sign-in/);
  assert.match(signInFailureMessage(new Error('PHONE11_PHONE_ACCESS_UNAVAILABLE')), /calling access/);
  assert.match(signInFailureMessage(new Error('PHONE11_CALLING_UNAVAILABLE')), /calling could not start/);
  assert.equal(signInFailureMessage(new Error('secret-token=private')), 'Phone11 sign-in is unavailable. Try again.');
});
test('IPC distinguishes rejected credentials from a local helper failure and clears the session', async () => {
  let current: DesktopSession | null = null;
  let failure: Error | null = new DesktopAuthenticationError('credentials_rejected');
  let helperStarts = 0;
  const provider = { currentSession: () => current, currentExtensionNumber: () => current ? '3001' : null,
    signOut: async () => { current = null; },
    signIn: async () => {
      if (failure) throw failure;
      current = { revision: 'r1', accountId: 'a1', userId: 'u1', tenantId: 1, extensionId: 2 };
    } };
  const helper = { stop: async () => true, snapshot: () => empty,
    start: async () => { helperStarts++; throw new Error('private local helper detail'); } };
  let generation: string | null = null;
  const handlers = createHandlers(provider as never, helper as never, () => generation, value => { generation = value; });
  await assert.rejects(handlers.signIn({ email: 'person@example.test', password: 'private-login' }),
    /PHONE11_CREDENTIALS_REJECTED/);
  assert.equal(helperStarts, 0);
  assert.equal(handlers.state().signedIn, false);
  failure = null;
  await assert.rejects(handlers.signIn({ email: 'person@example.test', password: 'private-login' }),
    /PHONE11_CALLING_UNAVAILABLE/);
  assert.equal(helperStarts, 1);
  assert.equal(handlers.state().signedIn, false);
});
test('late call results cannot replace a different account or helper generation', () => {
  const accountB: PublicState = { signedIn: true, sessionRevision: 'b', generation: 'gb',
    tenantId: 2, extensionNumber: '2002', calling: empty };
  const oldCall = { ...empty, registered: true, call: { id: '101', state: 'connected' as const, muted: false } };
  assert.equal(applyTaggedSnapshot(accountB, { sessionRevision: 'a', generation: 'ga', snapshot: oldCall }), accountB);
  assert.equal(applyTaggedSnapshot(accountB, { sessionRevision: 'b', generation: 'ga', snapshot: oldCall }), accountB);
  assert.equal(applyTaggedSnapshot(null, { sessionRevision: 'a', generation: 'ga', snapshot: oldCall }), null);
  assert.equal(applyTaggedSnapshot(accountB, { sessionRevision: 'b', generation: 'gb', snapshot: oldCall })?.calling, oldCall);
});
test('Windows helper checks executable and both loader DLLs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'phone11-helper-'));
  try {
    const root = join(dir, 'helper', 'win');
    await mkdir(root, { recursive: true });
    const files: Record<string, string> = {};
    for (const name of ['phone11_siprix_helper.exe', 'siprix.dll', 'siprixMedia.dll']) {
      const body = Buffer.from(name);
      await writeFile(join(root, name), body);
      files[name] = createHash('sha256').update(body).digest('hex');
    }
    const manifest = Buffer.from(JSON.stringify({ platform: 'win32', files, symlinks: {} }));
    await writeFile(join(dir, 'helper-integrity.json'), manifest);
    const pin = createHash('sha256').update(manifest).digest('hex');
    const path = helperExecutable(dir, 'win32');
    assert.equal(await verifyPackagedHelper(path, dir, pin, 'win32'), true);
    assert.equal(await verifyPackagedHelper(path, dir, 'f'.repeat(64), 'win32'), false);
    await writeFile(join(root, 'unexpected.dll'), 'injected');
    assert.equal(await verifyPackagedHelper(path, dir, pin, 'win32'), false);
    await rm(join(root, 'unexpected.dll'));
    await writeFile(join(root, 'siprixMedia.dll'), 'tampered');
    assert.equal(await verifyPackagedHelper(path, dir, pin, 'win32'), false);
    await rm(join(root, 'siprixMedia.dll'));
    assert.equal(await verifyPackagedHelper(path, dir, pin, 'win32'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('macOS helper checks app Frameworks and rejects symlink escape', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'phone11-helper-'));
  try {
    const app = join(dir, 'helper', 'mac', 'phone11_siprix_helper.app', 'Contents');
    const macos = join(app, 'MacOS');
    const frameworks = join(app, 'Frameworks');
    await mkdir(macos, { recursive: true });
    await mkdir(join(frameworks, 'siprix.framework'), { recursive: true });
    await mkdir(join(frameworks, 'siprixMedia.framework'), { recursive: true });
    const root = join(dir, 'helper', 'mac');
    const paths = [join(macos, 'phone11_siprix_helper'),
      join(frameworks, 'siprix.framework', 'siprix'),
      join(frameworks, 'siprixMedia.framework', 'siprixMedia')];
    const files: Record<string, string> = {};
    for (const path of paths) {
      const body = Buffer.from(path);
      await writeFile(path, body);
      files[path.slice(root.length + 1).split('/').join('/')] = createHash('sha256').update(body).digest('hex');
    }
    await chmod(paths[0], 0o755);
    const link = join(frameworks, 'siprix.framework', 'Current');
    await symlink('siprix', link);
    const key = link.slice(root.length + 1).split('/').join('/');
    const manifest = Buffer.from(JSON.stringify({ platform: 'darwin', files, symlinks: { [key]: 'siprix' } }));
    await writeFile(join(dir, 'helper-integrity.json'), manifest);
    const pin = createHash('sha256').update(manifest).digest('hex');
    const path = helperExecutable(dir, 'darwin');
    assert.equal(await verifyPackagedHelper(path, dir, pin, 'darwin'), true);
    await rm(link);
    await symlink('/etc/hosts', link);
    assert.equal(await verifyPackagedHelper(path, dir, pin, 'darwin'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('personal inbox IPC rejects stale history and disables voicemail before provider access', async () => {
  let current: DesktopSession | null = { revision: 'r1', accountId: 'a1', userId: 'u1', tenantId: 1, extensionId: 2 };
  let snapshot: import('../../src/call-boundary').PublicSnapshot = { ...empty };
  let meeting = false;
  let audioRequests = 0;
  let listRequests = 0;
  let readRequests = 0;
  let releaseHistory!: (value: any) => void;
  const provider = {
    currentSession: () => current,
    listCallHistoryPage: () => new Promise(resolve => { releaseHistory = resolve; }),
    listVoicemail: async () => { listRequests++; return []; },
    voicemailAudio: async () => { audioRequests++; return { id: 4, mimeType: 'audio/wav', bytes: new Uint8Array([1]) }; },
    markVoicemailRead: async () => { readRequests++; },
  };
  const handlers = createHandlers(provider as never, { snapshot: () => snapshot } as never, () => 'g1', () => {}, () => meeting);
  await assert.rejects(handlers.historyList({ sessionRevision: 'old' }));
  const history = handlers.historyList({ sessionRevision: 'r1' });
  current = { ...current!, revision: 'r2' };
  releaseHistory({ items: [], nextCursor: null });
  await assert.rejects(history, /session changed/);
  await assert.rejects(handlers.voicemailList({ sessionRevision: 'r2' }), /PHONE11_VOICEMAIL_UNAVAILABLE/);
  await assert.rejects(handlers.voicemailAudio({ sessionRevision: 'r2', id: 4 }), /PHONE11_VOICEMAIL_UNAVAILABLE/);
  await assert.rejects(handlers.voicemailMarkRead({ sessionRevision: 'r2', id: 4 }), /PHONE11_VOICEMAIL_UNAVAILABLE/);
  assert.deepEqual([listRequests, audioRequests, readRequests], [0, 0, 0]);
});

test('call history IPC exposes a stable safe failure code and maps it to actionable UI text', async () => {
  const current: DesktopSession = { revision: 'r1', accountId: 'a1', userId: 'u1', tenantId: 1, extensionId: 2 };
  const provider = {
    currentSession: () => current,
    listCallHistoryPage: async () => { throw new DesktopCallHistoryError('tenant_mismatch', 200); },
  };
  const handlers = createHandlers(provider as never, { snapshot: () => empty } as never, () => 'g1', () => {});
  await assert.rejects(handlers.historyList({ sessionRevision: 'r1' }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'PHONE11_HISTORY_TENANT_MISMATCH_200');
    return true;
  });
  assert.equal(callHistoryFailureMessage(new Error('PHONE11_HISTORY_FORBIDDEN_403')),
    'Your account cannot access call history in this workspace.');
  assert.equal(callHistoryFailureMessage(new Error('PHONE11_HISTORY_ENDPOINT_UNAVAILABLE_404')),
    'Call history is unavailable in this Desktop version. Update Phone11 or try again later.');
  assert.equal(callHistoryFailureMessage(new Error('PHONE11_HISTORY_TENANT_MISMATCH_200')),
    'Phone11 could not verify the workspace for call history. Sign in again or contact support.');
  assert.equal(callHistoryFailureMessage(new Error('raw response with bearer and caller number')),
    'Call history could not load. Refresh to try again.');
});

test('call history IPC validates and forwards an exact bounded page cursor', async () => {
  const current: DesktopSession = { revision: 'r1', accountId: 'a1', userId: 'u1', tenantId: 1, extensionId: 2 };
  const cursor = { startedAt: '2026-09-29T10:00:00.000001Z', id: 51 };
  const received: unknown[] = [];
  const provider = { currentSession: () => current,
    listCallHistoryPage: async (_revision: string, value?: unknown) => {
      received.push(value); return { items: [], nextCursor: null };
    } };
  const handlers = createHandlers(provider as never, { snapshot: () => empty } as never, () => 'g1', () => {});
  await assert.rejects(handlers.historyList({ sessionRevision: 'r1', cursor: { ...cursor, id: 0 } }),
    /Invalid history cursor/);
  await assert.rejects(handlers.historyList({ sessionRevision: 'r1', cursor: { ...cursor, startedAt: 'bad' } }),
    /Invalid history cursor/);
  assert.deepEqual(received, []);
  assert.deepEqual(await handlers.historyList({ sessionRevision: 'r1', cursor }),
    { sessionRevision: 'r1', items: [], nextCursor: null });
  assert.deepEqual(received, [cursor]);
});
