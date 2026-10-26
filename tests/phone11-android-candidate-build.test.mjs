import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { androidCandidateSettings, candidatePackage, wakePackage } = require("../plugins/android-candidate-settings");
const { androidRuntimeBuildSettings } = require("../plugins/with-phone11-android-runtime");
const base = { PHONE11_ANDROID_NATIVE_CANDIDATE:"1", EXPO_PUBLIC_PHONE11_ANDROID_NATIVE_CANDIDATE:"1",
  PHONE11_ANDROID_FOREGROUND_TRIAL:"1", EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL:"1", EXPO_PUBLIC_SIP_ENGINE:"siprix" };

test("candidate uses a distinct package and cannot leak into the ordinary/iOS/store build", () => {
  assert.equal(androidCandidateSettings({}).enabled, false);
  assert.equal(androidRuntimeBuildSettings(base).packageName, candidatePackage);
  for (const change of [
    { PHONE11_ANDROID_NATIVE_CANDIDATE:"0" }, { EXPO_PUBLIC_PHONE11_ANDROID_NATIVE_CANDIDATE:"0" },
    { PHONE11_ANDROID_FOREGROUND_TRIAL:"0" }, { EXPO_PUBLIC_PHONE11_ANDROID_FOREGROUND_TRIAL:"0" },
    { EXPO_PUBLIC_SIP_ENGINE:"pjsip" }, { EAS_BUILD_PLATFORM:"ios" }, { PHONE11_APP_STORE_BUILD:"1" },
    { PHONE11_VOIP_WAKE_COMMISSIONED:"1" }, { PHONE11_CHAT_NOTIFICATIONS_COMMISSIONED:"1" },
  ]) assert.throws(() => androidCandidateSettings({ ...base, ...change }));
});
test("Firebase and wake configuration fail closed unless public project and package match", () => {
  const root = mkdtempSync(path.join(tmpdir(), "phone11-public-firebase-"));
  const file = path.join(root, "google-services.json");
  const env = { ...base, PHONE11_ANDROID_CHAT_NOTIFICATIONS:"1", PHONE11_ANDROID_WAKE_CANDIDATE:"1",
    EXPO_PUBLIC_PHONE11_ANDROID_WAKE_CANDIDATE:"1", PHONE11_ANDROID_FCM_PROJECT_ID:"phone11-test",
    PHONE11_ANDROID_GOOGLE_SERVICES_FILE:file, EXPO_PUBLIC_API_BASE_URL:"https://api.phone11.test" };
  try {
    writeFileSync(file, JSON.stringify({ project_info:{ project_id:"phone11-test" },
      client:[{client_info:{android_client_info:{package_name:wakePackage}}}] }));
    assert.equal(androidCandidateSettings(env).wakeOrigin, env.EXPO_PUBLIC_API_BASE_URL);
    for (const change of [
      { EXPO_PUBLIC_PHONE11_ANDROID_WAKE_CANDIDATE:"0" },
      { PHONE11_ANDROID_FCM_PROJECT_ID:"wrong-project" }, { PHONE11_ANDROID_GOOGLE_SERVICES_FILE:"relative.json" },
      { EXPO_PUBLIC_API_BASE_URL:"http://api.phone11.test" }, { EXPO_PUBLIC_API_BASE_URL:"https://api.phone11.test/path" },
      { EXPO_PUBLIC_API_BASE_URL:"https://user:pass@api.phone11.test" },
      { EXPO_PUBLIC_API_BASE_URL:"https://api.phone11.test?key=private" },
    ]) assert.throws(() => androidCandidateSettings({ ...env, ...change }));
    writeFileSync(file, JSON.stringify({ project_info:{project_id:"phone11-test"},
      client:[{client_info:{android_client_info:{package_name:"ai.phone11.mobile.foregroundtrial"}}}] }));
    assert.throws(() => androidCandidateSettings(env));
  } finally { rmSync(root, { recursive:true, force:true }); }
});
