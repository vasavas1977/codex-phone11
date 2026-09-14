type Phone11Extra = {
  phone11AndroidLab?: boolean;
  phone11ApiBaseUrl?: string;
};

function extra(): Phone11Extra {
  try {
    // Lazy loading keeps the build flag usable in native release bundles while
    // allowing isolated logic tests to run without an Expo native runtime.
    const constants = require("expo-constants").default as {
      expoConfig?: { extra?: Phone11Extra };
    };
    return constants.expoConfig?.extra ?? {};
  } catch {
    return {};
  }
}

export function isPhone11AndroidLab(runtime = extra()): boolean {
  return (
    process.env.EXPO_PUBLIC_PHONE11_ANDROID_LAB === "1" ||
    runtime.phone11AndroidLab === true
  );
}

export function phone11ConfiguredApiBaseUrl(runtime = extra()): string {
  if (isPhone11AndroidLab(runtime)) return "http://10.0.2.2:18080";
  const configured =
    process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || runtime.phone11ApiBaseUrl;
  return typeof configured === "string" ? configured.replace(/\/+$/, "") : "";
}
