import { expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { meetingAdmissionFailure } from "../lib/meetings/admission-failure";
import { meetingJoinFailureReference } from "../lib/meetings/join-failure";

it.each([
  ["UNAUTHORIZED", 401, "unauthorized"],
  ["FORBIDDEN", 403, "forbidden"],
  ["NOT_FOUND", 404, "not_found"],
  ["PRECONDITION_FAILED", 412, "unavailable"],
  ["SERVICE_UNAVAILABLE", 503, "unavailable"],
  ["TIMEOUT", 408, "timeout"],
  ["GATEWAY_TIMEOUT", 504, "timeout"],
  ["INTERNAL_SERVER_ERROR", 500, "internal"],
])("reduces tRPC %s to a fixed admission reference", (code, httpStatus, reason) => {
  const failure = meetingAdmissionFailure({ data: { code, httpStatus } });
  expect(meetingJoinFailureReference(failure)).toBe(`admission / ${reason} / ${httpStatus}`);
  expect(failure).not.toHaveProperty("cause");
});

it.each([
  [401, "unauthorized"], [403, "forbidden"], [404, "not_found"],
  [408, "timeout"], [412, "unavailable"], [503, "unavailable"], [504, "timeout"],
])("accepts validated HTTP metadata status %s without response content", (status, reason) => {
  const failure = meetingAdmissionFailure({ meta: { response: { status }, responseJSON: "private-body" } });
  expect(meetingJoinFailureReference(failure)).toBe(`admission / ${reason} / ${status}`);
  expect(JSON.stringify(failure)).not.toContain("private-body");
});

it("keeps allowlisted tRPC codes when HTTP metadata describes a batch", () => {
  expect(meetingJoinFailureReference(meetingAdmissionFailure({
    data: { code: "FORBIDDEN", httpStatus: 403 }, meta: { response: { status: 207 } },
  }))).toBe("admission / forbidden / 403");
});

it("uses the installed client's error data and HTTP metadata shape", () => {
  const error = TRPCClientError.from({ error: {
    code: -32003, message: "private provider/token details",
    data: { code: "FORBIDDEN", httpStatus: 403 },
  } }, { meta: { response: { status: 403 }, responseJSON: "private-body" } });
  const failure = meetingAdmissionFailure(error);
  expect(meetingJoinFailureReference(failure)).toBe("admission / forbidden / 403");
  expect(JSON.stringify(failure)).not.toMatch(/private|provider|token/);
  expect(failure).not.toHaveProperty("cause");
});

it.each([
  { name: "TimeoutError" }, { cause: { name: "TimeoutError" } },
])("recognizes an explicit transport timeout type", error => {
  expect(meetingJoinFailureReference(meetingAdmissionFailure(error))).toBe("admission / timeout");
});
it("does not label explicit cancellation as a timeout", () => {
  expect(meetingJoinFailureReference(meetingAdmissionFailure({ cause: { name: "AbortError" } }))).toBe("admission / cancelled");
});

it.each([null, undefined, "private-token", { data: { code: "constructor", httpStatus: "401" } },
  { data: { code: "private-token", httpStatus: 12345 } },
  { data: { code: "__proto__", httpStatus: 200 } },
])("keeps unknown or malformed errors generic", error => {
  expect(meetingJoinFailureReference(meetingAdmissionFailure(error))).toBe("admission");
});

it("never reads message/stack/body or serializes a secret-bearing cause", () => {
  const error = {
    data: { code: "FORBIDDEN", httpStatus: 403, path: "private-meeting", tenantId: 987 },
    cause: { name: "Error", token: "private-token", url: "wss://private.invalid" },
    get message() { throw new Error("must not read private message"); },
    get stack() { throw new Error("must not read private stack"); },
    meta: { get responseJSON() { throw new Error("must not read private body"); } },
  };
  const failure = meetingAdmissionFailure(error);
  expect(meetingJoinFailureReference(failure)).toBe("admission / forbidden / 403");
  expect(failure).not.toHaveProperty("cause");
  expect(JSON.stringify(failure)).not.toMatch(/private|987|token|url|tenantId|meetingId/);
});
it("handles a hostile diagnostic getter without exposing its error", () => {
  const failure = meetingAdmissionFailure({ get data() { throw new Error("private-token"); } });
  expect(meetingJoinFailureReference(failure)).toBe("admission");
  expect(JSON.stringify(failure)).not.toContain("private-token");
});
it("does not infer a timeout from untrusted text", () => {
  expect(meetingJoinFailureReference(meetingAdmissionFailure(new Error("timeout private-token")))).toBe("admission");
});
