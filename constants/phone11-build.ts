type Phone11Extra = {
  phone11AndroidLab?: boolean;
  phone11ApiBaseUrl?: string;
  phone11AndroidSip?: Phone11AndroidSipConfig;
};

export type Phone11AndroidSipConfig = {
  sipServer: string;
  port: number;
  accountExtension: string;
  destinations: string[];
};

function extra(): Phone11Extra {
  try {
    // Lazy loading keeps the build flag usable in native release bundles while
    // allowing isolated logic tests to run without an Expo native runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
  const configured = runtime.phone11ApiBaseUrl?.trim() ||
    process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (isPhone11AndroidLab(runtime) && !configured) return "http://10.0.2.2:18080";
  return typeof configured === "string" ? configured.replace(/\/+$/, "") : "";
}

export function phone11AndroidSipConfig(runtime = extra()): Phone11AndroidSipConfig {
  const config = runtime.phone11AndroidSip;
  if (!isPhone11AndroidLab(runtime) || !config || typeof config.sipServer !== "string" ||
      !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 ||
      typeof config.accountExtension !== "string" || !Array.isArray(config.destinations) ||
      config.destinations.length < 2 || config.destinations.some(value => typeof value !== "string" || !value)) {
    throw new Error("Phone11 Android SIP lab configuration is unavailable");
  }
  return { ...config, destinations: [...config.destinations] };
}
