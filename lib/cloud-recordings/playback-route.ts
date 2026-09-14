import { NativeModules, Platform } from "react-native";
import { setAudioModeAsync } from "expo-audio";

const nativeRoute = () =>
  NativeModules.Phone11Siprix?.setRecordingPlaybackSpeaker as
    | undefined
    | ((speaker: boolean) => Promise<void>);
export const supportsPlaybackSpeaker = () =>
  (Platform.OS === "ios" && Boolean(nativeRoute())) ||
  Platform.OS === "android";

export async function configurePlaybackRoute(speaker: boolean): Promise<void> {
  if (Platform.OS === "ios" && nativeRoute()) {
    // Expo's earpiece flag is Android-only. The native method checks incoming
    // wakes/calls on the main queue before touching the shared AVAudioSession.
    await nativeRoute()!(speaker);
    return;
  }
  await setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: false,
    interruptionMode: "doNotMix",
    interruptionModeAndroid: "doNotMix",
    shouldPlayInBackground: false,
    // Expo Audio implements this flag natively on Android. Invert the
    // product-facing speaker choice so both playback routes are explicit.
    shouldRouteThroughEarpiece: Platform.OS === "android" ? !speaker : false,
  });
}

export async function releasePlaybackRoute(): Promise<void> {
  // Native guard refuses a reset when a call has taken ownership. Do not
  // deactivate the process-wide audio session from an unmount cleanup.
  if (Platform.OS === "ios" && nativeRoute()) await nativeRoute()!(false);
}
