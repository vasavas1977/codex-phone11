import { PermissionsAndroid, Platform } from "react-native";
import type { SipAccount } from "./account-store";
import type { SipCall } from "./call-store";

export const isAndroidForegroundTrial = () => Platform.OS === "android" &&
  process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix" &&
  process.env.EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL === "1";

export interface AndroidCallPermissionSnapshot {
  owner: { id: number } | null;
  authLoading: boolean;
  account: SipAccount | null;
  incomingCall: SipCall | null;
  activeCalls: Record<string, SipCall>;
}
type Action = { kind: "dial"; destination: string; video: boolean } |
  { kind: "answer"; callId: string; video: boolean };

/** One user action owns the prompt and command until both have settled. */
export function createAndroidCallPermissionGate(snapshot: () => AndroidCallPermissionSnapshot, subscribe: (changed: () => void) => () => void) {
  let disposed = false;
  let pending: { action: Action; assertDuplicate: () => void; unsubscribe: () => void; promise: Promise<unknown> } | null = null;
  const lifetime = (call: SipCall | null) => call?.history?.id ?? call?.startTime?.getTime() ?? call;
  const unchanged = () => { throw new Error("Your phone account or call changed while microphone permission was pending."); };
  const permissionDenied = () => { throw new Error("Microphone permission is required. Allow microphone access in Android Settings, then try again."); };

  function run<T>(action: Action, invoke: (assertCurrent: () => void, commandStarted: () => void) => Promise<T>): Promise<T> {
    if (pending) {
      const sameAction = pending.action.kind === action.kind && pending.action.video === action.video &&
        (pending.action.kind === "dial" && action.kind === "dial"
          ? pending.action.destination === action.destination : pending.action.kind === "answer" && action.kind === "answer" && pending.action.callId === action.callId);
      if (!sameAction) return Promise.reject(new Error("Another phone action is waiting for microphone permission or call acceptance."));
      // The command's own callbacks may have progressed the store beyond fresh
      // Dial/Answer eligibility. Validate its captured lifetime before joining.
      try { pending.assertDuplicate(); } catch (error) { return Promise.reject(error); }
      return pending.promise as Promise<T>;
    }
    const initial = snapshot();
    const owner = initial.owner;
    const account = initial.account;
    const incoming = initial.incomingCall;
    const identity = action.kind === "answer" ? lifetime(incoming) : undefined;
    let commandStarted = false;
    let invalidated = false;
    let outgoing: { id: string; lifetime: unknown } | undefined;
    const assertSession = () => {
      const live = snapshot();
      if (disposed || invalidated || !owner || live.authLoading || live.owner !== owner || !account?.enabled ||
          live.account !== account || account.ownerUserId !== owner.id) unchanged();
      return live;
    };
    const ownedCall = (call: SipCall) => call.history?.ownerUserId === undefined || call.history.ownerUserId === owner!.id;
    const assertCurrent = () => {
      const live = assertSession();
      if (action.kind === "dial") {
        if ((live.incomingCall && live.incomingCall.status !== "disconnected") ||
            Object.values(live.activeCalls).some(call => call.status !== "disconnected")) unchanged();
      } else {
        const call = live.incomingCall;
        if (!call || call.id !== action.callId || call.status !== "incoming" || lifetime(call) !== identity || !ownedCall(call)) unchanged();
      }
    };
    const assertDuplicate = () => {
      if (!commandStarted) return assertCurrent();
      const live = assertSession();
      const ongoing = [...(live.incomingCall ? [live.incomingCall] : []), ...Object.values(live.activeCalls)]
        .filter(call => call.status !== "disconnected");
      if (action.kind === "answer") {
        // The original lifetime may move to active after a connected callback.
        if (ongoing.length !== 1 || ongoing[0].id !== action.callId || lifetime(ongoing[0]) !== identity || !ownedCall(ongoing[0])) unchanged();
      } else {
        if (!ongoing.length && !outgoing) return; // The command has not published a call yet.
        const call = ongoing[0];
        const uri = /^sips?:/i.test(action.destination) ? action.destination : `sip:${action.destination}@${account!.domain}`;
        if (ongoing.length !== 1 || call.direction !== "outbound" || !ownedCall(call) ||
            (call.remoteNumber !== action.destination && call.remoteNumber !== uri)) unchanged();
        if (!outgoing) outgoing = { id: call.id, lifetime: lifetime(call) };
        if (call.id !== outgoing.id || lifetime(call) !== outgoing.lifetime) unchanged();
      }
    };
    try { assertCurrent(); } catch (error) { return Promise.reject(error); }
    // Defer until pending is assigned, so duplicate taps share the entire action.
    const operation = Promise.resolve().then(async () => {
      assertCurrent();
      const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      assertCurrent();
      if (!granted) {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        assertCurrent();
        if (result !== PermissionsAndroid.RESULTS.GRANTED) permissionDenied();
      }
      assertCurrent();
      return invoke(assertCurrent, () => { assertCurrent(); commandStarted = true; });
    });
    const record = { action, assertDuplicate, unsubscribe: () => {}, promise: operation as Promise<unknown> };
    const settled = operation.finally(() => { record.unsubscribe(); if (pending === record) pending = null; });
    record.promise = settled;
    pending = record;
    // Capture the first outgoing lifetime before a later same-peer replacement
    // can reuse its ID. Store observers never throw into a native callback.
    const unsubscribe = subscribe(() => { try { assertDuplicate(); } catch { invalidated = true; } });
    let observing = true;
    record.unsubscribe = () => { if (observing) { observing = false; unsubscribe(); } };
    return settled;
  }
  return { run, dispose: () => { disposed = true; pending?.unsubscribe(); } };
}
