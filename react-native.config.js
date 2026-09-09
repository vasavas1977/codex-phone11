module.exports = {
  dependencies: {
    "react-native-pjsip": {
      platforms: process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix" ? { ios: null } : {},
    },
    "phone11-siprix": {
      platforms: process.env.EXPO_PUBLIC_SIP_ENGINE === "siprix" ? { android: null } : { ios: null, android: null },
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
