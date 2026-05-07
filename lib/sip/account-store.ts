/**
 * SIP Account Store
 * Persists SIP account configuration using AsyncStorage.
 * Connects Phone11 to Kamailio SIP proxy -> SBC -> PSTN.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

export type SipTransport = "UDP" | "TCP" | "TLS";

export interface SipAccount {
  id: string;
  displayName: string;
  username: string;       // SIP username / extension
  password: string;       // SIP password
  domain: string;         // Kamailio SIP domain, e.g. sip.yourcompany.com
  proxy?: string;         // Optional outbound proxy / Dinstar SBC address
  port: number;           // SIP port (5060 UDP/TCP, 5061 TLS)
  transport: SipTransport;
  srtp: boolean;          // Enable SRTP media encryption
  stun?: string;          // STUN server for NAT traversal, e.g. stun.yourcompany.com
  enabled: boolean;
}

export type RegistrationState =
  | "unregistered"
  | "registering"
  | "registered"
  | "failed"
  | "network_error";

interface SipAccountState {
  account: SipAccount | null;
  registrationState: RegistrationState;
  registrationError: string | null;
  setAccount: (account: SipAccount) => Promise<void>;
  loadAccount: () => Promise<void>;
  clearAccount: () => Promise<void>;
  setRegistrationState: (state: RegistrationState, error?: string) => void;
}

const STORAGE_KEY = "phone11_sip_account";

const DEFAULT_ACCOUNT: Omit<SipAccount, "username" | "password" | "domain"> = {
  id: "default",
  displayName: "",
  proxy: "",
  port: 5061,
  transport: "TLS",
  srtp: true,
  stun: "stun.l.google.com:19302",
  enabled: true,
};

export const useSipAccountStore = create<SipAccountState>((set) => ({
  account: null,
  registrationState: "unregistered",
  registrationError: null,

  setAccount: async (account: SipAccount) => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(account));
    set({ account });
  },

  loadAccount: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const account = JSON.parse(raw) as SipAccount;
        set({ account });
      }
    } catch {
      // No stored account
    }
  },

  clearAccount: async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    set({ account: null, registrationState: "unregistered" });
  },

  setRegistrationState: (state: RegistrationState, error?: string) => {
    set({ registrationState: state, registrationError: error ?? null });
  },
}));

export { DEFAULT_ACCOUNT };
