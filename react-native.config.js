const { androidRuntimeBuildSettings } = require("./plugins/with-phone11-android-runtime.js");
const androidTrial = androidRuntimeBuildSettings();
module.exports = {
  dependencies: {
    "react-native-pjsip": {
      platforms: process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix" ? { ios: null, ...(androidTrial.enabled ? { android: null } : {}) } : {},
    },
    "phone11-siprix": {
      // The Siprix config plugin owns the iOS Pod declaration. This prevents
      // pod install from silently changing the native graph when the build
      // environment no longer carries EXPO_PUBLIC_SIP_ENGINE. The gated Android
      // trial plugin owns manual package registration and the exact runtime AAR.
      platforms: { ios: null, android: null },
    },
    "react-native-reanimated": {
      platforms: {
        ios: null,
        android: null,
      },
    },
    "react-native-worklets": {
      platforms: {
        ios: null,
        android: null,
      },
    },
  },
};
