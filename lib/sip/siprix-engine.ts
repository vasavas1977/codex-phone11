import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { addAuthChangeListener, getAuthSnapshot } from "../_core/auth";
import { useSipAccountStore, type SipAccount } from "./account-store";
import { useSipCallStore } from "./call-store";
import { callNumber } from "./call-history";
import { useSipDiagnosticsStore } from "./diagnostics-store";
import type {
  Phone11SiprixModule, SiprixAccount, SiprixCall, SiprixEvent, SiprixSnapshot,
} from "../../modules/phone11-siprix";

// These compatibility labels belong to call-store, not to the Siprix SDK.
const storeStates = {
  dialing: "PJSIP_INV_STATE_CALLING",
  ringing: "PJSIP_INV_STATE_INCOMING",
  proceeding: "PJSIP_INV_STATE_EARLY",
  connected: "PJSIP_INV_STATE_CONFIRMED",
  held: "PJSIP_INV_STATE_CONFIRMED",
  terminated: "PJSIP_INV_STATE_DISCONNECTED",
} as const;

function unsupported(feature: string): Error {
  return new Error(`Siprix iOS voice trial does not support ${feature}`);
}

function nativeCall(call: SiprixCall) {
  return {
    getId: () => call.callId,
    getState: () => storeStates[call.state],
    getRemoteUri: () => call.remoteUri,
    getInfo: () => ({ state: storeStates[call.state], remoteUri: call.remoteUri }),
    xferReplaces: async () => { throw unsupported("attended transfer"); },
  };
}

type Session = {
  revision: number;
  account: SipAccount;
  generation: number | null;
  accountId: string | null;
};

const accountFields = [
  "ownerUserId", "id", "displayName", "username", "password", "domain", "proxy",
  "port", "transport", "srtp", "stun", "enabled",
] as const satisfies ReadonlyArray<keyof SipAccount>;

function sameAccount(snapshot: SipAccount, account: SipAccount | null): boolean {
  // Secure-store hydration creates new objects. Compare credentials privately, never log them.
  return account !== null && accountFields.every(field => snapshot[field] === account[field]);
}

