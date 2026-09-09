import { describe, expect, it } from "vitest";
import { patchCallKitAudioStartup } from "../scripts/pjsip-callkit-patch.mjs";

const startup = `status = pjsua_start();
    if (status != PJ_SUCCESS) NSLog(@"Error starting pjsua");
    return self;`;

describe("PJSIP native CallKit startup patch", () => {
  it("disables automatic sound-device opening before returning the endpoint", () => {
    const patched = patchCallKitAudioStartup(startup);
    expect(patched).toContain("pjsua_set_no_snd_dev();");
    expect(patched.indexOf("pjsua_set_no_snd_dev();")).toBeGreaterThan(patched.indexOf("pjsua_start();"));
    expect(patched.indexOf("pjsua_set_no_snd_dev();")).toBeLessThan(patched.indexOf("return self;"));
  });
  it("is idempotent across repeated dependency installs", () => {
    const patched = patchCallKitAudioStartup(startup);
    expect(patchCallKitAudioStartup(patched)).toBe(patched);
  });
  it("fails closed if the dependency's startup code changes", () => {
    expect(() => patchCallKitAudioStartup("new startup implementation")).toThrow("PJSIP startup changed");
  });
});
