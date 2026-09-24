import { app, BrowserWindow, ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AuthenticatedDesktopProvider } from '../../src/authenticated-provider';
import { DesktopHelperSupervisor } from '../../src/helper-supervisor';
import { CHANNELS, createHandlers, validSender } from './ipc';
import { helperExecutable, verifyPackagedHelper } from './helper-verifier';
import { MEETING_CHANNELS } from './meeting-channels';
import { DesktopMeetingWindow } from './meeting-window';
declare const __PHONE11_MANIFEST_SHA256__: string;

let window: BrowserWindow | null = null;
let helper: DesktopHelperSupervisor | null = null;
let provider: AuthenticatedDesktopProvider | null = null;
let generation: string | null = null;
let meeting: DesktopMeetingWindow | null = null;
let quitting = false;
const resourcesDir = app.isPackaged ? join(process.resourcesPath, 'phone11') :
  (process.env.PHONE11_RESOURCE_STAGE ?? join(__dirname, '..', 'resources'));
const rendererPath = join(__dirname, 'index.html');
const rendererUrl = pathToFileURL(rendererPath).href;

async function bootstrap(): Promise<void> {
  const config = JSON.parse(await readFile(join(resourcesDir, 'config.json'), 'utf8')) as { apiOrigin?: unknown };
  if (typeof config.apiOrigin !== 'string') throw new Error('Phone11 API origin is not configured');
  provider = new AuthenticatedDesktopProvider({ origin: config.apiOrigin });
  window = new BrowserWindow({ width: 960, height: 740, minWidth: 360, minHeight: 600,
    title: 'Phone11 desktop trial', backgroundColor: '#f8fafc',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true,
      contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  const wc = window.webContents;
  helper = new DesktopHelperSupervisor({
    helperPath: helperExecutable(resourcesDir, process.platform as 'darwin' | 'win32'),
    currentSession: () => provider!.currentSession(),
    provision: session => provider!.provision(session),
    verifyHelper: path => verifyPackagedHelper(path, resourcesDir, __PHONE11_MANIFEST_SHA256__),
    onSnapshot: snapshot => {
      const sessionRevision = provider?.currentSession()?.revision;
      if (!wc.isDestroyed() && sessionRevision && generation)
        wc.send(CHANNELS.update, { sessionRevision, generation, snapshot });
      meeting?.onPhoneSnapshot();
    },
  });
  meeting = new DesktopMeetingWindow(provider, helper, () => window);
  meeting.registerIpc();
  const handlers = createHandlers(provider, helper, () => generation, value => { generation = value; });
  let accountQueue: Promise<void> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = accountQueue.then(operation, operation);
    accountQueue = next.then(() => undefined, () => undefined);
    return next;
  };
  const checked = <T>(fn: (value?: unknown) => Promise<T> | T) => async (event: Electron.IpcMainInvokeEvent, value?: unknown) => {
    if (!validSender(event, wc, rendererUrl)) throw new Error('Unauthorized renderer');
    return fn(value);
  };
  ipcMain.handle(CHANNELS.state, checked(() => handlers.state()));
  ipcMain.handle(CHANNELS.signIn, checked(value => serial(async () => {
    await meeting?.close();
    return handlers.signIn(value);
  })));
  ipcMain.handle(CHANNELS.action, checked(async value => {
    if (meeting?.blocksPhoneMedia() && value && typeof value === 'object' && 'operation' in value) {
      if (value.operation === 'answer') await meeting.close();
      else if (value.operation === 'dial') throw new Error('Leave the meeting before placing a Phone call');
    }
    return handlers.action(value);
  }));
  ipcMain.handle(CHANNELS.signOut, checked(() => serial(async () => {
    await meeting?.close();
    return handlers.signOut();
  })));
  ipcMain.handle(MEETING_CHANNELS.open, checked(() => meeting!.open()));
  window.on('closed', () => { window = null; });
  await window.loadFile(rendererPath);
}

app.whenReady().then(() => bootstrap()).catch(() => {
  // Startup configuration or integrity failures are fatal; never show remote content.
  app.quit();
});
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  void (async () => {
    try { await meeting?.close(); } catch { /* Local media teardown is bounded. */ }
    try { await helper?.stop(); }
    catch { /* The supervisor already attempts forced termination. */ }
    try { await provider?.signOut(); }
    finally { quitting = true; app.quit(); }
  })();
});
app.on('window-all-closed', () => app.quit());
