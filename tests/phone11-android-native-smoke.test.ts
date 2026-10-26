import { describe, expect, it, vi } from "vitest";
import { checkAndroidNativeSdkSmoke } from "../lib/sip/android-native-smoke";

const receipt = (changes: Record<string, unknown> = {}) => ({
  sdkVersion: "1.1.0 from 20260905_1222", initialized: false, accounts: [], calls: [],
  registrationAttempted: false, callAttempted: false, ...changes,
});

describe("Android native SDK smoke receipt", () => {
  it.each(["1.1.0 from 20260905_1222", "Siprix:1.1.0 from 20260905_1222", "Siprix: 1.1.0 from 20260905_1222"])(
    "accepts the pinned released receipt with vendor version %s", async sdkVersion => {
      expect(await checkAndroidNativeSdkSmoke(async () => receipt({ sdkVersion }))).toEqual({ ok: true, sdkVersion });
    });
  it.each(["1.1.1 from 20260905_1222", "1.1.0 from 20260906_1222", "Siprix: 1.1.0", "private-token\n1.1.0 from 20260905_1222", "x".repeat(81)])(
    "rejects unsupported or malformed version %# without displaying it", async sdkVersion => {
      const result = await checkAndroidNativeSdkSmoke(async () => receipt({ sdkVersion }));
      expect(result).toMatchObject({ ok: false, code: "E_NATIVE_SMOKE_RECEIPT" });
      expect(JSON.stringify(result)).not.toContain(sdkVersion);
    });
  it.each([{ initialized: true }, { initialized: undefined }, { accounts: [{}] }, { calls: [{}] },
    { accounts: undefined }, { calls: null }, { registrationAttempted: true }, { callAttempted: true },
    { registrationAttempted: undefined }, { callAttempted: "false" }])("rejects incomplete release evidence %j", async changes => {
    expect(await checkAndroidNativeSdkSmoke(async () => receipt(changes))).toMatchObject({ ok: false, code: "E_NATIVE_SMOKE_RECEIPT" });
  });
  it("distinguishes missing bridge, native rejection and invalid receipt", async () => {
    expect(await checkAndroidNativeSdkSmoke()).toMatchObject({ ok: false, code: "E_NATIVE_SMOKE_UNAVAILABLE" });
    expect(await checkAndroidNativeSdkSmoke(async () => { throw { code: "E_SDK_VERSION" }; })).toMatchObject({ ok: false, code: "E_SDK_VERSION" });
    expect(await checkAndroidNativeSdkSmoke(async () => null)).toMatchObject({ ok: false, code: "E_NATIVE_SMOKE_RECEIPT" });
  });
  it("keeps a known native code without reading its private message or configuration", async () => {
    const message = vi.fn(() => { throw new Error("private-token"); });
    const error = Object.defineProperty({ code: "E_SMOKE_STATE", config: "private-config" }, "message", { get: message });
    const result = await checkAndroidNativeSdkSmoke(async () => { throw error; });
    expect(result).toMatchObject({ ok: false, code: "E_SMOKE_STATE" });
    expect(message).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain("private");
  });
  it.each([-1000, -1047, -2147483648, 2147483647])("preserves only a canonical Java integer SDK status %s", async status => {
    expect(await checkAndroidNativeSdkSmoke(async () => { throw { code: `E_SIPRIX_${status}`, message: "private-message" }; }))
      .toEqual({ ok: false, code: `E_SIPRIX_${status}`, detail: "The native SDK rejected initialization or release." });
  });
  it.each(["private-token", "E_SIPRIX_-2147483649", "E_SIPRIX_2147483648", "E_SIPRIX_0", "E_SIPRIX_01",
    "E_SIPRIX_-1000\nprivate-token", "E_SMOKE_STATE\nprivate-token", "__proto__"])("does not expose unknown native code %#", async code => {
    const result = await checkAndroidNativeSdkSmoke(async () => { throw { code, message: "private-message" }; });
    expect(result).toMatchObject({ ok: false, code: "E_NATIVE_SMOKE_REJECTED" });
    expect(JSON.stringify(result)).not.toContain(code); expect(JSON.stringify(result)).not.toContain("private");
  });
  it("treats throwing error and receipt accessors as unavailable evidence", async () => {
    const hostile = Object.defineProperty({}, "code", { get() { throw new Error("private"); } });
    expect(await checkAndroidNativeSdkSmoke(async () => { throw hostile; })).toMatchObject({ code: "E_NATIVE_SMOKE_REJECTED" });
    const malformed = Object.defineProperty({}, "initialized", { get() { throw new Error("private"); } });
    expect(await checkAndroidNativeSdkSmoke(async () => malformed)).toMatchObject({ code: "E_NATIVE_SMOKE_RECEIPT" });
  });
});
