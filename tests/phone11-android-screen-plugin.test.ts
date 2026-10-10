import { afterEach, expect, it, vi } from "vitest";
import plugin from "../plugins/with-phone11-android-screen.js";
afterEach(() => vi.unstubAllEnvs());
const { androidScreenBuildSettings, configureManifest } = plugin as unknown as { androidScreenBuildSettings(source?: Record<string, string | undefined>): { enabled: boolean }; configureManifest(source: any, enabled: boolean): any };
function manifest() { return { manifest: { application: [{ $: { "android:name": ".MainApplication" }, service: [{ $: { "android:name": "other.Service" } }] }], "uses-permission": [{ $: { "android:name": "android.permission.RECORD_AUDIO" } }] } }; }
it("ordinary builds are default off", () => { expect(androidScreenBuildSettings({})).toEqual({ enabled: false }); });
it.each([{ PHONE11_ANDROID_SCREEN_TRANSACTION: "1" }, { EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION: "1" }, { PHONE11_ANDROID_SCREEN_TRANSACTION: "true", EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION: "true" }])("refuses mismatched/nonexplicit flags %j", source => { expect(() => androidScreenBuildSettings(source)).toThrow(); });
it.each(["ios", "store", "unset"])("refuses %s activation", platform => { expect(() => androidScreenBuildSettings({ PHONE11_ANDROID_SCREEN_TRANSACTION: "1", EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION: "1", ...(platform === "ios" ? { EAS_BUILD_PLATFORM: "ios" } : platform === "store" ? { PHONE11_APP_STORE_BUILD: "1", EAS_BUILD_PLATFORM: "android" } : {}) })).toThrow(); });
it("explicit source-only Android flags enable the native contract", () => { expect(androidScreenBuildSettings({ PHONE11_ANDROID_SCREEN_TRANSACTION: "1", EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION: "1", EAS_BUILD_PLATFORM: "android" })).toEqual({ enabled: true }); });
it("ON generated manifest owns one unexported projection service and permission", () => {
  const on = configureManifest(manifest(), true); configureManifest(on, true);
  expect(on.manifest.application[0].service).toEqual([{ $: { "android:name": "other.Service" } }, { $: { "android:name": "com.oney.WebRTCModule.Phone11ScreenProjectionService", "android:exported": "false", "android:foregroundServiceType": "mediaProjection" } }]);
  expect(on.manifest.application[0]["meta-data"]).toEqual([{ $: { "android:name": "ai.phone11.meeting.SCREEN_TRANSACTION", "android:value": "true" } }]);
  expect(on.manifest["uses-permission"].map((row: any) => row.$["android:name"])).toEqual(["android.permission.RECORD_AUDIO", "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"]);
});
it("OFF reverses only owned capture wiring and preserves microphone/other service", () => {
  const off = configureManifest(configureManifest(manifest(), true), false);
  expect(off.manifest.application[0].service).toEqual([{ $: { "android:name": "other.Service" } }]);
  expect(off.manifest.application[0]["meta-data"]).toEqual([]); expect(off.manifest["uses-permission"]).toEqual([{ $: { "android:name": "android.permission.RECORD_AUDIO" } }]);
});

it("ON refuses actual iOS mod even when build environment claims Android", async () => {
  vi.stubEnv("PHONE11_ANDROID_SCREEN_TRANSACTION", "1"); vi.stubEnv("EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION", "1"); vi.stubEnv("EAS_BUILD_PLATFORM", "android"); vi.stubEnv("PHONE11_APP_STORE_BUILD", "0");
  const config = plugin({ name: "Phone11", slug: "phone11" } as any) as any;
  await expect(config.mods.ios.infoPlist({ ...config, modResults: {}, modRequest: { platform: "ios", modName: "infoPlist" } })).rejects.toThrow("cannot generate an iOS application");
});
it("OFF does not add any iOS mod", () => {
  vi.stubEnv("PHONE11_ANDROID_SCREEN_TRANSACTION", "0"); vi.stubEnv("EXPO_PUBLIC_PHONE11_ANDROID_SCREEN_TRANSACTION", "0");
  const config = plugin({ name: "Phone11", slug: "phone11" } as any) as any;
  expect(config.mods.ios).toBeUndefined();
});
