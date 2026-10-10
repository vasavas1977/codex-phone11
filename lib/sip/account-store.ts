/**
 * SIP Account Store
 * Keeps native SIP credentials in device secure storage, bound to the signed-in user.
 * Connects Phone11 to Kamailio SIP proxy -> SBC -> PSTN.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { NativeModules, Platform } from "react-native";
import { getAuthSnapshot } from "../_core/auth";
import { hasOngoingSipCall } from "./call-store";
import { create } from "zustand";
import type { AccountConfig, Phone11SiprixModule } from "../../modules/phone11-siprix";

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

async function hasNativeSipCallOrWake(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  const bridge = NativeModules.Phone11Siprix as Phone11SiprixModule | undefined;
  if (!bridge) return false;
  if (typeof bridge.getSnapshot !== "function") return true;
  try {
    const snapshot = await bridge.getSnapshot();
    // A VoIP push can own a native ringing session before JS sees any call.
    // Native getSnapshot intentionally exposes nativeWake even with calls=[].
    return !Array.isArray(snapshot?.calls) || Boolean(snapshot.nativeWake) ||
      snapshot.calls.some(call => call.state !== "terminated");
  } catch {
    // A quarantined or independently leased native runtime is not safe to replace.
    return true;
  }
}

async function assertNativeIdleForAccountChange(current: SipAccount | null, next: SipAccount): Promise<void> {
  if (!sameSipAccount(current, next) && (hasOngoingSipCall() || await hasNativeSipCallOrWake())) {
    throw new SipAccountChangeDuringCallError();
  }
}
function nativeAccountChangeBridge(current: SipAccount | null, next: SipAccount): Phone11SiprixModule | null {
  // The Siprix native wake module is iOS-only. Android currently uses PJSIP
  // and its JS call-store guard; an Android native wake lease needs its own
  // implementation before claiming the same background-race guarantee.
  if (sameSipAccount(current, next) || Platform.OS !== "ios") return null;
  const bridge = NativeModules.Phone11Siprix as Phone11SiprixModule | undefined;
  if (!bridge) return null;
  // Old installed builds cannot make the final idle check atomic with wake
  // admission. Never replace their account while that gap remains open.
  if (typeof bridge.beginAccountChange !== "function" || typeof bridge.endAccountChange !== "function") {
    throw new Error("Install the latest Phone11 app before syncing a different phone account.");
  }
  return bridge;
}

async function restoreSecureAccount(previous: SipAccount | null): Promise<void> {
  if (Platform.OS === "web") return;
  if (previous) await SecureStore.setItemAsync(SECURE_STORAGE_KEY, JSON.stringify(previous), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  else await SecureStore.deleteItemAsync(SECURE_STORAGE_KEY);
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
      await assertNativeIdleForAccountChange(previous, account);
      const bridge = nativeAccountChangeBridge(previous, account);
      if (current !== revision || account.ownerUserId !== getAuthSnapshot().user?.id) return;
      if (Platform.OS !== "web") {
        await SecureStore.setItemAsync(SECURE_STORAGE_KEY, JSON.stringify(account), {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      }
      await AsyncStorage.removeItem(STORAGE_KEY);
      if (current === revision && account.ownerUserId === getAuthSnapshot().user?.id) {
        let lease: string | null = null;
        let published = false;
        let nextNativeConfig: AccountConfig | null = null;
        try {
          if (!sameSipAccount(previous, account)) {
            if (hasOngoingSipCall()) throw new SipAccountChangeDuringCallError();
            if (bridge) {
              try { lease = await bridge.beginAccountChange!(); }
              catch { throw new SipAccountChangeDuringCallError(); }
              if (!lease || hasOngoingSipCall()) throw new SipAccountChangeDuringCallError();
              // The lease prevents a native wake or outgoing call from starting
              // while the old idle runtime is retired and JS changes owner.
              const { siprixEngine, nativeAccount } = await import("./siprix-engine");
              nextNativeConfig = nativeAccount(account);
              await siprixEngine.destroy();
            } else if (await hasNativeSipCallOrWake()) {
              throw new SipAccountChangeDuringCallError();
            }
          }
          if (current !== revision || account.ownerUserId !== getAuthSnapshot().user?.id) {
            if (Platform.OS !== "web") await SecureStore.deleteItemAsync(SECURE_STORAGE_KEY);
            return;
          }
          set({ account });
          published = true;
        } catch (error) {
          if (current === revision && account.ownerUserId === getAuthSnapshot().user?.id) {
            await restoreSecureAccount(previous);
          } else if (Platform.OS !== "web") {
            await SecureStore.deleteItemAsync(SECURE_STORAGE_KEY);
          }
          throw error;
        } finally {
          if (lease && bridge) await bridge.endAccountChange!(lease, published ? nextNativeConfig : null,
            published && previous?.ownerUserId === account.ownerUserId && previous?.tenantId === account.tenantId &&
            previous?.username === account.username && previous?.domain === account.domain);
        }
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
