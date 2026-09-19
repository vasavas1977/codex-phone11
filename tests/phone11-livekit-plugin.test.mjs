import assert from "node:assert/strict";
import test from "node:test";
import plugin from "../plugins/with-phone11-livekit.js";

const swift = `import Expo

class AppDelegate: ExpoAppDelegate {
  override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    return true
  }
}`;

const kotlin = `package ai.phone11.mobile

import android.app.Application

class MainApplication : Application() {
  override fun onCreate() {
    super.onCreate()
  }
}`;

test("LiveKit RN3 iOS lifecycle injection is idempotent", () => {
  const first = plugin.injectIosSetup(swift);
  assert.match(first, /import livekit_react_native/);
  assert.match(first, /LivekitReactNative\.setup\(\)/);
  assert.equal(plugin.injectIosSetup(first), first);
});

test("LiveKit RN3 Android lifecycle injection is idempotent", () => {
  const first = plugin.injectAndroidSetup(kotlin);
  assert.match(first, /import com\.livekit\.reactnative\.LiveKitReactNative/);
  assert.match(first, /LiveKitReactNative\.setup\(this, AudioType\.CommunicationAudioType\(\)\)/);
  assert.equal(plugin.injectAndroidSetup(first), first);
});

test("LiveKit lifecycle injection rejects unreviewed app delegate shapes", () => {
  assert.throws(() => plugin.injectIosSetup("import Expo\nclass AppDelegate {}"));
  assert.throws(() => plugin.injectAndroidSetup("package ai.phone11.mobile"));
});
