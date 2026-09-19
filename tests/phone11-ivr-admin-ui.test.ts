import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { IVR_ACTION_TYPES, validateIvrActionDraft } from "../lib/pbx/ivr-actions";

const source = readFileSync(resolve(process.cwd(), "app/admin/ivr.tsx"), "utf8");

describe("IVR key-action editor", () => {
  it("uses the tenant-scoped action reader and transactional saver", () => {
    expect(source).toContain("useIvrMenu(editingMenuId ?? 0)");
    expect(source).toContain("useSetIvrActions()");
    expect(source).toContain("menuDetailQuery.refetch()");
    expect(source).toContain("menusQuery.refetch()");
  });

  it("provides add, edit, remove, validation and retry-preserving UI", () => {
    expect(source).toContain("Add key action");
    expect(source).toContain("Remove key action");
    expect(source).toContain("validateIvrActionDraft");
    expect(source).toContain("Your changes are still here; try again.");
    expect(source).toContain("DTMF key");
    expect(source).toContain("Description for key action");

    const action = (overrides: Record<string, unknown> = {}) => ({
      digit: "1",
      action_type: "hangup",
      sort_order: 0,
      ...overrides,
    });
    expect(validateIvrActionDraft([action()])).toBeNull();
    expect(validateIvrActionDraft([action({ digit: "A" })])).toContain("DTMF");
    expect(validateIvrActionDraft([action(), action({ action_type: "repeat" })])).toContain("used more than once");
    expect(validateIvrActionDraft([action({ action_type: "external_number", target: "1555" })])).toContain("not supported");
    expect(validateIvrActionDraft([action({ action_type: "transfer_ext" })])).toContain("destination");
    expect(validateIvrActionDraft([action({ target: "3001" })])).toContain("does not use");
  });

  it("offers only action types implemented by the current dialplan consumer", () => {
    expect(IVR_ACTION_TYPES.map((item) => item.value)).toEqual([
      "transfer_ext",
      "transfer_queue",
      "transfer_ringgroup",
      "sub_menu",
      "voicemail",
      "hangup",
      "repeat",
      "dial_by_name",
    ]);
    expect(source).toContain("IVR_ACTION_TYPES");
  });
});
