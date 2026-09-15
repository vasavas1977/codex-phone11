import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { patchCallKitAudioStartup } from "../scripts/pjsip-callkit-patch.mjs";

const startup = `status = pjsua_start();
    if (status != PJ_SUCCESS) NSLog(@"Error starting pjsua");
    return self;`;

describe("CallKeep iOS audio configuration contract", () => {
  it("passes the SDK's native voice-chat mode and HFP option without mixing", () => {
    const source = readFileSync(new URL("../lib/sip/native-call.ts", import.meta.url), "utf8");
    const sdk = readFileSync(new URL("../node_modules/react-native-callkeep/index.js", import.meta.url), "utf8");
    expect(sdk).toContain("voiceChat: 'AVAudioSessionModeVoiceChat'");
    expect(source).toContain('mode: "AVAudioSessionModeVoiceChat"');
    expect(source).not.toContain('mode: "voiceChat"');
    expect(source).toContain("categoryOptions: 0x04,");
  });
});

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
