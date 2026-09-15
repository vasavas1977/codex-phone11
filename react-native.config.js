module.exports = {
  dependencies: {
    "react-native-pjsip": {
      platforms: process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix" ? { ios: null, ...(process.env.PHONE11_ANDROID_LAB === "1" ? { android: null } : {}) } : {},
    },
    "phone11-siprix": {
      platforms: process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix" ? (process.env.PHONE11_ANDROID_LAB === "1" ? {} : { android: null }) : { ios: null, android: null },
    },
    "react-native-callkeep": { platforms: process.env.PHONE11_ANDROID_LAB === "1" ? { android: null } : {} },
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
