import { describe, expect, it } from "vitest";
import {
  ChatIntegrationContractError,
  createPhone11LineOAReference,
  mapPhone11MessageToSuperNumber,
  type Phone11ChatIntegrationMessage,
  type Phone11SuperNumberAccountMapping,
} from "./integration-contract";

const message: Phone11ChatIntegrationMessage = {
  id: "e748e07d-5d98-4353-84ed-9e2383c0d9ee",
  clientId: "bfca70ca-d978-42ba-94c1-30ea2d3cd5bf",
  tenantId: 41,
  conversationId: "5c6791c4-1e85-4ac2-95c3-5fb4c42c210b",
  senderId: 99,
  sequence: 204,
  createdAt: "2026-09-16T10:11:12.000Z",
  content: "Please review the customer request.",
  visibility: "internal_workspace",
  shareState: "not_shared",
};
const mapping: Phone11SuperNumberAccountMapping = {
  phone11TenantId: 41,
  phone11UserId: 99,
  superNumberTenantId: "sn-workspace-41",
  superNumberAccountId: "sn-account-99",
  state: "active",
};

describe("Phone11 Team Chat integration contract", () => {
  it("maps one persisted message to a stable, tenant-scoped Super Number event", () => {
    const first = mapPhone11MessageToSuperNumber(message, mapping);
    const retry = mapPhone11MessageToSuperNumber({ ...message, content: message.content }, mapping);
    expect(first).toEqual(retry);
    expect(first.eventId).toBe(`phone11.chat.message.v1:${message.id}`);
    expect(first.idempotencyKey).toBe(first.eventId);
    expect(first.source).toMatchObject({ tenantId: 41, accountId: 99, messageId: message.id, sequence: 204 });
    expect(first.target).toEqual({ tenantId: "sn-workspace-41", accountId: "sn-account-99" });
  });

  it.each([
    [{ ...mapping, phone11TenantId: 42 }, "different Phone11 workspace"],
    [{ ...mapping, phone11UserId: 100 }, "different Phone11 account"],
    [{ ...mapping, state: "inactive" as const }, "mapping is inactive"],
  ])("rejects a mapping that is not the sender's active tenant mapping", (invalid, expected) => {
    expect(() => mapPhone11MessageToSuperNumber(message, invalid)).toThrow(ChatIntegrationContractError);
    expect(() => mapPhone11MessageToSuperNumber(message, invalid)).toThrow(expected);
  });

  it("does not export a private recording follow-up until its owner explicitly shares it", () => {
    const privateFollowUp = { ...message, visibility: "owner_private" as const, shareState: "not_shared" as const };
    expect(() => mapPhone11MessageToSuperNumber(privateFollowUp, mapping)).toThrow("explicit owner share");
    expect(mapPhone11MessageToSuperNumber({ ...privateFollowUp, shareState: "owner_shared" }, mapping).payload.content).toBe(message.content);
  });

  it("creates a LINE OA association with no message text and no delivery request", () => {
    const reference = createPhone11LineOAReference(message, mapping, "line-oa-acme");
    expect(reference).toEqual({
      contractVersion: "phone11-line-oa-reference.v1",
      referenceId: `phone11.line-oa.reference.v1:${message.id}`,
      source: { tenantId: 41, conversationId: message.conversationId, messageId: message.id },
      target: { superNumberTenantId: "sn-workspace-41", lineOfficialAccountId: "line-oa-acme" },
      delivery: "not_requested",
    });
    expect(JSON.stringify(reference)).not.toContain(message.content);
  });
});
