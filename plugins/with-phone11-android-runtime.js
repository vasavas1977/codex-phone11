const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const trialPackage = "ai.phone11.mobile.foregroundtrial";
const sdkLock = require("../modules/phone11-siprix/android/sdk-lock.json");
const projectName = "phone11-siprix-android-runtime";
const metadataName = "ai.phone11.siprix.FOREGROUND_SOURCE_ENABLED";

function androidRuntimeBuildSettings(source = process.env) {
  const gate = source.PHONE11_ANDROID_FOREGROUND_TRIAL ?? "0";
  const publicGate = source.EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL ?? "0";
  if (!["0", "1"].includes(gate) || !["0", "1"].includes(publicGate) || gate !== publicGate) {
    throw new Error("Android foreground trial requires matching explicit 0/1 native and JavaScript build flags");
  }
  if (gate === "1" && (source.EXPO_PUBLIC_SIP_ENGINE !== "siprix" || source.EAS_BUILD_PLATFORM === "ios"
      || source.PHONE11_APP_STORE_BUILD === "1" || source.PHONE11_VOIP_WAKE_COMMISSIONED === "1"
      || source.PHONE11_CHAT_NOTIFICATIONS_COMMISSIONED === "1")) {
    throw new Error("Android foreground trial requires an isolated Android Siprix trial build without store or wake commissioning");
  }
  return { enabled: gate === "1", packageName: gate === "1" ? trialPackage : undefined };
}

function verifyRuntimeAar(filename) {
  if (!filename || !path.isAbsolute(filename)) throw new Error("Android foreground trial requires an absolute PHONE11_SIPRIX_ANDROID_AAR path; no download is performed");
  if (!fs.statSync(filename).isFile()) throw new Error("Pinned Android Siprix runtime AAR is missing");
  if (createHash("sha256").update(fs.readFileSync(filename)).digest("hex") !== sdkLock.sha256) {
    throw new Error("Pinned Android Siprix runtime AAR checksum mismatch");
  }
  return sdkLock.sha256;
}

// Owned blocks make repeated prebuilds reversible. A partial block fails closed.
function removeBlock(source, label) {
  const begin = `// Phone11 Android foreground trial: ${label} begin`;
  const end = `// Phone11 Android foreground trial: ${label} end`;
  const begins = source.split(begin).length - 1;
  const ends = source.split(end).length - 1;
  if (begins !== ends || begins > 1) throw new Error("Incomplete or duplicate Phone11 Android trial host integration");
  if (!begins) return source;
  const start = source.lastIndexOf("\n", source.indexOf(begin)) + 1;
  const finish = source.indexOf("\n", source.indexOf(end));
  if (source.indexOf(end) < source.indexOf(begin)) throw new Error("Misplaced Phone11 Android trial host integration");
  return source.slice(0, start) + (finish < 0 ? "" : source.slice(finish + 1));
}
function block(label, body, indent = "") {
  return `${indent}// Phone11 Android foreground trial: ${label} begin\n${body}\n${indent}// Phone11 Android foreground trial: ${label} end\n`;
}

function configureSettingsGradle(source, enabled) {
  source = removeBlock(source, "settings");
  if (source.includes(projectName)) throw new Error("Unexpected Android Siprix runtime project declaration");
  return enabled ? source.replace(/\n*$/, "\n") + block("settings",
    `include ':${projectName}'\nproject(':${projectName}').projectDir = new File(rootProject.projectDir, '../modules/phone11-siprix/android')`) : source;
}

function configureAppGradle(source, enabled) {
  source = removeBlock(source, "dependencies");
  if (source.includes(projectName)) throw new Error("Unexpected Android Siprix runtime dependency");
  return enabled ? source.replace(/\n*$/, "\n") + block("dependencies", `def phone11TrialAar = rootProject.findProperty('phone11SiprixAndroidAar') ?: System.getenv('PHONE11_SIPRIX_ANDROID_AAR')
if (!phone11TrialAar || !new File(phone11TrialAar.toString()).isAbsolute()) throw new GradleException('Android foreground trial requires an absolute pinned runtime AAR path')
// RN 0.81.5 only derives ABI filters from reactNativeArchitectures for New Arch.
// This legacy-architecture trial must explicitly filter the full four-ABI SDK.
android {
  defaultConfig {
    ndk {
      abiFilters.clear()
      abiFilters.addAll(['arm64-v8a', 'armeabi-v7a'])
    }
  }
  // Preserve the exact pinned SDK bytes for the packaged-library checksum gate.
  // Other native dependencies retain their existing debug-symbol stripping.
  packagingOptions {
    jniLibs {
      keepDebugSymbols += ['**/libsiprix.so', '**/libsiprixMedia.so']
    }
  }
}
dependencies {
  implementation project(':${projectName}')
  implementation files(phone11TrialAar)
}`) : source;
}

