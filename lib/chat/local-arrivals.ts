import type { ChatMessage } from "./types";

export type LocalArrivalScope = "messages" | "replies";
export type LocalArrivalBoundary = {
  messageKey: string;
  kind: LocalArrivalScope;
};
export type LocalArrivalState = {
  scopeKey: string | null;
  highestSequence: number;
  knownMessageKeys: Set<string>;
};

export function emptyLocalArrivalState(): LocalArrivalState {
  return { scopeKey: null, highestSequence: 0, knownMessageKeys: new Set() };
}

export function chatMessageKey(message: Pick<ChatMessage, "senderId" | "clientId">) {
  return `${message.senderId}:${message.clientId}`;
}

/**
 * Captures only new incoming server messages after the current list has been
 * observed. Loading an older page cannot create a boundary because its server
 * sequence is at or below the established high-water mark.
 */
export function observeLocalArrivals(
  state: LocalArrivalState,
  scopeKey: string,
  kind: LocalArrivalScope,
  messages: ChatMessage[],
  ownerId: number,
): { state: LocalArrivalState; boundary?: LocalArrivalBoundary } {
  const highestSequence = Math.max(
    state.scopeKey === scopeKey ? state.highestSequence : 0,
    ...messages.filter((message) => message.status === "sent").map((message) => message.sequence),
  );
  const knownMessageKeys = new Set(messages.map(chatMessageKey));
  if (state.scopeKey !== scopeKey)
    return { state: { scopeKey, highestSequence, knownMessageKeys } };

  const firstIncoming = messages.find(
    (message) =>
      message.status === "sent" &&
      message.senderId !== ownerId &&
      message.sequence > state.highestSequence &&
      !state.knownMessageKeys.has(chatMessageKey(message)),
  );
  return {
    state: { scopeKey, highestSequence, knownMessageKeys },
    ...(firstIncoming
      ? { boundary: { messageKey: chatMessageKey(firstIncoming), kind } }
      : {}),
  };
}