export class SiprixEngine {
  private bridge: Phone11SiprixModule | null = null;
  private session: Session | null = null;
  private revision = 0;
  private lifecycle: Promise<unknown> = Promise.resolve();
  private subscriptions: Array<() => void> = [];
  private sequence = -1;
  private networkLost = false;
  private calls = new Map<string, SiprixCall>();
  private terminated = new Set<string>();
  private connected = new Set<string>();
  private audioActive = false;
  private callManager: typeof import("./native-call").nativeCallManager | null = null;

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.lifecycle.then(operation, operation);
    this.lifecycle = task.catch(() => undefined);
    return task;
  }

  private current(session = this.session): session is Session {
    return Boolean(session && session === this.session && session.revision === this.revision &&
      session.account.enabled && sameAccount(session.account, useSipAccountStore.getState().account) &&
      session.account.ownerUserId === getAuthSnapshot().user?.id);
  }

  private failure(operation: string, error?: unknown): Error {
    // Native response text may contain SIP headers. Keep diagnostics and UI errors bounded.
    const code = (error as { code?: unknown })?.code;
    const suffix = typeof code === "string" && /^(?:E_[A-Z0-9_]+|E_SIPRIX_-?\d+)$/.test(code) ? ` (${code})` : "";
    const message = `Siprix ${operation} failed${suffix}`;
    useSipDiagnosticsStore.getState().addEvent({ level: "error", category: "engine", message });
    return new Error(message);
  }

  initialize(): Promise<void> {
    const revision = this.revision;
    return this.serialize(async () => {
      if (revision !== this.revision) return;
      const configured = useSipAccountStore.getState().account;
      const account = configured ? { ...configured } : null;
      if (!account?.enabled || !account.ownerUserId || account.ownerUserId !== getAuthSnapshot().user?.id) {
        if (this.bridge) await this.cleanup();
        useSipAccountStore.getState().setRegistrationState("unregistered", "Sign in and sync your Phone11 extension");
        return;
      }
      if (Platform.OS !== "ios") {
        const error = unsupported(`${Platform.OS}; no PJSIP fallback is enabled in this build`);
        useSipAccountStore.getState().setRegistrationState("failed", error.message);
        throw error;
      }
      if (this.current() && this.session?.accountId) return;
      if (this.bridge) await this.cleanup();
      if (revision !== this.revision) return;
      const bridge = NativeModules.Phone11Siprix as Phone11SiprixModule | undefined;
      if (!bridge) {
        const error = new Error("Phone11Siprix native module is missing; install a Siprix-enabled iOS build");
        useSipAccountStore.getState().setRegistrationState("failed", error.message);
        throw error;
      }
      this.bridge = bridge;
      const session: Session = { revision, account, generation: null, accountId: null };
      this.session = session;
      const invalidate = () => {
        if (this.session === session && !this.current(session)) {
          void this.destroy().catch(() => undefined);
        }
      };
      this.subscriptions.push(addAuthChangeListener(invalidate), useSipAccountStore.subscribe(invalidate));
      useSipAccountStore.getState().setRegistrationState("registering");
      try {
        // A native session surviving a JS reload has no authenticated JS owner. Remove it first.
        const previous = await bridge.getSnapshot();
        if (previous.initialized) await bridge.destroy();
        if (!this.current(session)) { await this.cleanup(); return; }
        const started = await bridge.initialize({});
        if (!this.current(session)) { await this.cleanup(); return; }
        if (!started.initialized || !Number.isSafeInteger(started.generation)) throw new Error("Invalid native initialization");
        session.generation = started.generation;
        this.sequence = started.sequence;
        useSipDiagnosticsStore.getState().addEvent({
          level: "info", category: "engine", message: "Siprix native engine initialized",
          context: { engine: "siprix", sdkVersion: started.sdkVersion ?? "unknown", generation: started.generation },
        });
        const { nativeCallManager } = await import("./native-call");
        await nativeCallManager.initialize();
        if (!this.current(session)) { await this.cleanup(); return; }
        this.callManager = nativeCallManager;
        const listener = new NativeEventEmitter(bridge as never).addListener(
          "Phone11SiprixEvent", (event: SiprixEvent) => this.onEvent(event, session),
        );
        this.subscriptions.push(() => listener.remove());
        const created = await bridge.createAccount({
          sipServer: account.domain, sipExtension: account.username, sipPassword: account.password,
          sipAuthId: account.username,
          ...(account.proxy ? { sipProxy: account.proxy } : {}),
          displName: account.displayName || account.username, transport: account.transport,
          port: account.port, secureMedia: account.srtp ? 1 : 0,
          ...(account.stun ? { stunServer: account.stun } : {}),
        });
        if (!this.current(session)) { await this.cleanup(); return; }
        if (!created.accountId) throw new Error("Missing native account ID");
        session.accountId = created.accountId;
        await bridge.registerAccount(created.accountId, 300);
        if (!this.current(session)) { await this.cleanup(); return; }
        this.applySnapshot(await bridge.getSnapshot(), session);
        if (!this.current(session)) await this.cleanup();
      } catch (error) {
        const relevant = this.current(session);
        await this.cleanup();
        if (!relevant) return;
        const failure = this.failure("initialization", error);
        useSipAccountStore.getState().setRegistrationState("failed", failure.message);
        throw failure;
      }
    });
  }

  private registration(account: SiprixAccount, fromSnapshot = false): void {
    if (account.accountId !== this.session?.accountId) return;
    if (fromSnapshot && this.networkLost) return;
    // Siprix.h RegState: success=0, failed=1, removed=2, inProgress=3.
    // accountAdd/registerAccount command acceptance is never registration confirmation.
    const state = account.registrationState;
    if (state === "registered" && account.regState !== 0) return;
    if (!["registered", "registering", "unregistered", "failed"].includes(state)) return;
    if (!fromSnapshot) this.networkLost = false;
    useSipAccountStore.getState().setRegistrationState(state,
      state === "failed" ? "Siprix native registration failed" : undefined);
    useSipDiagnosticsStore.getState().addEvent({
      level: state === "failed" ? "error" : "info", category: "registration",
      message: `Siprix registration ${state}`,
      context: {
        accountId: account.accountId, regState: account.regState ?? "unknown",
        ...(Number.isInteger(account.sipStatusCode) ? { sipStatusCode: account.sipStatusCode! } : {}),
      },
    });
  }

  private onEvent(event: SiprixEvent, session: Session): void {
    if (!this.current(session) || event.generation !== session.generation ||
      !Number.isSafeInteger(event.sequence) || event.sequence <= this.sequence) return;
    this.sequence = event.sequence;
    if (event.type === "registration" && "account" in event) {
      this.registration(event.account);
    } else if (["callIncoming", "callProceeding", "callConnected", "callTerminated", "callHeld", "callMuted"].includes(event.type) && "call" in event) {
      this.applyCall(event.call, event.type === "callConnected");
    } else if (event.type === "network" && "networkState" in event && event.networkState === 0) {
      this.networkLost = true;
      useSipAccountStore.getState().setRegistrationState("network_error", "Siprix network lost");
    } else if (event.type === "audioSession" && "audioSessionActive" in event && typeof event.audioSessionActive === "boolean") {
      this.audioActive = event.audioSessionActive;
      useSipDiagnosticsStore.getState().addEvent({
        level: "info", category: "media", message: "Siprix native audio session changed",
        context: { active: event.audioSessionActive },
      });
    } else if (event.type === "error") {
      this.failure("native event");
    }
  }

  private applySnapshot(snapshot: SiprixSnapshot, session: Session): void {
    if (!this.current(session) || !snapshot.initialized || snapshot.generation !== session.generation ||
      !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < this.sequence) return;
    this.sequence = snapshot.sequence;
    this.audioActive = snapshot.audioSessionActive;
    const account = snapshot.accounts.find(item => item.accountId === session.accountId);
    if (account) this.registration(account, true);
    else useSipAccountStore.getState().setRegistrationState("unregistered");
    const present = new Set(snapshot.calls.map(call => call.callId));
    for (const id of this.calls.keys()) if (!present.has(id)) this.endCall(id);
    for (const call of snapshot.calls) this.applyCall(call, call.state === "connected");
  }

  private endCall(id: string): void {
    if (this.calls.has(id)) this.callManager?.reportCallEnded(id);
    this.terminated.add(id);
    this.connected.delete(id);
    this.calls.delete(id);
    useSipCallStore.getState().terminateCall(id);
  }

  private applyCall(call: SiprixCall, confirmed = false): void {
    if (call.accountId !== this.session?.accountId || !call.callId || !(call.state in storeStates)) return;
    if (call.state === "terminated") { this.endCall(call.callId); return; }
    if (this.terminated.has(call.callId)) return;
    if (call.hasVideo || (this.calls.size > 0 && !this.calls.has(call.callId))) {
      void this.bridge?.hangupCall(call.callId).catch(() => this.failure("reject unsupported call"));
      return;
    }
    const previous = this.calls.get(call.callId);
    if (previous && ["connected", "held"].includes(previous.state) &&
      ["dialing", "proceeding", "ringing"].includes(call.state)) return;
    this.calls.set(call.callId, call);
    const handle = nativeCall(call);
    const store = useSipCallStore.getState();
    if (!previous) {
      // System UI/history get a display handle; the engine and SIP routing retain the full URI.
      const displayHandle = callNumber(call.remoteUri);
      if (call.direction === "incoming") {
        this.callManager?.displayIncomingCall(call.callId, displayHandle);
        store.setIncomingCall(handle);
      } else {
        this.callManager?.reportOutgoingCall(call.callId, displayHandle);
        store.addOutgoingCall(handle, call.remoteUri);
      }
    }
    store.updateCallState(handle);
    store.setMuted(call.callId, call.muted);
    if (call.state === "connected" || call.state === "held") store.setHeld(call.callId, call.holdState !== 0);
    if (confirmed && call.state === "connected" && !this.connected.has(call.callId)) {
      this.connected.add(call.callId);
      this.callManager?.reportCallConnected(call.callId);
    }
  }

  makeCall(destination: string, video = false): Promise<string | null> {
    if (video) return Promise.reject(unsupported("video calls"));
    const revision = this.revision;
    return this.serialize(async () => {
      if (revision !== this.revision) throw new Error("Siprix phone session changed");
      const session = this.requireSession();
      if (useSipAccountStore.getState().registrationState !== "registered") throw new Error("Siprix is not registered yet");
      if (this.calls.size) throw unsupported("a second call or attended transfer (single-call mode)");
      const target = destination.trim();
      if (!target || /[\r\n\s]/.test(target)) throw new Error("Invalid SIP destination");
      const uri = /^sips?:/i.test(target) ? target : `sip:${target}@${session.account.domain}`;
      try {
        const call = await this.bridge!.makeCall(session.accountId!, uri);
        if (!this.current(session)) return null;
        // Delegate events can precede Promise resolution, including remote termination.
        if (this.terminated.has(call.callId)) return null;
        if (!this.calls.has(call.callId)) this.applyCall(call);
        return this.calls.has(call.callId) ? call.callId : null;
      } catch (error) { throw this.failure("outbound call", error); }
    });
  }

  private requireSession(): Session {
    const session = this.session;
    if (!this.current(session) || !this.bridge || !session.accountId) throw new Error("Siprix has no current authenticated phone session");
    return session;
  }

  private command(callId: string, operation: string, invoke: (bridge: Phone11SiprixModule) => Promise<void>): Promise<void> {
    const revision = this.revision;
    return this.serialize(async () => {
      if (revision !== this.revision) throw new Error("Siprix phone session changed");
      const session = this.requireSession();
      if (!this.calls.has(callId)) throw new Error("Siprix call is no longer available");
      try {
        await invoke(this.bridge!);
        if (!this.current(session)) throw new Error("Siprix phone session changed");
      } catch (error) { throw this.failure(operation, error); }
    });
  }

  answerCall(callId: string, video = false): Promise<void> {
    if (video) return Promise.reject(unsupported("video calls"));
    const session = this.session;
    const record = (message: string) => {
      if (this.current(session)) useSipDiagnosticsStore.getState().addEvent({
        level: "info", category: "call", message, context: { callId },
      });
    };
    record("Siprix answer requested");
    return this.command(callId, "answer", bridge => bridge.answerCall(callId)).then(() => {
      // SDK command acceptance is separate from the later connected event.
      record("Siprix answer command accepted");
    });
  }
  hangupCall(callId: string): Promise<void> {
    useSipDiagnosticsStore.getState().addEvent({ level: "info", category: "call", message: "Siprix hang-up requested", context: { callId } });
    return this.command(callId, "hangup", bridge => bridge.hangupCall(callId));
  }
  setMute(callId: string, muted: boolean): Promise<void> {
    return this.command(callId, "mute", bridge => bridge.setMute(callId, muted));
  }
  setHold(callId: string, held: boolean): Promise<void> {
    return this.command(callId, "hold", bridge => bridge.setHold(callId, held));
  }
  setSpeaker(callId: string, speaker: boolean): Promise<void> {
    return this.command(callId, "speaker", async bridge => {
      await bridge.setSpeaker(speaker);
      if (this.current()) useSipCallStore.getState().setSpeaker(callId, speaker);
    });
  }
  sendDtmf(callId: string, digits: string): Promise<void> {
    if (!/^[0-9*#A-D]+$/i.test(digits)) return Promise.reject(new Error("Invalid DTMF digits"));
    return this.command(callId, "DTMF", bridge => bridge.sendDtmf(callId, digits.toUpperCase()));
  }
  transferCall(_callId: string, _destination: string): Promise<void> {
    return Promise.reject(unsupported("transfer"));
  }

  handleNativeAudioSession(active: boolean, _source = "callkit"): Promise<void> {
    const revision = this.revision;
    return this.serialize(async () => {
      if (revision !== this.revision || !this.current() || !this.bridge || active === this.audioActive) return;
      try {
        await this.bridge.handleNativeAudioSession(active);
        this.audioActive = active;
      } catch (error) { throw this.failure("CallKit audio session", error); }
    });
  }

  destroy(): Promise<void> {
    // Invalidate before waiting for an outstanding native Promise or auth cleanup.
    ++this.revision;
    return this.serialize(() => this.cleanup());
  }

  private async cleanup(): Promise<void> {
    this.session = null;
    for (const remove of this.subscriptions.splice(0)) remove();
    if (this.bridge) {
      try {
        await this.bridge.destroy();
      } catch (error) {
        const failure = this.failure("cleanup; close Phone11 before changing accounts", error);
        useSipAccountStore.getState().setRegistrationState("failed", failure.message);
        throw failure;
      }
    }
    for (const id of this.calls.keys()) this.endCall(id);
    this.calls.clear();
    this.terminated.clear();
    this.connected.clear();
    this.callManager = null;
    this.bridge = null;
    this.session = null;
    this.audioActive = false;
    this.sequence = -1;
    this.networkLost = false;
    useSipAccountStore.getState().setRegistrationState("unregistered");
  }

  async restart(): Promise<void> {
    const cleanup = this.destroy();
    const revision = this.revision;
    await cleanup;
    if (revision !== this.revision) return;
    await this.initialize();
  }
}

export const siprixEngine = new SiprixEngine();
