/**
 * Phone11's client-side boundary for the shared Super Number calendar/task
 * service. This module intentionally contains no endpoint, credential, OAuth,
 * or local-to-workspace sharing implementation. The server is the authority
 * for canonical task IDs, personal realms, tenant/workspace membership, source
 * ownership, and idempotency persistence.
 */

export const PHONE11_CALENDAR_TASK_CONTRACT = "supernumber.calendar-task.v1" as const;

export type Phone11PrivateFollowUp = Readonly<{
  /** Stable only inside Phone11's private recording metadata. Never canonical. */
  localFollowUpId: string;
  /** The private Phone11 call/recording identifier the current session may read. */
  callId: string;
  text: string;
  completed: boolean;
}>;

export type Phone11PrivateFollowUpIntent = Readonly<{
  contract: typeof PHONE11_CALENDAR_TASK_CONTRACT;
  operationId: string;
  localFollowUpId: string;
  title: string;
  notes: null;
  source: Readonly<{
    kind: "call";
    system: "phone";
    /** Namespaced so Phone11 and Zoom Phone cannot accidentally share a backlink. */
    sourceId: string;
    internalPath: string;
  }>;
}>;

export type Phone11LegacyFollowUpMigrationPosture =
  | Readonly<{
      kind: "retain_local";
      reason: "shared_service_unavailable" | "not_explicitly_saved";
    }>
  | Readonly<{
      kind: "requires_owner_review";
      reason: "completed_time_unknown";
    }>;

export type Phone11SharedTaskTransport = Readonly<{
  /**
   * The authenticated server adapter derives canonical user, personal realm,
   * tenant and workspace scope. It returns a server-created canonical task ID.
   * This is an interface only until the shared service publishes an API.
   */
  createPrivateCallFollowUp: (
    intent: Phone11PrivateFollowUpIntent,
  ) => Promise<
    | Readonly<{ kind: "accepted"; operationId: string; taskId: string; version: number }>
    | Readonly<{ kind: "conflict" | "retry" | "rejected" }>
  >;
}>;

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/;
const MAX_TITLE = 240;

function validOpaqueId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID.test(value);
}

function validOperationId(value: unknown): value is string {
  return typeof value === "string" && OPERATION_ID.test(value);
}

/**
 * Converts a user-confirmed private Phone11 follow-up to a request that an
 * authenticated shared-service adapter may authorize. It deliberately omits
 * tenantId, workspaceId, ownerUserId, privacy switching and canonical task ID:
 * none of those are trustworthy client claims.
 */
export function preparePrivateFollowUpIntent(
  followUp: Phone11PrivateFollowUp,
  operationId: string,
): Phone11PrivateFollowUpIntent {
  if (!validOpaqueId(followUp.localFollowUpId) || !validOpaqueId(followUp.callId)) {
    throw new Error("Invalid Phone11 follow-up source");
  }
  if (!validOperationId(operationId)) throw new Error("Invalid task operation");
  if (followUp.completed) {
    // Existing local completion has no trusted completion instant. Do not turn
    // it into a newly-created incomplete shared task or invent a timestamp.
    throw new Error("Completed follow-up requires owner review");
  }
  const title = followUp.text.trim();
  if (title.length === 0 || title.length > MAX_TITLE) {
    throw new Error("Invalid follow-up title");
  }
  const sourceId = `phone11_${followUp.callId}`;
  if (sourceId.length > 128 || !validOpaqueId(sourceId)) {
    throw new Error("Invalid Phone11 call source");
  }
  return Object.freeze({
    contract: PHONE11_CALENDAR_TASK_CONTRACT,
    operationId,
    localFollowUpId: followUp.localFollowUpId,
    title,
    notes: null,
    source: Object.freeze({
      kind: "call",
      system: "phone",
      sourceId,
      internalPath: `/app/calls/${sourceId}`,
    }),
  });
}

/**
 * Legacy private metadata stays local until its owner explicitly saves it.
 * Completed items require a review because Phone11's legacy boolean does not
 * carry the completion time needed by the canonical service.
 */
export function legacyFollowUpMigrationPosture(
  followUp: Phone11PrivateFollowUp,
  sharedServiceAvailable: boolean,
): Phone11LegacyFollowUpMigrationPosture {
  if (followUp.completed) {
    return { kind: "requires_owner_review", reason: "completed_time_unknown" };
  }
  return {
    kind: "retain_local",
    reason: sharedServiceAvailable ? "not_explicitly_saved" : "shared_service_unavailable",
  };
}

/** The transport is intentionally injected, so this module cannot send data by itself. */
export async function submitPrivateFollowUpIntent(
  transport: Phone11SharedTaskTransport,
  intent: Phone11PrivateFollowUpIntent,
): Promise<Awaited<ReturnType<Phone11SharedTaskTransport["createPrivateCallFollowUp"]>>> {
  return transport.createPrivateCallFollowUp(intent);
}
