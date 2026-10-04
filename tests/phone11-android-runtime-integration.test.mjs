import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const integration = require("../plugins/with-phone11-android-runtime.js");
const trial = { PHONE11_ANDROID_FOREGROUND_TRIAL: "1", EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL: "1", EXPO_PUBLIC_SIP_ENGINE: "siprix" };

test("ordinary builds stay off; trial requires matching exact flags and isolated Android intent", () => {
  assert.deepEqual(integration.androidRuntimeBuildSettings({}), { enabled: false, packageName: undefined });
  assert.deepEqual(integration.androidRuntimeBuildSettings(trial), { enabled: true, packageName: "ai.phone11.mobile.foregroundtrial" });
  for (const source of [
    { PHONE11_ANDROID_FOREGROUND_TRIAL: "1" }, { EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL: "1" },
    { ...trial, PHONE11_ANDROID_FOREGROUND_TRIAL: "true" }, { ...trial, EXPO_PUBLIC_SIP_ENGINE: "pjsip" },
    { ...trial, EAS_BUILD_PLATFORM: "ios" }, { ...trial, PHONE11_APP_STORE_BUILD: "1" },
    { ...trial, PHONE11_VOIP_WAKE_COMMISSIONED: "1" }, { ...trial, PHONE11_CHAT_NOTIFICATIONS_COMMISSIONED: "1" },
  ]) assert.throws(() => integration.androidRuntimeBuildSettings(source));
});

