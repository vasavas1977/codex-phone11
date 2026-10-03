/**
 * Source-only boundary for a future Super Number conversation adapter.
 *
 * This module does not perform I/O, load configuration, or carry provider
 * credentials. A delivery adapter must be injected by a later, separately
 * authorized integration. Phone11 remains the source of truth for its own
 * Team Chat records.
 */
export type Phone11ChatVisibility = "internal_workspace" | "owner_private";
export type Phone11ChatShareState = "not_shared" | "owner_shared";

export interface Phone11ChatIntegrationMessage {
  id: string;
  clientId: string;
  tenantId: number;
  conversationId: string;
  senderId: number;
  sequence: number;
  createdAt: string;
  content: string;
  visibility: Phone11ChatVisibility;
  shareState: Phone11ChatShareState;
}

/** An explicit, active mapping supplied by an authorized server-side resolver. */
export interface Phone11SuperNumberAccountMapping {
  phone11TenantId: number;
  phone11UserId: number;
  superNumberTenantId: string;
  superNumberAccountId: string;
  state: "active" | "inactive" | "revoked";
}

export interface SuperNumberChatEvent {
  contractVersion: "phone11-supernumber-chat.v1";
  eventId: string;
  idempotencyKey: string;
  source: {
    tenantId: number;
    accountId: number;
    conversationId: string;
    messageId: string;
    clientId: string;
    sequence: number;
    createdAt: string;
  };
  target: { tenantId: string; accountId: string };
  payload: { type: "team_chat_text"; content: string };
}

/**
 * A LINE OA reference is deliberately metadata-only. Phone11 Team Chat text
 * must never be forwarded to a customer channel implicitly.
 */
export interface Phone11LineOAReference {
  contractVersion: "phone11-line-oa-reference.v1";
  referenceId: string;
  source: { tenantId: number; conversationId: string; messageId: string };
  target: { superNumberTenantId: string; lineOfficialAccountId: string };
  delivery: "not_requested";
}

export class ChatIntegrationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatIntegrationContractError";
  }
}

function present(value: string, label: string) {
  if (!value.trim()) throw new ChatIntegrationContractError(`${label} is required.`);
}

function positive(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new ChatIntegrationContractError(`${label} must be a positive integer.`);
}

function assertShareable(message: Phone11ChatIntegrationMessage) {
  positive(message.tenantId, "Phone11 tenant ID");
  positive(message.senderId, "Phone11 sender ID");
  positive(message.sequence, "Message sequence");
  present(message.id, "Message ID");
  present(message.clientId, "Client ID");
  present(message.conversationId, "Conversation ID");
  present(message.createdAt, "Message creation time");
  present(message.content, "Message content");
  if (message.visibility === "owner_private" && message.shareState !== "owner_shared") {
    throw new ChatIntegrationContractError("Private Phone11 follow-ups require an explicit owner share before export.");
  }
}

function assertMapping(message: Phone11ChatIntegrationMessage, mapping: Phone11SuperNumberAccountMapping) {
  if (mapping.state !== "active") throw new ChatIntegrationContractError("The Phone11 account mapping is inactive.");
  if (mapping.phone11TenantId !== message.tenantId) throw new ChatIntegrationContractError("The mapping belongs to a different Phone11 workspace.");
  if (mapping.phone11UserId !== message.senderId) throw new ChatIntegrationContractError("The mapping belongs to a different Phone11 account.");
  present(mapping.superNumberTenantId, "Super Number tenant ID");
  present(mapping.superNumberAccountId, "Super Number account ID");
}

/**
 * Creates a deterministic, retry-safe event for a future Super Number adapter.
 * The same persisted Phone11 message always produces the same event and key.
 */
export function mapPhone11MessageToSuperNumber(
  message: Phone11ChatIntegrationMessage,
  mapping: Phone11SuperNumberAccountMapping,
): SuperNumberChatEvent {
  assertShareable(message);
  assertMapping(message, mapping);
  const stableKey = `phone11.chat.message.v1:${message.id}`;
  return {
    contractVersion: "phone11-supernumber-chat.v1",
    eventId: stableKey,
    idempotencyKey: stableKey,
    source: {
      tenantId: message.tenantId,
      accountId: message.senderId,
      conversationId: message.conversationId,
      messageId: message.id,
      clientId: message.clientId,
      sequence: message.sequence,
      createdAt: message.createdAt,
    },
    target: { tenantId: mapping.superNumberTenantId, accountId: mapping.superNumberAccountId },
    payload: { type: "team_chat_text", content: message.content },
  };
}

/**
 * Makes an auditable LINE OA association without sending content or creating a
 * customer conversation. A later Super Number-owned adapter may use this only
 * after its own customer consent and delivery checks.
 */
export function createPhone11LineOAReference(
  message: Phone11ChatIntegrationMessage,
  mapping: Phone11SuperNumberAccountMapping,
  lineOfficialAccountId: string,
): Phone11LineOAReference {
  assertShareable(message);
  assertMapping(message, mapping);
  present(lineOfficialAccountId, "LINE Official Account ID");
  return {
    contractVersion: "phone11-line-oa-reference.v1",
    referenceId: `phone11.line-oa.reference.v1:${message.id}`,
    source: { tenantId: message.tenantId, conversationId: message.conversationId, messageId: message.id },
    target: { superNumberTenantId: mapping.superNumberTenantId, lineOfficialAccountId },
    delivery: "not_requested",
  };
}
