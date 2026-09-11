import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const configPath = require.resolve("../react-native.config.js");
function config(engine) {
  const old = process.env.EXPO_PUBLIC_SIP_ENGINE;
  try {
    process.env.EXPO_PUBLIC_SIP_ENGINE = engine;
    delete require.cache[configPath];
    return require(configPath);
  } finally {
    if (old === undefined) delete process.env.EXPO_PUBLIC_SIP_ENGINE;
    else process.env.EXPO_PUBLIC_SIP_ENGINE = old;
  }
}
test("Siprix iOS build excludes PJSIP and retains the new bridge", () => {
  const c = config("siprix");
  assert.equal(c.dependencies["react-native-pjsip"].platforms.ios, null);
  assert.equal(c.dependencies["phone11-siprix"].platforms.ios, undefined);
});
test("legacy build excludes Siprix without changing PJSIP selection", () => {
  const c = config("pjsip");
  assert.equal(c.dependencies["phone11-siprix"].platforms.ios, null);
  assert.equal(c.dependencies["react-native-pjsip"].platforms.ios, undefined);
});
test("Siprix preview preserves bundle identity and separates update channel", () => {
  const profiles = require("../eas.json").build;
  const siprix = profiles["preview-ios-siprix"];
  assert.equal(siprix.extends, "preview-ios-existing-credentials");
  assert.equal(siprix.env.EXPO_PUBLIC_SIP_ENGINE, "siprix");
  assert.notEqual(siprix.channel, profiles[siprix.extends].channel);
  assert.equal(profiles[siprix.extends].env.PHONE11_BUNDLE_ID, "space.manus.phone11ai.t20260425073427");
});
test("diagnostics include engine and SDK build identity", () => {
  const source = readFileSync(new URL("../app/settings/sip-diagnostics.tsx", import.meta.url), "utf8");
  assert.match(source, /sipSdkVersion=/);
  assert.match(source, /sipEngine=/);
});

const expoRequire = createRequire(require.resolve("expo/package.json"));
const { getConfig } = expoRequire("@expo/config");
const projectRoot = new URL("..", import.meta.url).pathname;
async function nativeLicenseConfig(engine, value) {
  const previousEngine = process.env.EXPO_PUBLIC_SIP_ENGINE;
  const previousLicense = process.env.PHONE11_SIPRIX_LICENSE;
  try {
    process.env.EXPO_PUBLIC_SIP_ENGINE = engine;
    // Only a fake sentinel is present while the config's environment loader runs.
    process.env.PHONE11_SIPRIX_LICENSE = "fake-native-license-test-only";
    const { exp } = getConfig(projectRoot, { isModdedConfig: true });
    if (value === undefined) delete process.env.PHONE11_SIPRIX_LICENSE;
    else process.env.PHONE11_SIPRIX_LICENSE = value;
    return await exp.mods.ios.infoPlist({
      ...exp,
      modResults: { Phone11SiprixLicense: "stale-test-value" },
      modRequest: { projectRoot, platform: "ios", modName: "infoPlist", introspect: true },
    });
  } finally {
    if (previousEngine === undefined) delete process.env.EXPO_PUBLIC_SIP_ENGINE;
    else process.env.EXPO_PUBLIC_SIP_ENGINE = previousEngine;
    if (previousLicense === undefined) delete process.env.PHONE11_SIPRIX_LICENSE;
    else process.env.PHONE11_SIPRIX_LICENSE = previousLicense;
  }
}
test("missing and blank native license keep trial behavior and remove stale plist values", async () => {
  for (const value of [undefined, "", " \n\t "]) {
    const config = await nativeLicenseConfig("siprix", value);
    assert.ok(!Object.hasOwn(config.modResults, "Phone11SiprixLicense"));
  }
});
test("optional license enters only the native Siprix plist, never the other adapter", async () => {
  const configured = await nativeLicenseConfig("siprix", " fake-native-license-test-only ");
  assert.ok(configured.modResults.Phone11SiprixLicense === "fake-native-license-test-only");
  const legacy = await nativeLicenseConfig("pjsip", "fake-native-license-test-only");
  assert.ok(!Object.hasOwn(legacy.modResults, "Phone11SiprixLicense"));
});
test("license is absent from public Expo runtime configuration", () => {
  const previousEngine = process.env.EXPO_PUBLIC_SIP_ENGINE;
  const previousLicense = process.env.PHONE11_SIPRIX_LICENSE;
  try {
    process.env.EXPO_PUBLIC_SIP_ENGINE = "siprix";
    process.env.PHONE11_SIPRIX_LICENSE = "fake-native-license-test-only";
    const { exp } = getConfig(projectRoot, { isPublicConfig: true });
    assert.ok(!JSON.stringify(exp).includes("fake-native-license-test-only"));
    assert.ok(!Object.hasOwn(exp.ios.infoPlist, "Phone11SiprixLicense"));
  } finally {
    if (previousEngine === undefined) delete process.env.EXPO_PUBLIC_SIP_ENGINE;
    else process.env.EXPO_PUBLIC_SIP_ENGINE = previousEngine;
    if (previousLicense === undefined) delete process.env.PHONE11_SIPRIX_LICENSE;
    else process.env.PHONE11_SIPRIX_LICENSE = previousLicense;
  }
});


test("Swift bootstrap has an explicitly defined static pod module and public header", () => {
  const spec = readFileSync(new URL("../modules/phone11-siprix/Phone11Siprix.podspec", import.meta.url), "utf8");
  assert.match(spec, /s\.module_name\s*=\s*'Phone11Siprix'/);
  assert.match(spec, /s\.pod_target_xcconfig\s*=\s*\{\s*'DEFINES_MODULE'\s*=>\s*'YES'\s*\}/);
  assert.match(spec, /s\.public_header_files\s*=\s*'ios\/Phone11Siprix\.h',\s*'ios\/Phone11VoipPush\.h'/);
  assert.doesNotMatch(spec, /PHONE11_VOIP_WAKE_COMMISSIONED.*1/);
});


test("real Siprix Expo config wires Swift startup to the exported bootstrap module", async () => {
  const configured = await nativeLicenseConfig("siprix", undefined);
  assert.equal(typeof configured.mods.ios.appDelegate, "function");
  const source = "import Expo\nclass AppDelegate: ExpoAppDelegate {\n override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {\n let factory = ExpoReactNativeFactory(delegate: delegate)\n return true\n }\n}";
  const result = await configured.mods.ios.appDelegate({
    ...configured, modResults: { language: "swift", path: "AppDelegate.swift", contents: source },
    modRequest: { projectRoot, platform: "ios", modName: "appDelegate", introspect: true },
  });
  assert.match(result.modResults.contents, /import Phone11Siprix/);
  assert.ok(result.modResults.contents.indexOf("Phone11VoipPush.bootstrap()") < result.modResults.contents.indexOf("let factory"));
});
