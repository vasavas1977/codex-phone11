import { getVideoBridge } from "./video-runtime";
import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { addAuthChangeListener, getAuthSnapshot } from "../_core/auth";
import { useSipAccountStore, type SipAccount } from "./account-store";
import { useSipCallStore } from "./call-store";
import { callNumber, importCompletedWakeCalls } from "./call-history";
import { useSipDiagnosticsStore } from "./diagnostics-store";
import type {
  AccountConfig, WakeBinding, Phone11SiprixModule, SiprixAccount, SiprixCall, SiprixEvent, SiprixSnapshot,
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
    getInfo: () => ({ state: storeStates[call.state], remoteUri: call.remoteUri, historyId: call.historyId, startedAt: call.startedAt, answeredAt: call.answeredAt, hasVideo: call.hasVideo, cameraMuted: (call as SiprixCall & { cameraMuted?: boolean }).cameraMuted, videoOffered: (call as SiprixCall & { videoOffered?: boolean }).videoOffered }),
    xferReplaces: async () => { throw unsupported("attended transfer"); },
  };
}

type Session = {
  owner: ReturnType<typeof getAuthSnapshot>["user"];
  revision: number;
  account: SipAccount;
  generation: number | null;
  accountId: string | null;
};

const accountFields = [
  "ownerUserId", "tenantId", "id", "displayName", "username", "password", "domain", "proxy",
  "port", "transport", "srtp", "stun", "enabled",
] as const satisfies ReadonlyArray<keyof SipAccount>;

function nativeAccount(account: SipAccount): AccountConfig {
  return {
    sipServer: account.domain, sipExtension: account.username, sipPassword: account.password,
    sipAuthId: account.username, ...(account.proxy ? { sipProxy: account.proxy } : {}),
    displName: account.displayName || account.username, transport: account.transport,
    port: account.port, secureMedia: account.srtp ? 1 : 0,
    ...(account.stun ? { stunServer: account.stun } : {}),
  };
}
function sameWake(binding: WakeBinding, snapshot: SiprixSnapshot): boolean {
  const wake = snapshot.nativeWake;
  return !!wake && binding.expiresAt > Date.now() &&
    (["bindingId", "ownerUserId", "tenantId", "deviceId", "sessionBinding"] as const)
      .every(key => binding[key] === wake[key]);
}

function sameAccount(snapshot: SipAccount, account: SipAccount | null): boolean {
  // Secure-store hydration creates new objects. Compare credentials privately, never log them.
  return account !== null && accountFields.every(field => snapshot[field] === account[field]);
}

