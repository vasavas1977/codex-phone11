import { afterEach, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  extra: {} as Record<string, unknown>,
}));

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      get extra() {
        return runtime.extra;
      },
    },
  },
}));

import {
  isPhone11AndroidLab,
  phone11AndroidSipConfig,
  phone11ConfiguredApiBaseUrl,
} from "../constants/phone11-build";

afterEach(() => {
  runtime.extra = {};
  vi.unstubAllEnvs();
});

it("retains the Android lab gate and isolated API in a native release bundle", () => {
  vi.stubEnv("EXPO_PUBLIC_PHONE11_ANDROID_LAB", "0");
  vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", "https://api.phone11.ai");
  runtime.extra = {
    phone11AndroidLab: true,
    phone11ApiBaseUrl: "http://10.0.2.2:18080",
    phone11AndroidSip: { sipServer: "sip.staging.example", port: 16060, accountExtension: "8201", destinations: ["8202", "8290"] },
  };
  expect(isPhone11AndroidLab(runtime.extra)).toBe(true);
  expect(phone11ConfiguredApiBaseUrl(runtime.extra)).toBe("http://10.0.2.2:18080");
  expect(phone11AndroidSipConfig(runtime.extra)).toEqual({ sipServer: "sip.staging.example", port: 16060, accountExtension: "8201", destinations: ["8202", "8290"] });
});

it("rejects absent Android SIP configuration rather than falling back to a live endpoint", () => {
  runtime.extra = { phone11AndroidLab: true };
  expect(() => phone11AndroidSipConfig(runtime.extra)).toThrow("configuration is unavailable");
});

it("uses the configured non-lab API without a trailing slash", () => {
  vi.stubEnv("EXPO_PUBLIC_PHONE11_ANDROID_LAB", "0");
  vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", "");
  runtime.extra = {
    phone11AndroidLab: false,
    phone11ApiBaseUrl: "https://staging.phone11.example/",
  };
  expect(isPhone11AndroidLab(runtime.extra)).toBe(false);
  expect(phone11ConfiguredApiBaseUrl(runtime.extra)).toBe("https://staging.phone11.example");
});

it("uses the commissioned Android lab HTTPS API instead of the offline emulator fallback", () => {
  vi.stubEnv("EXPO_PUBLIC_PHONE11_ANDROID_LAB", "1");
  vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", "http://10.0.2.2:18080");
  runtime.extra = {
    phone11AndroidLab: true,
    phone11ApiBaseUrl: "https://api.staging.phone11.invalid/",
  };
  expect(phone11ConfiguredApiBaseUrl(runtime.extra)).toBe("https://api.staging.phone11.invalid");
});
