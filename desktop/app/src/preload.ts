import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from './ipc';
import { MEETING_CHANNELS } from './meeting-channels';

const api = Object.freeze({
  state: () => ipcRenderer.invoke(CHANNELS.state),
  signIn: (email: string, password: string) => ipcRenderer.invoke(CHANNELS.signIn, { email, password }),
  selectTenant: (selectionRevision: string, tenantId: number) =>
    ipcRenderer.invoke(CHANNELS.selectTenant, { selectionRevision, tenantId }),
  action: (action: unknown) => ipcRenderer.invoke(CHANNELS.action, action),
  historyList: (sessionRevision: string, cursor?: { startedAt: string; id: number }) =>
    ipcRenderer.invoke(CHANNELS.historyList, { sessionRevision, ...(cursor ? { cursor } : {}) }),
  directoryList: (sessionRevision: string, search: string, offset: number) =>
    ipcRenderer.invoke(CHANNELS.directoryList, { sessionRevision, search, offset }),
  voicemailAudio: (sessionRevision: string, id: number) => ipcRenderer.invoke(CHANNELS.voicemailAudio, { sessionRevision, id }),
  voicemailMarkRead: (sessionRevision: string, id: number) => ipcRenderer.invoke(CHANNELS.voicemailMarkRead, { sessionRevision, id }),
  voicemailList: (sessionRevision: string) => ipcRenderer.invoke(CHANNELS.voicemailList, { sessionRevision }),
  signOut: () => ipcRenderer.invoke(CHANNELS.signOut),
  openMeetings: () => ipcRenderer.invoke(MEETING_CHANNELS.open),
  onUpdate: (listener: (snapshot: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: unknown) => listener(snapshot);
    ipcRenderer.on(CHANNELS.update, handler);
    return () => ipcRenderer.removeListener(CHANNELS.update, handler);
  },
});
contextBridge.exposeInMainWorld('phone11', api);
