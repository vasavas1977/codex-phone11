import assert from "node:assert/strict";
import test from "node:test";
import {
  DesktopCallBoundary,
  HelperCommandRejectedError,
  type DesktopSession,
  type HelperCommand,
  parseRendererAction,
} from "../src/call-boundary";

const binding: DesktopSession = {
  revision: "session-1", userId: "user-3001", tenantId: 11, extensionId: 3001, accountId: "sip-1",
};

function setup() {
  const commands: HelperCommand[] = [];
  const boundary = new DesktopCallBoundary({ execute: async command => { commands.push(command); } });
  boundary.startHelperGeneration("helper-A");
  boundary.bindSession(binding, "helper-A");
  const event = (sequence: number, payload: Record<string, unknown>) => boundary.receiveHelperEvent({
    version: 1, generation: "helper-A", sequence, sessionRevision: binding.revision,
    accountId: binding.accountId, ...payload,
  });
  return { boundary, commands, event };
}

test("renderer actions are allowlisted and reject injected SIP destinations", () => {
  assert.throws(() => parseRendererAction({ operation: "setAccount", sessionRevision: binding.revision, password: "secret" }));
  assert.throws(() => parseRendererAction({ operation: "dial", sessionRevision: binding.revision, destination: "123\r\nHeader: bad" }));
  assert.throws(() => parseRendererAction({ operation: "dial", sessionRevision: binding.revision, destination: "sip:3001@example.com" }));
  assert.deepEqual(parseRendererAction({ operation: "dial", sessionRevision: binding.revision, destination: "+6621234567" }), {
    operation: "dial", sessionRevision: binding.revision, destination: "+6621234567",
  });
});

test("SDK acceptance does not assert a connected call; callback sequence controls state", async () => {
  const { boundary, commands, event } = setup();
  await assert.rejects(boundary.handleRendererAction({ operation: "dial", sessionRevision: binding.revision, destination: "1020" }, binding), /unavailable/);
  assert.equal(event(1, { type: "registration", registered: true }), true);
  const accepted = await boundary.handleRendererAction({ operation: "dial", sessionRevision: binding.revision, destination: "1020" }, binding);
  assert.deepEqual(accepted, { version: 1, registered: true, call: null, dialState: "requesting", callActionState: "idle" });
  assert.equal(commands[0]?.destination, "1020");
  assert.equal(event(2, { type: "call", callId: "42", state: "dialing" }), true);
  assert.equal(boundary.snapshot().call?.state, "dialing");
  assert.equal(event(3, { type: "call", callId: "42", state: "connected" }), true);
  assert.equal(boundary.snapshot().call?.state, "connected");
});

test("exact authenticated session, helper generation, and call ID gate every operation", async () => {
  const { boundary, commands, event } = setup();
  event(1, { type: "registration", registered: true });
  event(2, { type: "call", callId: "42", state: "incoming" });
  const answer = { operation: "answer", sessionRevision: binding.revision, generation: "helper-A", callId: "42" };
  await assert.rejects(boundary.handleRendererAction(answer, { ...binding, tenantId: 12 }), /session changed/);
  await assert.rejects(boundary.handleRendererAction({ ...answer, generation: "helper-B" }, binding), /Call changed/);
  await assert.rejects(boundary.handleRendererAction({ ...answer, callId: "43" }, binding), /Call changed/);
  assert.equal(commands.length, 0);
  await boundary.handleRendererAction(answer, binding);
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.callId, "42");
  assert.equal(boundary.snapshot().call?.state, "incoming");
  boundary.clear();
  await assert.rejects(boundary.handleRendererAction(answer, binding), /session changed/);
});

test("foreign, stale, malformed, and unsupported second-call events fail closed", () => {
  const { boundary, event } = setup();
  assert.equal(event(1, { type: "registration", registered: true, password: "unexpected" }), true);
  assert.equal(event(2, { type: "call", callId: "42", state: "connected" }), true);
  assert.equal(event(2, { type: "call", callId: "42", state: "held" }), false);
  assert.equal(event(3, { type: "call", callId: "43", state: "incoming" }), false);
  assert.equal(event(4, { type: "call", callId: "42", state: "held", generation: "helper-old" }), false);
  assert.equal(event(5, { type: "call", callId: "42", state: "held", sessionRevision: "session-old" }), false);
  assert.equal(event(6, { type: "call", callId: "42", state: "held", accountId: "sip-other" }), false);
  assert.equal(event(7, { type: "call", callId: "42", state: "held", muted: "yes" }), false);
  assert.equal(event(8, { type: "call", callId: "42", state: "held" }), true);
  assert.equal(boundary.snapshot().call?.state, "held");
  assert.equal("password" in boundary.snapshot(), false);
});

