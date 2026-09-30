import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AuthenticatedDesktopProvider, DesktopMeetingGrant, DesktopMeetingDirectCursor } from '../../src/authenticated-provider';
import type { DesktopHelperSupervisor } from '../../src/helper-supervisor';
import { appendDirectMeetingPage, MEETING_CHANNELS, type PublicMeetingState } from './meeting-channels';
import { permitMeetingMedia, permitMeetingSpeakerSelection, phoneMediaBusy, validMeetingFrame } from './meeting-boundary';

const meetingPath = join(__dirname, 'meeting.html');
const meetingUrl = pathToFileURL(meetingPath).href;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Main-process owner of a single local media window. Only its isolated preload sees a grant. */
export class DesktopMeetingWindow {
  private win: BrowserWindow | null = null;
  private revision: string | null = null;
  private admitted = new Set<string>();
  private channels = new Set<string>();
  private directChats = new Map<string, number>();
  private directSearchGeneration = 0;
  private directSearchTerm = '';
  private directCursor: DesktopMeetingDirectCursor | null = null;
  private directHasMore = false;
  private directSearchPending = false;
  private directPagePending = false;
  private closing: Promise<void> | null = null;
  private joined = false;
  private starting = false;
  private startedChannel = false;
  private startRequest: { key: string; requestId: string } | null = null;
  private acceptingClose = false;

  constructor(private readonly provider: AuthenticatedDesktopProvider,
    private readonly helper: DesktopHelperSupervisor,
    private readonly parent: () => BrowserWindow | null) {}

  private current(): boolean {
    return !!this.revision && this.provider.currentSession()?.revision === this.revision;
  }

  private phoneBusy(): boolean {
    return phoneMediaBusy(this.helper.snapshot());
  }

  /** Used by the existing phone action bridge to keep one media owner. */
  blocksPhoneMedia(): boolean { return !!this.win && !this.win.isDestroyed(); }

  async open(): Promise<void> {
    if (this.closing) await this.closing;
    const session = this.provider.currentSession();
    if (!session || this.phoneBusy()) throw new Error('Meeting unavailable during a Phone call');
    if (this.win && !this.win.isDestroyed()) { this.win.show(); this.win.focus(); return; }
    this.revision = session.revision;
    this.admitted.clear();
    this.channels.clear();
    this.directChats.clear();
    this.directSearchGeneration++;
    this.directSearchTerm = '';
    this.directCursor = null;
    this.directHasMore = false;
    this.directSearchPending = false;
    this.directPagePending = false;
    this.joined = false;
    this.starting = false;
    this.startedChannel = false;
    this.startRequest = null;
    this.acceptingClose = false;
    const win = new BrowserWindow({ parent: this.parent() ?? undefined, width: 980, height: 760,
      minWidth: 480, minHeight: 560, show: false, title: 'Phone11 meeting', backgroundColor: '#101827',
      webPreferences: { preload: join(__dirname, 'meeting-preload.cjs'), partition: 'phone11-meeting',
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false } });
    this.win = win;
    const wc = win.webContents;
    const exactFrame = (sender: Electron.WebContents | null) => validMeetingFrame({
      sender, senderFrame: sender?.mainFrame, owner: wc, frameUrl: sender?.mainFrame?.url,
      localUrl: meetingUrl, expectedRevision: this.revision,
      currentRevision: this.provider.currentSession()?.revision ?? null, closing: !!this.closing });
    win.webContents.session.setPermissionRequestHandler((sender, permission, callback, details) => {
      const types = 'mediaTypes' in details ? details.mediaTypes : undefined;
      const allowedFrame = exactFrame(sender) && details.requestingUrl === meetingUrl;
      callback(permitMeetingMedia(permission, Array.isArray(types) ? types : undefined,
        allowedFrame, this.phoneBusy()) ||
        permitMeetingSpeakerSelection(permission, allowedFrame, this.phoneBusy()));
    });
    win.webContents.session.setPermissionCheckHandler((sender, permission) =>
      permitMeetingMedia(permission, ['audio', 'video'], exactFrame(sender), this.phoneBusy()) ||
      permitMeetingSpeakerSelection(permission, exactFrame(sender), this.phoneBusy()));
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', event => event.preventDefault());
    wc.on('will-redirect', event => event.preventDefault());
    wc.on('will-attach-webview', event => event.preventDefault());
    win.on('close', event => {
      if (this.acceptingClose) return;
      event.preventDefault();
      void this.close();
    });
    win.on('closed', () => {
      if (this.win === win) { this.win = null; this.revision = null; this.admitted.clear(); this.channels.clear(); this.joined = false; }
    });
    try { await win.loadFile(meetingPath); if (this.win === win && this.current()) win.show(); }
    catch { await this.close(); throw new Error('Meeting window unavailable'); }
  }

