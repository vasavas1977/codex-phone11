export type DesktopCallHistoryErrorCode = "unauthorized" | "forbidden" | "endpoint_unavailable" |
  "server_error" | "request_failed" | "invalid_response" | "tenant_mismatch" | "session_changed";

/** Safe failure classification shared by the privileged provider and IPC boundary. */
export class DesktopCallHistoryError extends Error {
  constructor(readonly code: DesktopCallHistoryErrorCode, readonly status?: number) {
    super(`Phone11 call history unavailable (${code})`);
    this.name = "DesktopCallHistoryError";
  }
}
