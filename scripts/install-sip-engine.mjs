import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { trialProfile, requireTrialFlags, verifyTrialAar } from "./stage-siprix-android-trial-sdk.mjs";

export function installationPlan(source = process.env) {
  // Only the new standalone profile changes dispatch. Existing iOS, ordinary
  // Android and CI debug source installations keep their previous behavior.
  if (source.EAS_BUILD_PROFILE === trialProfile) {
    requireTrialFlags(source);
    if (source.EAS_BUILD_PLATFORM !== "android") throw new Error("E_ANDROID_TRIAL_PLATFORM");
    return { androidTrial: true, scripts: [] };
  }
  return { androidTrial: false, scripts: source.EXPO_PUBLIC_SIP_ENGINE === "siprix"
    ? ["stage-siprix-sdk.mjs"]
    : ["patch-react-native-pjsip.mjs", "fix-pjsip-podspec-ruby.mjs"] };
}

export function installSipEngine(source = process.env) {
  const plan = installationPlan(source);
  if (plan.androidTrial) {
    verifyTrialAar(source.PHONE11_SIPRIX_ANDROID_AAR);
    console.log("Verified pinned Android Siprix 1.1.0 foreground trial; calls limited to 60 seconds.");
    return;
  }
  for (const script of plan.scripts) execFileSync(process.execPath, [`scripts/${script}`], { stdio: "inherit" });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { installSipEngine(); }
  catch { console.error("SIP engine installation prerequisite failed"); process.exitCode = 1; }
}
