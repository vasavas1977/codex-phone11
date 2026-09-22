import { expect, it } from "vitest";
import { emptyLocalArrivalState, observeLocalArrivals } from "../lib/chat/local-arrivals";
import type { ChatMessage } from "../lib/chat/types";

function message(id: string, sequence: number, senderId = 2): ChatMessage {
  return {
    id,
    clientId: `${id}-client`,
    channelId: "room",
    senderId,
    senderName: senderId === 1 ? "You" : "Teammate",
    content: id,
    timestamp: sequence,
    sequence,
    status: "sent",
    parent: null,
  };
}

it("marks only the first newly arrived incoming message after a list baseline", () => {
  let state = emptyLocalArrivalState();
  state = observeLocalArrivals(state, "10:room:messages", "messages", [message("known", 10)], 1).state;

  const next = observeLocalArrivals(
    state,
    "10:room:messages",
    "messages",
    [message("older", 4), message("known", 10), message("mine", 11, 1), message("arrived", 12)],
    1,
  );
  expect(next.boundary).toEqual({ messageKey: "2:arrived-client", kind: "messages" });
});

it("does not turn an older-page load or an initial thread view into a new-reply alert", () => {
  let state = emptyLocalArrivalState();
  state = observeLocalArrivals(state, "10:room:messages", "messages", [message("recent", 10)], 1).state;
  expect(observeLocalArrivals(state, "10:room:messages", "messages", [message("old", 2), message("recent", 10)], 1).boundary).toBeUndefined();

  expect(observeLocalArrivals(state, "10:room:thread:root", "replies", [message("root", 5), message("reply", 12)], 1).boundary).toBeUndefined();
});