test("helper restart clears stale calls and requires trusted rebinding", async () => {
  const { boundary, event } = setup();
  event(1, { type: "registration", registered: true });
  event(2, { type: "call", callId: "42", state: "incoming" });
  boundary.startHelperGeneration("helper-B");
  assert.deepEqual(boundary.snapshot(), { version: 1, registered: false, call: null, dialState: "idle", callActionState: "idle" });
  assert.equal(event(3, { type: "call", callId: "42", state: "connected" }), false);
  await assert.rejects(boundary.handleRendererAction({ operation: "end", sessionRevision: binding.revision, generation: "helper-A", callId: "42" }, binding), /session changed/);
  boundary.bindSession(binding, "helper-B");
  assert.equal(boundary.receiveHelperEvent({ version: 1, generation: "helper-B", sequence: 1, sessionRevision: binding.revision, accountId: binding.accountId, type: "registration", registered: true }), true);
});

test("call controls permit only current connected call and validated DTMF", async () => {
  const { boundary, commands, event } = setup();
  event(1, { type: "registration", registered: true });
  event(2, { type: "call", callId: "42", state: "connected" });
  await boundary.handleRendererAction({ operation: "mute", sessionRevision: binding.revision, generation: "helper-A", callId: "42", value: true }, binding);
  await boundary.handleRendererAction({ operation: "dtmf", sessionRevision: binding.revision, generation: "helper-A", callId: "42", digits: "12a#" }, binding);
  assert.equal(commands[0]?.value, true);
  assert.equal(commands[1]?.value, "12A#");
  assert.throws(() => parseRendererAction({ operation: "dtmf", sessionRevision: binding.revision, generation: "helper-A", callId: "42", digits: "12;rm" }));
  event(3, { type: "call", callId: "42", state: "terminated" });
  await assert.rejects(boundary.handleRendererAction({ operation: "end", sessionRevision: binding.revision, generation: "helper-A", callId: "42" }, binding), /Call changed/);
});

test("registration loss preserves End for a connected call", async () => {
  const { boundary, commands, event } = setup();
  event(1, { type: "registration", registered: true });
  event(2, { type: "call", callId: "42", state: "connected" });
  event(3, { type: "registration", registered: false });
  assert.equal(boundary.snapshot().registered, false);
  assert.equal(boundary.snapshot().call?.id, "42");
  await boundary.handleRendererAction({ operation: "end", sessionRevision: binding.revision, generation: "helper-A", callId: "42" }, binding);
  assert.equal(commands.at(-1)?.operation, "end");
  event(4, { type: "call", callId: "42", state: "terminated" });
  assert.equal(boundary.snapshot().call, null);
});

test("concurrent dial requests reserve one call before the first helper command resolves", async () => {
  let finishFirst!: () => void;
  const firstDone = new Promise<void>(resolve => { finishFirst = resolve; });
  const commands: HelperCommand[] = [];
  const boundary = new DesktopCallBoundary({ execute: async command => { commands.push(command); await firstDone; } });
  boundary.startHelperGeneration("helper-A");
  boundary.bindSession(binding, "helper-A");
  boundary.receiveHelperEvent({ version: 1, generation: "helper-A", sequence: 1, sessionRevision: binding.revision, accountId: binding.accountId, type: "registration", registered: true });
  const action = { operation: "dial", sessionRevision: binding.revision, destination: "1020" };
  const first = boundary.handleRendererAction(action, binding);
  await assert.rejects(boundary.handleRendererAction(action, binding), /unavailable/);
  assert.equal(commands.length, 1);
  finishFirst();
  await first;
  await assert.rejects(boundary.handleRendererAction(action, binding), /unavailable/);
  boundary.receiveHelperEvent({ version: 1, generation: "helper-A", sequence: 2, sessionRevision: binding.revision, accountId: binding.accountId, type: "call", callId: "42", state: "dialing" });
  assert.equal(boundary.snapshot().dialState, "idle");
  await assert.rejects(boundary.handleRendererAction(action, binding), /unavailable/);
});

