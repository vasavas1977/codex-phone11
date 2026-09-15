import Constants from "expo-constants";
import { Platform } from "react-native";
import { sipEngine as pjsipEngine } from "./pjsip-engine";
import { siprixEngine } from "./siprix-engine";

// The native Android lab gate is also embedded in Expo config. Keep it as the
// authoritative fallback when a release bundle omits the public build variable.
const isAndroidSiprixLab =
  Platform.OS === "android" &&
  Constants.expoConfig?.extra?.phone11AndroidLab === true;

export const sipEngine: Pick<typeof pjsipEngine, keyof typeof pjsipEngine> =
  process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix" || isAndroidSiprixLab
    ? siprixEngine
    : pjsipEngine;
