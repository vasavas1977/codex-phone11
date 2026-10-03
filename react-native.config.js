module.exports = {
  dependencies: {
    "react-native-pjsip": {
      platforms: process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix" ? { ios: null } : {},
    },
    "phone11-siprix": {
      // The Siprix config plugin owns the iOS Pod declaration. This prevents
      // pod install from silently changing the native graph when the build
      // environment no longer carries EXPO_PUBLIC_SIP_ENGINE.
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
