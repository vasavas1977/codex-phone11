import { execFileSync } from "node:child_process";

const scripts = process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix"
  ? ["stage-siprix-sdk.mjs"]
  : ["patch-react-native-pjsip.mjs", "fix-pjsip-podspec-ruby.mjs"];
for (const script of scripts) execFileSync(process.execPath, [`scripts/${script}`], { stdio: "inherit" });
