import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DesktopHelperSupervisor, type SipAccountSecret } from "../src/helper-supervisor";
import type { DesktopSession } from "../src/call-boundary";

const binding: DesktopSession = {
  revision: "session-1", userId: "user-3001", tenantId: 11, extensionId: 3001, accountId: "sip-1",
};
const secret: SipAccountSecret = {
  accountId: binding.accountId, server: "pbx.example.invalid", extension: "3001",
  authId: "3001", password: "fake-private-password", transport: "TLS",
};
const fake = `
const readline = require('node:readline');
const fs = require('node:fs');
const mode = process.argv[2];
const marker = process.argv[3];
if (mode === 'ignore-shutdown') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
let fields = 0;
let registered = false;
let call = null;
const out = value => process.stdout.write(JSON.stringify({ version: 1, ...value }) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  if (fields) {
    fields--;
    if (!fields) {
      out({ ok: true, initialized: true });
      registered = true;
      out({ event: 'registration', registered: true, accountId: 'forged-account' });
      if (mode === 'inbound') setTimeout(() => { call = '200'; out({ event: 'call', callId: call, state: 'incoming', muted: false }); }, 10);
    }
    return;
  }
  if (line === 'v1 init') {
    if (mode === 'slow-init') setTimeout(() => out({ ok: true, initialized: true }), 80);
    else out({ ok: true, initialized: true });
  }
  else if (line === 'v1 provision') { fs.appendFileSync(marker, 'provision\\n'); fields = 5; }
  else if (line === 'v1 snapshot') out({ ok: true, initialized: true, registered, callId: call });
  else if (line === 'v1 shutdown') {
    if (mode === 'ignore-shutdown') return;
    out({ ok: true, initialized: false });
    if (mode === 'slow-shutdown') setTimeout(() => process.exit(0), 80);
    else process.exit(0);
  }
  else if (line.startsWith('v1 dial ')) {
    if (mode === 'no-reply') return;
    if (mode === 'delayed-reply') { setTimeout(() => out({ ok: true, initialized: true }), 80); return; }
    out({ ok: true, initialized: true });
    if (mode !== 'silent') {
      call = '201';
      out({ event: 'call', callId: call, state: 'dialing', muted: false,
        generation: 'forged-generation', sessionRevision: 'forged-session' });
      setTimeout(() => out({ event: 'call', callId: call, state: 'connected', muted: false }), 10);
    }
  } else if (line === 'v1 answer 200') {
    out({ ok: true, initialized: true });
    setTimeout(() => out({ event: 'call', callId: '200', state: 'connected', muted: false }), 10);
  } else if (line.startsWith('v1 end ')) {
    out({ ok: true, initialized: true });
    out({ event: 'call', callId: line.slice(7), state: 'terminated', muted: false });
    setTimeout(() => out({ event: 'call', callId: line.slice(7), state: 'connected', muted: false }), 10);
  } else if (line.startsWith('v1 mute ') || line.startsWith('v1 hold ') || line.startsWith('v1 dtmf ')) {
    out({ ok: true, initialized: true });
  } else out({ ok: false, initialized: true, code: 'secret native response' });
});
`;

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (predicate: () => boolean) => {
  for (let i = 0; i < 30; i++) {
    if (predicate()) return;
    await pause(10);
  }
  assert.fail("expected helper event did not arrive");
};

function harness(mode: string) {
  const directory = mkdtempSync(join(tmpdir(), "phone11-helper-supervisor-"));
  const script = join(directory, "fake-helper.cjs");
  const marker = join(directory, "provision-observed");
  writeFileSync(script, fake);
  let session: DesktopSession | null = binding;
  const snapshots: string[] = [];
  const children: ChildProcess[] = [];
  const supervisor = new DesktopHelperSupervisor({
    helperPath: join(directory, "phone11_siprix_helper"), currentSession: () => session,
    provision: async () => secret, dialCallbackTimeoutMs: 25, commandTimeoutMs: 250,
    verifyHelper: async () => true, shutdownGraceMs: 40,
    onSnapshot: snapshot => snapshots.push(JSON.stringify(snapshot)),
    launch: () => {
      const child = spawn(process.execPath, [script, mode, marker], { stdio: ["pipe", "pipe", "ignore"] });
      children.push(child);
      return child;
    },
  });
  return { supervisor, snapshots, children, marker, setSession: (next: DesktopSession | null) => { session = next; },
    cleanup: () => { supervisor.stop(); rmSync(directory, { recursive: true, force: true }); } };
}

