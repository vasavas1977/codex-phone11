import { afterEach, describe, expect, it, vi } from "vitest";

const engines = vi.hoisted(() => ({ legacy: { initialize: vi.fn() }, siprix: { initialize: vi.fn() } }));
const runtime = vi.hoisted(() => ({
  platform: { OS: "ios" },
  extra: {} as Record<string, unknown>,
}));
vi.mock("../lib/sip/pjsip-engine", () => ({ sipEngine: engines.legacy }));
vi.mock("../lib/sip/siprix-engine", () => ({ siprixEngine: engines.siprix }));
vi.mock("react-native", () => ({ Platform: runtime.platform }));
vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      get extra() {
        return runtime.extra;
      },
    },
  },
}));

describe("Siprix build-time selection", () => {
  afterEach(() => {
    runtime.platform.OS = "ios";
    runtime.extra = {};
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it.each([undefined, "pjsip", "legacyPJSIP", "SIPRIX"])("retains legacy PJSIP when flag is %s", async flag => {
    vi.stubEnv("EXPO_PUBLIC_SIP_ENGINE", flag);
    expect((await import("../lib/sip/engine")).sipEngine).toBe(engines.legacy);
  });
  it("selects only Siprix for the exact build flag and does not hot-switch", async () => {
    vi.stubEnv("EXPO_PUBLIC_SIP_ENGINE", "siprix");
    const { sipEngine } = await import("../lib/sip/engine");
    expect(sipEngine).toBe(engines.siprix);
    vi.stubEnv("EXPO_PUBLIC_SIP_ENGINE", "pjsip");
    expect((await import("../lib/sip/engine")).sipEngine).toBe(sipEngine);
    expect(engines.legacy.initialize).not.toHaveBeenCalled();
  });

  it("selects Siprix from the embedded Android lab gate when the public env was omitted", async () => {
    runtime.platform.OS = "android";
    runtime.extra = { phone11AndroidLab: true };
    vi.stubEnv("EXPO_PUBLIC_SIP_ENGINE", undefined);
    vi.stubEnv("EXPO_PUBLIC_PHONE11_ANDROID_LAB", undefined);

    expect((await import("../lib/sip/engine")).sipEngine).toBe(engines.siprix);
  });

  it("does not apply the embedded Android lab fallback to ordinary Android or iOS builds", async () => {
    runtime.platform.OS = "android";
    runtime.extra = { phone11AndroidLab: false };
    vi.stubEnv("EXPO_PUBLIC_SIP_ENGINE", undefined);
    expect((await import("../lib/sip/engine")).sipEngine).toBe(engines.legacy);

    vi.resetModules();
    runtime.platform.OS = "ios";
    runtime.extra = { phone11AndroidLab: true };
    expect((await import("../lib/sip/engine")).sipEngine).toBe(engines.legacy);
  });
});