type CommandStage = "requested" | "precondition_rejected" | "sdk_requested" | "sdk_failed" | "accepted" | "session_changed";
type CommandReason = "revision_changed" | "session_unavailable" | "call_unavailable" | "sdk_rejected" | "session_changed_after_sdk";
type CommandAudit = (stage: CommandStage, reason?: CommandReason) => void;

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
  private transfers = new Map<string, { requestId?: string; settle: (error?: Error) => void }>();
  private callManager: typeof import("./native-call").nativeCallManager | null = null;

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.lifecycle.then(operation, operation);
    this.lifecycle = task.catch(() => undefined);
    return task;
  }

  private current(session = this.session): session is Session {
    return Boolean(session && session === this.session && session.revision === this.revision &&
      session.owner === getAuthSnapshot().user && session.account.enabled && sameAccount(session.account, useSipAccountStore.getState().account) &&
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

  bindWakeOwner(binding: WakeBinding): Promise<void> {
    const owner = getAuthSnapshot().user;
    return this.serialize(async () => {
      const session = this.requireSession();
      if (owner !== getAuthSnapshot().user || binding.ownerUserId !== owner?.id ||
          binding.tenantId !== session.account.tenantId || binding.expiresAt <= Date.now()) {
        throw new Error("The wake binding does not match this phone session");
      }
      await this.bridge!.bindForegroundWakeContext(binding, nativeAccount(session.account));
      if (!this.current(session)) throw new Error("Your phone session changed");
    });
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
      if (this.current() && this.session?.accountId) {
        const session = this.session;
        const snapshot = await this.bridge!.getSnapshot();
        if (snapshot.nativeWake && this.current(session)) {
          await this.bridge!.restoreIncomingWakeDelegate();
          this.applySnapshot(snapshot, session);
        }
        void this.reconcileCompletedCalls(session);
        return;
      }
      if (this.bridge) await this.cleanup();
      if (revision !== this.revision) return;
      const bridge = NativeModules.Phone11Siprix as Phone11SiprixModule | undefined;
      if (!bridge) {
        const error = new Error("Phone11Siprix native module is missing; install a Siprix-enabled iOS build");
        useSipAccountStore.getState().setRegistrationState("failed", error.message);
        throw error;
      }
      this.bridge = bridge;
      const session: Session = { revision, account, owner: getAuthSnapshot().user, generation: null, accountId: null };
      this.session = session;
      const invalidate = () => {
        if (this.session === session && !this.current(session)) {
          void this.destroy().catch(() => undefined);
        }
      };
      this.subscriptions.push(addAuthChangeListener(invalidate), useSipAccountStore.subscribe(invalidate));
      useSipAccountStore.getState().setRegistrationState("registering");
      try {
        const previous = await bridge.getSnapshot();
        let adopted = false;
        let started: SiprixSnapshot;
        if (previous.nativeWake) {
          // A native wake must survive JS startup until the server validates its
          // exact login binding. Never tear down another session during adoption.
          this.bridge = null;
          const { getWakeAdoptionBinding } = await import("../push/client");
          const binding = await getWakeAdoptionBinding();
          if (!this.current(session) || !binding || !sameWake(binding, previous) ||
              binding.ownerUserId !== session.account.ownerUserId || binding.tenantId !== session.account.tenantId) {
            throw new Error("Incoming wake session could not be verified");
          }
          started = await bridge.adoptIncomingWake(binding, nativeAccount(account));
          this.bridge = bridge;
          adopted = true;
        } else {
          if (previous.initialized) await bridge.destroy();
          if (!this.current(session)) { await this.cleanup(); return; }
          started = await bridge.initialize({});
        }
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
        if (adopted) await bridge.restoreIncomingWakeDelegate();
        if (!this.current(session)) { await this.cleanup(); return; }
        const listener = new NativeEventEmitter(bridge as never).addListener(
          "Phone11SiprixEvent", (event: SiprixEvent) => this.onEvent(event, session),
        );
        this.subscriptions.push(() => listener.remove());
        if (adopted) {
          if (started.accounts.length !== 1) throw new Error("Invalid native wake account");
          session.accountId = started.accounts[0].accountId;
          this.applySnapshot(await bridge.getSnapshot(), session);
          void this.reconcileCompletedCalls(session);
          return;
        }
        const created = await bridge.createAccount(nativeAccount(account));
        if (!this.current(session)) { await this.cleanup(); return; }
        if (!created.accountId) throw new Error("Missing native account ID");
        session.accountId = created.accountId;
        await bridge.registerAccount(created.accountId, 300);
        if (!this.current(session)) { await this.cleanup(); return; }
        this.applySnapshot(await bridge.getSnapshot(), session);
        if (!this.current(session)) { await this.cleanup(); return; }
        // Native recreation clears its warm-wake owner, while secure enrollment
        // survives. Resolve that enrollment against the current server session.
        // Bind directly: bindWakeOwner serializes on this same lifecycle queue.
        try {
          const { getWakeAdoptionBinding } = await import("../push/client");
          const binding = await getWakeAdoptionBinding(); // Existing five-second bound.
          if (this.current(session) && binding && binding.ownerUserId === session.account.ownerUserId &&
              binding.tenantId === session.account.tenantId && binding.expiresAt > Date.now()) {
            await bridge.bindForegroundWakeContext(binding, nativeAccount(session.account));
            void this.reconcileCompletedCalls(session, binding);
            if (this.current(session)) useSipDiagnosticsStore.getState().addEvent({
              level: "info", category: "engine", message: "Siprix foreground wake owner restored",
            });
          } else if (this.current(session) && !binding) {
            useSipDiagnosticsStore.getState().addEvent({
              level: "warning", category: "engine", message: "Siprix wake owner verification unavailable",
            });
          }
        } catch (error) {
          // Enrollment can be absent or temporarily unavailable. Preserve the
          // registered foreground account and any call that arrived meanwhile.
          if (this.current(session)) this.failure("wake owner rebinding", error);
        }
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
    } else if (event.type === "callTransferred" && "call" in event) {
      this.transferOutcome(event.call);
    } else if (["callIncoming", "callProceeding", "callConnected", "callTerminated", "callHeld", "callMuted", "callVideoChanged"].includes(event.type) && "call" in event) {
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
      if (event.operation === "wakeCleanup") {
        const owner = session.owner;
        void this.destroy().then(() => {
          if (getAuthSnapshot().user === owner && sameAccount(session.account, useSipAccountStore.getState().account)) {
            useSipAccountStore.getState().setRegistrationState("failed", "Incoming call cleanup required. Reconnect your phone.");
          }
        }).catch(() => undefined);
      }
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
    for (const call of snapshot.calls) {
      this.applyCall(call, call.state === "connected");
      this.transferOutcome(call);
    }
  }

  private async reconcileCompletedCalls(session: Session, verified?: WakeBinding): Promise<void> {
    const bridge = this.bridge;
    if (!bridge?.readCompletedWakeCalls || !bridge.ackCompletedWakeCalls) return;
    try {
      const binding = verified ?? await (await import("../push/client")).getWakeAdoptionBinding();
      const current = () => !!binding && this.current(session) && this.bridge === bridge && binding.ownerUserId === session.account.ownerUserId &&
        binding.tenantId === session.account.tenantId && binding.expiresAt > Date.now();
      if (!binding || !current()) return;
      const rows = await bridge.readCompletedWakeCalls(binding);
      if (!current() || rows.some(row => row.ownerUserId !== binding.ownerUserId || row.tenantId !== binding.tenantId)) return;
      if (!rows.length) return;
      await importCompletedWakeCalls(rows, binding.ownerUserId, current);
      if (current()) await bridge.ackCompletedWakeCalls(binding, rows.map(row => row.id));
    } catch {
      if (this.current(session)) useSipDiagnosticsStore.getState().addEvent({ level: "warning", category: "engine", message: "Completed call history will retry when available" });
    }
  }

  private transferOutcome(call: SiprixCall): void {
    if (call.accountId !== this.session?.accountId || !this.calls.has(call.callId) || call.transferPending !== false || !Number.isInteger(call.transferStatusCode)) return;
    const pending = this.transfers.get(call.callId);
    if (!pending?.requestId || call.transferRequestId !== pending.requestId) return;
    pending.settle(call.transferStatusCode === 0 ? undefined : new Error("Call transfer failed. Your original call remains available."));
  }

  private endCall(id: string): void {
    this.transfers.get(id)?.settle(new Error("The call ended before transfer was confirmed."));
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
    if (this.calls.size > 0 && !this.calls.has(call.callId)) {
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
        if (call.wakeCallUUID) {
          this.callManager?.adoptIncomingCall(call.callId, call.wakeCallUUID, !!call.wakeSystemAnswered);
        } else this.callManager?.displayIncomingCall(call.callId, displayHandle);
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
        const videoBridge = video ? await getVideoBridge() : null;
        if (video && !videoBridge) throw unsupported("video calls in this installed build");
        if (!this.current(session)) throw new Error("Your phone session changed");
        if (videoBridge && !await videoBridge.requestCameraPermission()) throw new Error("Allow camera access in Settings to make a video call");
        if (!this.current(session)) throw new Error("Your phone session changed");
        if (this.calls.size) throw new Error("Another call arrived while camera permission was pending");
        const call = videoBridge ? await videoBridge.makeVideoCall(session.accountId!, uri) : await this.bridge!.makeCall(session.accountId!, uri);
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

  private command(callId: string, operation: string, invoke: (bridge: Phone11SiprixModule) => Promise<void>, audit?: CommandAudit): Promise<void> {
    const revision = this.revision;
    audit?.("requested");
    return this.serialize(async () => {
      if (revision !== this.revision) {
        audit?.("precondition_rejected", "revision_changed");
        throw new Error("Siprix phone session changed");
      }
      let session: Session;
      try { session = this.requireSession(); }
      catch (error) {
        audit?.("precondition_rejected", "session_unavailable");
        throw error;
      }
      if (!this.calls.has(callId)) {
        audit?.("precondition_rejected", "call_unavailable");
        throw new Error("Siprix call is no longer available");
      }
      let sdkAccepted = false;
      try {
        audit?.("sdk_requested");
        await invoke(this.bridge!);
        sdkAccepted = true;
        if (!this.current(session)) throw new Error("Siprix phone session changed");
        audit?.("accepted");
      } catch (error) {
        audit?.(sdkAccepted ? "session_changed" : "sdk_failed", sdkAccepted ? "session_changed_after_sdk" : "sdk_rejected");
        throw this.failure(operation, error);
      }
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
    const messages: Record<CommandStage, string> = {
      requested: "Siprix microphone mute requested",
      precondition_rejected: "Siprix microphone mute rejected before SDK",
      sdk_requested: "Siprix microphone mute sent to SDK",
      sdk_failed: "Siprix microphone mute SDK command failed",
      accepted: "Siprix microphone mute command accepted",
      session_changed: "Siprix microphone mute session changed after SDK",
    };
    return this.command(callId, "mute", bridge => bridge.setMute(callId, muted), (stage, reason) => {
      // Record only fixed reason codes and a bounded native ID. Session/account
      // data and arbitrary SDK error messages must never enter diagnostics.
      useSipDiagnosticsStore.getState().addEvent({
        level: reason ? "error" : "info", category: "media", message: messages[stage],
        context: { ...(/^\d{1,10}$/.test(callId) ? { callId } : {}), muted, stage, ...(reason ? { reason } : {}) },
      });
    });
  }
  private async videoCommand(callId: string, operation: "camera mute" | "camera switch", invoke: (bridge: NonNullable<Awaited<ReturnType<typeof getVideoBridge>>>) => Promise<void>): Promise<void> {
    // Capability discovery and camera SDK promises must never block the voice
    // command queue: the user must be able to hang up during a stuck camera call.
    const session = this.requireSession();
    const bridge = await getVideoBridge();
    if (!this.current(session)) throw new Error("Your phone session changed");
    const call = this.calls.get(callId);
    if (!bridge || !call?.hasVideo || call.state !== "connected" || call.held) throw unsupported("camera controls");
    try {
      await invoke(bridge);
      if (!this.current(session) || !this.calls.has(callId)) throw new Error("Your phone session changed");
    } catch (error) { throw this.failure(operation, error); }
  }
  setCameraMuted(callId: string, muted: boolean): Promise<void> {
    return this.videoCommand(callId, "camera mute", bridge => bridge.setCameraMuted(callId, muted));
  }
  switchCamera(callId: string): Promise<void> {
    return this.videoCommand(callId, "camera switch", bridge => bridge.switchCamera(callId));
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
  supportsBlindTransfer(): boolean {
    return this.current() && typeof this.bridge?.transferCall === "function" && typeof this.bridge?.createTransferRequestId === "function";
  }

  transferCall(callId: string, destination: string): Promise<void> {
    const target = destination.trim();
    if (!/^\+?[0-9*#]{1,32}$/.test(target)) return Promise.reject(new Error("Enter a phone number or extension."));
    if (!this.supportsBlindTransfer()) return Promise.reject(new Error("Install the Phone11 update to enable call transfer."));
    const call = this.calls.get(callId);
    if (!call || call.state !== "connected" || call.held || call.holdState !== 0) return Promise.reject(new Error("Resume the connected call before transferring it."));
    if (this.transfers.has(callId)) return Promise.reject(new Error("A transfer is already in progress."));
    let settled = false;
    let settle!: (error?: Error) => void;
    const outcome = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => settle(new Error("Transfer has not been confirmed. Keep the call open; the server may still complete it.")), 30_000);
      settle = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.transfers.delete(callId);
        if (error) reject(error);
        else resolve();
      };
    });
    const pending: { requestId?: string; settle: (error?: Error) => void } = { settle };
    this.transfers.set(callId, pending);
    // Never hold the command queue while waiting for REFER: mute/end must stay responsive.
    void this.command(callId, "transfer", async bridge => {
      if (settled) throw new Error("Transfer request expired before it could be sent.");
      if (!bridge.transferCall || !bridge.createTransferRequestId) throw new Error("Call transfer requires a native update.");
      const requestId = await bridge.createTransferRequestId();
      if (settled) throw new Error("Transfer request expired before it could be sent.");
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(requestId)) throw new Error("Invalid native transfer identity.");
      pending.requestId = requestId;
      await bridge.transferCall(callId, target, requestId);
    }).catch(() => settle(new Error("Could not request transfer. Your original call remains available.")));
    return outcome;
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
    for (const transfer of [...this.transfers.values()]) transfer.settle(new Error("Your phone session changed."));
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
    const requestedRevision = this.revision;
    // Foreground recovery must not destroy an already ringing native wake.
    if (this.current() && this.bridge) {
      const session = this.session;
      const snapshot = await this.bridge.getSnapshot();
      if (requestedRevision !== this.revision) return;
      if (this.current(session) && snapshot.nativeWake) { await this.initialize(); return; }
      // A regular call can arrive while the recovery snapshot is in flight.
      // Preserve both native calls not yet delivered to JS and newer JS events.
      if (this.current(session) && (this.calls.size > 0 || snapshot.calls.some(call =>
        call.accountId === session?.accountId && call.state !== "terminated"))) {
        this.applySnapshot(snapshot, session!);
        return;
      }
    }
    const cleanup = this.destroy();
    const revision = this.revision;
    await cleanup;
    if (revision !== this.revision) return;
    await this.initialize();
  }
}

export const siprixEngine = new SiprixEngine();
