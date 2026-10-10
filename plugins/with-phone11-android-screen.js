const { withAndroidManifest, withInfoPlist } = require("expo/config-plugins");
const metadata = "ai.phone11.meeting.SCREEN_TRANSACTION";
const service = "com.oney.WebRTCModule.Phone11ScreenProjectionService";
const permission = "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION";
function androidScreenBuildSettings(source = process.env) {
  const native = source.PHONE11_ANDROID_SCREEN_TRANSACTION ?? "0";
  const js = source.EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION ?? "0";
  if (!["0", "1"].includes(native) || !["0", "1"].includes(js) || native !== js)
    throw new Error("Android screen transaction requires matching explicit 0/1 build flags");
  if (native === "1" && (source.EAS_BUILD_PLATFORM !== "android" || source.PHONE11_APP_STORE_BUILD === "1"))
    throw new Error("Android screen transaction is Android source-only and unavailable to store builds");
  return { enabled: native === "1" };
}
function configureManifest(manifest, enabled) {
  const app = manifest.manifest.application?.[0];
  if (!app) throw new Error("Android screen transaction requires one application");
  app["meta-data"] = (app["meta-data"] ?? []).filter(row => row.$?.["android:name"] !== metadata);
  app.service = (app.service ?? []).filter(row => row.$?.["android:name"] !== service);
  manifest.manifest["uses-permission"] = (manifest.manifest["uses-permission"] ?? []).filter(row => row.$?.["android:name"] !== permission);
  if (enabled) {
    app["meta-data"].push({ $: { "android:name": metadata, "android:value": "true" } });
    app.service.push({ $: { "android:name": service, "android:exported": "false", "android:foregroundServiceType": "mediaProjection" } });
    manifest.manifest["uses-permission"].push({ $: { "android:name": permission } });
  }
  return manifest;
}
function withPhone11AndroidScreen(config) {
  const { enabled } = androidScreenBuildSettings();
  if (enabled) config = withInfoPlist(config, () => {
    throw new Error("Android screen transaction cannot generate an iOS application");
  });
  return withAndroidManifest(config, native => {
    native.modResults = configureManifest(native.modResults, enabled);
    return native;
  });
}
module.exports = withPhone11AndroidScreen;
module.exports.androidScreenBuildSettings = androidScreenBuildSettings;
module.exports.configureManifest = configureManifest;
