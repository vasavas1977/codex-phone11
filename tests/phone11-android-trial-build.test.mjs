import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudStageRequested, fetchPinnedAar, maxAarBytes, requireTrialFlags, sdkUrl,
  stageAndroidTrialSdk, trialProfile, verifyTrialAar } from "../scripts/stage-siprix-android-trial-sdk.mjs";
import { installationPlan } from "../scripts/install-sip-engine.mjs";

const require = createRequire(import.meta.url);
const profile = JSON.parse(readFileSync(new URL("../eas.json", import.meta.url), "utf8")).build[trialProfile];
const source = { ...profile.env, EAS_BUILD_PROFILE: trialProfile, EAS_BUILD_PLATFORM: "android", EAS_BUILD: "true" };
const integration = require("../plugins/with-phone11-android-runtime.js");
const ownedAar = process.env.PHONE11_SIPRIX_ANDROID_AAR;
const pinnedBytes = () => { assert.ok(ownedAar, "Explicit already-owned AAR required; tests never download"); verifyTrialAar(ownedAar); return readFileSync(ownedAar); };
const neverFetch = () => { throw new Error("unexpected fetch"); };
const response = (bytes, options) => new Response(bytes, { status: 200, ...options });

test("standalone profile fixes every trial gate, INTERNAL release task and independent package", () => {
  assert.equal(profile.extends, undefined);
  assert.equal(profile.distribution, "internal");
  assert.equal(profile.developmentClient, false);
  assert.equal(profile.android.buildType, "apk");
  assert.equal(profile.android.gradleCommand, undefined);
  assert.equal(profile.android.image, "ubuntu-24.04-jdk-17-ndk-r27b");
  assert.equal(profile.pnpm, "9.12.0");
  assert.equal(profile.autoIncrement, true);
  assert.equal(profile.environment, "preview");
  assert.equal(profile.channel, "android-foreground-trial");
  assert.equal(Object.hasOwn(profile.env, "PHONE11_SIPRIX_LICENSE"), false);
  assert.equal(Object.hasOwn(profile.env, "PHONE11_SIPRIX_ANDROID_AAR"), false);
  requireTrialFlags(source);
  assert.equal(integration.androidRuntimeBuildSettings(source).packageName, "ai.phone11.mobile.foregroundtrial");
  const config = readFileSync(new URL("../app.config.ts", import.meta.url), "utf8");
  assert.match(config, /newArchEnabled: false/);
  assert.match(config, /1\.0\.0-siprix-android-foreground-trial-1/);
  // OTA is absent through the native dependency graph, not an explicit field
  // in app.config. Do not invent a configuration flag that this source lacks.
  const dependencies = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).dependencies;
  assert.equal(dependencies["expo-updates"], undefined);
  assert.match(readFileSync(new URL("../.easignore", import.meta.url), "utf8"), /modules\/phone11-siprix\/vendor\//);
});

test("ordinary pre-install never reads, fetches, stages or persists Android SDK", async () => {
  for (const env of [{}, { EAS_BUILD: "true", EAS_BUILD_PLATFORM: "android", EAS_BUILD_PROFILE: "development" },
    { EAS_BUILD: "true", EAS_BUILD_PLATFORM: "ios", EAS_BUILD_PROFILE: "preview-ios-siprix-daily-pilot", EXPO_PUBLIC_SIP_ENGINE: "siprix" }]) {
    assert.equal(cloudStageRequested(env), false);
    assert.deepEqual(await stageAndroidTrialSdk({ source: env, root: "/absent-not-touched", fetchImpl: neverFetch,
      persist: () => assert.fail("unexpected persistence") }), { staged: false });
  }
});

