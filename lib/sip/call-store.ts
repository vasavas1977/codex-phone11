/**
 * SIP Call Store — Phone11
 * Manages active calls, incoming calls, and call state using Zustand.
 */

import { create } from "zustand";

export type CallDirection = "inbound" | "outbound";
export type CallStatus =
  | "calling"       // Outbound: ringing remote
  | "incoming"      // Inbound: ringing locally
  | "connecting"    // Being answered
  | "active"        // Connected, media flowing
  | "held"          // On hold
  | "disconnected"; // Ended

export interface SipCall {
  id: string;
  direction: CallDirection;
  status: CallStatus;
  remoteNumber: string;
  remoteName?: string;
  startTime?: Date;
  connectTime?: Date;
  isMuted: boolean;
  isHeld: boolean;
  isSpeaker: boolean;
  isVideo: boolean;
  // Raw PJSIP call object (native only)
  _nativeCall?: any;
}

interface SipCallState {
  activeCalls: Record<string, SipCall>;
  incomingCall: SipCall | null;

  // Actions
  addOutgoingCall: (nativeCall: any, destination: string) => void;
  setIncomingCall: (nativeCall: any) => void;
  updateCallState: (nativeCall: any) => void;
  terminateCall: (callId: string) => void;
  setMuted: (callId: string, muted: boolean) => void;
  setHeld: (callId: string, held: boolean) => void;
  setSpeaker: (callId: string, speaker: boolean) => void;
  clearIncomingCall: () => void;
  getCall: (callId: string) => any | null;
}

export const useSipCallStore = create<SipCallState>((set, get) => ({
  activeCalls: {},
  incomingCall: null,

  addOutgoingCall: (nativeCall: any, destination: string) => {
    const id = nativeCall.getId().toString();
    const call: SipCall = {
      id,
      direction: "outbound",
      status: "calling",
      remoteNumber: destination,
      isMuted: false,
      isHeld: false,
      isSpeaker: false,
      isVideo: false,
      startTime: new Date(),
      _nativeCall: nativeCall,
    };
    set((state) => ({
      activeCalls: { ...state.activeCalls, [id]: call },
    }));
  },

  setIncomingCall: (nativeCall: any) => {
    const id = nativeCall.getId().toString();
    const info = nativeCall.getInfo?.() ?? {};
    const remoteUri: string = info.remoteUri ?? info.remoteContact ?? "Unknown";
    // Extract number from SIP URI: sip:+66812345678@domain.com → +66812345678
    const match = remoteUri.match(/sip:([^@]+)@/);
    const remoteNumber = match ? match[1] : remoteUri;

    const call: SipCall = {
      id,
      direction: "inbound",
      status: "incoming",
      remoteNumber,
      remoteName: info.remoteDisplayName ?? undefined,
      isMuted: false,
      isHeld: false,
      isSpeaker: false,
      isVideo: false,
      startTime: new Date(),
      _nativeCall: nativeCall,
    };
    set({ incomingCall: call });
  },

  updateCallState: (nativeCall: any) => {
    const id = nativeCall.getId().toString();
    const info = nativeCall.getInfo?.() ?? {};
    const pjState: string = info.state ?? "";

    const statusMap: Record<string, CallStatus> = {
      PJSIP_INV_STATE_CALLING: "calling",
      PJSIP_INV_STATE_INCOMING: "incoming",
      PJSIP_INV_STATE_EARLY: "calling",
      PJSIP_INV_STATE_CONNECTING: "connecting",
      PJSIP_INV_STATE_CONFIRMED: "active",
      PJSIP_INV_STATE_DISCONNECTED: "disconnected",
    };

    const newStatus = statusMap[pjState] ?? "active";

    set((state) => {
      const existing = state.activeCalls[id];
      const incoming = state.incomingCall?.id === id ? state.incomingCall : null;
      if (!existing && !incoming) return state;

      if (incoming && newStatus !== "active") {
        return {
          incomingCall: { ...incoming, status: newStatus, _nativeCall: nativeCall },
        };
      }

      if (!existing) return state;

      const updated: SipCall = {
        ...existing,
        status: newStatus,
        connectTime: newStatus === "active" && !existing.connectTime ? new Date() : existing.connectTime,
        _nativeCall: nativeCall,
      };

      return { activeCalls: { ...state.activeCalls, [id]: updated } };
    });

    // Move from incoming to active calls when answered
    set((state) => {
      if (state.incomingCall?.id === id && newStatus === "active") {
        const call = state.incomingCall;
        return {
          incomingCall: null,
          activeCalls: {
            ...state.activeCalls,
            [id]: { ...call, status: "active", connectTime: new Date(), _nativeCall: nativeCall },
          },
        };
      }
      return state;
    });
  },

  terminateCall: (callId: string) => {
    set((state) => {
      const calls = { ...state.activeCalls };
      delete calls[callId];
      return {
        activeCalls: calls,
        incomingCall: state.incomingCall?.id === callId ? null : state.incomingCall,
      };
    });
  },

  setMuted: (callId: string, muted: boolean) => {
    set((state) => {
      const call = state.activeCalls[callId];
      if (!call) return state;
      return { activeCalls: { ...state.activeCalls, [callId]: { ...call, isMuted: muted } } };
    });
  },

  setHeld: (callId: string, held: boolean) => {
    set((state) => {
      const call = state.activeCalls[callId];
      if (!call) return state;
      return { activeCalls: { ...state.activeCalls, [callId]: { ...call, isHeld: held, status: held ? "held" : "active" } } };
    });
  },

  setSpeaker: (callId: string, speaker: boolean) => {
    set((state) => {
      const call = state.activeCalls[callId];
      if (!call) return state;
      return { activeCalls: { ...state.activeCalls, [callId]: { ...call, isSpeaker: speaker } } };
    });
  },

  clearIncomingCall: () => set({ incomingCall: null }),

  getCall: (callId: string) => {
    const state = get();
    const call =
      state.activeCalls[callId] ??
      (state.incomingCall?.id === callId ? state.incomingCall : null);
    return call?._nativeCall ?? null;
  },
}));
