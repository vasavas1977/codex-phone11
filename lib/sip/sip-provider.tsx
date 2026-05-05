/**
 * SIP Provider — CloudPhone11
 * Initializes the PJSIP engine + CallKit/ConnectionService on app start.
 * Wrap the app root with <SipProvider> to enable real SIP calling.
 */

import React, { createContext, useContext, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { sipEngine } from "./engine";
import { useSipAccountStore } from "./account-store";
import { useSipCallStore } from "./call-store";
import { nativeCallManager, registerVoipPush } from "./native-call";

interface SipContextValue {
  makeCall: (destination: string, video?: boolean) => Promise<string | null>;
  hangupCall: (callId: string) => Promise<void>;
  answerCall: (callId: string, video?: boolean) => Promise<void>;
  setMute: (callId: string, muted: boolean) => Promise<void>;
  setHold: (callId: string, held: boolean) => Promise<void>;
  sendDtmf: (callId: string, digit: string) => Promise<void>;
  transferCall: (callId: string, destination: string) => Promise<void>;
}

const SipContext = createContext<SipContextValue>({
  makeCall: async () => null,
  hangupCall: async () => {},
  answerCall: async () => {},
  setMute: async () => {},
  setHold: async () => {},
  sendDtmf: async () => {},
  transferCall: async () => {},
});

export function SipProvider({ children }: { children: React.ReactNode }) {
  const initialized = useRef(false);
  const { loadAccount } = useSipAccountStore();

  useEffect(() => {
    async function init() {
      if (initialized.current) return;
      initialized.current = true;

      // Load SIP account from storage
      await loadAccount();

      // Initialize PJSIP engine
      await sipEngine.initialize();

      // Initialize CallKit (iOS) / ConnectionService (Android)
      await nativeCallManager.initialize();

      // Register for VoIP push notifications (iOS)
      await registerVoipPush();
    }
    init();

    // Subscribe to incoming call events — display on native UI
    let prevIncomingId: string | null = null;
    const unsubIncoming = useSipCallStore.subscribe((state) => {
      const incomingCall = state.incomingCall;
      if (incomingCall && incomingCall.id !== prevIncomingId) {
        prevIncomingId = incomingCall.id;
        nativeCallManager.displayIncomingCall(
          incomingCall.id,
          incomingCall.remoteNumber,
          incomingCall.remoteName,
          incomingCall.isVideo
        );
      } else if (!incomingCall) {
        prevIncomingId = null;
      }
    });

    // Re-register when app comes to foreground
    const appStateSub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active" && initialized.current) {
        sipEngine.initialize().catch(console.error);
      }
    });

    return () => {
      appStateSub.remove();
      unsubIncoming();
      nativeCallManager.destroy();
      sipEngine.destroy().catch(console.error);
    };
  }, []);

  const value: SipContextValue = {
    makeCall: async (dest, video) => {
      const callId = await sipEngine.makeCall(dest, video);
      if (callId) {
        // Report outgoing call to native UI
        nativeCallManager.reportOutgoingCall(callId, dest, undefined, video);
      }
      return callId;
    },
    hangupCall: async (id) => {
      await sipEngine.hangupCall(id);
      nativeCallManager.reportCallEnded(id);
    },
    answerCall: async (id, video) => {
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
