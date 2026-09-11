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
import { sipEngine } from "./engine";
import { useSipAccountStore } from "./account-store";
import { useSipCallStore } from "./call-store";
import { useSipDiagnosticsStore } from "./diagnostics-store";
import { nativeCallManager, registerVoipPush } from "./native-call";

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
}

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
});

export function SipProvider({ children }: { children: React.ReactNode }) {
  const registrationLifecycle = useRef<ReturnType<typeof createRegistrationLifecycle> | null>(null);
  const accountLoadedFor = useRef<number | undefined>(undefined);
  const accountLoadPromise = useRef<Promise<void> | null>(null);
  const nativeStackInitialized = useRef(false);
  const nativeStackInitPromise = useRef<Promise<void> | null>(null);
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
    const unsubAccount = useSipAccountStore.subscribe(lifecycle.changed);
    const unsubAuth = addAuthChangeListener(lifecycle.changed);
    const appState = AppState.addEventListener("change", state => lifecycle.setActive(Platform.OS !== "web" && state === "active"));
    lifecycle.start();

    let prevIncomingId: string | null = null;
    const unsubIncoming = useSipCallStore.subscribe((state) => {
      lifecycle.changed();
      const incomingCall = state.incomingCall;
      if (incomingCall && incomingCall.id !== prevIncomingId) {
        prevIncomingId = incomingCall.id;
        nativeCallManager.displayIncomingCall(
          incomingCall.id,
          incomingCall.remoteNumber,
          incomingCall.remoteName,
          incomingCall.isVideo,
        );
      } else if (!incomingCall) {
        prevIncomingId = null;
      }
    });

    return () => {
      lifecycle.stop();
      if (registrationLifecycle.current === lifecycle) registrationLifecycle.current = null;
      unsubAccount();
      unsubAuth();
      appState.remove();
      unsubIncoming();
      nativeCallManager.destroy();
      sipEngine.destroy().catch(console.error);
      nativeStackInitialized.current = false;
      nativeStackInitPromise.current = null;
    };
  }, [loadAccount, ensureNativeStackInitialized]);

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
      await ensureNativeStackInitialized();
      const callId = await sipEngine.makeCall(dest, video);
      if (callId) {
        nativeCallManager.reportOutgoingCall(callId, dest, undefined, video);
      }
      return callId;
    },
    hangupCall: async (id) => {
      await sipEngine.hangupCall(id);
      if (process.env.EXPO_PUBLIC_SIP_ENGINE !== "siprix") nativeCallManager.reportCallEnded(id);
    },
    answerCall: async (id, video) => {
      const systemAnswer = Platform.OS === "ios" && process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix";
      if (systemAnswer && video) throw new Error("Siprix iOS voice trial does not support video calls");
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
      if (systemAnswer) {
        if (!stillThisIncomingCall()) throw new Error("This incoming call is no longer available.");
        await nativeCallManager.answerIncomingCall(id);
        return;
      }
      await sipEngine.answerCall(id, video);
      if (process.env.EXPO_PUBLIC_SIP_ENGINE !== "siprix") nativeCallManager.reportCallConnected(id);
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
  };

  return <SipContext.Provider value={value}>{children}</SipContext.Provider>;
}

export function useSip() {
  return useContext(SipContext);
}
