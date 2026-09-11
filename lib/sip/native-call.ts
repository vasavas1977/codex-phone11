/**
 * Native Call Manager — CloudPhone11
 *
 * Integrates CallKit (iOS) and ConnectionService (Android) via react-native-callkeep.
 * This enables:
 *  - Incoming call UI on lock screen (full-screen call notification)
 *  - Call management from system call UI (answer, decline, end)
 *  - Audio route management (speaker, bluetooth)
 *  - Call history integration with native phone app
 *  - System call controls for calls received by the running SIP engine
 *
 * Architecture:
 *   SIP incoming callback → NativeCallManager → CallKit/ConnectionService
 *                                            → SIP Engine (answer/decline)
 *                                            → Call Store (state sync)
 */

import { Alert, Platform, AppState, AppStateStatus } from "react-native";
import { getAuthSnapshot } from "../_core/auth";
import { sipEngine } from "./engine";
import { useSipCallStore, type SipCall } from "./call-store";
import { formatSipError, useSipDiagnosticsStore } from "./diagnostics-store";

// CallKeep types
let RNCallKeep: any = null;

function getCallKeep() {
  if (Platform.OS === "web") return null;
  if (!RNCallKeep) {
    try {
      RNCallKeep = require("react-native-callkeep").default;
    } catch (e) {
      console.warn("[NativeCall] react-native-callkeep not available:", e);
    }
  }
  return RNCallKeep;
}

// UUID generator for call identifiers
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Map between SIP engine call IDs and CallKit UUIDs
const callIdToUuid: Map<string, string> = new Map();
const uuidToCallId: Map<string, string> = new Map();
const outgoingCalls = new Set<string>();
const outgoingHandleEchoes: Map<string, { sipCallId: string; expiresAt: number }> = new Map();

function normalizeHandle(handle?: string | null): string {
  return String(handle ?? "").trim().toLowerCase();
}

function rememberOutgoingHandle(handle: string, sipCallId: string): void {
  const normalized = normalizeHandle(handle);
  if (!normalized) return;

  outgoingHandleEchoes.set(normalized, {
    sipCallId,
    expiresAt: Date.now() + 10_000,
  });
}

function consumeOutgoingHandleEcho(handle?: string | null): string | null {
  const normalized = normalizeHandle(handle);
  if (!normalized) return null;

  const echo = outgoingHandleEchoes.get(normalized);
  if (!echo) return null;

  if (echo.expiresAt < Date.now()) {
    outgoingHandleEchoes.delete(normalized);
    return null;
  }

  return echo.sipCallId;
}

function addNativeCallDiagnostic(
  level: "info" | "warning" | "error",
  message: string,
  extra: { callId?: string; destination?: string; detail?: string; context?: Record<string, string | number | boolean | null | undefined> } = {}
): void {
  useSipDiagnosticsStore.getState().addEvent({
    level,
    category: "native",
    message,
    ...extra,
  });
}

interface AnswerWaiter {
  call: SipCall;
  historyId?: string;
  startedAt?: number;
  owner: ReturnType<typeof getAuthSnapshot>["user"];
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type AnswerCallIdentity = Pick<AnswerWaiter, "call" | "historyId" | "startedAt">;
function sameAnswerCall(identity: AnswerCallIdentity, call: SipCall | null): boolean {
  if (!call || call.id !== identity.call.id) return false;
  return identity.historyId ? call.history?.id === identity.historyId
    : identity.startedAt !== undefined ? call.startTime?.getTime() === identity.startedAt : call === identity.call;
}

class NativeCallManager {
  private initialized = false;
  private initialization: Promise<void> | null = null;
  private appStateSubscription: any = null;
  private pendingAnswers = new Set<string>();
  private acceptedAnswers = new Set<string>();
  private systemAnswered = new Set<string>();
  private incomingOwners = new Map<string, ReturnType<typeof getAuthSnapshot>["user"]>();
  private answerWaiters = new Map<string, AnswerWaiter>();
  private answerCalls = new Map<string, AnswerCallIdentity>();

