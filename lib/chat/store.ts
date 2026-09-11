import AsyncStorage from "@react-native-async-storage/async-storage";
import { createChatPersistence } from "./persistence";
import { createChatTransport } from "./transport";
import { addAuthChangeListener, getAuthSnapshot } from "../_core/auth";
import { createChatStore } from "./state";
export const useChatStore = createChatStore(createChatTransport(), createChatPersistence(AsyncStorage));
const syncIdentity = () => useChatStore.getState().setUser(getAuthSnapshot().user?.id ?? null);
syncIdentity();
addAuthChangeListener(syncIdentity);
