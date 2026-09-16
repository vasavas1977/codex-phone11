import { NativeModules, Platform, UIManager } from "react-native";
import type { SiprixCall } from "../../modules/phone11-siprix";

export interface VideoBridge {
  getVideoCapabilities(): Promise<{
    oneToOne: boolean;
    cameraMute: boolean;
    cameraSwitch: boolean;
    nativeView: boolean;
  }>;
  requestCameraPermission(): Promise<boolean>;
  makeVideoCall(accountId: string, destination: string): Promise<SiprixCall>;
  prepareVideoAnswer(callId: string): Promise<void>;
  cancelVideoAnswer(callId: string): Promise<void>;
  setCameraMuted(callId: string, muted: boolean): Promise<void>;
  switchCamera(callId: string): Promise<void>;
}
/** Never require a native view on an older signed binary or a different engine. */
export async function getVideoBridge(): Promise<VideoBridge | null> {
  if (Platform.OS !== "ios" || process.env.EXPO_PUBLIC_SIP_ENGINE !== "siprix")
    return null;
  const bridge = NativeModules.Phone11Siprix;
  const methods: (keyof VideoBridge)[] = [
    "getVideoCapabilities",
    "requestCameraPermission",
    "makeVideoCall",
    "cancelVideoAnswer",
    "prepareVideoAnswer",
    "setCameraMuted",
    "switchCamera",
  ];
  if (!bridge || methods.some((key) => typeof bridge[key] !== "function"))
    return null;
  try {
    if (!UIManager.getViewManagerConfig?.("Phone11VideoView")) return null;
    const capabilities = await bridge.getVideoCapabilities();
    return capabilities.oneToOne === true &&
      capabilities.nativeView === true &&
      capabilities.cameraMute === true &&
      capabilities.cameraSwitch === true
      ? bridge
      : null;
  } catch {
    return null;
  }
}
