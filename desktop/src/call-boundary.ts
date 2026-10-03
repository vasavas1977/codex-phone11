/**
 * Phone11 desktop calling boundary, protocol v1.
 *
 * This module belongs in a privileged desktop main process. A renderer may
 * request only `RendererAction`s. It never receives SIP credentials, helper
 * diagnostics, or an arbitrary helper command channel.
 */
export const DESKTOP_CALL_PROTOCOL_VERSION = 1;
export type TransferState = "ready" | "pending" | "uncertain" | "confirmed" | "refused";

export type DesktopSession = Readonly<{
  revision: string;
  userId: string;
  tenantId: number;
  extensionId: number;
  accountId: string;
}>;

export type CallState = "incoming" | "dialing" | "ringing" | "connected" | "held";
export type PublicCall = Readonly<{ id: string; state: CallState; muted: boolean }>;
export type PublicSnapshot = Readonly<{
  version: 1;
  registered: boolean;
  call: PublicCall | null;
  dialState: "idle" | "requesting" | "reconcile";
  callActionState: "idle" | "requesting" | "reconcile";
  holdMessage: "Hold unavailable; end call if needed" | null;
  /** Present only after the verified helper advertises callback support. One attempt per call. */
  transfer?: TransferState;
}>;

export type HelperCommand = Readonly<{
  version: 1;
  generation: string;
  sessionRevision: string;
  accountId: string;
  operation: "dial" | "answer" | "end" | "mute" | "hold" | "dtmf" | "transfer";
  callId?: string;
  destination?: string;
  intentId?: string;
  value?: boolean | string;
}>;

export interface HelperPort {
  /**
   * Resolving means SDK command acceptance only; state follows helper events.
   * Throw HelperCommandRejectedError only when the helper confirms the command
   * was not accepted or queued. A transport failure has ambiguous acceptance
   * and must throw an ordinary error instead.
   */
  execute(command: HelperCommand): Promise<void>;
}

/** A trusted helper's definite pre-acceptance refusal, without SIP details. */
export class HelperCommandRejectedError extends Error {
  constructor() {
    super("Helper command was rejected");
    this.name = "HelperCommandRejectedError";
  }
}

type HelperEvent =
  | { version: 1; generation: string; sequence: number; sessionRevision: string; accountId: string; type: "registration"; registered: boolean }
  | { version: 1; generation: string; sequence: number; sessionRevision: string; accountId: string; type: "call"; callId: string; state: CallState | "terminated"; muted?: boolean }
  | { version: 1; generation: string; sequence: number; sessionRevision: string; accountId: string; type: "hold_error"; callId: string; code: "state_unconfirmed"; holdControl: "blocked" }
  | { version: 1; generation: string; sequence: number; sessionRevision: string; accountId: string; type: "transfer"; callId: string; intentId: string; statusCode: number }
  | { version: 1; generation: string; sequence: number; sessionRevision: string; accountId: string; type: "hold_recovered"; callId: string; code: "state_confirmed"; holdControl: "ready" };

