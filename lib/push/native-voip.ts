import { NativeEventEmitter, NativeModules, Platform } from "react-native";

type NativeVoip = {
  getCapabilities(): Promise<{ registrationAvailable: boolean; closedAppCalling: false; reason: string }>;
  start(): Promise<string | null>;
  createDeviceId(): Promise<string>;
  stop(): Promise<void>;
  addListener(name: string): void;
  removeListeners(count: number): void;
};
const native = Platform.OS === "ios" ? NativeModules.Phone11VoipPush as NativeVoip | undefined : undefined;
const unavailable = { registrationAvailable: false, closedAppCalling: false as const, reason: "native_wake_not_commissioned" };
export async function getVoipCapabilities() { return native ? native.getCapabilities() : unavailable; }
export async function stopNativeVoip() { await native?.stop(); }
export async function createVoipDeviceId(): Promise<string> {
  if (!native) throw new Error("Native phone push is unavailable");
  return native.createDeviceId();
}
export async function startNativeVoip(onToken: (token: string | null) => void): Promise<() => void> {
  if (!native || !(await native.getCapabilities()).registrationAvailable) return () => {};
  const subscription = new NativeEventEmitter(native).addListener("Phone11VoipToken", event => {
    if (event.token === null || typeof event.token === "string") onToken(event.token);
  });
  try {
    const token = await native.start();
    if (token) onToken(token);
    return () => subscription.remove();
  } catch (error) { subscription.remove(); throw error; }
}
