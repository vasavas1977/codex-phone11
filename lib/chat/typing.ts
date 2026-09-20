import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { getAuthSnapshot, type User } from "../_core/auth";
import { createTypingLifecycleController } from "./typing-controller";
import { createChatTransport } from "./transport";
import { typingText } from "./typing-format";

const api = createChatTransport();
const sessionId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
  const value = Math.floor(Math.random() * 16); return (character === "x" ? value : (value & 3) | 8).toString(16);
});
let sequence = 0;
const uuid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
  const value = Math.floor(Math.random() * 16); return (character === "x" ? value : (value & 3) | 8).toString(16);
});

type TypingScope = {
  owner: User | null | undefined;
  tenantId?: number;
  conversationId: string;
  threadRootId?: string;
  enabled: boolean;
  focused: boolean;
};

function sameScope(left: TypingScope, right: TypingScope) {
  return left.owner === right.owner && left.tenantId === right.tenantId &&
    left.conversationId === right.conversationId && left.threadRootId === right.threadRootId &&
    left.enabled === right.enabled && left.focused === right.focused;
}

export function useChatTyping(options: TypingScope) {
  const { owner, tenantId, conversationId, threadRootId, enabled, focused } = options;
  const [snapshot, setSnapshot] = useState<{ scope: TypingScope; names: string[] } | null>(null);
  const current = useRef(options);
  current.current = options;
  const controller = useRef<ReturnType<typeof createTypingLifecycleController> | undefined>(undefined);

  useEffect(() => {
    const captured: TypingScope = { owner, tenantId, conversationId, threadRootId, enabled, focused };
    if (!captured.owner || !captured.tenantId || !captured.enabled || !captured.focused) {
      controller.current = undefined;
      setSnapshot(null);
      return;
    }
    const generation = uuid();
    const lifecycle = createTypingLifecycleController({
      nextSequence: () => ++sequence,
      canSend: state => {
        if (getAuthSnapshot().user !== captured.owner) return false;
        // A stop is safe for its captured old thread/workspace. A start must still
        // belong to the visible composer that produced the user gesture.
        return !state.active || sameScope(current.current, captured);
      },
      send: state => api.typingPublish(captured.tenantId!, captured.conversationId, {
        threadRootId: captured.threadRootId,
        sessionId,
        generation,
        sequence: state.sequence,
        active: state.active,
      }),
    });
    controller.current = lifecycle;
    return () => {
      if (controller.current === lifecycle) controller.current = undefined;
      lifecycle.dispose();
    };
  }, [owner, tenantId, conversationId, threadRootId, enabled, focused]);

  useEffect(() => {
    const captured: TypingScope = { owner, tenantId, conversationId, threadRootId, enabled, focused };
    if (!captured.owner || !captured.tenantId || !captured.enabled || !captured.focused) {
      setSnapshot(null);
      return;
    }
    let stopped = false;
    let running = false;
    let pending = false;
    const stillCurrent = () => !stopped && getAuthSnapshot().user === captured.owner &&
      sameScope(current.current, captured);
    const read = async () => {
      if (!stillCurrent() || AppState.currentState !== "active") return;
      if (running) { pending = true; return; }
      running = true;
      try {
        const rows = await api.typing(captured.tenantId!, captured.conversationId, captured.threadRootId);
        if (stillCurrent()) setSnapshot({ scope: captured, names: rows.map(row => row.name) });
      } catch {
        if (stillCurrent()) setSnapshot({ scope: captured, names: [] });
      } finally {
        running = false;
        if (pending) { pending = false; void read(); }
      }
    };
    void read();
    const timer = setInterval(() => void read(), 2_000);
    const activity = AppState.addEventListener("change", state => {
      if (!stillCurrent()) return;
      if (state === "active") void read();
      else { setSnapshot(null); controller.current?.stop(); }
    });
    return () => {
      stopped = true;
      clearInterval(timer);
      activity.remove();
      setSnapshot(null);
    };
  }, [owner, tenantId, conversationId, threadRootId, enabled, focused]);

  const onUserEdit = useCallback((text: string) => controller.current?.onUserEdit(text), []);
  const stop = useCallback(() => controller.current?.stop(), []);
  const names = snapshot && sameScope(snapshot.scope, options) ? snapshot.names : [];
  return { names, label: typingText(names), onUserEdit, stop };
}
