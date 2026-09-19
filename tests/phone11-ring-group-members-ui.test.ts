import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeRingGroupMember,
  validateRingGroupMembers,
  type RingGroupMemberDraft,
} from "../lib/pbx/ring-group-members";

const source = readFileSync(
  resolve(process.cwd(), "app/admin/ring-groups.tsx"),
  "utf8",
);

const member = (overrides: Partial<RingGroupMemberDraft> = {}): RingGroupMemberDraft => ({
  extensionId: 10,
  priority: 1,
  delaySeconds: 0,
  isActive: true,
  ...overrides,
});

describe("ring-group member editor", () => {
  it("offers only ring strategies the current runtime can execute faithfully", () => {
    expect(source).toContain('value: "simultaneous"');
    expect(source).toContain('value: "sequential"');
    expect(source).not.toContain('value: "round_robin"');
    expect(source).not.toContain('value: "longest_idle"');
    expect(source).not.toContain('value: "random"');
    expect(source).toContain("Legacy strategy is not supported by the current call runtime.");
    expect(source).toContain("useUpdateRingGroup");
    expect(source).toContain("Save Ring All or Sequential to repair it.");
  });

  it("normalizes database bigint fields without changing persisted delay values", () => {
    expect(normalizeRingGroupMember({
      id: "7",
      extension_id: "10",
      priority: "2",
      delay_seconds: "30",
      is_active: false,
    })).toEqual({ extensionId: 10, priority: 2, delaySeconds: 30, isActive: false });
  });

  it("rejects duplicate, invalid, and out-of-range drafts before mutation", () => {
    expect(validateRingGroupMembers([member()])).toBeNull();
    expect(validateRingGroupMembers([member(), member({ priority: 2 })])).toContain("only once");
    expect(validateRingGroupMembers([member({ extensionId: 0 })])).toContain("valid workspace extension");
    expect(validateRingGroupMembers([member({ priority: 10001 })])).toContain("Priority");
    expect(validateRingGroupMembers([member({ delaySeconds: 121 })])).toContain("Delay");
  });

  it("wires a retryable, locked, tenant-extension member sheet", () => {
    expect(source).toContain("useRingGroup");
    expect(source).toContain("useSetRingGroupMembers");
    expect(source).toContain("useExtensions(1, 100");
    expect(source).toContain('accessibilityLabel={`Edit members for ${item.name}`}');
    expect(source).toContain('accessibilityLabel={"Add extension " + String(extension.extension_number)}');
    expect(source).toContain("membersMutation.isPending");
    expect(source).toContain("groupDetailQuery.refetch()");
    expect(source).toContain("closeMembers();");
    expect(source).toContain("void Promise.all([groupDetailQuery.refetch(), ringGroupsQuery.refetch()]).catch");
    expect(source).toContain("Your changes are still here; try again.");
    expect(source).toContain('editable={!membersMutation.isPending}');
    expect(source).not.toContain('accessibilityLabel={"Delay for member');
    expect(source).toContain("delay_seconds: member.delaySeconds");
    expect(source).toContain("extension: newExt.trim() || null");
  });
});
