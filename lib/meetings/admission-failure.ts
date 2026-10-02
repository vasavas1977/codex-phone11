import { MeetingJoinFailure, safeMeetingJoinHttpStatus, type MeetingJoinReason } from "./join-failure";

const codeReasons: Readonly<Record<string, MeetingJoinReason>> = {
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  PRECONDITION_FAILED: "unavailable",
  SERVICE_UNAVAILABLE: "unavailable",
  INTERNAL_SERVER_ERROR: "internal",
  TIMEOUT: "timeout",
  GATEWAY_TIMEOUT: "timeout",
};
const statusReasons: Readonly<Record<number, MeetingJoinReason>> = {
  401: "unauthorized", 403: "forbidden", 404: "not_found",
  408: "timeout", 412: "unavailable", 503: "unavailable", 504: "timeout",
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

/** Reduce installed tRPC data/meta fields to fixed labels; never retain the error. */
export function meetingAdmissionFailure(error: unknown): MeetingJoinFailure {
  try {
    const candidate = record(error);
    const data = record(candidate?.data);
    const response = record(record(candidate?.meta)?.response);
    const httpStatus = safeMeetingJoinHttpStatus(data?.httpStatus)
      ?? safeMeetingJoinHttpStatus(response?.status)
      ?? safeMeetingJoinHttpStatus(candidate?.status);
    const code = typeof data?.code === "string" ? data.code : undefined;
    const reason = code && Object.prototype.hasOwnProperty.call(codeReasons, code) ? codeReasons[code]
      : httpStatus && Object.prototype.hasOwnProperty.call(statusReasons, httpStatus) ? statusReasons[httpStatus]
      : undefined;
    // fetchWithTimeout can erase the transport cause. Do not infer a timeout
    // from its message, and do not inspect arbitrary nested response bodies.
    const causeName = record(candidate?.cause)?.name;
    const transportReason = candidate?.name === "TimeoutError" || causeName === "TimeoutError" ? "timeout"
      : candidate?.name === "AbortError" || causeName === "AbortError" ? "cancelled" : undefined;
    return new MeetingJoinFailure("admission", { reason: reason ?? transportReason, httpStatus });
  } catch {
    // Malformed objects/getters are unknown failures, never diagnostic content.
    return new MeetingJoinFailure("admission");
  }
}
