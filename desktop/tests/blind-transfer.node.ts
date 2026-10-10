import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopCallBoundary, HelperCommandRejectedError, parseRendererAction, type HelperCommand, type DesktopSession } from '../src/call-boundary';
const session: DesktopSession = { revision: 'session-1', userId: 'user-1', tenantId: 11, extensionId: 1, accountId: 'account-1' };
const transfer = { operation: 'transfer', sessionRevision: session.revision, generation: 'helper-1', callId: '42', destination: '+6621234567' };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function fixture(execute?: (command: HelperCommand) => Promise<void>, capability = true) {
  const commands: HelperCommand[] = [];
  const boundary = new DesktopCallBoundary({ execute: async command => { commands.push(command); await execute?.(command); } }, 15);
  boundary.startHelperGeneration('helper-1'); boundary.bindSession(session, 'helper-1'); boundary.setTransferCapability(capability);
  let sequence = 0;
  const event = (payload: Record<string, unknown>) => boundary.receiveHelperEvent({ version: 1, generation: 'helper-1', sessionRevision: session.revision, accountId: session.accountId, sequence: ++sequence, ...payload });
  event({ type: 'registration', registered: true }); event({ type: 'call', callId: '42', state: 'connected' });
  const outcome = (statusCode: number, changes: Record<string, unknown> = {}) => event({ type: 'transfer', callId: '42', intentId: commands.find(c => c.operation === 'transfer')?.intentId, statusCode, ...changes });
  return { boundary, commands, event, outcome };
}
test('transfer rejects URI, star/hash, whitespace, misplaced plus and overlong numbers', () => {
  for (const destination of ['sip:42@invalid', '42#', '*42', ' 42', '4+2', '++42', '+', '1'.repeat(33), '42\n'])
    assert.throws(() => parseRendererAction({ ...transfer, destination }));
  assert.equal(parseRendererAction({ ...transfer, destination: '+' + '1'.repeat(32) }).operation, 'transfer');
});
test('old helper has unchanged snapshot and calling but truthfully refuses transfer', async () => {
  const f = fixture(undefined, false);
  assert.equal('transfer' in f.boundary.snapshot(), false);
  await assert.rejects(f.boundary.handleRendererAction(transfer, session), /unavailable/);
  await f.boundary.handleRendererAction({ ...transfer, operation: 'mute', value: true }, session);
  assert.deepEqual(f.commands.map(c => c.operation), ['mute']);
});
test('connected unheld current authenticated call and confirmed Hold state required', async () => {
  for (const state of ['incoming', 'held', 'dialing']) {
    const f = fixture(); f.event({ type: 'call', callId: '42', state });
    await assert.rejects(f.boundary.handleRendererAction(transfer, session)); assert.equal(f.commands.length, 0);
  }
  const f = fixture(); f.event({ type: 'hold_error', callId: '42', code: 'state_unconfirmed', holdControl: 'blocked' });
  await assert.rejects(f.boundary.handleRendererAction(transfer, session));
  const clean = fixture();
  for (const changed of [{ ...session, tenantId: 12 }, { ...session, extensionId: 2 }, { ...session, accountId: 'account-2' }, { ...session, userId: 'user-2' }])
    await assert.rejects(clean.boundary.handleRendererAction(transfer, changed));
  for (const changed of [{ generation: 'old-helper' }, { callId: '43' }, { sessionRevision: 'old-session' }])
    await assert.rejects(clean.boundary.handleRendererAction({ ...transfer, ...changed }, session));
  assert.equal(clean.commands.length, 0);
});
test('acceptance stays pending, callback 0 confirms without auto-ending original call', async () => {
  const f = fixture(); await f.boundary.handleRendererAction(transfer, session);
  assert.equal(f.boundary.snapshot().transfer, 'pending'); assert.equal(f.boundary.snapshot().call?.id, '42');
  assert.match(f.commands[0].intentId!, /^[0-9a-f-]{36}$/);
  assert.equal(f.outcome(0), true); assert.equal(f.boundary.snapshot().transfer, 'confirmed');
  assert.equal(f.boundary.snapshot().call?.id, '42'); assert.equal(f.commands.length, 1);
  assert.equal(f.outcome(486), false); // Duplicate must not change confirmed outcome.
  await assert.rejects(f.boundary.handleRendererAction(transfer, session), /one attempt/);
});
test('sync callback before accepted reply survives acceptance and later request rejection', async () => {
  for (const rejected of [false, true]) {
    let f!: ReturnType<typeof fixture>;
    f = fixture(async command => { if (command.operation === 'transfer') { assert.equal(f.outcome(0), true); if (rejected) throw new HelperCommandRejectedError(); } });
    if (rejected) await assert.rejects(f.boundary.handleRendererAction(transfer, session));
    else await f.boundary.handleRendererAction(transfer, session);
    assert.equal(f.boundary.snapshot().transfer, 'confirmed'); assert.equal(f.boundary.snapshot().call?.id, '42');
  }
});
test('nonzero callbacks including SIP 200 stay unconfirmed and cannot retry', async () => {
  for (const statusCode of [200, 486, 408, 0xffffffff]) {
    const f = fixture(); await f.boundary.handleRendererAction(transfer, session); assert.equal(f.outcome(statusCode), true);
    assert.equal(f.boundary.snapshot().transfer, 'uncertain'); assert.equal(f.boundary.snapshot().call?.id, '42');
    await assert.rejects(f.boundary.handleRendererAction(transfer, session));
    assert.equal(f.commands.length, 1);
  }
});
test('refused request retains original call and consumes this call attempt', async () => {
  const f = fixture(async command => { if (command.operation === 'transfer') throw new HelperCommandRejectedError(); });
  await assert.rejects(f.boundary.handleRendererAction(transfer, session), /original call remains/);
  assert.equal(f.boundary.snapshot().transfer, 'refused'); assert.equal(f.boundary.snapshot().call?.id, '42');
  await assert.rejects(f.boundary.handleRendererAction(transfer, session)); assert.equal(f.commands.length, 1);
  await assert.rejects(f.boundary.handleRendererAction({ ...transfer, operation: 'hold', value: true }, session), /Hold unavailable/);
});
test('timeout and transport uncertainty block duplicate; matching late result can confirm', async () => {
  for (const transport of [false, true]) {
    const f = fixture(async command => { if (transport && command.operation === 'transfer') throw new Error('private'); });
    if (transport) await assert.rejects(f.boundary.handleRendererAction(transfer, session));
    else await f.boundary.handleRendererAction(transfer, session);
    await pause(25); assert.equal(f.boundary.snapshot().transfer, 'uncertain');
    await assert.rejects(f.boundary.handleRendererAction(transfer, session));
    assert.equal(f.outcome(0), true); assert.equal(f.boundary.snapshot().transfer, 'confirmed');
  }
});
test('pending acceptance reserves once, End/Mute remain usable; End supersedes late callback', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async command => { if (command.operation === 'transfer') await gate; });
  const pending = f.boundary.handleRendererAction(transfer, session);
  await assert.rejects(f.boundary.handleRendererAction(transfer, session));
  await f.boundary.handleRendererAction({ ...transfer, operation: 'mute', value: true }, session);
  await f.boundary.handleRendererAction({ ...transfer, operation: 'end' }, session);
  assert.equal(f.outcome(0), false); assert.equal(f.boundary.snapshot().transfer, 'uncertain');
  f.event({ type: 'call', callId: '42', state: 'terminated' });
  f.event({ type: 'call', callId: '43', state: 'connected' });
  release(); await pending;
  assert.equal(f.boundary.snapshot().call?.id, '43'); assert.equal(f.boundary.snapshot().transfer, 'ready');
  assert.equal(f.outcome(0), false); assert.deepEqual(f.commands.map(c => c.operation), ['transfer', 'mute', 'end']);
});
test('wrong intent/account/generation/call cannot consume transfer callback', async () => {
  const f = fixture(); await f.boundary.handleRendererAction(transfer, session);
  for (const changed of [{ intentId: '12345678-1234-4234-8234-123456789abc' }, { accountId: 'other' }, { generation: 'other' }, { callId: '43' }, { sessionRevision: 'other' }])
    assert.equal(f.outcome(0, changed), false);
  assert.equal(f.boundary.snapshot().transfer, 'pending'); assert.equal(f.outcome(0), true);
});
test('termination tombstones reused ID; restart/session swap retire outstanding intent', async () => {
  for (const reset of ['restart', 'session', 'termination']) {
    const f = fixture(); await f.boundary.handleRendererAction(transfer, session);
    if (reset === 'restart') { f.boundary.startHelperGeneration('helper-2'); f.boundary.bindSession(session, 'helper-2'); }
    else if (reset === 'session') f.boundary.clear();
    else { f.event({ type: 'call', callId: '42', state: 'terminated' }); assert.equal(f.event({ type: 'call', callId: '42', state: 'connected' }), false); }
    assert.equal(f.outcome(0), false); assert.equal(f.boundary.snapshot().call, null);
    await pause(25); assert.notEqual(f.boundary.snapshot().transfer, 'uncertain');
  }
});