test("a helper command failure releases dial reservation; missing callback fails closed for reconciliation", async () => {
  const failed = new DesktopCallBoundary({ execute: async () => { throw new Error("secret native error"); } });
  failed.startHelperGeneration("helper-A");
  failed.bindSession(binding, "helper-A");
  failed.receiveHelperEvent({ version: 1, generation: "helper-A", sequence: 1, sessionRevision: binding.revision, accountId: binding.accountId, type: "registration", registered: true });
  const action = { operation: "dial", sessionRevision: binding.revision, destination: "1020" };
  await assert.rejects(failed.handleRendererAction(action, binding), /Call could not start/);
  assert.equal(failed.snapshot().dialState, "idle");

  const silent = new DesktopCallBoundary({ execute: async () => {} }, 5);
  silent.startHelperGeneration("helper-A");
  silent.bindSession(binding, "helper-A");
  silent.receiveHelperEvent({ version: 1, generation: "helper-A", sequence: 1, sessionRevision: binding.revision, accountId: binding.accountId, type: "registration", registered: true });
  await silent.handleRendererAction(action, binding);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(silent.snapshot().dialState, "reconcile");
  await assert.rejects(silent.handleRendererAction(action, binding), /unavailable/);
  silent.startHelperGeneration("helper-B");
  assert.equal(silent.snapshot().dialState, "idle");
});

test("duplicate answer and end commands cannot overlap", async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const boundary = new DesktopCallBoundary({ execute: async () => { await blocked; } });
  boundary.startHelperGeneration("helper-A");
  boundary.bindSession(binding, "helper-A");
  boundary.receiveHelperEvent({ version: 1, generation: "helper-A", sequence: 1, sessionRevision: binding.revision, accountId: binding.accountId, type: "registration", registered: true });
  boundary.receiveHelperEvent({ version: 1, generation: "helper-A", sequence: 2, sessionRevision: binding.revision, accountId: binding.accountId, type: "call", callId: "42", state: "incoming" });
  const answer = { operation: "answer", sessionRevision: binding.revision, generation: "helper-A", callId: "42" };
  const first = boundary.handleRendererAction(answer, binding);
  await assert.rejects(boundary.handleRendererAction(answer, binding), /in progress/);
  release();
  await first;
  await assert.rejects(boundary.handleRendererAction(answer, binding), /in progress/);
  assert.equal(boundary.snapshot().callActionState, "requesting");
  boundary.receiveHelperEvent({ version: 1, generation: "helper-A", sequence: 3, sessionRevision: binding.revision, accountId: binding.accountId, type: "call", callId: "42", state: "connected" });
  assert.equal(boundary.snapshot().callActionState, "idle");

  const end = { operation: "end", sessionRevision: binding.revision, generation: "helper-A", callId: "42" };
  await boundary.handleRendererAction(end, binding);
  await assert.rejects(boundary.handleRendererAction(end, binding), /in progress/);
  boundary.receiveHelperEvent({ version: 1, generation: "helper-A", sequence: 4, sessionRevision: binding.revision, accountId: binding.accountId, type: "call", callId: "42", state: "terminated" });
  assert.equal(boundary.snapshot().callActionState, "idle");
});

test("answer and end remain reserved after command acceptance until matching callbacks", async () => {
  const { boundary, event, commands } = setup();
  event(1, { type: "registration", registered: true });
  event(2, { type: "call", callId: "42", state: "incoming" });
  const answer = { operation: "answer", sessionRevision: binding.revision, generation: "helper-A", callId: "42" };
  await boundary.handleRendererAction(answer, binding);
  await assert.rejects(boundary.handleRendererAction(answer, binding), /in progress/);
  assert.equal(commands.length, 1);
  event(3, { type: "call", callId: "42", state: "ringing" });
  assert.equal(boundary.snapshot().callActionState, "requesting");
  event(4, { type: "call", callId: "42", state: "connected" });
  assert.equal(boundary.snapshot().callActionState, "idle");
  const end = { operation: "end", sessionRevision: binding.revision, generation: "helper-A", callId: "42" };
  await boundary.handleRendererAction(end, binding);
  await assert.rejects(boundary.handleRendererAction(end, binding), /in progress/);
  assert.equal(commands.length, 2);
  event(5, { type: "call", callId: "42", state: "held" });
  assert.equal(boundary.snapshot().callActionState, "requesting");
  event(6, { type: "call", callId: "42", state: "terminated" });
  assert.equal(boundary.snapshot().callActionState, "idle");
});

