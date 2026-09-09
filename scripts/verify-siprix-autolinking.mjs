import { execFileSync } from "node:child_process";
import { verifyBinaries } from "./stage-siprix-sdk.mjs";

if (process.env.EXPO_PUBLIC_SIP_ENGINE !== "siprix") throw new Error("Siprix build selection is required");
const config = JSON.parse(execFileSync("npx", ["--no-install", "expo-modules-autolinking", "react-native-config", "--platform", "ios", "--json"], { encoding: "utf8" }));
if (!config.dependencies["phone11-siprix"]?.platforms?.ios?.podspecPath) throw new Error("Phone11Siprix pod missing from autolinking");
if (config.dependencies["react-native-pjsip"]?.platforms?.ios) throw new Error("PJSIP must not be linked into the Siprix iOS build");
if (!config.dependencies["react-native-callkeep"]?.platforms?.ios) throw new Error("CallKeep must remain the CallKit provider");
verifyBinaries("modules/phone11-siprix/vendor");
console.log("PASS: Siprix + CallKeep iOS pods selected; PJSIP excluded; pinned frameworks verified.");
