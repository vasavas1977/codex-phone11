import type { SipCall } from "./call-store";

type Calls = { activeCalls: Record<string, SipCall>; incomingCall: SipCall | null };

/** A stale explicit route must never control a newer, unrelated call. */
export function resolveCurrentCall(state: Calls, requestedId?: string | string[]): SipCall | null {
  const id = Array.isArray(requestedId) ? requestedId[0] : requestedId;
  const live = (call?: SipCall | null) => call && call.status !== "disconnected" ? call : null;
  if (id) return live(state.activeCalls[id] ?? (state.incomingCall?.id === id ? state.incomingCall : null));
  const calls = new Map<string, SipCall>();
  for (const call of [...Object.values(state.activeCalls), state.incomingCall]) {
    if (live(call)) calls.set(call!.id, call!);
  }
  return calls.size === 1 ? calls.values().next().value! : null;
}
