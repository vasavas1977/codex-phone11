import { useEffect } from "react";
import { AppState } from "react-native";
import { addAuthChangeListener, getAuthSnapshot } from "../_core/auth";
import { useChatStore } from "./store";
import { startChatForegroundRefresh } from "./foreground";

export function ChatForegroundRefresh() {
  useEffect(() => startChatForegroundRefresh({
    auth: getAuthSnapshot,
    onAuth: addAuthChangeListener,
    active: () => AppState.currentState === "active",
    onActivity: listener => {
      const subscription = AppState.addEventListener("change", listener);
      return () => subscription.remove();
    },
    state: useChatStore.getState,
  }), []);
  return null;
}
