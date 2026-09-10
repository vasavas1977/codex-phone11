import AsyncStorage from "@react-native-async-storage/async-storage";
import { createChatPersistence } from "./persistence";
import { createTRPCClient } from "../trpc";
import { addAuthChangeListener, getAuthSnapshot } from "../_core/auth";
import { createChatStore } from "./state";
let client: ReturnType<typeof createTRPCClient> | null = null;
const api = () => (client ??= createTRPCClient()).chat;
export const useChatStore = createChatStore({
  list: tenantId => api().list.query({ tenantId }),
  directory: tenantId => api().directory.query({ tenantId }),
  create: (tenantId, kind, name, memberIds) => api().create.mutate({ tenantId, kind, name, memberIds }),
  history: (tenantId, id, before) => api().history.query({ tenantId, id, before }),
  search: (tenantId, id, text) => api().search.query({ tenantId, id, text }),
  send: (tenantId, id, clientId, content) => api().send.mutate({ tenantId, id, clientId, content }),
  read: (tenantId, id, through) => api().read.mutate({ tenantId, id, through }),
}, createChatPersistence(AsyncStorage));
const syncIdentity = () => useChatStore.getState().setUser(getAuthSnapshot().user?.id ?? null);
syncIdentity();
addAuthChangeListener(syncIdentity);