test("profile, platform, cloud and every native/public/isolation flag fail before transport", async () => {
  for (const key of Object.keys(profile.env)) {
    for (const value of [undefined, "unexpected"])
      await assert.rejects(stageAndroidTrialSdk({ source: { ...source, [key]: value }, fetchImpl: neverFetch }), /E_ANDROID_TRIAL_FLAGS/);
  }
  for (const [key, value, expected] of [
    ["EAS_BUILD_PROFILE", "preview", "PROFILE"], ["EAS_BUILD_PLATFORM", "ios", "PLATFORM"],
    ["EAS_BUILD", "false", "CLOUD_ONLY"], ["PHONE11_SIPRIX_LICENSE", "fake-sentinel-only", "LICENSE"],
  ]) await assert.rejects(stageAndroidTrialSdk({ source: { ...source, [key]: value }, fetchImpl: neverFetch }), new RegExp(`E_ANDROID_TRIAL_${expected}`));
});

test("new post-install verifies Android only; previous Android/iOS/CI plans retain exact dispatch", () => {
  assert.deepEqual(installationPlan(source), { androidTrial: true, scripts: [] });
  assert.throws(() => installationPlan({ ...source, EAS_BUILD_PLATFORM: "ios" }), /PLATFORM/);
  assert.throws(() => installationPlan({ ...source, PHONE11_VOIP_WAKE_COMMISSIONED: "1" }), /FLAGS/);
  for (const platform of [undefined, "ios", "android"])
    assert.deepEqual(installationPlan({ EXPO_PUBLIC_SIP_ENGINE: "siprix", EAS_BUILD_PLATFORM: platform }),
      { androidTrial: false, scripts: ["stage-siprix-sdk.mjs"] });
  // Existing CI installs the debug trial before staging its AAR. It is not the
  // new EAS standalone profile and remains unchanged.
  assert.deepEqual(installationPlan({ ...profile.env, EAS_BUILD_PROFILE: undefined }),
    { androidTrial: false, scripts: ["stage-siprix-sdk.mjs"] });
  assert.deepEqual(installationPlan({ EXPO_PUBLIC_SIP_ENGINE: "pjsip" }),
    { androidTrial: false, scripts: ["patch-react-native-pjsip.mjs", "fix-pjsip-podspec-ruby.mjs"] });
});

test("missing/relative/wrong SDK input fails closed without fetching or modifying it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "phone11-trial-invalid-"));
  try {
    const wrong = join(directory, "wrong.aar"); writeFileSync(wrong, "wrong SDK", { mode: 0o600 });
    for (const [filename, expected] of [[undefined, "REQUIRED"], ["relative.aar", "REQUIRED"],
      [join(directory, "absent.aar"), "UNAVAILABLE"], [wrong, "HASH"]]) {
      assert.throws(() => verifyTrialAar(filename), new RegExp(`E_ANDROID_TRIAL_AAR_${expected}`));
      if (filename !== undefined)
        await assert.rejects(stageAndroidTrialSdk({ source: { ...source, PHONE11_SIPRIX_ANDROID_AAR: filename },
          fetchImpl: neverFetch, persist: () => assert.fail("unexpected persistence") }), /E_ANDROID_TRIAL_AAR_/);
    }
    assert.equal(readFileSync(wrong, "utf8"), "wrong SDK");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("immutable HTTPS transport rejects redirects, HTTP failure, lengths and mismatched bytes", async () => {
  assert.equal(sdkUrl, "https://raw.githubusercontent.com/siprix/SampleJava/80d198ed6179b45ff8cd8dad9b8086976b4197a0/app/libs/siprix_voip_sdk.aar");
  for (const [result, expected] of [
    [new Response(null, { status: 302, headers: { location: "https://example.invalid/sdk" } }), "REDIRECT"],
    [new Response(null, { status: 404 }), "HTTP"], [new Response(null, { status: 200 }), "EMPTY_BODY"],
    [response("x", { headers: { "content-encoding": "gzip" } }), "ENCODING"],
    [response("x", { headers: { "content-length": String(maxAarBytes + 1) } }), "AAR_SIZE"],
    [response("x", { headers: { "content-length": "invalid" } }), "AAR_SIZE"],
    [response("x", { headers: { "content-length": "2" } }), "AAR_SIZE"],
    [response(""), "AAR_SIZE"], [response("wrong bytes"), "AAR_HASH"],
  ]) await assert.rejects(fetchPinnedAar(async (url, options) => {
    assert.equal(url, sdkUrl); assert.equal(options.redirect, "manual"); assert.ok(options.signal);
    assert.equal(options.headers["Accept-Encoding"], "identity"); return result;
  }), new RegExp(`E_ANDROID_TRIAL_${expected}`));
  await assert.rejects(fetchPinnedAar(async () => { throw new Error("private untrusted transport error"); }), /^Error: E_ANDROID_TRIAL_TRANSPORT$/);
});

test("stream byte bound and stalled transport deadline terminate without an output", async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(maxAarBytes + 1)); controller.close(); } });
  await assert.rejects(fetchPinnedAar(async () => response(stream)), /AAR_SIZE/);
  await assert.rejects(fetchPinnedAar(async () => new Promise(() => {}), 5), /TIMEOUT/);
  const stalled = new ReadableStream({ start() {} });
  await assert.rejects(fetchPinnedAar(async () => response(stalled), 5), /TIMEOUT/);
  await assert.rejects(fetchPinnedAar(neverFetch, 120001), /TIMEOUT_BOUND/);
});

