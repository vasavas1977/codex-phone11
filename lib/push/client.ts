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
import { createVoipDeviceId, getVoipCapabilities, startNativeVoip, stopNativeVoip, getNativeWakeBinding, saveNativeWakeEnrollment, type WakeBinding } from "./native-voip";

const ledgerKey = "phone11_voip_revocations_v1";
const deviceKey = "phone11_voip_device_v1";
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
let unsubscribe: (() => void) | undefined;
let generation = 0;
// Transient identity only; the durable ledger never receives auth/session data.
const registrationOrigins = new WeakMap<PushBinding, ReturnType<typeof phoneIdentity>>();

function validBinding(value: unknown): value is PushBinding {
  if (!value || typeof value !== "object") return false;
  const entry = value as PushBinding;
  return Number.isSafeInteger(entry.ownerUserId) && entry.ownerUserId > 0 &&
    [entry.token, entry.deviceId, entry.sipUri, entry.bundleId].every(item => typeof item === "string" && item.length > 0 && item.length <= 4096) &&
    entry.platform === "ios" && typeof entry.sandbox === "boolean";
}

function phoneIdentity() {
  const user = getAuthSnapshot().user;
  const configured = useSipAccountStore.getState().account;
  const account = configured ? { ...configured } : null;
  const fields = ["id", "ownerUserId", "tenantId", "username", "domain", "password", "proxy", "port", "transport", "srtp", "stun", "enabled"] as const;
  return { user, account, current: () => {
    const now = useSipAccountStore.getState().account;
    return !!user && !!account?.enabled && account.ownerUserId === user.id &&
      getAuthSnapshot().user === user && !!now && fields.every(key => account[key] === now[key]);
  } };
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
    const origin = registrationOrigins.get(binding) ?? phoneIdentity();
    const current = () => {
      if (signal.aborted || !origin.current() || origin.user?.id !== binding.ownerUserId ||
          binding.sipUri !== `sip:${origin.account?.username}@${origin.account?.domain}`) {
        throw new Error("Incoming phone account changed");
      }
    };
    current();
    const client = await requestClient(binding.ownerUserId, signal); current();
    const { ownerUserId: _, ...data } = binding;
    await client.push.register.mutate({ ...data, tokenType: "voip" }); current();
    const cached = await getNativeWakeBinding(); current();
    // An active wake retains its grant. Resolve under the captured bearer before
    // minting another grant; no operation may borrow a replacement login.
    let publicBinding = cached?.ownerUserId === binding.ownerUserId && cached.deviceId === binding.deviceId
      ? await client.push.resolveWakeBinding.query({ bindingId: cached.bindingId }) : null;
    current();
    if (!publicBinding) {
      const enrollment = await client.push.enrollWake.mutate({ deviceId: binding.deviceId, platform: "ios" }); current();
      if (enrollment.ownerUserId !== binding.ownerUserId || enrollment.deviceId !== binding.deviceId || origin.account?.tenantId !== enrollment.tenantId) throw new Error("Incoming phone account changed");
      await saveNativeWakeEnrollment(enrollment); current();
      // No late global stop here: logout's authoritative server revocation and
      // its native cleanup own the old binding, never a replacement session.
      const { grant: _grant, ...identity } = enrollment;
      publicBinding = identity;
    }
    if (publicBinding.ownerUserId !== binding.ownerUserId || publicBinding.deviceId !== binding.deviceId ||
        publicBinding.tenantId !== origin.account?.tenantId || publicBinding.expiresAt <= Date.now()) throw new Error("Incoming phone account changed");
    const { siprixEngine } = await import("../sip/siprix-engine"); current();
    await siprixEngine.bindWakeOwner(publicBinding); current();
  },
  async unregister(binding, signal) {
    const client = await requestClient(binding.ownerUserId, signal);
    await client.push.unregister.mutate({ token: binding.token, deviceId: binding.deviceId, platform: binding.platform });
  },
  async stopNative() { unsubscribe?.(); unsubscribe = undefined; await stopNativeVoip(); },
});

/** Revalidate native wake identity against the exact current authenticated
 * session before JS adopts a cold call. The native grant never crosses to JS. */
export async function getWakeAdoptionBinding(): Promise<WakeBinding | null> {
  if (Platform.OS !== "ios") return null;
  const user = getAuthSnapshot().user;
  if (!user) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    const binding = await getNativeWakeBinding();
    if (controller.signal.aborted || !binding || binding.ownerUserId !== user.id || getAuthSnapshot().user !== user) return null;
    const client = await requestClient(user.id, controller.signal);
    const verified = await client.push.resolveWakeBinding.query({ bindingId: binding.bindingId });
    const account = useSipAccountStore.getState().account;
    if (controller.signal.aborted || getAuthSnapshot().user !== user || account?.ownerUserId !== user.id || account.tenantId !== binding.tenantId) return null;
    return verified && ["bindingId", "ownerUserId", "tenantId", "deviceId", "sessionBinding", "expiresAt"].every(key =>
      verified[key as keyof WakeBinding] === binding[key as keyof WakeBinding]) && verified.expiresAt > Date.now() ? verified : null;
  })();
  try {
    return await Promise.race([work.catch(() => null), new Promise<null>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, 5000);
    })]);
  } finally { clearTimeout(timer); controller.abort(); }
}

/** Called only after an authenticated, enabled phone account was initialized.
 * The shipping native capability is false; no PKRegistry, token or network work
 * occurs until a separate reviewed native wake implementation is commissioned. */
export async function registerPhoneVoipPush(): Promise<null> {
  const origin = phoneIdentity();
  if (Platform.OS !== "ios" || !(await getVoipCapabilities()).registrationAvailable || !origin.current()) return null;
  const account = origin.account;
  const owner = origin.user?.id;
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier;
  if (!origin.current() || !owner || !account || !bundleId) return null;
  const current = ++generation;
  unsubscribe?.(); unsubscribe = undefined;
  let deviceId = await SecureStore.getItemAsync(deviceKey);
  if (generation !== current || !origin.current()) return null;
  if (!deviceId) {
    deviceId = await createVoipDeviceId();
    if (generation !== current || !origin.current()) return null;
    await SecureStore.setItemAsync(deviceKey, deviceId, secureOptions);
  }
  if (generation !== current || !origin.current()) return null;
  // APNs environment is a signed-build property, never inferred from __DEV__.
  // A commissioned build must explicitly provide this value in its native config.
  const environment = Constants.expoConfig?.extra?.phone11ApnsEnvironment;
  if (environment !== "sandbox" && environment !== "production") return null;
  const binding = { ownerUserId: owner, deviceId, sipUri: `sip:${account.username}@${account.domain}`,
    bundleId, platform: "ios" as const, sandbox: environment === "sandbox" };
  const remove = await startNativeVoip(token => {
    if (generation !== current || !origin.current()) return;
    const candidate = token ? { ...binding, token } : null;
    if (candidate) registrationOrigins.set(candidate, origin);
    const operation = candidate ? coordinator.bind(candidate) : coordinator.beforeLogout();
    // Provider tokens and request errors must never be logged. The durable ledger
    // preserves cleanup across a lost response or account/session transition.
    void operation.catch(() => undefined);
  });
  if (generation !== current || !origin.current()) remove(); else unsubscribe = remove;
  return null;
}

export async function beforePhoneLogout(): Promise<void> {
  ++generation;
  if (Platform.OS !== "ios") return;
  // Server session revocation (and its push-token cascade) is authoritative.
  // A local cleanup failure must not prevent that revocation request.
  try { await coordinator.beforeLogout(); } catch { /* retain encrypted ledger */ }
}