test("dial events are bound to authenticated session, not helper-supplied metadata", async () => {
  const h = harness("dial");
  try {
    const generation = await h.supervisor.start();
    assert.equal(readFileSync(h.marker, "utf8"), "provision\n");
    await waitFor(() => h.supervisor.snapshot().registered);
    await h.supervisor.handleRendererAction({ operation: "dial", sessionRevision: binding.revision, destination: "1020" });
    await waitFor(() => h.supervisor.snapshot().call?.state === "connected");
    assert.equal(h.supervisor.snapshot().call?.id, "201");
    assert.equal(h.snapshots.join(" ").includes("fake-private-password"), false);
    assert.equal(h.snapshots.join(" ").includes("forged-"), false);
    await h.supervisor.handleRendererAction({ operation: "end", sessionRevision: binding.revision, generation, callId: "201" });
    await waitFor(() => h.supervisor.snapshot().call === null);
    await pause(20);
    assert.equal(h.supervisor.snapshot().call, null); // late connected event cannot revive it
  } finally { h.cleanup(); }
});

test("inbound Answer and End remain single-call operations", async () => {
  const h = harness("inbound");
  try {
    const generation = await h.supervisor.start();
    await waitFor(() => h.supervisor.snapshot().call?.state === "incoming");
    await h.supervisor.handleRendererAction({ operation: "answer", sessionRevision: binding.revision, generation, callId: "200" });
    await waitFor(() => h.supervisor.snapshot().call?.state === "connected");
    await h.supervisor.handleRendererAction({ operation: "mute", sessionRevision: binding.revision, generation, callId: "200", value: true });
    await h.supervisor.handleRendererAction({ operation: "end", sessionRevision: binding.revision, generation, callId: "200" });
    await waitFor(() => h.supervisor.snapshot().call === null);
  } finally { h.cleanup(); }
});

test("missing dial callback requires reconciliation; restart and session changes fail closed", async () => {
  const h = harness("silent");
  try {
    const old = await h.supervisor.start();
    await waitFor(() => h.supervisor.snapshot().registered);
    await h.supervisor.handleRendererAction({ operation: "dial", sessionRevision: binding.revision, destination: "1020" });
    await waitFor(() => h.supervisor.snapshot().dialState === "reconcile");
    assert.ok(h.snapshots.some(value => JSON.parse(value).dialState === "reconcile"));
    await assert.rejects(h.supervisor.handleRendererAction({ operation: "dial", sessionRevision: binding.revision, destination: "1020" }), /unavailable/);
    h.supervisor.stop();
    assert.equal(h.supervisor.snapshot().dialState, "idle");
    const next = await h.supervisor.start();
    assert.notEqual(next, old);
    h.children[0]?.stdout?.emit("data", '{"version":1,"event":"call","callId":"201","state":"connected","muted":false}\n');
    assert.equal(h.supervisor.snapshot().call, null);
    await assert.rejects(h.supervisor.handleRendererAction({ operation: "end", sessionRevision: binding.revision, generation: old, callId: "201" }), /Call changed/);
    h.setSession({ ...binding, revision: "session-2" });
    assert.equal(h.supervisor.snapshot().registered, false);
    await assert.rejects(h.supervisor.handleRendererAction({ operation: "dial", sessionRevision: binding.revision, destination: "1020" }), /session changed/);
  } finally { h.cleanup(); }
});

test("dial timeout after a tenant switch emits only a cleared snapshot", async () => {
  const h = harness("silent");
  try {
    await h.supervisor.start();
    await waitFor(() => h.supervisor.snapshot().registered);
    await h.supervisor.handleRendererAction({ operation: "dial", sessionRevision: binding.revision, destination: "1020" });
    const beforeSwitch = h.snapshots.length;
    h.setSession({ ...binding, tenantId: 22, revision: "tenant-2" });
    // Do not call snapshot() or stop() here: the boundary timer must detect
    // the change on its own before notifying the renderer.
    await waitFor(() => h.snapshots.length > beforeSwitch);
    await pause(35);
    const afterSwitch = h.snapshots.slice(beforeSwitch).map(value => JSON.parse(value));
    assert.ok(afterSwitch.length > 0);
    assert.ok(afterSwitch.every(value => !value.registered && value.call === null && value.dialState === "idle"));
    assert.equal(h.supervisor.snapshot().registered, false);
  } finally { h.cleanup(); }
});

test("a queued provision frame is never written after a session swap", async () => {
  const h = harness("slow-init");
  try {
    const started = h.supervisor.start();
    await waitFor(() => h.children.length === 1);
    h.setSession({ ...binding, revision: "session-2" });
    await assert.rejects(started, /could not start/);
    assert.equal(existsSync(h.marker), false);
    assert.equal(h.supervisor.snapshot().registered, false);
  } finally { h.cleanup(); }
});

