/**
 * SIP Provider — Phone11
 * Connects the verified owner's provisioned account while the app is active
 * and recovers registration without interrupting a live call.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { addAuthChangeListener, getAuthSnapshot } from "../_core/auth";
import { createRegistrationLifecycle } from "./registration-lifecycle";
import { createVoipEnrollmentLifecycle } from "../push/enrollment-lifecycle";
import { getVideoBridge } from "./video-runtime";
import {
  phone11MediaOwnership,
  prepareSipMediaOwnership,
  releaseSipMediaOwnership,
} from "../meetings/native-session";
import type { MediaLease } from "../meetings/media-ownership";
import { sipEngine } from "./engine";
import { siprixEngine } from "./siprix-engine";
import { useSipAccountStore } from "./account-store";
import { useSipCallStore } from "./call-store";
import { useSipDiagnosticsStore } from "./diagnostics-store";
import { nativeCallManager, registerVoipPush } from "./native-call";
import { createAndroidCallPermissionGate, isAndroidForegroundTrial } from "./android-call-permission";

interface SipContextValue {
  reconnectPhone: () => Promise<void>;
  makeCall: (destination: string, video?: boolean) => Promise<string | null>;
  hangupCall: (callId: string) => Promise<void>;
  answerCall: (callId: string, video?: boolean) => Promise<void>;
  setMute: (callId: string, muted: boolean) => Promise<void>;
  setHold: (callId: string, held: boolean) => Promise<void>;
  setSpeaker: (callId: string, speaker: boolean) => Promise<void>;
  sendDtmf: (callId: string, digit: string) => Promise<void>;
  transferCall: (callId: string, destination: string) => Promise<void>;
  supportsBlindTransfer: () => boolean;
  supportsWarmTransfer: () => boolean;
  consultation: typeof siprixEngine.consultation;
  remainingConsultation: typeof siprixEngine.remainingConsultation;
  beginConsultation: (callId: string, destination: string) => Promise<void>;
  cancelConsultation: (callId: string, requestId: string) => Promise<void>;
  completeConsultation: (callId: string, requestId: string) => Promise<void>;
  hasAttemptedBlindTransfer: (callId: string) => boolean;
}

type AndroidIncomingMediaPreparation = {
  generation: number;
  current: (incomingOnly?: boolean) => boolean;
  task: Promise<MediaLease>;
  lease?: MediaLease;
};

const SipContext = createContext<SipContextValue>({
  reconnectPhone: async () => {},
  makeCall: async () => null,
  hangupCall: async () => {},
  answerCall: async () => {},
  setMute: async () => {},
  setHold: async () => {},
  setSpeaker: async () => {},
  sendDtmf: async () => {},
  transferCall: async () => {},
  supportsBlindTransfer: () => false,
  supportsWarmTransfer: () => false,
  consultation: () => null,
  remainingConsultation: () => null,
  beginConsultation: async () => { throw new Error("Consultation transfer is unavailable."); },
  cancelConsultation: async () => { throw new Error("Consultation transfer is unavailable."); },
  completeConsultation: async () => { throw new Error("Consultation transfer is unavailable."); },
  hasAttemptedBlindTransfer: () => false,
});

const createTrialPermissionGate = () => createAndroidCallPermissionGate(() => {
  const auth = getAuthSnapshot();
  const phone = useSipAccountStore.getState();
  const calls = useSipCallStore.getState();
  return { owner: auth.user, authLoading: auth.loading, account: phone.account,
    incomingCall: calls.incomingCall, activeCalls: calls.activeCalls };
}, changed => useSipCallStore.subscribe(changed));

export function SipProvider({ children }: { children: React.ReactNode }) {
  const registrationLifecycle = useRef<ReturnType<typeof createRegistrationLifecycle> | null>(null);
  const accountLoadedFor = useRef<number | undefined>(undefined);
  const accountLoadPromise = useRef<Promise<void> | null>(null);
  const nativeStackInitialized = useRef(false);
  const nativeStackInitPromise = useRef<Promise<void> | null>(null);
  const sipMediaLease = useRef<MediaLease | undefined>(undefined);
  const androidIncomingMedia = useRef<AndroidIncomingMediaPreparation | undefined>(undefined);
  const androidIncomingGeneration = useRef(0);
  const androidCallPermission = useRef<ReturnType<typeof createAndroidCallPermissionGate> | null>(null);
  if (!androidCallPermission.current) androidCallPermission.current = createTrialPermissionGate();
  const retireAllAndroidIncomingMedia = useCallback(() => {
    androidIncomingMedia.current = undefined;
    ++androidIncomingGeneration.current;
  }, []);
  useEffect(() => {
    // Recreate on effect setup so React's development cleanup/setup rehearsal
    // does not leave a disposed gate in the still-mounted provider.
    const gate = createTrialPermissionGate();
    androidCallPermission.current = gate;
    return () => {
      gate.dispose();
      retireAllAndroidIncomingMedia();
    };
  }, [retireAllAndroidIncomingMedia]);
  const { loadAccount } = useSipAccountStore();

  const ensureAccountLoaded = useCallback(async () => {
    const owner = getAuthSnapshot().user?.id;
    if (!owner || getAuthSnapshot().loading) return;
    if (accountLoadedFor.current === owner) return;

    if (!accountLoadPromise.current) {
      accountLoadPromise.current = loadAccount()
        .then(() => {
          accountLoadedFor.current = owner;
          accountLoadPromise.current = null;
        })
        .catch((error) => {
          accountLoadPromise.current = null;
          console.error("[SipProvider] Failed to load SIP account:", error);
          throw error;
        });
    }

    await accountLoadPromise.current;
    if (getAuthSnapshot().user?.id !== owner) return;
  }, [loadAccount]);

  const ensureSipRegistered = useCallback(async (): Promise<boolean> => {
    await ensureAccountLoaded();

    const { account } = useSipAccountStore.getState();
    const auth = getAuthSnapshot();
    if (!account || !account.enabled || auth.loading || account.ownerUserId !== auth.user?.id) {
      useSipDiagnosticsStore.getState().addEvent({
        level: "warning",
        category: "registration",
        message: "No admin-provisioned phone account loaded",
        detail: "Open Phone Provisioning, sign in, then sync from admin management.",
      });
      return false;
    }

    await sipEngine.initialize();
    return true;
  }, [ensureAccountLoaded]);

  const ensureNativeStackInitialized = useCallback(async () => {
    if (nativeStackInitialized.current) {
      await ensureSipRegistered();
      return;
    }

    if (!nativeStackInitPromise.current) {
      nativeStackInitPromise.current = (async () => {
        const hasAccount = await ensureSipRegistered();
        if (!hasAccount) {
          nativeStackInitPromise.current = null;
          return;
        }

        await nativeCallManager.initialize();
        await registerVoipPush();
        nativeStackInitialized.current = true;
      })().catch((error) => {
        nativeStackInitPromise.current = null;
        nativeStackInitialized.current = false;
        console.error("[SipProvider] Native SIP stack initialization failed:", error);
        throw error;
      });
    }

    await nativeStackInitPromise.current;
  }, [ensureSipRegistered]);

  const retireAndroidIncomingMedia = useCallback(() => {
    const preparation = androidIncomingMedia.current;
    if (!preparation || (preparation.current(false) &&
      (!preparation.lease || phone11MediaOwnership.isCurrent(preparation.lease)))) return;
    androidIncomingMedia.current = undefined;
    ++androidIncomingGeneration.current;
    // A retired ring may release only its own prepared lease. A connected
    // original/consultation keeps the one SIP lease through SDK termination.
    const active = Object.values(useSipCallStore.getState().activeCalls)
      .some(call => call.status !== "disconnected");
    if (!active && preparation.lease && sipMediaLease.current === preparation.lease) {
      releaseSipMediaOwnership(preparation.lease);
      sipMediaLease.current = undefined;
    }
  }, []);

  const prepareAndroidIncomingMedia = useCallback((callId: string): Promise<MediaLease> => {
    retireAndroidIncomingMedia();
    const existing = androidIncomingMedia.current;
    if (existing?.current()) return existing.task.then(lease => {
      if (!existing.current() || !phone11MediaOwnership.isCurrent(lease))
        throw new Error("This incoming call's media ownership changed.");
      return lease;
    });
    const owner = getAuthSnapshot().user;
    const account = useSipAccountStore.getState().account;
    const incoming = useSipCallStore.getState().incomingCall;
    const historyId = incoming?.history?.id;
    const startedAt = incoming?.startTime?.getTime();
    const generation = ++androidIncomingGeneration.current;
    const preparation: AndroidIncomingMediaPreparation = {
      generation,
      current: (incomingOnly = true) => {
        const auth = getAuthSnapshot();
        const phone = useSipAccountStore.getState().account;
        const calls = useSipCallStore.getState();
        const live = calls.incomingCall?.id === callId ? calls.incomingCall
          : incomingOnly ? undefined : calls.activeCalls[callId];
        if (androidIncomingMedia.current !== preparation || androidIncomingGeneration.current !== generation ||
          !owner || auth.loading || auth.user !== owner || !account || phone !== account ||
          !account.enabled || account.ownerUserId !== owner.id || live?.id !== callId ||
          (incomingOnly ? live.status !== "incoming" : live.status === "disconnected") ||
          (live.history?.ownerUserId !== undefined && live.history.ownerUserId !== owner.id)) return false;
        return historyId ? live.history?.id === historyId
          : startedAt !== undefined ? live.startTime?.getTime() === startedAt : live === incoming;
      },
      // Install the exact record before SDK/coordinator preparation can yield.
      task: Promise.resolve().then(async () => {
        let lease: MediaLease | undefined;
        try {
          if (!preparation.current() || sipMediaLease.current)
            throw new Error("This incoming call's media ownership changed.");
          lease = await prepareSipMediaOwnership(callId);
          if (!preparation.current() || !phone11MediaOwnership.isCurrent(lease) ||
            (sipMediaLease.current && sipMediaLease.current !== lease))
            throw new Error("This incoming call's media ownership changed.");
          preparation.lease = lease;
          sipMediaLease.current = lease;
          return lease;
        } catch (error) {
          if (lease) releaseSipMediaOwnership(lease);
          if (androidIncomingMedia.current === preparation) androidIncomingMedia.current = undefined;
          throw error;
        }
      }),
    };
    androidIncomingMedia.current = preparation;
    return preparation.task;
  }, [retireAndroidIncomingMedia]);

  useEffect(() => {
    const lifecycle = createRegistrationLifecycle({
      snapshot: () => {
        const auth = getAuthSnapshot();
        const calls = useSipCallStore.getState();
        return {
          userId: auth.user?.id,
          authLoading: auth.loading,
          ...useSipAccountStore.getState(),
          hasLiveCall: (!!calls.incomingCall && calls.incomingCall.status !== "disconnected") ||
            Object.values(calls.activeCalls).some(call => call.status !== "disconnected"),
        };
      },
      loadAccount,
      initialize: ensureNativeStackInitialized,
      restart: async () => { await sipEngine.restart(); await ensureNativeStackInitialized(); },
      onError: () => useSipDiagnosticsStore.getState().addEvent({
        level: "warning", category: "registration", message: "Phone connection unavailable; automatic retry pending",
      }),
    }, Platform.OS !== "web" && AppState.currentState === "active");
    registrationLifecycle.current = lifecycle;
    const changed = () => { retireAndroidIncomingMedia(); lifecycle.changed(); };
    const unsubAccount = useSipAccountStore.subscribe(changed);
    const unsubAuth = addAuthChangeListener(changed);
    const appState = AppState.addEventListener("change", state => lifecycle.setActive(Platform.OS !== "web" && state === "active"));
    lifecycle.start();

    let prevIncomingId: string | null = null;
    const unsubIncoming = useSipCallStore.subscribe((state) => {
      changed();
      const incomingCall = state.incomingCall;
      if (incomingCall && incomingCall.id !== prevIncomingId) {
        prevIncomingId = incomingCall.id;
        // A meeting owns the microphone/camera until it has stopped every
        // track and released its audio session. Never display CallKit first.
        void (async () => {
          try {
            const androidTrial = isAndroidForegroundTrial();
            const lease = androidTrial ? await prepareAndroidIncomingMedia(incomingCall.id)
              : await prepareSipMediaOwnership(incomingCall.id);
            const current = useSipCallStore.getState().incomingCall;
            if (androidTrial) {
              const preparation = androidIncomingMedia.current;
              if (preparation?.lease !== lease || !preparation.current(false) || !phone11MediaOwnership.isCurrent(lease)) {
                retireAndroidIncomingMedia();
                return;
              }
              // Another authoritative answer callback may already have moved
              // this same lifetime to active. Keep its lease without displaying it again.
              if (!preparation.current()) return;
            }
            if (current?.id !== incomingCall.id || current.status === "disconnected") {
              releaseSipMediaOwnership(lease);
              return;
            }
            if (!androidTrial) {
              releaseSipMediaOwnership(sipMediaLease.current);
              sipMediaLease.current = lease;
            }
            nativeCallManager.displayIncomingCall(
              current.id,
              current.remoteNumber,
              current.remoteName,
              current.isVideo,
            );
          } catch {
            useSipDiagnosticsStore.getState().addEvent({
              level: "warning",
              category: "call",
              message: "Incoming call is waiting for meeting media to stop",
            });
          }
        })();
      } else if (!incomingCall) {
        prevIncomingId = null;
      }
      const hasLiveCall = Boolean(state.incomingCall && state.incomingCall.status !== "disconnected") ||
        Object.values(state.activeCalls).some(call => call.status !== "disconnected");
      if (!hasLiveCall) {
        releaseSipMediaOwnership(sipMediaLease.current);
        sipMediaLease.current = undefined;
      }
    });

    return () => {
      retireAllAndroidIncomingMedia();
      lifecycle.stop();
      if (registrationLifecycle.current === lifecycle) registrationLifecycle.current = null;
      unsubAccount();
      unsubAuth();
      appState.remove();
      unsubIncoming();
      releaseSipMediaOwnership(sipMediaLease.current);
      sipMediaLease.current = undefined;
      nativeCallManager.destroy();
      sipEngine.destroy().catch(console.error);
      nativeStackInitialized.current = false;
      nativeStackInitPromise.current = null;
    };
  }, [loadAccount, ensureNativeStackInitialized, prepareAndroidIncomingMedia, retireAndroidIncomingMedia, retireAllAndroidIncomingMedia]);

  useEffect(() => {
    const snapshot = () => {
      const auth = getAuthSnapshot();
      const phone = useSipAccountStore.getState();
      const calls = useSipCallStore.getState();
      return { owner: auth.user, account: phone.account,
        ready: nativeStackInitialized.current && phone.registrationState === "registered" &&
          !!phone.account?.enabled && phone.account.ownerUserId === auth.user?.id,
        busy: !!calls.incomingCall || Object.values(calls.activeCalls).some(call => call.status !== "disconnected") };
    };
    const canRefresh = () => Platform.OS === "ios" && AppState.currentState === "active" && snapshot().ready && !snapshot().busy;
    const maintenance = createVoipEnrollmentLifecycle({ snapshot,
      refresh: async signal => { const { refreshPhoneVoipEnrollment } = await import("../push/client"); await refreshPhoneVoipEnrollment(signal, canRefresh); },
    }, Platform.OS === "ios" && AppState.currentState === "active");
    const unsubAuth = addAuthChangeListener(maintenance.changed);
    const unsubAccount = useSipAccountStore.subscribe(maintenance.changed);
    const unsubCalls = useSipCallStore.subscribe(maintenance.changed);
    const appState = AppState.addEventListener("change", state => maintenance.setActive(Platform.OS === "ios" && state === "active"));
    maintenance.start();
    return () => { maintenance.dispose(); unsubAuth(); unsubAccount(); unsubCalls(); appState.remove(); };
  }, []);

  const value: SipContextValue = {
    reconnectPhone: async () => {
      if (!registrationLifecycle.current) throw new Error("Phone connection is starting. Please try again.");
      await registrationLifecycle.current.reconnect();
    },
    makeCall: async (dest, video) => {
      const dial = async (assertCurrent?: () => void, commandStarted?: () => void) => {
        const lease = await prepareSipMediaOwnership(`outgoing-${Date.now()}`);
        try { assertCurrent?.(); }
        catch (error) { releaseSipMediaOwnership(lease); throw error; }
        releaseSipMediaOwnership(sipMediaLease.current);
        sipMediaLease.current = lease;
        if (assertCurrent) {
          try { await ensureNativeStackInitialized(); }
          catch (error) {
            releaseSipMediaOwnership(lease);
            if (sipMediaLease.current === lease) sipMediaLease.current = undefined;
            throw error;
          }
        } else await ensureNativeStackInitialized();
        try {
          assertCurrent?.();
          commandStarted?.();
          const callId = await sipEngine.makeCall(dest, video);
          if (callId) {
            nativeCallManager.reportOutgoingCall(callId, dest, undefined, video);
            return callId;
          }
          releaseSipMediaOwnership(lease);
          if (sipMediaLease.current === lease) sipMediaLease.current = undefined;
          return null;
        } catch (error) {
          releaseSipMediaOwnership(lease);
          if (sipMediaLease.current === lease) sipMediaLease.current = undefined;
          throw error;
        }
      };
      if (!isAndroidForegroundTrial()) return dial();
      return androidCallPermission.current!.run({ kind: "dial", destination: dest, video: !!video }, dial);
    },
    hangupCall: async (id) => {
      await sipEngine.hangupCall(id);
      if (process.env.EXPO_PUBLIC_SIP_ENGINE !== "siprix") nativeCallManager.reportCallEnded(id);
    },
    answerCall: async (id, video) => {
      const answer = async (assertCurrent?: () => void, commandStarted?: () => void) => {
        const systemAnswer = Platform.OS === "ios" && process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix";

        const owner = getAuthSnapshot().user;
        const incoming = useSipCallStore.getState().incomingCall;
        // Initialization can cross a logout or a replacement call with a reused native ID.
        // Capture identity before yielding; accepting the SDK directly skips CallKit audio activation.
        const historyId = incoming?.history?.id;
        const startedAt = incoming?.startTime?.getTime();
        const stillThisIncomingCall = () => {
          const auth = getAuthSnapshot();
          const live = useSipCallStore.getState().incomingCall;
          if (!owner || auth.loading || auth.user !== owner || live?.id !== id || live.status !== "incoming" ||
            (live.history?.ownerUserId !== undefined && live.history.ownerUserId !== owner.id)) return false;
          return historyId ? live.history?.id === historyId
            : startedAt !== undefined ? live.startTime?.getTime() === startedAt : live === incoming;
        };
        if (systemAnswer && !stillThisIncomingCall()) throw new Error("This incoming call is no longer available.");
        await ensureNativeStackInitialized();
        assertCurrent?.();
        if (systemAnswer) {
          if (!stillThisIncomingCall()) throw new Error("This incoming call is no longer available.");
          const videoBridge = video ? await getVideoBridge() : null;
          if (video) {
            const bridge = videoBridge;
            if (!bridge) throw new Error("Video requires a Phone11 update.");
            if (!await bridge.requestCameraPermission()) throw new Error("Camera permission is required.");
            if (!stillThisIncomingCall()) throw new Error("This incoming call is no longer available.");
            await bridge.prepareVideoAnswer(id);
            if (!stillThisIncomingCall()) {
              await bridge.cancelVideoAnswer(id).catch(() => undefined);
              throw new Error("This incoming call is no longer available.");
            }
          }
          try { await nativeCallManager.answerIncomingCall(id); }
          catch (error) {
            if (videoBridge) await videoBridge.cancelVideoAnswer(id).catch(() => undefined);
            throw error;
          }
          return;
        }
        if (assertCurrent) {
          try {
            const lease = await prepareAndroidIncomingMedia(id);
            assertCurrent();
            const preparation = androidIncomingMedia.current;
            if (preparation?.lease !== lease || !preparation.current() ||
              sipMediaLease.current !== lease || !phone11MediaOwnership.isCurrent(lease))
              throw new Error("This incoming call's media ownership changed.");
          } catch (error) {
            retireAndroidIncomingMedia();
            throw error;
          }
        }
        commandStarted?.();
        await sipEngine.answerCall(id, video);
        if (process.env.EXPO_PUBLIC_SIP_ENGINE !== "siprix") nativeCallManager.reportCallConnected(id);
      };
      if (!isAndroidForegroundTrial()) return answer();
      return androidCallPermission.current!.run({ kind: "answer", callId: id, video: !!video }, answer);
    },
    setMute: async (id, muted) => {
      await sipEngine.setMute(id, muted);
      useSipCallStore.getState().setMuted(id, muted);
      nativeCallManager.setMuted(id, muted);
    },
    setHold: async (id, held) => {
      await sipEngine.setHold(id, held);
      useSipCallStore.getState().setHeld(id, held);
      nativeCallManager.setOnHold(id, held);
    },
    setSpeaker: async (id, speaker) => {
      await sipEngine.setSpeaker(id, speaker);
      useSipCallStore.getState().setSpeaker(id, speaker);
    },
    sendDtmf: async (id, digit) => {
      await sipEngine.sendDtmf(id, digit);
    },
    transferCall: async (id, dest) => {
      await sipEngine.transferCall(id, dest);
    },
    supportsWarmTransfer: () => process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix" &&
      (Platform.OS === "ios" || (isAndroidForegroundTrial() &&
        process.env.EXPO_PUBLIC_PHONE11_ANDROID_CONSULTATION_SOURCE === "1")) &&
      siprixEngine.supportsWarmTransfer(),
    consultation: id => siprixEngine.consultation(id),
    remainingConsultation: id => siprixEngine.remainingConsultation(id),
    beginConsultation: (id,dest) => siprixEngine.beginConsultation(id,dest),
    cancelConsultation: (id,requestId) => siprixEngine.cancelConsultation(id,requestId),
    completeConsultation: (id,requestId) => siprixEngine.completeConsultation(id,requestId),
    hasAttemptedBlindTransfer: id => siprixEngine.hasAttemptedBlindTransfer(id),
    supportsBlindTransfer: () => Platform.OS === "ios" &&
      process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix" &&
      siprixEngine.supportsBlindTransfer(),
  };

  return <SipContext.Provider value={value}>{children}</SipContext.Provider>;
}

export function useSip() {
  return useContext(SipContext);
}
