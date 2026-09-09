import { sipEngine as pjsipEngine } from "./pjsip-engine";
import { siprixEngine } from "./siprix-engine";

// Expo replaces this direct env access at bundle time. Rollback requires a new build.
export const sipEngine: Pick<typeof pjsipEngine, keyof typeof pjsipEngine> =
  process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix" ? siprixEngine : pjsipEngine;