test("answer callback timeout requires reconciliation and blocks duplicate helper commands", async () => {
  const commands: HelperCommand[] = [];
  const boundary = new DesktopCallBoundary({ execute: async command => { commands.push(command); } }, 5);
  boundary.startHelperGeneration("helper-A");
  boundary.bindSession(binding, "helper-A");
  const event = (sequence: number, payload: Record<string, unknown>) => boundary.receiveHelperEvent({
    version: 1, generation: "helper-A", sequence, sessionRevision: binding.revision, accountId: binding.accountId, ...payload,
  });
  event(1, { type: "registration", registered: true });
  event(2, { type: "call", callId: "42", state: "incoming" });
  const answer = { operation: "answer", sessionRevision: binding.revision, generation: "helper-A", callId: "42" };
  await boundary.handleRendererAction(answer, binding);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(boundary.snapshot().callActionState, "reconcile");
  await assert.rejects(boundary.handleRendererAction(answer, binding), /in progress/);
  assert.equal(commands.length, 1);
  event(3, { type: "call", callId: "42", state: "connected" });
  assert.equal(boundary.snapshot().callActionState, "idle");
});

test("native SIP errors are not returned to the renderer for any call control", async () => {
  for (const operation of ["answer", "end", "mute", "hold", "dtmf"] as const) {
    const marker = "secret SIP password 407 challenge";
    const boundary = new DesktopCallBoundary({ execute: async () => { throw new Error(marker); } });
    boundary.startHelperGeneration("helper-A");
    boundary.bindSession(binding, "helper-A");
    boundary.receiveHelperEvent({ version: 1, generation: "helper-A", sequence: 1, sessionRevision: binding.revision, accountId: binding.accountId, type: "registration", registered: true });
    boundary.receiveHelperEvent({ version: 1, generation: "helper-A", sequence: 2, sessionRevision: binding.revision, accountId: binding.accountId, type: "call", callId: "42", state: operation === "answer" ? "incoming" : "connected" });
    const action = { operation, sessionRevision: binding.revision, generation: "helper-A", callId: "42",
      ...(operation === "mute" || operation === "hold" ? { value: true } : {}),
      ...(operation === "dtmf" ? { digits: "12#" } : {}) };
    await assert.rejects(boundary.handleRendererAction(action, binding), error => {
      assert.equal((error as Error).message, "Call action could not complete");
      assert.equal(String(error).includes(marker), false);
      return true;
    });
    assert.equal(boundary.snapshot().callActionState,
      operation === "answer" || operation === "end" ? "reconcile" : "idle");
  }
});

test("End remains available after a lost Answer callback and stale callbacks cannot revive the ended call", async () => {
  const commands: HelperCommand[] = [];
  const boundary = new DesktopCallBoundary({ execute: async command => { commands.push(command); } }, 5);
  boundary.startHelperGeneration("helper-A");
  boundary.bindSession(binding, "helper-A");
  const event = (sequence: number, payload: Record<string, unknown>) => boundary.receiveHelperEvent({
    version: 1, generation: "helper-A", sequence, sessionRevision: binding.revision, accountId: binding.accountId, ...payload,
  });
  event(1, { type: "registration", registered: true });
  event(2, { type: "call", callId: "42", state: "incoming" });
  const answer = { operation: "answer", sessionRevision: binding.revision, generation: "helper-A", callId: "42" };
  await boundary.handleRendererAction(answer, binding);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(boundary.snapshot().callActionState, "reconcile");

  const end = { operation: "end", sessionRevision: binding.revision, generation: "helper-A", callId: "42" };
  await boundary.handleRendererAction(end, binding);
  assert.deepEqual(commands.map(command => command.operation), ["answer", "end"]);
  await assert.rejects(boundary.handleRendererAction(end, binding), /in progress/);
  assert.equal(event(3, { type: "call", callId: "42", state: "connected" }), true);
  assert.equal(boundary.snapshot().callActionState, "requesting");
  assert.equal(event(4, { type: "call", callId: "42", state: "terminated" }), true);
  assert.equal(boundary.snapshot().call, null);
  assert.equal(event(5, { type: "call", callId: "42", state: "connected" }), false);
  assert.equal(boundary.snapshot().call, null);
});

