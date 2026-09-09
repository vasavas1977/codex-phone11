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
