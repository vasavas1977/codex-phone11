import { beforeEach, describe, expect, it, vi } from "vitest";
import { protectedVoicemailAction, voicemailDialplanActions, type VoicemailExtensionRoute } from "../server/pbx/voicemail-dialplan";
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../server/pbx/db", () => ({ query: db.query }));
beforeEach(() => db.query.mockReset());

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

  it("preserves the guarded legacy route when the new hook is not commissioned", () => {
    expect(voicemailDialplanActions(mailbox, false)).toEqual({
      beforeBridge: "",
      afterBridge: '<action application="lua" data="/etc/freeswitch/scripts/phone11_legacy_voicemail.lua 3001 phone11.cloud"/>',
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
    // The feature-off path retains legacy mailbox behavior behind the host gate.
    expect(voicemailDialplanActions({ ...mailbox, type: "shared" }, false).afterBridge)
      .toBe('<action application="lua" data="/etc/freeswitch/scripts/phone11_legacy_voicemail.lua 3001 phone11.cloud"/>');
  });
});

describe("protected mailbox resolution", () => {
  it("uses the server tenant and current SIP/owner assignment for direct deposits", async () => {
    db.query.mockResolvedValue({ rows: [mailbox] });
    const action = await protectedVoicemailAction(12, "3001", "direct");
    expect(action).toContain("12 3001 3001 phone11.cloud direct");
    expect(action).not.toContain('application="voicemail"');
    const [sql, parameters] = db.query.mock.calls[0];
    expect(parameters).toEqual([12, "3001"]);
    expect(sql).toContain("sa.user_id = e.user_id");
    expect(sql).toContain("tm.status = 'active'");
    expect(sql).toContain("ue.user_id = e.user_id");
  });

  it.each(["", "3001 other", "../3001", "0", undefined])("refuses an invalid target %s before querying", async target => {
    expect(await protectedVoicemailAction(12, target as string, "direct")).toContain('application="hangup"');
    expect(db.query).not.toHaveBeenCalled();
  });

  it.each([
    [], [mailbox, mailbox], [{ ...mailbox, tenant_id: 99 }], [{ ...mailbox, extension_number: "3002" }],
    [{ ...mailbox, sip_username: "3002" }], [{ ...mailbox, user_id: null }],
    [{ ...mailbox, voicemail_enabled: false }], [{ ...mailbox, type: "shared" }],
  ].map(rows => ({ rows })))("refuses unavailable, ambiguous or invalid mailbox rows %#", async ({ rows }) => {
    db.query.mockResolvedValue({ rows });
    expect(await protectedVoicemailAction(12, "3001", "direct")).toContain('application="hangup"');
  });

  it("rechecks a reassigned or disabled mailbox without cached ownership", async () => {
    db.query.mockResolvedValueOnce({ rows: [mailbox] }).mockResolvedValueOnce({ rows: [] });
    expect(await protectedVoicemailAction(12, "3001", "bridge")).toContain("phone11_voicemail_deposit.lua");
    expect(await protectedVoicemailAction(12, "3001", "bridge")).toContain('application="hangup"');
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