test("an ambiguous End failure remains in reconciliation without exposing native details or permitting a duplicate", async () => {
  const marker = "secret SIP 407 realm";
  const commands: HelperCommand[] = [];
  const boundary = new DesktopCallBoundary({ execute: async command => {
    commands.push(command);
    if (command.operation === "end") throw new Error(marker);
  } }, 5);
  boundary.startHelperGeneration("helper-A");
  boundary.bindSession(binding, "helper-A");
  boundary.receiveHelperEvent({ version: 1, generation: "helper-A", sequence: 1, sessionRevision: binding.revision, accountId: binding.accountId, type: "registration", registered: true });
  boundary.receiveHelperEvent({ version: 1, generation: "helper-A", sequence: 2, sessionRevision: binding.revision, accountId: binding.accountId, type: "call", callId: "42", state: "incoming" });
  const end = { operation: "end", sessionRevision: binding.revision, generation: "helper-A", callId: "42" };
  await assert.rejects(boundary.handleRendererAction(end, binding), error => {
    assert.equal((error as Error).message, "Call action could not complete");
    assert.equal(String(error).includes(marker), false);
    return true;
  });
  assert.equal(boundary.snapshot().callActionState, "reconcile");
  await assert.rejects(boundary.handleRendererAction(end, binding), /in progress/);
  assert.equal(commands.length, 1);
});

test("a definite End refusal releases only its exact reservation and permits a safe retry", async () => {
  const commands: HelperCommand[] = [];
  let rejectFirst!: (error: Error) => void;
  const firstHelperResult = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
  const boundary = new DesktopCallBoundary({ execute: async command => {
    commands.push(command);
    if (command.operation === "end" && commands.length === 1) await firstHelperResult;
  } }, 5);
  boundary.startHelperGeneration("helper-A");
  boundary.bindSession(binding, "helper-A");
  const event = (sequence: number, payload: Record<string, unknown>) => boundary.receiveHelperEvent({
    version: 1, generation: "helper-A", sequence, sessionRevision: binding.revision, accountId: binding.accountId, ...payload,
  });
  event(1, { type: "registration", registered: true });
  event(2, { type: "call", callId: "42", state: "connected" });
  const end = { operation: "end", sessionRevision: binding.revision, generation: "helper-A", callId: "42" };
  const first = boundary.handleRendererAction(end, binding);
  await assert.rejects(boundary.handleRendererAction(end, binding), /in progress/);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(boundary.snapshot().callActionState, "reconcile");
  rejectFirst(new HelperCommandRejectedError());
  await assert.rejects(first, error => {
    assert.equal((error as Error).message, "Call action could not complete");
    return true;
  });
  assert.equal(boundary.snapshot().callActionState, "idle");
  assert.equal(boundary.snapshot().call?.id, "42");
  await boundary.handleRendererAction(end, binding);
  assert.equal(commands.length, 2);
  assert.equal(boundary.snapshot().callActionState, "requesting");
  assert.equal(event(3, { type: "call", callId: "42", state: "held" }), true);
  await assert.rejects(boundary.handleRendererAction(end, binding), /in progress/);
  assert.equal(event(4, { type: "call", callId: "42", state: "terminated" }), true);
  assert.equal(boundary.snapshot().callActionState, "idle");
  assert.equal(event(5, { type: "call", callId: "42", state: "connected" }), false);
  await assert.rejects(boundary.handleRendererAction(end, binding), /Call changed/);
});

test("refused End restores uncertainty from an accepted Answer whose callback was lost", async () => {
  const commands: HelperCommand[] = [];
  let endAttempts = 0;
  const boundary = new DesktopCallBoundary({ execute: async command => {
    commands.push(command);
    if (command.operation === "end" && ++endAttempts === 1) throw new HelperCommandRejectedError();
  } }, 5);
  boundary.startHelperGeneration("helper-A");
  boundary.bindSession(binding, "helper-A");
  const event = (sequence: number, state: string) => boundary.receiveHelperEvent({
    version: 1, generation: "helper-A", sequence, sessionRevision: binding.revision,
    accountId: binding.accountId, type: "call", callId: "42", state,
  });
  boundary.receiveHelperEvent({ version: 1, generation: "helper-A", sequence: 1,
    sessionRevision: binding.revision, accountId: binding.accountId, type: "registration", registered: true });
  event(2, "incoming");
  const answer = { operation: "answer", sessionRevision: binding.revision, generation: "helper-A", callId: "42" };
  const end = { operation: "end", sessionRevision: binding.revision, generation: "helper-A", callId: "42" };
  await boundary.handleRendererAction(answer, binding);
  await assert.rejects(boundary.handleRendererAction(end, binding), /Call action could not complete/);
  assert.equal(boundary.snapshot().call?.state, "incoming");
  assert.equal(boundary.snapshot().callActionState, "reconcile");
  await assert.rejects(boundary.handleRendererAction(answer, binding), /in progress/);
  assert.deepEqual(commands.map(command => command.operation), ["answer", "end"]);
  await boundary.handleRendererAction(end, binding);
  assert.deepEqual(commands.map(command => command.operation), ["answer", "end", "end"]);
  assert.equal(event(3, "connected"), true);
  assert.equal(boundary.snapshot().callActionState, "requesting");
  await assert.rejects(boundary.handleRendererAction(end, binding), /in progress/);
  assert.equal(event(4, "terminated"), true);
  assert.equal(event(5, "connected"), false);
});

