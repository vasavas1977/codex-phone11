// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";
import { withInfoPlist } from "expo/config-plugins";

const { wakeBuildSettings } = require("./plugins/with-phone11-voip-wake.js");
const wakeSettings = wakeBuildSettings();
const chatCommissioned = process.env.PHONE11_CHAT_NOTIFICATIONS_COMMISSIONED ?? "0";
if (!["0", "1"].includes(chatCommissioned)) throw new Error("Invalid chat notification build flag");
if (chatCommissioned === "1" && (wakeSettings.gate !== "1" || wakeSettings.environment !== "production")) {
  throw new Error("Chat notification pilot requires the production incoming-call pilot configuration");
}
const chatNotificationsEnabled = chatCommissioned === "1";

const rawBundleId = process.env.PHONE11_BUNDLE_ID ?? "ai.phone11.mobile";
const sipEngine = process.env.EXPO_PUBLIC_SIP_ENGINE ?? "pjsip";
if (!["siprix", "pjsip"].includes(sipEngine)) throw new Error("Invalid SIP engine selection");
const bundleId =
  rawBundleId
    .replace(/[-_]/g, ".") // Replace hyphens/underscores with dots
    .replace(/[^a-zA-Z0-9.]/g, "") // Remove invalid chars
    .replace(/\.+/g, ".") // Collapse consecutive dots
    .replace(/^\.+|\.+$/g, "") // Trim leading/trailing dots
    .toLowerCase()
    .split(".")
    .map((segment) => {
      // Android requires each segment to start with a letter
      // Prefix with 'x' if segment starts with a digit
      return /^[a-zA-Z]/.test(segment) ? segment : "x" + segment;
    })
    .join(".") || "space.manus.app";
const env = {
  // App branding - update these values directly (do not use env vars)
  appName: "Phone11",
  appSlug: "phone11ai",
  // S3 URL of the app logo - set this to the URL returned by generate_image when creating custom logo
  // Leave empty to use the default icon from assets/images/icon.png
  logoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/107568382/ToqVlgyTUoXePKRa.png",
  scheme: "phone11",
  iosBundleId: bundleId,
  androidPackage: bundleId,
};

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
  version: "1.0.0",
  runtimeVersion: `1.0.0-${sipEngine}${chatNotificationsEnabled ? "-daily-pilot" : wakeSettings.gate === "1" ? "-wake-pilot" : ""}-1`,
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  userInterfaceStyle: "dark",
  // Both native SIP adapters currently expose the legacy NativeModules bridge.
  newArchEnabled: false,
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    buildNumber: "5",
    ...(wakeSettings.environment ? { entitlements: { "aps-environment": wakeSettings.environment } } : {}),
    infoPlist: {
      Phone11ChatNotificationsCommissioned: chatNotificationsEnabled ? 1 : 0,
      ITSAppUsesNonExemptEncryption: false,
      NSMicrophoneUsageDescription: "Allow Phone11 to access your microphone for voice and video calls.",
      UIBackgroundModes: ["audio", "voip", "remote-notification"],
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#000000",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: env.androidPackage,
    permissions: ["POST_NOTIFICATIONS", "RECORD_AUDIO", "READ_PHONE_STATE"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: env.scheme,
            host: "*",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    ...(sipEngine === "siprix" ? [["./plugins/with-phone11-voip-wake.js", {
      origin: process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://api.phone11.ai",
    }] as [string, { origin: string }]] : []),
    [
      "expo-audio",
      {
        microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone.",
      },
    ],
    [
      "expo-video",
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#000000",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
        },
        ios: {
          // Keep building RN from source while validating the legacy PJSIP bridge.
          buildReactNativeFromSource: true,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: false,
  },
  extra: {
    phone11ChatNotificationsEnabled: chatNotificationsEnabled,
    ...(wakeSettings.environment ? { phone11ApnsEnvironment: wakeSettings.environment } : {}),
    eas: {
      projectId: "e354ffd3-485c-49f1-9e6f-aebe571d8dfb",
    },
    buildInfo: {
      sipEngine,
      sipSdkVersion: sipEngine === "siprix" ? "1.0.40-trial" : "react-native-pjsip-2.7.4",
      easBuildId: process.env.EAS_BUILD_ID ?? "local",
      easBuildProfile: process.env.EAS_BUILD_PROFILE ?? "unknown",
      gitCommitHash: process.env.EAS_BUILD_GIT_COMMIT_HASH ?? process.env.GITHUB_SHA ?? "unknown",
      builtAt: new Date().toISOString(),
    },
    router: {},
  },
};

// Apply only during native prebuild. Putting this value directly in ios.infoPlist
// would also expose it through Expo's public runtime configuration.
export default withInfoPlist(config, (nativeConfig) => {
  const license = process.env.PHONE11_SIPRIX_LICENSE?.trim();
  if (sipEngine === "siprix" && license) {
    nativeConfig.modResults.Phone11SiprixLicense = license;
  } else {
    delete nativeConfig.modResults.Phone11SiprixLicense;
  }
  return nativeConfig;
});
