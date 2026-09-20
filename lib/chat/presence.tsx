import { useEffect } from "react";
import { AppState } from "react-native";
import { getAuthSnapshot } from "../_core/auth";
import { getActiveNativeMeeting, subscribeNativeMeetingRegistry } from "../meetings/native-session-registry";
import { useSipCallStore } from "../sip/call-store";
import { createChatTransport } from "./transport";
import { useChatStore } from "./store";
import { resetPresenceOwner, richPresenceAvailable } from "./presence-store";
import type { ChatPresenceStatus } from "./types";
import { useAuth } from "@/hooks/use-auth";

export { presenceColor, presenceLabel, useChatPresence, useChatPresenceStore, usePresencePolling } from "./presence-store";

const api = createChatTransport();
const POLL_MS = 30_000;
let processSequence = 0;
function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
    const value = Math.floor(Math.random() * 16);
    return (character === "x" ? value : (value & 3) | 8).toString(16);
  });
}
const processSessionId = uuid();

type PublishedPresence = { sequence: number; status: Exclude<ChatPresenceStatus, "offline">; active: boolean };
export function createPresencePublisherController(options: {
  getStatus: () => Exclude<ChatPresenceStatus, "offline">;
  nextSequence: () => number;
  canSend: (active: boolean) => Promise<boolean>;
  send: (presence: PublishedPresence) => Promise<unknown>;
}) {
  let stopped = false, sending = false, lastStatus: PublishedPresence["status"] | undefined, desired: PublishedPresence | undefined;
  const newestDesired = () => desired;
  const flush = async () => {
    if (sending) return;
    sending = true;
    try {
      while (desired) {
        const next = desired; desired = undefined;
        if (next.active && stopped) continue;
        if (!await options.canSend(next.active) || (next.active && stopped)) continue;
        const newer = newestDesired();
        if (newer && newer.sequence > next.sequence) continue;
        await options.send(next);
      }
    } catch {
      // Lease expiry makes failures self-healing and prevents stale busy state.
    } finally {
      sending = false;
      if (desired) void flush();
    }
  };
  const publish = (active = true, force = false) => {
    if (stopped && active) return;
    const status = options.getStatus();
    if (!force && active && status === lastStatus) return;
    lastStatus = status;
    desired = { sequence: options.nextSequence(), status, active };
    void flush();
  };
  return { publish, stop: () => { stopped = true; publish(false, true); } };
}

export function localPresenceStatus(ownerId: number): Exclude<ChatPresenceStatus, "offline"> {
  const calls = useSipCallStore.getState();
  const callStates = new Set(["calling", "incoming", "connecting", "active", "held"]);
  const ownedCall = [calls.incomingCall, ...Object.values(calls.activeCalls)]
    .some(call => call && call.history?.ownerUserId === ownerId && callStates.has(call.status));
  if (ownedCall) return "on_call";
  const meeting = getActiveNativeMeeting(ownerId);
  const meetingStatus = meeting?.session.getSnapshot().status;
  if (meetingStatus === "connected" || meetingStatus === "reconnecting") return "in_meeting";
  return AppState.currentState === "active" ? "available" : "away";
}

/** One publisher at the app root keeps presence current across every tab. */
export function Phone11PresencePublisher() {
  const { user: authOwner } = useAuth({ autoFetch: false });
  const userId = useChatStore(state => state.userId);
  const tenantId = useChatStore(state => state.workspace?.id);
  useEffect(() => {
    resetPresenceOwner(authOwner?.id ?? null);
  }, [authOwner]);
  useEffect(() => {
    // Resolve the server-authorized primary workspace on cold launch. Explicit
    // Team Chat workspace changes replace it; presence is never broadcast to
    // every membership or to a client-guessed tenant.
    if (userId && !tenantId) void useChatStore.getState().loadChannels();
  }, [tenantId, userId]);
  useEffect(() => {
    const owner = authOwner;
    if (!owner || owner.id !== userId || !tenantId) return;
    const generation = uuid();
    const controller = createPresencePublisherController({
      getStatus: () => localPresenceStatus(owner.id), nextSequence: () => ++processSequence,
      canSend: async active => {
        if (!await richPresenceAvailable(owner.id, tenantId) || getAuthSnapshot().user !== owner) return false;
        const state = useChatStore.getState();
        return !active || (state.userId === owner.id && state.workspace?.id === tenantId);
      },
      send: next => api.heartbeat(tenantId, { sessionId: processSessionId, generation, ...next }),
    });
    controller.publish(true, true);
    const callUnsubscribe = useSipCallStore.subscribe(() => controller.publish());
    const meetingUnsubscribe = subscribeNativeMeetingRegistry(() => controller.publish());
    const appSubscription = AppState.addEventListener("change", () => controller.publish());
    const timer = setInterval(() => controller.publish(true, true), POLL_MS);
    return () => {
      callUnsubscribe(); meetingUnsubscribe(); appSubscription.remove(); clearInterval(timer);
      controller.stop();
    };
  }, [authOwner, tenantId, userId]);
  return null;
}