export type RendererAction =
  | { operation: "snapshot"; sessionRevision: string }
  | { operation: "dial"; sessionRevision: string; destination: string }
  | { operation: "answer" | "end"; sessionRevision: string; generation: string; callId: string }
  | { operation: "mute" | "hold"; sessionRevision: string; generation: string; callId: string; value: boolean }
  | { operation: "transfer"; sessionRevision: string; generation: string; callId: string; destination: string }
  | { operation: "dtmf"; sessionRevision: string; generation: string; callId: string; digits: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isToken = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
const isCallId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,9}$/.test(value);
const isDestination = (value: unknown): value is string =>
  typeof value === "string" && /^\+?[0-9*#]{1,32}$/.test(value);
const isTransferDestination = (value: unknown): value is string =>
  typeof value === "string" && /^\+?[0-9]{1,32}$/.test(value);
const isIntentId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const isDigits = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9*#A-Da-d]{1,32}$/.test(value);
const states: readonly string[] = ["incoming", "dialing", "ringing", "connected", "held", "terminated"];

export function parseRendererAction(input: unknown): RendererAction {
  if (!isRecord(input) || !isToken(input.sessionRevision)) throw new Error("Invalid calling request");
  switch (input.operation) {
    case "snapshot":
      return { operation: "snapshot", sessionRevision: input.sessionRevision };
    case "dial":
      if (!isDestination(input.destination)) break;
      return { operation: "dial", sessionRevision: input.sessionRevision, destination: input.destination };
    case "answer":
    case "end":
      if (!isToken(input.generation) || !isCallId(input.callId)) break;
      return { operation: input.operation, sessionRevision: input.sessionRevision, generation: input.generation, callId: input.callId };
    case "mute":
    case "hold":
      if (!isToken(input.generation) || !isCallId(input.callId) || typeof input.value !== "boolean") break;
      return { operation: input.operation, sessionRevision: input.sessionRevision, generation: input.generation, callId: input.callId, value: input.value };
    case "transfer":
      if (!isToken(input.generation) || !isCallId(input.callId) || !isTransferDestination(input.destination)) break;
      return { operation: "transfer", sessionRevision: input.sessionRevision, generation: input.generation, callId: input.callId, destination: input.destination };
    case "dtmf":
      if (!isToken(input.generation) || !isCallId(input.callId) || !isDigits(input.digits)) break;
      return { operation: "dtmf", sessionRevision: input.sessionRevision, generation: input.generation, callId: input.callId, digits: input.digits.toUpperCase() };
  }
  throw new Error("Invalid calling request");
}

function parseHelperEvent(input: unknown): HelperEvent | null {
  if (!isRecord(input) || input.version !== DESKTOP_CALL_PROTOCOL_VERSION ||
      !isToken(input.generation) || !Number.isSafeInteger(input.sequence) || (input.sequence as number) <= 0 ||
      !isToken(input.sessionRevision) || !isToken(input.accountId)) return null;
  const base = { version: 1 as const, generation: input.generation, sequence: input.sequence as number,
    sessionRevision: input.sessionRevision, accountId: input.accountId };
  if (input.type === "registration" && typeof input.registered === "boolean")
    return { ...base, type: "registration", registered: input.registered };
  if (input.type === "call" && isCallId(input.callId) && typeof input.state === "string" && states.includes(input.state) &&
      (input.muted === undefined || typeof input.muted === "boolean"))
    return { ...base, type: "call", callId: input.callId, state: input.state as CallState | "terminated", muted: input.muted as boolean | undefined };
  if (input.type === "transfer" && isCallId(input.callId) && isIntentId(input.intentId) &&
      Number.isInteger(input.statusCode) && (input.statusCode as number) >= 0 && (input.statusCode as number) <= 0xffffffff)
    return { ...base, type: "transfer", callId: input.callId, intentId: input.intentId, statusCode: input.statusCode as number };
  if (input.type === "hold_error" && isCallId(input.callId) &&
      input.code === "state_unconfirmed" && input.holdControl === "blocked")
    return { ...base, type: "hold_error", callId: input.callId, code: "state_unconfirmed", holdControl: "blocked" };
  if (input.type === "hold_recovered" && isCallId(input.callId) &&
      input.code === "state_confirmed" && input.holdControl === "ready")
    return { ...base, type: "hold_recovered", callId: input.callId, code: "state_confirmed", holdControl: "ready" };
  return null;
}

/** Current auth and tenant binding must be checked by the caller on every IPC. */
export class DesktopCallBoundary {
  private generation: string | null = null;
  private session: DesktopSession | null = null;
  private transferSupported = false;
  private transfer: { callId: string; intentId: string; state: TransferState; callbackSeen: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null;
  private sequence = 0;
  private registered = false;
  private call: PublicCall | null = null;
  private holdMessage: "Hold unavailable; end call if needed" | null = null;
  private terminatedCallIds = new Set<string>();
  private dialState: "idle" | "requesting" | "reconcile" = "idle";
  private dialTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCallCommands = new Set<string>();
  private pendingCallAction: {
    operation: "answer" | "end";
    callId: string;
    phase: "requesting" | "reconcile";
    timer: ReturnType<typeof setTimeout> | null;
    supersededAnswer: boolean;
  } | null = null;

  constructor(private readonly port: HelperPort, private readonly dialCallbackTimeoutMs = 30_000,
              private readonly onStateChange?: () => void) {
    if (!Number.isSafeInteger(dialCallbackTimeoutMs) || dialCallbackTimeoutMs < 1)
      throw new Error("Invalid dial timeout");
  }

  /** Only the verified supervisor may set this from a successful init reply. */
  setTransferCapability(supported: boolean): void { this.transferSupported = supported; }

  private resetPending(): void {
    if (this.transfer?.timer) clearTimeout(this.transfer.timer);
    this.transfer = null;
    if (this.dialTimer) clearTimeout(this.dialTimer);
    this.dialTimer = null;
    this.dialState = "idle";
    this.pendingCallCommands.clear();
    this.clearPendingCallAction();
  }

  private clearPendingCallAction(): void {
    if (this.pendingCallAction?.timer) clearTimeout(this.pendingCallAction.timer);
    this.pendingCallAction = null;
  }

  /** Called only by the privileged helper supervisor after each spawn. */
  startHelperGeneration(generation: string): void {
    if (!isToken(generation) || generation === this.generation) throw new Error("Invalid helper generation");
    this.resetPending();
    this.transferSupported = false;
    this.generation = generation;
    this.session = null;
    this.sequence = 0;
    this.registered = false;
    this.call = null;
    this.holdMessage = null;
    this.terminatedCallIds.clear();
  }

  /** Called after a trusted provisioner has bound this account in the helper. */
  bindSession(session: DesktopSession, generation: string): void {
    if (generation !== this.generation || !this.generation || !isToken(session.revision) ||
        !isToken(session.userId) || !isToken(session.accountId) ||
        !Number.isSafeInteger(session.tenantId) || session.tenantId <= 0 ||
        !Number.isSafeInteger(session.extensionId) || session.extensionId <= 0)
      throw new Error("Invalid desktop session");
    this.resetPending();
    this.session = Object.freeze({ ...session });
    this.registered = false;
    this.call = null;
    this.holdMessage = null;
    this.terminatedCallIds.clear();
    this.sequence = 0;
  }

  /** Logout, helper exit, or account change immediately invalidates old calls. */
  clear(): void {
    this.resetPending();
    this.transferSupported = false;
    this.session = null;
    this.registered = false;
    this.call = null;
    this.holdMessage = null;
    this.terminatedCallIds.clear();
    this.sequence = 0;
  }

  receiveHelperEvent(input: unknown): boolean {
    const event = parseHelperEvent(input);
    if (!event || !this.session || event.generation !== this.generation ||
        event.sessionRevision !== this.session.revision || event.accountId !== this.session.accountId ||
        event.sequence <= this.sequence) return false;
    if (event.type === "registration") {
      this.sequence = event.sequence;
      this.registered = event.registered;
      // An established SIP dialog can outlive a registration failure. Keep its
      // End control until the helper reports termination or the session ends.
      return true;
    }
    if (event.type === "transfer") {
      const transfer = this.transfer;
      if (!transfer || transfer.callbackSeen || this.call?.id !== event.callId ||
          transfer.callId !== event.callId || transfer.intentId !== event.intentId) return false;
      this.sequence = event.sequence;
      transfer.callbackSeen = true;
      if (transfer.timer) clearTimeout(transfer.timer);
      transfer.timer = null;
      // Siprix documents status 0 as success. Never infer success from SIP 2xx.
      transfer.state = event.statusCode === 0 ? "confirmed" : "uncertain";
      return true;
    }
    if (event.type === "hold_error") {
      if (this.call?.id !== event.callId ||
          (this.call.state !== "connected" && this.call.state !== "held")) return false;
      this.sequence = event.sequence;
      this.holdMessage = "Hold unavailable; end call if needed";
      return true;
    }
    if (event.type === "hold_recovered") {
      if (!this.holdMessage || this.call?.id !== event.callId ||
          (this.call.state !== "connected" && this.call.state !== "held")) return false;
      this.sequence = event.sequence;
      this.holdMessage = null;
      return true;
    }
    if (event.state === "terminated") {
      if (this.call?.id !== event.callId) return false;
      this.sequence = event.sequence;
      this.terminatedCallIds.add(event.callId);
      this.call = null;
      this.holdMessage = null;
      this.resetPending();
      return true;
    }
    if (this.terminatedCallIds.has(event.callId)) return false;
    if (this.call && this.call.id !== event.callId) return false; // one-call policy
    if (!this.registered && event.state !== "incoming") return false;
    this.sequence = event.sequence;
    this.call = { id: event.callId, state: event.state, muted: event.muted ?? this.call?.muted ?? false };
    if (this.pendingCallAction?.operation === "answer" && this.pendingCallAction.callId === event.callId &&
        (event.state === "connected" || event.state === "held")) this.clearPendingCallAction();
    if (this.pendingCallAction?.operation === "end" && this.pendingCallAction.callId === event.callId &&
        (event.state === "connected" || event.state === "held")) this.pendingCallAction.supersededAnswer = false;
    if (this.dialState !== "idle") {
      if (this.dialTimer) clearTimeout(this.dialTimer);
      this.dialTimer = null;
      this.dialState = "idle";
    }
    return true;
  }

  snapshot(): PublicSnapshot {
    return { version: 1, registered: this.registered, call: this.call ? { ...this.call } : null,
      dialState: this.dialState, callActionState: this.pendingCallAction?.phase ?? "idle",
      holdMessage: this.holdMessage, ...(this.transferSupported ? { transfer: this.transfer?.state ?? "ready" } : {}) };
  }

  async handleRendererAction(input: unknown, currentSession: DesktopSession | null): Promise<PublicSnapshot> {
    const action = parseRendererAction(input);
    if (!currentSession || !this.session || !this.generation ||
        action.sessionRevision !== currentSession.revision || currentSession.revision !== this.session.revision ||
        currentSession.userId !== this.session.userId || currentSession.tenantId !== this.session.tenantId ||
        currentSession.extensionId !== this.session.extensionId || currentSession.accountId !== this.session.accountId)
      throw new Error("Calling session changed");
    if (action.operation === "snapshot") return this.snapshot();

    const command: HelperCommand = {
      version: 1, generation: this.generation, sessionRevision: this.session.revision,
      accountId: this.session.accountId, operation: action.operation,
    };
    if (action.operation === "dial") {
      if (!this.registered || this.call || this.dialState !== "idle") throw new Error("Calling is unavailable");
      // Reserve the single-call slot before awaiting the helper. Command
      // acceptance is not a call callback, so the reservation remains until
      // a callback arrives. A timeout requires reconciliation, not a retry.
      this.dialState = "requesting";
      this.dialTimer = setTimeout(() => {
        if (this.session?.revision === action.sessionRevision && this.generation === command.generation &&
            this.dialState === "requesting") {
          this.dialTimer = null;
          this.dialState = "reconcile";
          this.onStateChange?.();
        }
      }, this.dialCallbackTimeoutMs);
      try {
        await this.port.execute({ ...command, destination: action.destination });
      } catch (error) {
        if (this.session?.revision === action.sessionRevision && this.generation === command.generation &&
            this.dialState === "requesting") {
          if (this.dialTimer) clearTimeout(this.dialTimer);
          this.dialTimer = null;
          // A transport error may follow helper acceptance. Only a definite
          // pre-acceptance refusal frees the one-call slot for retry.
          this.dialState = error instanceof HelperCommandRejectedError ? "idle" : "reconcile";
          this.onStateChange?.();
        }
        throw new Error("Call could not start");
      }
      if (this.session?.revision !== action.sessionRevision || this.generation !== command.generation)
        throw new Error("Calling session changed");
      return this.snapshot();
    }
    if (!this.call || this.call.id !== action.callId || action.generation !== this.generation)
      throw new Error("Call changed");
    if (action.operation === "transfer") {
      if (!this.transferSupported || !this.registered || this.call.state !== "connected" || this.holdMessage ||
          this.transfer || this.pendingCallAction || this.pendingCallCommands.has(`hold:${action.callId}`))
        throw new Error("Transfer unavailable; one attempt per call");
      const reservation = { callId: action.callId, intentId: globalThis.crypto.randomUUID(), state: "pending" as TransferState,
        callbackSeen: false, timer: null as ReturnType<typeof setTimeout> | null };
      this.transfer = reservation; // Reserve before the SDK can callback synchronously.
      reservation.timer = setTimeout(() => {
        if (this.transfer === reservation && reservation.state === "pending") {
          reservation.timer = null; reservation.state = "uncertain"; this.onStateChange?.();
        }
      }, this.dialCallbackTimeoutMs);
      try { await this.port.execute({ ...command, callId: action.callId, destination: action.destination, intentId: reservation.intentId }); }
      catch (error) {
        if (this.transfer === reservation && !reservation.callbackSeen) {
          if (reservation.timer) clearTimeout(reservation.timer);
          reservation.timer = null;
          reservation.state = error instanceof HelperCommandRejectedError ? "refused" : "uncertain";
          this.onStateChange?.();
        }
        throw new Error("Transfer could not be confirmed; original call remains available");
      }
      if (this.session?.revision !== action.sessionRevision || this.generation !== action.generation)
        throw new Error("Calling session changed");
      return this.snapshot();
    }
    if (action.operation === "hold" && this.transfer) throw new Error("Hold unavailable after transfer attempt");
    if (action.operation === "answer" && this.call.state !== "incoming") throw new Error("Call is not ringing");
    if ((action.operation === "mute" || action.operation === "hold" || action.operation === "dtmf") &&
        !["connected", "held"].includes(this.call.state)) throw new Error("Call is not connected");
    if (action.operation === "hold" && this.holdMessage) throw new Error("Hold unavailable");
    if (action.operation === "end" && this.transfer) {
      this.transfer.callbackSeen = true;
      if (this.transfer.timer) clearTimeout(this.transfer.timer);
      this.transfer.timer = null;
      if (this.transfer.state === "pending") this.transfer.state = "uncertain";
    }
    const callbackAction = action.operation === "answer" || action.operation === "end";
    let supersededAnswer = false;
    if (callbackAction && this.pendingCallAction) {
      // A missed Answer callback must never strand a live call. End may
      // supersede Answer for this exact known call, but its uncertain outcome
      // must survive a definite End refusal until a connected callback arrives.
      if (action.operation === "end" && this.pendingCallAction.operation === "answer" &&
          this.pendingCallAction.callId === action.callId) {
        supersededAnswer = true;
        this.clearPendingCallAction();
      }
      else throw new Error("Call action is in progress");
    }
    const commandKey = `${action.operation}:${action.callId}`;
    let reservation: typeof this.pendingCallAction = null;
    if (callbackAction) {
      const reserved = {
        operation: action.operation as "answer" | "end", callId: action.callId,
        phase: "requesting" as "requesting" | "reconcile", timer: null as ReturnType<typeof setTimeout> | null,
        supersededAnswer,
      };
      reservation = reserved;
      this.pendingCallAction = reserved;
      reserved.timer = setTimeout(() => {
        if (this.pendingCallAction === reserved) {
          reserved.timer = null;
          reserved.phase = "reconcile";
          this.onStateChange?.();
        }
      }, this.dialCallbackTimeoutMs);
    } else {
      this.pendingCallCommands.add(commandKey);
    }
    try {
      if (action.operation === "mute" || action.operation === "hold") await this.port.execute({ ...command, callId: action.callId, value: action.value });
      else if (action.operation === "dtmf") await this.port.execute({ ...command, callId: action.callId, value: action.digits });
      else await this.port.execute({ ...command, callId: action.callId });
    } catch (error) {
      if (callbackAction && reservation && this.pendingCallAction === reservation) {
        if (error instanceof HelperCommandRejectedError &&
            this.session?.revision === action.sessionRevision && this.generation === action.generation &&
            this.call?.id === action.callId) {
          // A confirmed refusal did not queue Answer or End. A matching live
          // call may retry; an End that superseded an uncertain Answer restores
          // that exact Answer reconciliation reservation.
          this.clearPendingCallAction();
          if (action.operation === "end" && reservation.supersededAnswer) this.pendingCallAction = {
            operation: "answer", callId: action.callId, phase: "reconcile", timer: null, supersededAnswer: false,
          };
          this.onStateChange?.();
        } else {
          // Transport failures may occur after acceptance. A second End must
          // wait for a trusted terminal callback or a helper/session reset.
          if (reservation.timer) clearTimeout(reservation.timer);
          reservation.timer = null;
          reservation.phase = "reconcile";
        }
      }
      // Native errors can contain SIP responses or account details.
      throw new Error("Call action could not complete");
    } finally {
      if (!callbackAction) this.pendingCallCommands.delete(commandKey);
    }
    if (this.session?.revision !== action.sessionRevision || this.generation !== action.generation)
      throw new Error("Calling session changed");
    return this.snapshot();
  }
}
