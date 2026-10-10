import { expect, it } from "vitest";
import { resolveCurrentCall } from "../lib/sip/current-call";
import type { SipCall } from "../lib/sip/call-store";
const call = (id: string, status: SipCall["status"] = "active"): SipCall => ({ id, status, direction: "inbound", remoteNumber: "3001", isMuted: false, isHeld: false, isSpeaker: false, isVideo: false });
it("binds a route without an id to the single actual incoming or connected call", () => {
  const incoming = call("200", "incoming");
  expect(resolveCurrentCall({ activeCalls: {}, incomingCall: incoming })).toBe(incoming);
  const connected = call("200");
  expect(resolveCurrentCall({ activeCalls: { "200": connected }, incomingCall: null })).toBe(connected);
});
it("never makes a stale route control a different call", () => {
  expect(resolveCurrentCall({ activeCalls: { "201": call("201") }, incomingCall: null }, "200")).toBeNull();
});
it("requires an explicit id when more than one live call exists", () => {
  const one = call("200"), two = call("201");
  const state = { activeCalls: { "200": one, "201": two }, incomingCall: null };
  expect(resolveCurrentCall(state)).toBeNull();
  expect(resolveCurrentCall(state, ["201"])).toBe(two);
});
it("stops controlling a call when it ends and deduplicates incoming-to-active transitions", () => {
  expect(resolveCurrentCall({ activeCalls: { "200": call("200", "disconnected") }, incomingCall: null })).toBeNull();
  const current = call("200");
  expect(resolveCurrentCall({ activeCalls: { "200": current }, incomingCall: current })).toBe(current);
  expect(resolveCurrentCall({ activeCalls: {}, incomingCall: null }, "200")).toBeNull();
});