  /** Request the system answer transaction; its delegate remains the only SIP accept path. */
  answerIncomingCall(sipCallId: string): Promise<void> {
    const owner = getAuthSnapshot().user;
    const incoming = useSipCallStore.getState().incomingCall;
    const uuid = callIdToUuid.get(sipCallId);
    const callKeep = getCallKeep();
    if (!owner || !uuid || this.incomingOwners.get(uuid) !== owner || !this.initialized || !callKeep ||
      incoming?.id !== sipCallId || incoming.status !== "incoming") {
      return Promise.reject(new Error("This incoming call is no longer available."));
    }
    const identity = this.answerCalls.get(uuid);
    if (identity && !sameAnswerCall(identity, incoming)) {
      return Promise.reject(new Error("This incoming call is no longer available."));
    }
    this.answerCalls.set(uuid, identity ?? { call: incoming, historyId: incoming.history?.id, startedAt: incoming.startTime?.getTime() });
    const existing = this.answerWaiters.get(uuid);
    if (existing) {
      if (existing.owner !== owner) return Promise.reject(new Error("Your phone session changed."));
      return existing.promise;
    }
    if (this.acceptedAnswers.has(uuid)) return Promise.resolve();
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    // CallKeep's void transaction API cannot propagate CXTransaction errors.
    // Bound the wait without falling back to a SIP accept that bypasses CallKit.
    const timer = setTimeout(() => {
      addNativeCallDiagnostic("warning", "Native answer transaction timed out", { callId: sipCallId });
      this.finishAnswerWaiter(uuid, new Error("Call controls did not respond. Try Answer again while the caller is ringing."));
    }, 8_000);
    this.answerWaiters.set(uuid, { call: incoming, historyId: incoming.history?.id, startedAt: incoming.startTime?.getTime(), owner, promise, resolve, reject, timer });
    if (this.systemAnswered.has(uuid) && !this.pendingAnswers.has(uuid)) {
      // CallKit already fulfilled CXAnswerCallAction for this exact owner/call.
      // Retry a rejected SDK accept through the same handler, not a second CX action.
      void this.handleNativeAnswer(uuid, false);
    } else if (!this.pendingAnswers.has(uuid)) {
      addNativeCallDiagnostic("info", "Native answer transaction requested", { callId: sipCallId });
      try { callKeep.answerIncomingCall(uuid); }
      catch { this.finishAnswerWaiter(uuid, new Error("Could not open the system call controls. Please try again.")); }
    }
    return promise;
  }

  private finishAnswerWaiter(uuid: string, error?: Error): void {
    const waiter = this.answerWaiters.get(uuid);
    if (!waiter) return;
    this.answerWaiters.delete(uuid);
    clearTimeout(waiter.timer);
    if (error) waiter.reject(error);
    else if (waiter.owner !== getAuthSnapshot().user || !uuidToCallId.has(uuid)) {
      waiter.reject(new Error("Your phone session changed."));
    } else waiter.resolve();
  }

  private clearAnswerActions(): void {
    for (const uuid of this.answerWaiters.keys()) this.finishAnswerWaiter(uuid, new Error("This incoming call ended."));
    this.pendingAnswers.clear();
    this.acceptedAnswers.clear();
    this.systemAnswered.clear();
    this.incomingOwners.clear();
    this.answerCalls.clear();
  }

