import { describe, expect, it } from "vitest";
import { voicemailDialplanActions, type VoicemailExtensionRoute } from "../server/pbx/voicemail-dialplan";

const mailbox: VoicemailExtensionRoute = {
  tenant_id: 12,
  extension_number: "3001",
  sip_username: "3001",
  sip_domain: "phone11.cloud",
  voicemail_enabled: true,
  type: "user",
  user_id: 17,
};

describe("Phone11 voicemail dialplan handoff", () => {
  it("does not send a disabled mailbox to the voicemail application or producer", () => {
    expect(voicemailDialplanActions({ ...mailbox, voicemail_enabled: false }, true))
      .toEqual({ beforeBridge: "", afterBridge: "" });
  });

  it("preserves the legacy route when the new hook is not commissioned", () => {
    expect(voicemailDialplanActions(mailbox, false)).toEqual({
      beforeBridge: "",
      afterBridge: '<action application="voicemail" data="default phone11.cloud 3001"/>',
    });
  });

  it("passes only authenticated tenant and mailbox identity to the gated Lua hook", () => {
    expect(voicemailDialplanActions(mailbox, true)).toEqual({
      beforeBridge: '<action application="set" data="continue_on_fail=true"/>',
      afterBridge: '<action application="lua" data="/etc/freeswitch/scripts/phone11_voicemail_deposit.lua 12 3001 3001 phone11.cloud"/>',
    });
  });

  it("fails closed on missing tenant identity or XML/Lua argument injection", () => {
    expect(voicemailDialplanActions({ ...mailbox, tenant_id: 0 }, true).afterBridge).toBe("");
    expect(voicemailDialplanActions({ ...mailbox, sip_username: "3002" }, true).afterBridge).toBe("");
    expect(voicemailDialplanActions({ ...mailbox, sip_domain: 'phone11.cloud" extra' }, true).afterBridge).toBe("");
  });

  it("never invokes the inbox producer for a shared or unassigned mailbox", () => {
    expect(voicemailDialplanActions({ ...mailbox, type: "shared" }, true))
      .toEqual({ beforeBridge: "", afterBridge: "" });
    expect(voicemailDialplanActions({ ...mailbox, user_id: undefined }, true))
      .toEqual({ beforeBridge: "", afterBridge: "" });
    // The feature-off path retains the existing legacy route byte for byte.
    expect(voicemailDialplanActions({ ...mailbox, type: "shared" }, false).afterBridge)
      .toBe('<action application="voicemail" data="default phone11.cloud 3001"/>');
  });
});
