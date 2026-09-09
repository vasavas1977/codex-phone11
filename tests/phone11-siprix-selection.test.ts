import { afterEach, describe, expect, it, vi } from "vitest";

const engines = vi.hoisted(() => ({ legacy: { initialize: vi.fn() }, siprix: { initialize: vi.fn() } }));
vi.mock("../lib/sip/pjsip-engine", () => ({ sipEngine: engines.legacy }));
vi.mock("../lib/sip/siprix-engine", () => ({ siprixEngine: engines.siprix }));

describe("Siprix build-time selection", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
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
});