  /**
   * Initialize CallKit (iOS) / ConnectionService (Android).
   * Must be called once on app start, after SIP engine initialization.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!this.initialization) {
      this.initialization = this.initializeOnce().finally(() => { this.initialization = null; });
    }
    await this.initialization;
  }

  private async initializeOnce(): Promise<void> {
    const callKeep = getCallKeep();
    if (!callKeep) {
      console.log("[NativeCall] Not available on this platform");
      return;
    }

    try {
      // Configure CallKit / ConnectionService
      const options = {
        ios: {
          appName: "CloudPhone11",
          // Supported handle types
          includesCallsInRecents: true,
          maximumCallGroups: process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix" ? 1 : 2,
          maximumCallsPerCallGroup: 1,
          supportsVideo: process.env.EXPO_PUBLIC_SIP_ENGINE !== "siprix",
          // Audio session configuration
          audioSession: {
            categoryOptions: 0x04, // AllowBluetooth (bidirectional HFP, not MixWithOthers)
            // CallKeep passes this value directly to AVAudioSession.setMode.
            mode: "AVAudioSessionModeVoiceChat",
          },
          // Ringtone sound file (must be in app bundle)
          ringtoneSound: "ringtone.caf",
        },
        android: {
          alertTitle: "CloudPhone11 Permissions",
          alertDescription:
            "CloudPhone11 needs access to your phone accounts to manage calls",
          cancelButton: "Cancel",
          okButton: "OK",
          imageName: "phone_account_icon",
          // Self-managed ConnectionService for full control
          selfManaged: false,
          // Additional notification channel for incoming calls
          additionalPermissions: [],
          // Foreground service for active calls
          foregroundService: {
            channelId: "cloudphone11_calls",
            channelName: "CloudPhone11 Calls",
            notificationTitle: "CloudPhone11",
            notificationIcon: "ic_notification",
          },
        },
      };

      await callKeep.setup(options);

      // Register event listeners
      this._registerListeners(callKeep);

      // Monitor app state for background/foreground transitions
      this.appStateSubscription = AppState.addEventListener(
        "change",
        this._handleAppStateChange.bind(this)
      );

      // On Android, register the phone account
      if (Platform.OS === "android") {
        callKeep.setAvailable(true);
        callKeep.canMakeMultipleCalls(false);
      }

      this.initialized = true;
      console.log("[NativeCall] Initialized successfully");
    } catch (error) {
      console.error("[NativeCall] Initialization failed:", error);
      addNativeCallDiagnostic("error", "CallKit initialization failed", {
        detail: formatSipError(error),
      });
      if (process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix") throw error;
    }
  }

  /**
   * Display incoming call on native UI (lock screen).
   * Called when SIP engine receives an incoming call.
   */
  displayIncomingCall(
    sipCallId: string,
    callerNumber: string,
    callerName?: string,
    hasVideo = false
  ): void {
    if (callIdToUuid.has(sipCallId)) return;
    const callKeep = getCallKeep();
    if (!callKeep || !this.initialized) return;

    const uuid = generateUUID();
    callIdToUuid.set(sipCallId, uuid);
    uuidToCallId.set(uuid, sipCallId);
    this.incomingOwners.set(uuid, getAuthSnapshot().user);

    try {
      callKeep.displayIncomingCall(
        uuid,
        callerNumber,
        callerName || callerNumber,
        "generic", // handleType: "generic" | "number" | "email"
        hasVideo
      );
    } catch (error) {
      addNativeCallDiagnostic("error", "CallKit incoming call display failed", {
        callId: sipCallId,
        destination: callerNumber,
        detail: formatSipError(error),
        context: { callUUID: uuid },
      });
      return;
    }

    console.log(
      `[NativeCall] Displaying incoming call: ${callerName || callerNumber} (UUID: ${uuid})`
    );
  }

  /**
   * Report that an outgoing call has started.
   * Called when user initiates a call from the app.
   */
  reportOutgoingCall(
    sipCallId: string,
    callerNumber: string,
    callerName?: string,
    hasVideo = false
  ): void {
    if (callIdToUuid.has(sipCallId)) return;
    const callKeep = getCallKeep();
    if (!callKeep || !this.initialized) return;

    const uuid = generateUUID();
    callIdToUuid.set(sipCallId, uuid);
    uuidToCallId.set(uuid, sipCallId);
    outgoingCalls.add(sipCallId);
    rememberOutgoingHandle(callerNumber, sipCallId);

    addNativeCallDiagnostic("info", "CallKit outgoing call reported", {
      callId: sipCallId,
      destination: callerNumber,
      context: {
        callUUID: uuid,
        hasVideo,
      },
    });

    try {
      callKeep.startCall(
        uuid,
        callerNumber,
        callerName || callerNumber,
        "generic",
        hasVideo
      );
    } catch (error) {
      addNativeCallDiagnostic("error", "CallKit outgoing call report failed", {
        callId: sipCallId,
        destination: callerNumber,
        detail: formatSipError(error),
        context: { callUUID: uuid },
      });
      return;
    }

    console.log(
      `[NativeCall] Reporting outgoing call: ${callerNumber} (UUID: ${uuid})`
    );
  }

