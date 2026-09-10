import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers";
import { getApiBaseUrl } from "@/constants/oauth";
import { getAuthSnapshot, getSessionToken } from "@/lib/_core/auth";
import { useSipAccountStore } from "@/lib/sip/account-store";
import { VoipTokenCoordinator, type PushBinding } from "./token-coordinator";
import { createVoipDeviceId, getVoipCapabilities, startNativeVoip, stopNativeVoip } from "./native-voip";

const ledgerKey = "phone11_voip_revocations_v1";
const deviceKey = "phone11_voip_device_v1";
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
let unsubscribe: (() => void) | undefined;
let generation = 0;

function validBinding(value: unknown): value is PushBinding {
  if (!value || typeof value !== "object") return false;
  const entry = value as PushBinding;
  return Number.isSafeInteger(entry.ownerUserId) && entry.ownerUserId > 0 &&
    [entry.token, entry.deviceId, entry.sipUri, entry.bundleId].every(item => typeof item === "string" && item.length > 0 && item.length <= 4096) &&
    entry.platform === "ios" && typeof entry.sandbox === "boolean";
}

async function requestClient(owner: number, signal: AbortSignal) {
  const user = getAuthSnapshot().user;
  const current = () => !signal.aborted && user?.id === owner && getAuthSnapshot().user === user;
  if (!current()) throw new Error("Phone account changed");
  const token = await getSessionToken();
  if (!token || !current()) throw new Error("Phone account changed");
  // Capture this session, never a later user's bearer token during an async call.
  return createTRPCProxyClient<AppRouter>({ links: [httpBatchLink({
    url: `${getApiBaseUrl()}/api/trpc`, transformer: superjson,
    headers: { Authorization: `Bearer ${token}` },
    async fetch(url, options) {
      if (!current()) throw new Error("Phone account changed");
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => controller.abort(), 5000);
      try { return await fetch(url, { ...options, credentials: "omit", signal: controller.signal }); }
      finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
    },
  })] });
}

const coordinator = new VoipTokenCoordinator({
  currentOwner: () => getAuthSnapshot().user?.id ?? null,
  async read() {
    const value = await SecureStore.getItemAsync(ledgerKey);
    if (!value) return [];
    const entries: unknown = JSON.parse(value);
    if (!Array.isArray(entries) || !entries.every(validBinding)) throw new Error("Phone push cleanup needs recovery");
    return entries;
  },
  write: entries => SecureStore.setItemAsync(ledgerKey, JSON.stringify(entries), secureOptions),
  async register(binding, signal) {
    const client = await requestClient(binding.ownerUserId, signal);
    const { ownerUserId: _, ...data } = binding;
    await client.push.register.mutate({ ...data, tokenType: "voip" });
  },
  async unregister(binding, signal) {
    const client = await requestClient(binding.ownerUserId, signal);
    await client.push.unregister.mutate({ token: binding.token, deviceId: binding.deviceId, platform: binding.platform });
  },
  async stopNative() { unsubscribe?.(); unsubscribe = undefined; await stopNativeVoip(); },
});

/** Called only after an authenticated, enabled phone account was initialized.
 * The shipping native capability is false; no PKRegistry, token or network work
 * occurs until a separate reviewed native wake implementation is commissioned. */
export async function registerPhoneVoipPush(): Promise<null> {
  if (Platform.OS !== "ios" || !(await getVoipCapabilities()).registrationAvailable) return null;
  const account = useSipAccountStore.getState().account;
  const owner = getAuthSnapshot().user?.id;
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier;
  if (!owner || account?.ownerUserId !== owner || !account.enabled || !bundleId) return null;
  const current = ++generation;
  unsubscribe?.(); unsubscribe = undefined;
  let deviceId = await SecureStore.getItemAsync(deviceKey);
  if (!deviceId) {
    deviceId = await createVoipDeviceId();
    await SecureStore.setItemAsync(deviceKey, deviceId, secureOptions);
  }
  if (generation !== current || getAuthSnapshot().user?.id !== owner) return null;
  // APNs environment is a signed-build property, never inferred from __DEV__.
  // A commissioned build must explicitly provide this value in its native config.
  const environment = Constants.expoConfig?.extra?.phone11ApnsEnvironment;
  if (environment !== "sandbox" && environment !== "production") return null;
  const binding = { ownerUserId: owner, deviceId, sipUri: `sip:${account.username}@${account.domain}`,
    bundleId, platform: "ios" as const, sandbox: environment === "sandbox" };
  const remove = await startNativeVoip(token => {
    if (generation !== current || getAuthSnapshot().user?.id !== owner) return;
    const operation = token ? coordinator.bind({ ...binding, token }) : coordinator.beforeLogout();
    // Provider tokens and request errors must never be logged. The durable ledger
    // preserves cleanup across a lost response or account/session transition.
    void operation.catch(() => undefined);
  });
  if (generation !== current) remove(); else unsubscribe = remove;
  return null;
}

export async function beforePhoneLogout(): Promise<void> {
  ++generation;
  if (Platform.OS !== "ios") return;
  // Server session revocation (and its push-token cascade) is authoritative.
  // A local cleanup failure must not prevent that revocation request.
  try { await coordinator.beforeLogout(); } catch { /* retain encrypted ledger */ }
}
