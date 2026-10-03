import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { verifyBinaries } from "./stage-siprix-sdk.mjs";

if (process.env.EXPO_PUBLIC_SIP_ENGINE !== "siprix") throw new Error("Siprix build selection is required");
const config = JSON.parse(execFileSync("npx", ["--no-install", "expo-modules-autolinking", "react-native-config", "--platform", "ios", "--json"], { encoding: "utf8" }));
// The wake plugin owns the static bridge pod, avoiding a later pod-install
// environment change silently replacing the engine. Verify the actual Expo mod.
if (config.dependencies["phone11-siprix"]?.platforms?.ios) throw new Error("Phone11Siprix must have exactly one plugin-owned pod, not an autolink duplicate");
const require = createRequire(import.meta.url);
const { getConfig } = createRequire(require.resolve("expo/package.json"))("@expo/config");
const root = process.cwd();
const { exp } = getConfig(root, { isModdedConfig: true });
const generated = await exp.mods.ios.podfile({ ...exp,
  modResults: { contents: "target 'Phone11' do\n  use_expo_modules!\nend\n", language: "rb" },
  modRequest: { projectRoot: root, platform: "ios", modName: "podfile", introspect: true } });
assert.equal(generated.modResults.contents.match(/pod 'Phone11Siprix', :path => '\.\.\/modules\/phone11-siprix'/g)?.length, 1,
  "Resolved Expo plugin must declare the pinned Siprix bridge exactly once");
if (config.dependencies["react-native-pjsip"]?.platforms?.ios) throw new Error("PJSIP must not be linked into the Siprix iOS build");
if (!config.dependencies["react-native-callkeep"]?.platforms?.ios) throw new Error("CallKeep must remain the CallKit provider");
verifyBinaries("modules/phone11-siprix/vendor");
console.log("PASS: Plugin-owned Siprix pod + autolinked CallKeep selected; PJSIP excluded; pinned frameworks verified.");
