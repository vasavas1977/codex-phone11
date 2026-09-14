import { NativeEventEmitter, NativeModules, Platform } from "react-native";

type NativeVoip = {
  getCapabilities(): Promise<{ registrationAvailable: boolean; closedAppCalling: false; reason: string }>;
  start(): Promise<string | null>;
  currentToken?(): Promise<string | null>;
  createDeviceId(): Promise<string>;
  stop(): Promise<void>;
  saveWakeEnrollment(value: WakeEnrollment): Promise<void>;
  getWakeBinding(): Promise<WakeBinding | null>;
  addListener(name: string): void;
  removeListeners(count: number): void;
};
export type WakeBinding = { bindingId: string; ownerUserId: number; tenantId: number; deviceId: string; sessionBinding: string; expiresAt: number };
export type WakeEnrollment = WakeBinding & { grant: string };
const candidate = Platform.OS === "ios" ? NativeModules.Phone11VoipPush
  : Platform.OS === "android" ? NativeModules.Phone11Siprix : undefined;
const native = candidate && typeof candidate.getCapabilities === "function" ? candidate as NativeVoip : undefined;
const unavailable = { registrationAvailable: false, closedAppCalling: false as const, reason: "native_wake_not_commissioned" };
export async function getVoipCapabilities() { return native ? native.getCapabilities() : unavailable; }
export async function stopNativeVoip() { await native?.stop(); }
export async function getCurrentNativeVoipToken(): Promise<string | null> {
  return native?.currentToken && (await native.getCapabilities()).registrationAvailable ? native.currentToken() : null;
}
export async function getNativeWakeBinding(): Promise<WakeBinding | null> {
  return native && (await native.getCapabilities()).registrationAvailable ? native.getWakeBinding() : null;
}
export async function saveNativeWakeEnrollment(value: WakeEnrollment): Promise<void> {
  if (!native || !(await native.getCapabilities()).registrationAvailable) throw new Error("Incoming call setup is unavailable");
  await native.saveWakeEnrollment(value);
}
export async function createVoipDeviceId(): Promise<string> {
  if (!native) throw new Error("Native phone push is unavailable");
  return native.createDeviceId();
}
export async function startNativeVoip(onToken: (token: string | null) => void): Promise<() => void> {
  if (!native || !(await native.getCapabilities()).registrationAvailable) return () => {};
  let active = true;
  const android = Platform.OS === "android";
  const subscription = new NativeEventEmitter(native).addListener(android ? "Phone11VoipTokenChanged" : "Phone11VoipToken", event => {
    if (android) {
      // Android's provider callback carries no raw token through an event. Read
      // the current value transiently from Firebase-owned storage instead.
      void native.currentToken!().then(token => { if (active) onToken(token); }).catch(() => undefined);
    } else if (event.token === null || typeof event.token === "string") onToken(event.token);
  });
  try {
    const token = await native.start();
    if (token) onToken(token);
    return () => { active = false; subscription.remove(); };
  } catch (error) { active = false; subscription.remove(); throw error; }
}