  /**
   * Report the SDK's connected state. This does not prove audible media.
   */
  reportCallConnected(sipCallId: string): void {
    const callKeep = getCallKeep();
    if (!callKeep || !this.initialized) return;

    const uuid = callIdToUuid.get(sipCallId);
    if (!uuid) return;

    try {
      if (Platform.OS === "ios") {
        if (outgoingCalls.has(sipCallId)) callKeep.reportConnectedOutgoingCallWithUUID(uuid);
      } else {
        callKeep.setCurrentCallActive(uuid);
      }
      addNativeCallDiagnostic("info", Platform.OS === "ios" && !outgoingCalls.has(sipCallId)
        ? "Incoming SIP call connected" : "CallKit call marked active", {
        callId: sipCallId,
        context: { callUUID: uuid },
      });
    } catch (error) {
      addNativeCallDiagnostic("error", "CallKit call active update failed", {
        callId: sipCallId,
        detail: formatSipError(error),
        context: { callUUID: uuid },
      });
      return;
    }
    console.log(`[NativeCall] Call connected: ${uuid}`);
  }

  /**
   * Report that a call has ended.
   */
  reportCallEnded(sipCallId: string, reason?: string): void {
    const callKeep = getCallKeep();
    if (!callKeep || !this.initialized) return;

    const uuid = callIdToUuid.get(sipCallId);
    if (!uuid) return;

    // Map reason to CallKit end reason
    const endReason = this._mapEndReason(reason);
    try {
      callKeep.reportEndCallWithUUID(uuid, endReason);
      addNativeCallDiagnostic("info", "CallKit call ended", {
        callId: sipCallId,
        detail: reason,
        context: {
          callUUID: uuid,
          endReason,
        },
      });
    } catch (error) {
      addNativeCallDiagnostic("error", "CallKit call end report failed", {
        callId: sipCallId,
        detail: formatSipError(error),
        context: {
          callUUID: uuid,
          endReason,
        },
      });
    }

    // Clean up mappings
    this.finishAnswerWaiter(uuid, new Error("This incoming call ended."));
    this.pendingAnswers.delete(uuid);
    this.acceptedAnswers.delete(uuid);
    this.systemAnswered.delete(uuid);
    this.incomingOwners.delete(uuid);
    this.answerCalls.delete(uuid);
    callIdToUuid.delete(sipCallId);
    uuidToCallId.delete(uuid);
    outgoingCalls.delete(sipCallId);

    console.log(`[NativeCall] Call ended: ${uuid} (reason: ${endReason})`);
  }

  /**
   * Update mute state in native call UI.
   */
  setMuted(sipCallId: string, muted: boolean): void {
    const callKeep = getCallKeep();
    if (!callKeep || !this.initialized) return;

    const uuid = callIdToUuid.get(sipCallId);
    if (!uuid) return;

    try {
      callKeep.setMutedCall(uuid, muted);
    } catch (error) {
      addNativeCallDiagnostic("error", "CallKit mute update failed", {
        callId: sipCallId,
        detail: formatSipError(error),
        context: { callUUID: uuid, muted },
      });
    }
  }

  /**
   * Update hold state in native call UI.
   */
  setOnHold(sipCallId: string, held: boolean): void {
    const callKeep = getCallKeep();
    if (!callKeep || !this.initialized) return;

    const uuid = callIdToUuid.get(sipCallId);
    if (!uuid) return;

    try {
      callKeep.setOnHold(uuid, held);
    } catch (error) {
      addNativeCallDiagnostic("error", "CallKit hold update failed", {
        callId: sipCallId,
        detail: formatSipError(error),
        context: { callUUID: uuid, held },
      });
    }
  }

  /**
   * Send DTMF tone through native call UI.
   */
  sendDTMF(sipCallId: string, digit: string): void {
    const callKeep = getCallKeep();
    if (!callKeep || !this.initialized) return;

    const uuid = callIdToUuid.get(sipCallId);
    if (!uuid) return;

    try {
      callKeep.sendDTMF(uuid, digit);
    } catch (error) {
      addNativeCallDiagnostic("error", "CallKit DTMF update failed", {
        callId: sipCallId,
        detail: formatSipError(error),
        context: { callUUID: uuid, digit },
      });
    }
  }

