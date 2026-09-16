import { describe, expect, it, vi } from "vitest";
import {
  PHONE11_CALENDAR_TASK_CONTRACT,
  legacyFollowUpMigrationPosture,
  preparePrivateFollowUpIntent,
  submitPrivateFollowUpIntent,
  type Phone11PrivateFollowUp,
} from "../lib/tasks/phone11-calendar-adapter";

const followUp = (overrides: Partial<Phone11PrivateFollowUp> = {}): Phone11PrivateFollowUp => ({
  localFollowUpId: "followup_01",
  callId: "call_01",
  text: "  Call the customer tomorrow  ",
  completed: false,
  ...overrides,
});
const operationId = "phone11operation_01";

describe("Phone11 shared calendar/task adapter boundary", () => {
  it("creates a private call intent without client scope or canonical task claims", () => {
    const intent = preparePrivateFollowUpIntent(followUp(), operationId);

    expect(intent).toEqual({
      contract: PHONE11_CALENDAR_TASK_CONTRACT,
      operationId,
      localFollowUpId: "followup_01",
      title: "Call the customer tomorrow",
      notes: null,
      source: {
        kind: "call",
        system: "phone",
        sourceId: "phone11_call_01",
        internalPath: "/app/calls/phone11_call_01",
      },
    });
    expect(intent).not.toHaveProperty("tenantId");
    expect(intent).not.toHaveProperty("workspaceId");
    expect(intent).not.toHaveProperty("ownerUserId");
    expect(intent).not.toHaveProperty("taskId");
  });

  it("uses a Phone11 namespace and rejects unsafe or incomplete source claims", () => {
    expect(() => preparePrivateFollowUpIntent(followUp({ callId: "../other" }), operationId)).toThrow(
      "source",
    );
    expect(() => preparePrivateFollowUpIntent(followUp(), "short")).toThrow("operation");
    expect(() => preparePrivateFollowUpIntent(followUp({ text: "  " }), operationId)).toThrow("title");
  });

  it("never auto-migrates private follow-ups and asks the owner to review completed legacy work", () => {
    expect(legacyFollowUpMigrationPosture(followUp(), false)).toEqual({
      kind: "retain_local",
      reason: "shared_service_unavailable",
    });
    expect(legacyFollowUpMigrationPosture(followUp(), true)).toEqual({
      kind: "retain_local",
      reason: "not_explicitly_saved",
    });
    expect(legacyFollowUpMigrationPosture(followUp({ completed: true }), true)).toEqual({
      kind: "requires_owner_review",
      reason: "completed_time_unknown",
    });
    expect(() => preparePrivateFollowUpIntent(followUp({ completed: true }), operationId)).toThrow(
      "owner review",
    );
  });

  it("only reaches an injected authenticated transport", async () => {
    const intent = preparePrivateFollowUpIntent(followUp(), operationId);
    const createPrivateCallFollowUp = vi.fn().mockResolvedValue({
      kind: "accepted",
      operationId,
      taskId: "task_01",
      version: 1,
    });

    await expect(
      submitPrivateFollowUpIntent({ createPrivateCallFollowUp }, intent),
    ).resolves.toMatchObject({ kind: "accepted", taskId: "task_01" });
    expect(createPrivateCallFollowUp).toHaveBeenCalledWith(intent);
  });
});