test("graceful shutdown waits for exit before a new generation can spawn", async () => {
  const h = harness("slow-shutdown");
  try {
    const old = await h.supervisor.start();
    const stopping = h.supervisor.stop();
    const restarting = h.supervisor.start();
    await pause(20);
    assert.equal(h.children.length, 1);
    assert.equal(await stopping, true);
    const next = await restarting;
    assert.notEqual(next, old);
    assert.equal(h.children.length, 2);
  } finally { await h.supervisor.stop(); h.cleanup(); }
});

test("stop cancels a restart waiting for the previous helper to exit", async () => {
  const h = harness("slow-shutdown");
  try {
    await h.supervisor.start();
    const draining = h.supervisor.stop();
    const restarting = h.supervisor.start();
    h.supervisor.stop();
    assert.equal(await draining, true);
    await assert.rejects(restarting, /could not start/);
    assert.equal(h.children.length, 1);
  } finally { await h.supervisor.stop(); h.cleanup(); }
});

test("a helper that ignores shutdown is force-terminated before restart", async () => {
  const h = harness("ignore-shutdown");
  try {
    await h.supervisor.start();
    const stopped = await h.supervisor.stop();
    assert.equal(stopped, true);
    assert.equal(h.children[0]?.exitCode !== null || h.children[0]?.signalCode !== null, true);
    await h.supervisor.start();
    assert.equal(h.children.length, 2);
  } finally { await h.supervisor.stop(); h.cleanup(); }
});

test("unverified executable fails before credential lookup or spawn", async () => {
  let provisioned = 0;
  let launched = 0;
  const supervisor = new DesktopHelperSupervisor({
    helperPath: join(tmpdir(), "phone11_siprix_helper"), currentSession: () => binding,
    verifyHelper: async () => false,
    provision: async () => { provisioned++; return secret; },
    launch: () => { launched++; return spawn(process.execPath, ["-e", ""], { stdio: ["pipe", "pipe", "ignore"] }); },
  });
  await assert.rejects(supervisor.start(), /could not start/);
  assert.equal(provisioned, 0);
  assert.equal(launched, 0);
  assert.throws(() => new DesktopHelperSupervisor({
    helperPath: process.execPath, currentSession: () => binding,
    verifyHelper: async () => true, provision: async () => secret,
  }), /Invalid helper configuration/);
});

test("invalid provider binding never launches or exposes credentials", async () => {
  const h = harness("dial");
  try {
    h.setSession(null);
    await assert.rejects(h.supervisor.start(), /could not start/);
    assert.equal(h.supervisor.snapshot().registered, false);
  } finally { h.cleanup(); }
});

test("an unresponsive helper command tears down the pipe without exposing native text", async () => {
  const h = harness("no-reply");
  try {
    await h.supervisor.start();
    await waitFor(() => h.supervisor.snapshot().registered);
    await assert.rejects(h.supervisor.handleRendererAction({ operation: "dial", sessionRevision: binding.revision,
      destination: "1020" }), /Call could not start/);
    assert.equal(h.supervisor.snapshot().registered, false);
    assert.equal(h.supervisor.snapshot().call, null);
  } finally { h.cleanup(); }
});

test("stop while privileged provisioning is pending prevents a late helper spawn", async () => {
  let release!: (secret: SipAccountSecret) => void;
  const pending = new Promise<SipAccountSecret>(resolve => { release = resolve; });
  let launches = 0;
  const supervisor = new DesktopHelperSupervisor({
    helperPath: join(tmpdir(), "phone11_siprix_helper"), currentSession: () => binding,
    provision: async () => pending,
    verifyHelper: async () => true,
    launch: () => { launches++; return spawn(process.execPath, ["-e", ""], { stdio: ["pipe", "pipe", "ignore"] }); },
  });
  const started = supervisor.start();
  supervisor.stop();
  release(secret);
  await assert.rejects(started, /could not start/);
  assert.equal(launches, 0);
});

test("session change during an accepted command never returns the old snapshot", async () => {
  const h = harness("delayed-reply");
  try {
    await h.supervisor.start();
    await waitFor(() => h.supervisor.snapshot().registered);
    const action = h.supervisor.handleRendererAction({ operation: "dial", sessionRevision: binding.revision,
      destination: "1020" });
    h.setSession({ ...binding, revision: "session-2" });
    await assert.rejects(action, /session changed/);
    assert.equal(h.supervisor.snapshot().registered, false);
    assert.equal(h.supervisor.snapshot().call, null);
  } finally { h.cleanup(); }
});