  /**
   * Clean up and destroy native call manager.
   */
  destroy(): void {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    // End all active calls in CallKit
    const callKeep = getCallKeep();
    if (callKeep && this.initialized) {
      try {
        callKeep.endAllCalls();
      } catch (error) {
        addNativeCallDiagnostic("error", "CallKit end all calls failed", {
          detail: formatSipError(error),
        });
      }
    }

    callIdToUuid.clear();
    uuidToCallId.clear();
    this.clearAnswerActions();
    outgoingHandleEchoes.clear();
    outgoingCalls.clear();
    if (callKeep && this.initialized) {
      for (const event of ["answerCall", "endCall", "didToggleHoldCallAction", "didPerformSetMutedCallAction", "didPerformDTMFAction", "didChangeAudioRoute", "didActivateAudioSession", "didDeactivateAudioSession", "didReceiveStartCallAction", "didResetProvider", "checkReachability"]) {
        callKeep.removeEventListener(event);
      }
    }
    this.initialized = false;
  }

  // ─── Private Methods ──────────────────────────────────────────────

  private async handleNativeAnswer(callUUID: string, systemCallback = true): Promise<void> {
      const callKeep = getCallKeep();
      const sipCallId = uuidToCallId.get(callUUID);
      const incoming = useSipCallStore.getState().incomingCall;
      // Persist only our mapped SDK identifier and bounded state, never the
      // untrusted event payload, caller handle, or raw native error.
      const context = {
        mapped: !!sipCallId,
        ringing: !!sipCallId && incoming?.id === sipCallId && incoming.status === "incoming",
      };
      addNativeCallDiagnostic("info", systemCallback ? "Native answer callback received" : "Retrying SDK answer after system answer", { callId: sipCallId, context });
      if (!sipCallId) {
        addNativeCallDiagnostic("warning", "Ignored native answer action for an unknown call", { context });
        return;
      }
      const owner = getAuthSnapshot().user;
      if (!owner || this.incomingOwners.get(callUUID) !== owner) {
        this.finishAnswerWaiter(callUUID, new Error("Your phone session changed."));
        addNativeCallDiagnostic("warning", "Ignored native answer for a changed phone session", { callId: sipCallId });
        return;
      }
      if (this.pendingAnswers.has(callUUID)) {
        addNativeCallDiagnostic("info", "Ignored duplicate pending native answer", { callId: sipCallId, context });
        return;
      }
      const identity = this.answerCalls.get(callUUID);
      if (!context.ringing || !incoming || (identity && !sameAnswerCall(identity, incoming))) {
        this.finishAnswerWaiter(callUUID, new Error("This incoming call is no longer available."));
        addNativeCallDiagnostic("warning", "Ignored native answer for a call that is no longer ringing", { callId: sipCallId });
        return;
      }
      this.answerCalls.set(callUUID, identity ?? { call: incoming, historyId: incoming.history?.id, startedAt: incoming.startTime?.getTime() });
      if (systemCallback) this.systemAnswered.add(callUUID);
      this.pendingAnswers.add(callUUID);
      let accepted = false;

      addNativeCallDiagnostic("info", "Native answer requested", { callId: sipCallId });
      try {
        await sipEngine.answerCall(sipCallId);
        accepted = true;
        if (uuidToCallId.get(callUUID) === sipCallId && getAuthSnapshot().user === owner) {
          this.acceptedAnswers.add(callUUID);
        }
        this.finishAnswerWaiter(callUUID);
        addNativeCallDiagnostic("info", "Native answer command accepted", {
          callId: sipCallId,
          context: { mapped: uuidToCallId.get(callUUID) === sipCallId },
        });
        // A completed command is not evidence of connection. Siprix's connected
        // callback owns that transition; retain the mapping on failure for retry.
        if (process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix" || uuidToCallId.get(callUUID) !== sipCallId) return;
        try {
          callKeep.setCurrentCallActive(callUUID);
        } catch (error) {
          addNativeCallDiagnostic("error", "CallKit native answer active update failed", {
            callId: sipCallId,
            detail: formatSipError(error),
            context: { callUUID },
          });
        }
      } catch {
        const requestedInApp = this.answerWaiters.has(callUUID);
        this.finishAnswerWaiter(callUUID, new Error("Could not answer call. Please try again while the caller is ringing."));
        // SDK diagnostics already preserve a bounded error code. Do not leak
        // arbitrary event/request text or reject an async native event listener.
        const incoming = useSipCallStore.getState().incomingCall;
        const canRetry = AppState.currentState === "active" && owner && getAuthSnapshot().user === owner &&
          uuidToCallId.get(callUUID) === sipCallId && incoming?.id === sipCallId && incoming.status === "incoming";
        addNativeCallDiagnostic("error", canRetry ? "Native answer failed; call remains available for retry" : "Native answer failed", {
          callId: sipCallId,
        });
        if (canRetry && !requestedInApp) {
          Alert.alert("Could not answer call", "Tap Answer again in Phone11 while the caller is still ringing.");
        }
      } finally {
        // Keep successful requests latched until real termination, including the
        // ringing-to-connected gap. A failed request remains retryable.
        if (!accepted) this.pendingAnswers.delete(callUUID);
      }
  }

  private async handleAudioSession(active: boolean, source?: string): Promise<void> {
    addNativeCallDiagnostic("info", active ? "CallKit audio activation received" : "CallKit audio deactivation received");
    try {
      if (source) await sipEngine.handleNativeAudioSession(active, source);
      else await sipEngine.handleNativeAudioSession(active);
      addNativeCallDiagnostic("info", "CallKit audio session forwarded to SDK", { context: { active } });
    } catch {
      addNativeCallDiagnostic("error", "CallKit audio session update failed", { context: { active } });
    }
  }

  private _registerListeners(callKeep: any): void {
    // User answered call from native UI (lock screen / notification)
    callKeep.addEventListener("answerCall", ({ callUUID }: any) => this.handleNativeAnswer(callUUID));

    // User declined call from native UI
    callKeep.addEventListener("endCall", async ({ callUUID }: any) => {
      const sipCallId = uuidToCallId.get(callUUID);
      if (!sipCallId) {
        addNativeCallDiagnostic("warning", "Ignored native end action for an unknown call");
        return;
      }

      addNativeCallDiagnostic("info", "Native hang-up requested", { callId: sipCallId });
      try {
        await sipEngine.hangupCall(sipCallId);
      } catch (error) {
        addNativeCallDiagnostic("error", "Native hang-up failed; call remains available for retry", {
          callId: sipCallId, detail: formatSipError(error),
        });
        return;
      }
      // Siprix's termination callback owns history and CallKit cleanup.
      if (process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix") return;
      useSipCallStore.getState().terminateCall(sipCallId);

      callIdToUuid.delete(sipCallId);
      uuidToCallId.delete(callUUID);
    });

    // User toggled mute from native UI
    callKeep.addEventListener(
      "didToggleHoldCallAction",
      async ({ callUUID, hold }: any) => {
        const sipCallId = uuidToCallId.get(callUUID);
        if (!sipCallId) return;

        console.log(`[NativeCall] Hold toggled: ${hold}`);
        await sipEngine.setHold(sipCallId, hold);
        useSipCallStore.getState().setHeld(sipCallId, hold);
      }
    );

    // User toggled mute from native UI
    callKeep.addEventListener(
      "didPerformSetMutedCallAction",
      async ({ callUUID, muted }: any) => {
        const sipCallId = uuidToCallId.get(callUUID);
        if (!sipCallId) return;

        console.log(`[NativeCall] Mute toggled: ${muted}`);
        await sipEngine.setMute(sipCallId, muted);
        useSipCallStore.getState().setMuted(sipCallId, muted);
      }
    );

    // User sent DTMF from native UI
    callKeep.addEventListener(
      "didPerformDTMFAction",
      async ({ callUUID, digits }: any) => {
        const sipCallId = uuidToCallId.get(callUUID);
        if (!sipCallId) return;

        console.log(`[NativeCall] DTMF: ${digits}`);
        await sipEngine.sendDtmf(sipCallId, digits);
      }
    );

    // Audio route changed (speaker, bluetooth, etc.)
    callKeep.addEventListener(
      "didChangeAudioRoute",
      ({ output, reason }: any) => {
        console.log(`[NativeCall] Audio route changed: ${output} (${reason})`);
      }
    );

    // CallKit owns native audio-session activation for system call controls.
    if (Platform.OS === "ios") {
      callKeep.addEventListener("didActivateAudioSession", () => this.handleAudioSession(true));
      callKeep.addEventListener("didDeactivateAudioSession", () => this.handleAudioSession(false));
      callKeep.addEventListener(
        "didReceiveStartCallAction",
        async ({ callUUID, handle, name }: any) => {
          console.log(`[NativeCall] Start call action: ${handle}`);

          const existingSipCallId = callUUID ? uuidToCallId.get(callUUID) : null;
          const echoSipCallId = consumeOutgoingHandleEcho(handle);
          if (existingSipCallId || echoSipCallId) {
            const sipCallId = existingSipCallId ?? echoSipCallId ?? "unknown";
            if (callUUID && !uuidToCallId.has(callUUID)) {
              uuidToCallId.set(callUUID, sipCallId);
              callIdToUuid.set(sipCallId, callUUID);
            }
            if (useSipCallStore.getState().activeCalls[sipCallId]?.status === "active") {
              this.reportCallConnected(sipCallId);
            }
            addNativeCallDiagnostic("info", "Ignored CallKit start-call echo for existing outbound SIP call", {
              callId: sipCallId,
              destination: handle,
              context: {
                callUUID: callUUID ?? "none",
                name: name ?? "none",
              },
            });
            return;
          }

          // This is triggered when user taps "Call Back" from native call history.
          if (handle) {
            addNativeCallDiagnostic("info", "CallKit callback requested a new SIP call", {
              destination: handle,
              context: {
                callUUID: callUUID ?? "none",
                name: name ?? "none",
              },
            });

            const callId = await sipEngine.makeCall(handle);
            if (callId) {
              callIdToUuid.set(callId, callUUID);
              uuidToCallId.set(callUUID, callId);
              addNativeCallDiagnostic("info", "CallKit callback SIP call created", {
                callId,
                destination: handle,
                context: {
                  callUUID: callUUID ?? "none",
                },
              });
            }
          }
        }
      );

      // Provider reset (iOS) — clean up all calls
      callKeep.addEventListener("didResetProvider", () => {
        void this.handleAudioSession(false, "provider_reset");
        console.log("[NativeCall] Provider reset — ending all calls");
        callIdToUuid.clear();
        uuidToCallId.clear();
        this.clearAnswerActions();
      });
    }

    // Check reachability (Android) — verify phone account is still active
    if (Platform.OS === "android") {
      callKeep.addEventListener("checkReachability", () => {
        callKeep.setReachable();
      });
    }
  }

  private _handleAppStateChange(state: AppStateStatus): void {
    // When app comes to foreground, ensure call state is synced
    if (state === "active") {
      const { activeCalls, incomingCall } = useSipCallStore.getState();

      // Sync any active calls with native UI
      Object.values(activeCalls).forEach((call: SipCall) => {
        const uuid = callIdToUuid.get(call.id);
        if (uuid && call.status === "active") {
          const callKeep = getCallKeep();
          if (callKeep) {
            try {
              this.reportCallConnected(call.id);
            } catch (error) {
              addNativeCallDiagnostic("error", "CallKit foreground active sync failed", {
                callId: call.id,
                detail: formatSipError(error),
                context: { callUUID: uuid },
              });
            }
          }
        }
      });
    }
  }

  private _mapEndReason(reason?: string): number {
    // CallKit CXCallEndedReason values:
    // 1 = Failed, 2 = RemoteEnded, 3 = Unanswered, 4 = AnsweredElsewhere, 5 = DeclinedElsewhere
    if (!reason) return 2; // RemoteEnded
    const lower = reason.toLowerCase();
    if (lower.includes("busy")) return 2;
    if (lower.includes("reject") || lower.includes("decline")) return 2;
    if (lower.includes("timeout") || lower.includes("no answer")) return 3;
    if (lower.includes("elsewhere")) return 4;
    if (lower.includes("error") || lower.includes("fail")) return 1;
    return 2;
  }
}

// Singleton instance
export const nativeCallManager = new NativeCallManager();

/** Register an authenticated device only when native wake is commissioned. */
export async function registerVoipPush(): Promise<string | null> {
  if (Platform.OS !== "ios") return null;
  try {
    const { registerPhoneVoipPush } = await import("../push/client");
    return await registerPhoneVoipPush();
  } catch {
    // Registration diagnostics must never expose provider tokens or credentials.
    return null;
  }
}