function configureMainApplication(source, enabled) {
  // A single owned import line permits other plugins to append their imports
  // without accidentally placing them inside a removable Phone11 block.
  const importLine = "import ai.phone11.siprix.Phone11SiprixPackage // Phone11 Android foreground trial package";
  if (source.split(importLine).length > 2) throw new Error("Duplicate Phone11 Android trial import");
  source = removeBlock(source, "package registration").replace(importLine + "\n", "");
  if (/\bPhone11SiprixPackage\b/.test(source)) throw new Error("Unexpected Android Siprix package registration");
  if (!enabled) return source;
  const imports = [...source.matchAll(/^import\s+[^\n]+$/gm)];
  const packages = [...source.matchAll(/PackageList\(this\)\.packages\.apply\s*\{\r?\n/g)];
  if (!imports.length || packages.length !== 1) throw new Error("Android foreground trial requires the reviewed Kotlin PackageList host");
  const at = packages[0].index + packages[0][0].length;
  source = source.slice(0, at) + block("package registration", "              add(Phone11SiprixPackage())", "              ") + source.slice(at);
  const lastImport = imports.at(-1);
  const importEnd = lastImport.index + lastImport[0].length + 1;
  return source.slice(0, importEnd) + importLine + "\n" + source.slice(importEnd);
}

function configureProperties(properties, enabled) {
  const retained = properties.filter(item => item.type !== "property" || item.key !== "phone11AndroidForegroundSourceEnabled");
  if (enabled) retained.push({ type: "property", key: "phone11AndroidForegroundSourceEnabled", value: "true" });
  return retained;
}

function configureManifest(manifest, enabled) {
  const application = manifest.application?.[0];
  if (!application || manifest.application.length !== 1) throw new Error("Android foreground trial requires one application manifest");
  application["meta-data"] = (application["meta-data"] ?? []).filter(item => item?.$?.["android:name"] !== metadataName);
  if (enabled) {
    manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
    application["meta-data"].push({ $: { "android:name": metadataName, "android:value": "true", "tools:replace": "android:value" } });
  }
  return manifest;
}

function withPhone11AndroidRuntime(config) {
  const settings = androidRuntimeBuildSettings();
  if (settings.enabled) {
    if (config.android?.package !== trialPackage || config.newArchEnabled !== false) {
      throw new Error("Android foreground trial requires the separate trial package and legacy React Native bridge");
    }
    verifyRuntimeAar(process.env.PHONE11_SIPRIX_ANDROID_AAR);
  }
  const { withSettingsGradle, withAppBuildGradle, withMainApplication, withGradleProperties, withAndroidManifest } = require("expo/config-plugins");
  config = withSettingsGradle(config, native => {
    if (native.modResults.language !== "groovy") throw new Error("Android foreground trial requires Groovy settings.gradle");
    native.modResults.contents = configureSettingsGradle(native.modResults.contents, settings.enabled); return native;
  });
  config = withAppBuildGradle(config, native => {
    if (native.modResults.language !== "groovy") throw new Error("Android foreground trial requires Groovy app build.gradle");
    native.modResults.contents = configureAppGradle(native.modResults.contents, settings.enabled); return native;
  });
  config = withMainApplication(config, native => {
    if (native.modResults.language !== "kt") throw new Error("Android foreground trial requires Kotlin MainApplication");
    native.modResults.contents = configureMainApplication(native.modResults.contents, settings.enabled); return native;
  });
  config = withGradleProperties(config, native => { native.modResults = configureProperties(native.modResults, settings.enabled); return native; });
  return withAndroidManifest(config, native => { configureManifest(native.modResults.manifest, settings.enabled); return native; });
}

module.exports = withPhone11AndroidRuntime;
Object.assign(module.exports, { androidRuntimeBuildSettings, verifyRuntimeAar, configureSettingsGradle, configureAppGradle,
  configureMainApplication, configureProperties, configureManifest, trialPackage });
