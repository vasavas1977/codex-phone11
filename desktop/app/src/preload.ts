import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from './ipc';

const api = Object.freeze({
  state: () => ipcRenderer.invoke(CHANNELS.state),
  signIn: (email: string, password: string) => ipcRenderer.invoke(CHANNELS.signIn, { email, password }),
  action: (action: unknown) => ipcRenderer.invoke(CHANNELS.action, action),
  signOut: () => ipcRenderer.invoke(CHANNELS.signOut),
  onUpdate: (listener: (snapshot: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: unknown) => listener(snapshot);
    ipcRenderer.on(CHANNELS.update, handler);
    return () => ipcRenderer.removeListener(CHANNELS.update, handler);
  },
});
contextBridge.exposeInMainWorld('phone11', api);
