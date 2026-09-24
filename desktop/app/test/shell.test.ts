import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validSender, createHandlers, applyTaggedSnapshot, signInFailureMessage, type PublicState } from '../src/ipc';
import { helperExecutable, verifyPackagedHelper } from '../src/helper-verifier';
import { DesktopAuthenticationError } from '../../src/authenticated-provider';
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