test("a connected callback while End is pending resolves prior Answer uncertainty", async () => {
  let rejectEnd!: (error: Error) => void;
  const endResult = new Promise<void>((_resolve, reject) => { rejectEnd = reject; });
  const commands: HelperCommand[] = [];
  const boundary = new DesktopCallBoundary({ execute: async command => {
    commands.push(command);
    if (command.operation === "end" && commands.length === 2) await endResult;
  } }, 5);
  boundary.startHelperGeneration("helper-A");
  boundary.bindSession(binding, "helper-A");
  const event = (sequence: number, state: string) => boundary.receiveHelperEvent({
    version: 1, generation: "helper-A", sequence, sessionRevision: binding.revision,
    accountId: binding.accountId, type: "call", callId: "42", state,
  });
  boundary.receiveHelperEvent({ version: 1, generation: "helper-A", sequence: 1,
    sessionRevision: binding.revision, accountId: binding.accountId, type: "registration", registered: true });
  event(2, "incoming");
  const answer = { operation: "answer", sessionRevision: binding.revision, generation: "helper-A", callId: "42" };
  const end = { operation: "end", sessionRevision: binding.revision, generation: "helper-A", callId: "42" };
  await boundary.handleRendererAction(answer, binding);
  const firstEnd = boundary.handleRendererAction(end, binding);
  assert.equal(event(3, "connected"), true);
  rejectEnd(new HelperCommandRejectedError());
  await assert.rejects(firstEnd, /Call action could not complete/);
  assert.equal(boundary.snapshot().callActionState, "idle");
  await assert.rejects(boundary.handleRendererAction(answer, binding), /not ringing/);
  await boundary.handleRendererAction(end, binding);
  assert.deepEqual(commands.map(command => command.operation), ["answer", "end", "end"]);
  event(4, "terminated");
});

test("late rejection from an old helper generation cannot clear a new End reservation", async () => {
  let rejectOld!: (error: Error) => void;
  const oldResult = new Promise<void>((_resolve, reject) => { rejectOld = reject; });
  const commands: HelperCommand[] = [];
  const boundary = new DesktopCallBoundary({ execute: async command => {
    commands.push(command);
    if (command.generation === "helper-A") await oldResult;
  } });
  const callEvent = (generation: string, sequence: number, state: string) => boundary.receiveHelperEvent({
    version: 1, generation, sequence, sessionRevision: binding.revision, accountId: binding.accountId,
    type: "call", callId: "42", state,
  });
  const register = (generation: string) => boundary.receiveHelperEvent({
    version: 1, generation, sequence: 1, sessionRevision: binding.revision, accountId: binding.accountId,
    type: "registration", registered: true,
  });
  boundary.startHelperGeneration("helper-A");
  boundary.bindSession(binding, "helper-A");
  register("helper-A");
  callEvent("helper-A", 2, "connected");
  const oldEnd = boundary.handleRendererAction({ operation: "end", sessionRevision: binding.revision,
    generation: "helper-A", callId: "42" }, binding);
  boundary.startHelperGeneration("helper-B");
  boundary.bindSession(binding, "helper-B");
  register("helper-B");
  callEvent("helper-B", 2, "connected");
  await boundary.handleRendererAction({ operation: "end", sessionRevision: binding.revision,
    generation: "helper-B", callId: "42" }, binding);
  rejectOld(new HelperCommandRejectedError());
  await assert.rejects(oldEnd, /Call action could not complete/);
  assert.equal(boundary.snapshot().callActionState, "requesting");
  assert.equal(commands.length, 2);
});
