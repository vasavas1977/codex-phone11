/**
 * SIP Account Store
 * Keeps native SIP credentials in device secure storage, bound to the signed-in user.
 * Connects Phone11 to Kamailio SIP proxy -> SBC -> PSTN.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { getAuthSnapshot } from "../_core/auth";
import { hasOngoingSipCall } from "./call-store";
import { create } from "zustand";

export type SipTransport = "UDP" | "TCP" | "TLS";

export interface SipAccount {
  ownerUserId?: number;
  tenantId?: number;
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
const SECURE_STORAGE_KEY = "phone11_sip_account_v2";
const accountFields = [
  "ownerUserId", "tenantId", "id", "displayName", "username", "password", "domain", "proxy",
  "port", "transport", "srtp", "stun", "enabled",
] as const satisfies ReadonlyArray<keyof SipAccount>;

export function sameSipAccount(current: SipAccount | null, next: SipAccount): boolean {
  return current !== null && accountFields.every(field => current[field] === next[field]);
}

export class SipAccountChangeDuringCallError extends Error {
  constructor() {
    super("Finish the current phone call before syncing a different phone account.");
    this.name = "SipAccountChangeDuringCallError";
  }
}

function assertNoCallForAccountChange(current: SipAccount | null, next: SipAccount): void {
  if (!sameSipAccount(current, next) && hasOngoingSipCall()) {
    throw new SipAccountChangeDuringCallError();
  }
}
let storageQueue: Promise<unknown> = Promise.resolve();
let revision = 0;
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const task = storageQueue.then(operation, operation);
  storageQueue = task.catch(() => undefined);
  return task;
}

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
    if (!account.ownerUserId || account.ownerUserId !== getAuthSnapshot().user?.id) {
      throw new Error("Sign in before provisioning a Phone11 account");
    }
    assertNoCallForAccountChange(useSipAccountStore.getState().account, account);
    const current = ++revision;
    await serialize(async () => {
      if (current !== revision || account.ownerUserId !== getAuthSnapshot().user?.id) return;
      const previous = useSipAccountStore.getState().account;
      assertNoCallForAccountChange(previous, account);
      if (Platform.OS !== "web") {
        await SecureStore.setItemAsync(SECURE_STORAGE_KEY, JSON.stringify(account), {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      }
      await AsyncStorage.removeItem(STORAGE_KEY);
      if (current === revision && account.ownerUserId === getAuthSnapshot().user?.id) {
        if (!sameSipAccount(previous, account) && hasOngoingSipCall()) {
          if (Platform.OS !== "web") {
            if (previous) await SecureStore.setItemAsync(SECURE_STORAGE_KEY, JSON.stringify(previous), {
              keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            });
            else await SecureStore.deleteItemAsync(SECURE_STORAGE_KEY);
            // Sign-out or another write may have started during the rollback.
            // A queued clear/new write now owns the keychain state.
            if (current !== revision || account.ownerUserId !== getAuthSnapshot().user?.id) {
              await SecureStore.deleteItemAsync(SECURE_STORAGE_KEY);
            }
          }
          throw new SipAccountChangeDuringCallError();
        }
        set({ account });
      } else if (Platform.OS !== "web") {
        // Auth can change while the keychain write is in flight. Do not leave that
        // owner's credentials available to a later hydration before cleanup runs.
        await SecureStore.deleteItemAsync(SECURE_STORAGE_KEY);
      }
    });
  },

  loadAccount: async () => {
    const current = revision;
    await serialize(async () => {
      // Old unbound/plaintext credentials must be re-provisioned after real sign-in.
      await AsyncStorage.removeItem(STORAGE_KEY);
      if (Platform.OS === "web") return;
      const raw = await SecureStore.getItemAsync(SECURE_STORAGE_KEY);
      if (!raw || current !== revision) return;
      try {
        const account = JSON.parse(raw) as SipAccount;
        if (Number.isSafeInteger(account.ownerUserId) && account.ownerUserId === getAuthSnapshot().user?.id) {
          set({ account });
        }
      } catch { /* Invalid cached account; authenticated provisioning replaces it. */ }
    });
  },

  clearAccount: async () => {
    ++revision;
    set({ account: null, registrationState: "unregistered", registrationError: null });
    await serialize(async () => {
      if (Platform.OS !== "web") await SecureStore.deleteItemAsync(SECURE_STORAGE_KEY);
      await AsyncStorage.removeItem(STORAGE_KEY);
    });
  },

  setRegistrationState: (state: RegistrationState, error?: string) => {
    set({ registrationState: state, registrationError: error ?? null });
  },
}));

export { DEFAULT_ACCOUNT };
