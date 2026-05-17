/**
 * SIP Provider — Phone11
 * Loads SIP account data at app start, registers SIP only when an
 * admin-provisioned account is explicitly synced or a call flow needs it,
 * and initializes native call UI when calling is used.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { sipEngine } from "./engine";
import { useSipAccountStore } from "./account-store";
import { useSipCallStore } from "./call-store";
import { useSipDiagnosticsStore } from "./diagnostics-store";
import { nativeCallManager, registerVoipPush } from "./native-call";

interface SipContextValue {
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
  const accountLoaded = useRef(false);
  const accountLoadPromise = useRef<Promise<void> | null>(null);
  const nativeStackInitialized = useRef(false);
  const nativeStackInitPromise = useRef<Promise<void> | null>(null);
  const { loadAccount } = useSipAccountStore();

  const ensureAccountLoaded = useCallback(async () => {
    if (accountLoaded.current) return;

    if (!accountLoadPromise.current) {
      accountLoadPromise.current = loadAccount()
        .then(() => {
          accountLoaded.current = true;
        })
        .catch((error) => {
          accountLoadPromise.current = null;
          console.error("[SipProvider] Failed to load SIP account:", error);
          throw error;
        });
    }

    await accountLoadPromise.current;
  }, [loadAccount]);

  const ensureSipRegistered = useCallback(async (): Promise<boolean> => {
    await ensureAccountLoaded();

    const { account } = useSipAccountStore.getState();
    if (!account || !account.enabled) {
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
    if (nativeStackInitialized.current) return;

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
    ensureAccountLoaded().catch(() => {});

    let prevIncomingId: string | null = null;
    const unsubIncoming = useSipCallStore.subscribe((state) => {
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
      unsubIncoming();
      nativeCallManager.destroy();
      sipEngine.destroy().catch(console.error);
      nativeStackInitialized.current = false;
      nativeStackInitPromise.current = null;
    };
  }, [ensureAccountLoaded]);

  const value: SipContextValue = {
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
      nativeCallManager.reportCallEnded(id);
    },
    answerCall: async (id, video) => {
      await ensureNativeStackInitialized();
      await sipEngine.answerCall(id, video);
      nativeCallManager.reportCallConnected(id);
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