test("prebuild refuses missing, relative and mismatched full runtime AAR without downloading", () => {
  assert.throws(() => integration.verifyRuntimeAar(undefined), /no download/);
  assert.throws(() => integration.verifyRuntimeAar("relative.aar"), /absolute/);
  const directory = mkdtempSync(path.join(tmpdir(), "phone11-android-trial-invalid-"));
  try {
    assert.throws(() => integration.verifyRuntimeAar(path.join(directory, "missing.aar")));
    const filename = path.join(directory, "wrong.aar"); writeFileSync(filename, "wrong-sdk");
    assert.throws(() => integration.verifyRuntimeAar(filename), /checksum mismatch/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("host links the module and full runtime, idempotently removes both on an ordinary prebuild", () => {
  for (const [transform, label, source] of [
    [integration.configureSettingsGradle, "settings", "rootProject.name = 'Phone11'\ninclude ':app'\n"],
    [integration.configureAppGradle, "dependencies", "apply plugin: 'com.android.application'\n"],
  ]) {
    const enabled = transform(source, true);
    assert.equal(transform(enabled, true), enabled);
    assert.equal(transform(enabled, false), source);
    assert.equal(transform(source, false), source);
    assert.throws(() => transform(enabled.replace(`// Phone11 Android foreground trial: ${label} end`, ""), true), /Incomplete/);
  }
  const app = integration.configureAppGradle("", true);
  assert.match(app, /implementation project\(':phone11-siprix-android-runtime'\)/);
  assert.match(app, /implementation files\(phone11TrialAar\)/);
  assert.match(app, /phone11SiprixAndroidAar.*PHONE11_SIPRIX_ANDROID_AAR/);
  assert.match(app, /isAbsolute/);
  assert.doesNotMatch(app, /compileOnly|https?:|vendor/);
});

test("legacy trial explicitly filters the full SDK to two ARM ABIs and restores existing host configuration", () => {
  const source = `apply plugin: 'com.android.application'
android {
  defaultConfig {
    ndk { abiFilters.addAll(['x86', 'x86_64']) }
  }
}
dependencies { implementation project(':livekit_react-native') }
`;
  const enabled = integration.configureAppGradle(source, true);
  assert.match(enabled, /ndk\s*\{\s*abiFilters\.clear\(\)\s*abiFilters\.addAll\(\['arm64-v8a', 'armeabi-v7a'\]\)/);
  assert.equal(enabled.split("abiFilters.clear()").length, 2);
  assert.ok(enabled.startsWith(source));
  assert.equal(integration.configureAppGradle(enabled, true), enabled);
  assert.equal(integration.configureAppGradle(enabled, false), source);
  assert.doesNotMatch(integration.configureAppGradle("", false), /abiFilters|Siprix/);
});

const kotlin = `package ai.phone11.mobile
import android.app.Application
import com.facebook.react.PackageList
class MainApplication : Application() {
  fun getPackages() = PackageList(this).packages.apply {
    // Other generated packages remain here.
  }
}
`;
test("one manually registered package; repeated prebuild and disable preserve the generated host", () => {
  const enabled = integration.configureMainApplication(kotlin, true);
  assert.equal(integration.configureMainApplication(enabled, true), enabled);
  assert.equal(integration.configureMainApplication(enabled, false), kotlin);
  assert.equal(enabled.split("add(Phone11SiprixPackage())").length, 2);
  assert.equal(enabled.split("import ai.phone11.siprix.Phone11SiprixPackage").length, 2);
  const withOtherPlugin = enabled.replace("// Phone11 Android foreground trial package\n", "// Phone11 Android foreground trial package\nimport com.livekit.reactnative.LiveKitReactNative\n");
  assert.match(integration.configureMainApplication(withOtherPlugin, false), /import com\.livekit\.reactnative\.LiveKitReactNative/);
  for (const changed of [kotlin.replace("PackageList(this)", "PackageList(other)"), kotlin + kotlin,
    enabled.replace("// Phone11 Android foreground trial: package registration end", "")]) {
    assert.throws(() => integration.configureMainApplication(changed, true));
  }
  assert.throws(() => integration.configureMainApplication(kotlin + "\nadd(Phone11SiprixPackage())", true), /Unexpected/);
});

test("generated build and manifest gates are independently explicit and removable", () => {
  const properties = [{ type: "property", key: "newArchEnabled", value: "false" }];
  const enabled = integration.configureProperties(properties, true);
  assert.equal(enabled.find(item => item.key === "phone11AndroidForegroundSourceEnabled").value, "true");
  assert.deepEqual(integration.configureProperties(enabled, true), enabled);
  assert.deepEqual(integration.configureProperties(enabled, false), properties);
  const manifest = { $: {}, application: [{ $: {}, "meta-data": [{ $: { "android:name": "existing", "android:value": "keep" } }] }] };
  const original = structuredClone(manifest);
  integration.configureManifest(manifest, true);
  const metadata = manifest.application[0]["meta-data"].find(item => item.$["android:name"] === "ai.phone11.siprix.FOREGROUND_SOURCE_ENABLED");
  assert.equal(metadata.$["android:value"], "true");
  assert.equal(metadata.$["tools:replace"], "android:value");
  assert.equal(manifest.application[0].service, undefined);
  assert.equal(manifest.application[0].receiver, undefined);
  const repeat = structuredClone(manifest); integration.configureManifest(repeat, true); assert.deepEqual(repeat, manifest);
  integration.configureManifest(manifest, false);
  assert.deepEqual(manifest.application[0], original.application[0]);
});

test("ordinary and trial autolinking stay explicit while trial excludes Android PJSIP", () => {
  const filename = require.resolve("../react-native.config.js");
  const names = Object.keys(trial);
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    delete require.cache[filename];
    const ordinary = require(filename);
    assert.deepEqual(ordinary.dependencies["phone11-siprix"].platforms, { ios: null, android: null });
    assert.deepEqual(ordinary.dependencies["react-native-pjsip"].platforms, {});
    Object.assign(process.env, trial); delete require.cache[filename];
    const candidate = require(filename);
    assert.deepEqual(candidate.dependencies["react-native-pjsip"].platforms, { ios: null, android: null });
    assert.deepEqual(candidate.dependencies["phone11-siprix"].platforms, { ios: null, android: null });
  } finally {
    for (const name of names) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
    delete require.cache[filename];
  }
});

test("candidate identity/runtime stay Android-specific and iOS license configuration remains native-only", () => {
  const source = readFileSync(new URL("../app.config.ts", import.meta.url), "utf8");
  assert.match(source, /package: androidTrial\.packageName \?\? env\.androidPackage/);
  assert.match(source, /androidTrial\.enabled \? \{ runtimeVersion: "1\.0\.0-siprix-android-foreground-trial-1"/);
  assert.match(source, /bundleIdentifier: env\.iosBundleId/);
  assert.match(source, /sipSdkVersion: sipEngine === "siprix"\s*\? `1\.0\.40-/);
  assert.match(source, /nativeConfig\.modResults\.Phone11SiprixLicense = license/);
});