  private valid(event: IpcMainInvokeEvent): boolean {
    const win = this.win;
    return !!win && !win.isDestroyed() && validMeetingFrame({
      sender: event.sender, senderFrame: event.senderFrame, owner: win.webContents,
      frameUrl: event.senderFrame?.url, localUrl: meetingUrl,
      expectedRevision: this.revision, currentRevision: this.provider.currentSession()?.revision ?? null,
      closing: !!this.closing });
  }

  registerIpc(): void {
    ipcMain.handle(MEETING_CHANNELS.state, async event => {
      if (!this.valid(event) || !this.revision) throw new Error('Meeting session changed');
      const revision = this.revision;
      const [meetings, channels, directChats] = await Promise.all([
        this.provider.availableMeetings(revision), this.provider.meetingChannels(revision),
        this.provider.meetingDirectChats(revision).catch(() => []),
      ]);
      if (!this.valid(event) || this.revision !== revision) throw new Error('Meeting session changed');
      this.admitted = new Set(meetings.map(({ meetingId }) => meetingId));
      this.channels = new Set(channels.map(({ id }) => id));
      this.directChats = new Map(directChats.map(({ id, peerId }) => [id, peerId]));
      this.directSearchTerm = '';
      this.directCursor = directChats.length
        ? { peerId: directChats[directChats.length - 1].peerId, id: directChats[directChats.length - 1].id } : null;
      this.directHasMore = directChats.length === 50;
      return { revision, meetings, channels, directChats,
        directHasMore: this.directHasMore } satisfies PublicMeetingState;
    });
    ipcMain.handle(MEETING_CHANNELS.directSearch, async (event, input: unknown) => {
      if (!this.valid(event) || !this.revision || this.phoneBusy() || this.joined || this.starting || this.startedChannel ||
          !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Meeting unavailable');
      const { search, revision } = input as Record<string, unknown>;
      if (revision !== this.revision || typeof search !== 'string' || search !== search.trim() ||
          (search.length > 0 && search.length < 2) || search.length > 100 ||
          /[\u0000-\u001f\u007f-\u009f]/u.test(search)) throw new Error('Meeting unavailable');
      const expected = this.revision;
      const generation = ++this.directSearchGeneration;
      this.directSearchPending = true;
      try {
        const directChats = await this.provider.meetingDirectChats(expected, search);
        if (!this.valid(event) || this.revision !== expected || this.phoneBusy() ||
            generation !== this.directSearchGeneration) throw new Error('Meeting session changed');
        this.directChats = new Map(directChats.map(({ id, peerId }) => [id, peerId]));
        this.directSearchTerm = search;
        this.directCursor = directChats.length
          ? { peerId: directChats[directChats.length - 1].peerId, id: directChats[directChats.length - 1].id } : null;
        this.directHasMore = directChats.length === 50;
        return { chats: directChats, hasMore: this.directHasMore };
      } finally {
        if (generation === this.directSearchGeneration) this.directSearchPending = false;
      }
    });
    ipcMain.handle(MEETING_CHANNELS.directMore, async (event, input: unknown) => {
      if (!this.valid(event) || !this.revision || this.phoneBusy() || this.joined || this.starting || this.startedChannel ||
          this.directSearchPending || this.directPagePending || !this.directHasMore || !this.directCursor ||
          !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Meeting unavailable');
      const { search, revision } = input as Record<string, unknown>;
      if (revision !== this.revision || search !== this.directSearchTerm) throw new Error('Meeting unavailable');
      const expected = this.revision;
      const generation = this.directSearchGeneration;
      const cursor = this.directCursor;
      this.directPagePending = true;
      try {
        const page = await this.provider.meetingDirectChats(expected, this.directSearchTerm, cursor);
        if (!this.valid(event) || this.revision !== expected || this.phoneBusy() ||
            generation !== this.directSearchGeneration) throw new Error('Meeting session changed');
        const { choices, added } = appendDirectMeetingPage(this.directChats, page);
        this.directChats = choices;
        if (page.length) this.directCursor = { peerId: page[page.length - 1].peerId,
          id: page[page.length - 1].id };
        this.directHasMore = page.length === 50;
        return { chats: added, hasMore: this.directHasMore };
      } finally { this.directPagePending = false; }
    });
    ipcMain.handle(MEETING_CHANNELS.channelDetails, async (event, input: unknown) => {
      if (!this.valid(event) || !this.revision || this.phoneBusy() || this.joined || this.starting || this.startedChannel ||
          !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Meeting unavailable');
      const { channelId, revision } = input as Record<string, unknown>;
      if (typeof channelId !== 'string' || !uuid.test(channelId) ||
          revision !== this.revision || !this.channels.has(channelId)) throw new Error('Meeting unavailable');
      const expected = this.revision;
      const details = await this.provider.meetingChannelDetails(expected, channelId);
      if (!this.valid(event) || this.revision !== expected || this.phoneBusy())
        throw new Error('Meeting session changed');
      return details;
    });
    ipcMain.handle(MEETING_CHANNELS.startChannel, async (event, input: unknown) => {
      if (!this.valid(event) || !this.revision || this.phoneBusy() || this.joined || this.starting || this.startedChannel ||
          !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Meeting unavailable');
      const { channelId, selectedMemberIds, revision } = input as Record<string, unknown>;
      if (typeof channelId !== 'string' || !uuid.test(channelId) || revision !== this.revision ||
          !this.channels.has(channelId) || !Array.isArray(selectedMemberIds) ||
          selectedMemberIds.length > 50 || selectedMemberIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
          new Set(selectedMemberIds).size !== selectedMemberIds.length) throw new Error('Meeting unavailable');
      const expected = this.revision;
      this.starting = true;
      try {
        const key = JSON.stringify([channelId, [...selectedMemberIds].sort((a, b) => a - b)]);
        if (this.startRequest?.key !== key) this.startRequest = { key, requestId: randomUUID() };
        const meetingId = await this.provider.startChannelMeeting(expected, channelId, selectedMemberIds, this.startRequest.requestId);
        if (!this.valid(event) || this.revision !== expected || this.phoneBusy())
          throw new Error('Meeting session changed');
        this.admitted.add(meetingId);
        this.startedChannel = true;
        return { meetingId };
      } finally { this.starting = false; }
    });
    ipcMain.handle(MEETING_CHANNELS.directDetails, async (event, input: unknown) => {
      if (!this.valid(event) || !this.revision || this.phoneBusy() || this.joined || this.starting || this.startedChannel ||
          this.directSearchPending ||
          !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Meeting unavailable');
      const { conversationId, revision } = input as Record<string, unknown>;
      if (typeof conversationId !== 'string' || !uuid.test(conversationId) ||
          revision !== this.revision || !this.directChats.has(conversationId)) throw new Error('Meeting unavailable');
      const expected = this.revision;
      const peerId = this.directChats.get(conversationId)!;
      const details = await this.provider.meetingDirectDetails(expected, conversationId, peerId);
      if (!this.valid(event) || this.revision !== expected || this.phoneBusy() ||
          this.directChats.get(conversationId) !== details.peerId) throw new Error('Meeting session changed');
      return details;
    });
    ipcMain.handle(MEETING_CHANNELS.startDirect, async (event, input: unknown) => {
      if (!this.valid(event) || !this.revision || this.phoneBusy() || this.joined || this.starting || this.startedChannel ||
          this.directSearchPending ||
          !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Meeting unavailable');
      const { conversationId, revision } = input as Record<string, unknown>;
      if (typeof conversationId !== 'string' || !uuid.test(conversationId) ||
          revision !== this.revision || !this.directChats.has(conversationId)) throw new Error('Meeting unavailable');
      const expected = this.revision;
      const peerId = this.directChats.get(conversationId)!;
      this.starting = true;
      try {
        const key = JSON.stringify(['direct', conversationId, peerId]);
        if (this.startRequest?.key !== key) this.startRequest = { key, requestId: randomUUID() };
        const meetingId = await this.provider.startDirectMeeting(expected, conversationId, peerId, this.startRequest.requestId);
        if (!this.valid(event) || this.revision !== expected || this.phoneBusy())
          throw new Error('Meeting session changed');
        this.admitted.add(meetingId);
        this.startedChannel = true;
        return { meetingId };
      } finally { this.starting = false; }
    });
    ipcMain.handle(MEETING_CHANNELS.join, async (event, input: unknown): Promise<DesktopMeetingGrant> => {
      if (!this.valid(event) || !this.revision || this.phoneBusy() || this.joined || this.starting ||
          !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Meeting unavailable');
      const { meetingId, revision } = input as Record<string, unknown>;
      if (typeof meetingId !== 'string' || !uuid.test(meetingId) ||
          revision !== this.revision || !this.admitted.has(meetingId)) throw new Error('Meeting unavailable');
      const expected = this.revision;
      // Prevent a double-click from minting two grants or joining twice.
      this.joined = true;
      try {
        const admission = await this.provider.joinMeeting(expected, meetingId);
        if (!this.valid(event) || this.revision !== expected || this.phoneBusy())
          throw new Error('Meeting session changed');
        return admission;
      } catch {
        this.joined = false;
        throw new Error('Meeting unavailable');
      }
    });
    ipcMain.handle(MEETING_CHANNELS.joinFailed, event => {
      if (!this.valid(event)) throw new Error('Meeting session changed');
      this.joined = false;
    });
    ipcMain.handle(MEETING_CHANNELS.finished, async event => {
      if (!this.valid(event)) throw new Error('Meeting session changed');
      await this.close();
    });
    ipcMain.on(MEETING_CHANNELS.left, event => {
      if (this.win && !this.win.isDestroyed() && event.sender === this.win.webContents &&
          event.senderFrame === this.win.webContents.mainFrame && event.senderFrame?.url === meetingUrl)
        this.leftAck?.();
    });
  }

  private leftAck: (() => void) | null = null;
  async close(): Promise<void> {
    if (this.closing) return this.closing;
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    this.closing = (async () => {
      this.admitted.clear();
      this.channels.clear();
      this.directChats.clear();
      this.directSearchGeneration++;
      this.directSearchTerm = '';
      this.directCursor = null;
      this.directHasMore = false;
      this.directSearchPending = false;
      this.directPagePending = false;
      this.joined = false;
      this.starting = false;
      this.startedChannel = false;
      this.startRequest = null;
      // Ask the trusted preload to disconnect tracks first; bound the wait so sign-out never hangs.
      await new Promise<void>(resolve => {
        let done = false;
        const finish = () => { if (!done) { done = true; clearTimeout(timer); this.leftAck = null; resolve(); } };
        const timer = setTimeout(finish, 2000);
        this.leftAck = finish;
        if (win.isDestroyed() || win.webContents.isDestroyed()) finish();
        else win.webContents.send(MEETING_CHANNELS.leaveNow);
      });
      this.acceptingClose = true;
      if (!win.isDestroyed()) win.destroy();
      this.win = null;
      this.revision = null;
    })().finally(() => { this.closing = null; this.acceptingClose = false; });
    return this.closing;
  }

  /** An incoming/ringing/connected SIP call has priority over meeting media. */
  onPhoneSnapshot(): void { if (this.phoneBusy()) void this.close(); }
}