test("failed fetch neither publishes a path nor creates partial SDK output", async () => {
  const directory = mkdtempSync(join(tmpdir(), "phone11-trial-output-"));
  try {
    await assert.rejects(stageAndroidTrialSdk({ source, root: directory, fetchImpl: async () => response("wrong SDK"),
      persist: () => assert.fail("unexpected persistence") }), /AAR_HASH/);
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("already-owned pinned AAR is read-only and avoids transport", { skip: !ownedAar }, async () => {
  const before = statSync(ownedAar);
  let path;
  const result = await stageAndroidTrialSdk({ source: { ...source, PHONE11_SIPRIX_ANDROID_AAR: ownedAar },
    fetchImpl: neverFetch, persist: filename => { path = filename; } });
  assert.equal(result.sha256, "3173ee8bae7aa37d3be3b44f7533d43b4e4d8625110d1d2bd8d79367973c9198");
  assert.equal(path, ownedAar);
  const after = statSync(ownedAar);
  for (const key of ["ino", "size", "mtimeMs", "ctimeMs", "mode"]) assert.equal(after[key], before[key]);
});

test("mocked pinned transfer atomically stages private bytes before environment persistence", { skip: !ownedAar }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "phone11-trial-stage-"));
  try {
    let persisted;
    const result = await stageAndroidTrialSdk({ source, root: directory, fetchImpl: async () => response(pinnedBytes()),
      persist: filename => { verifyTrialAar(filename); persisted = filename; } });
    assert.equal(result.staged, true);
    assert.equal(statSync(persisted).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(join(directory, "modules/phone11-siprix/vendor/android")), ["siprix_voip_sdk.aar"]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("staging rejects output directory symlinks and failed persistence yields no success", { skip: !ownedAar }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "phone11-trial-symlink-"));
  const outside = mkdtempSync(join(tmpdir(), "phone11-trial-outside-"));
  try {
    symlinkSync(outside, join(directory, "modules"), "dir");
    await assert.rejects(stageAndroidTrialSdk({ source, root: directory, fetchImpl: async () => response(pinnedBytes()),
      persist: () => assert.fail("unexpected persistence") }), /OUTPUT_DIRECTORY/);
    assert.deepEqual(readdirSync(outside), []);
    await assert.rejects(stageAndroidTrialSdk({ source: { ...source, PHONE11_SIPRIX_ANDROID_AAR: ownedAar },
      fetchImpl: neverFetch, persist: () => { throw new Error("persistence failed"); } }), /persistence failed/);
  } finally { rmSync(directory, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
