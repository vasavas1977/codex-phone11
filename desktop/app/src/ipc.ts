import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { parseRendererAction } from '../../src/call-boundary';
import type { DesktopHelperSupervisor } from '../../src/helper-supervisor';
import { DesktopCallHistoryError } from '../../src/call-history-error';
import type { AuthenticatedDesktopProvider, DesktopAuthenticationError, DesktopVoicemail, DesktopCallHistory, DesktopCallHistoryCursor, DesktopTenantSelection } from '../../src/authenticated-provider';

export const CHANNELS = Object.freeze({ state: 'phone11:state', signIn: 'phone11:sign-in',
  selectTenant: 'phone11:select-tenant',
  action: 'phone11:action', signOut: 'phone11:sign-out', update: 'phone11:update',
  voicemailList: 'phone11:voicemail-list', historyList: 'phone11:history-list',
  directoryList: 'phone11:directory-list',
  voicemailDelete: 'phone11:voicemail-delete', voicemailAudio: 'phone11:voicemail-audio', voicemailMarkRead: 'phone11:voicemail-mark-read' });
export type PublicState = { signedIn: boolean; sessionRevision: string | null; generation: string | null;
  tenantId: number | null; extensionNumber: string | null; calling: ReturnType<DesktopHelperSupervisor['snapshot']> };
export type TaggedSnapshot = { sessionRevision: string; generation: string;
  snapshot: ReturnType<DesktopHelperSupervisor['snapshot']> };
export type TaggedVoicemail = { sessionRevision: string; items: readonly DesktopVoicemail[] };
export type DirectoryEntry = Readonly<{ id: number; name: string; number: string }>;
export type TaggedDirectory = { sessionRevision: string; tenantId: number;
  items: readonly DirectoryEntry[]; nextOffset: number | null };
// Keep the personal inbox closed until the deployed list, read, and media routes enforce owner authority.
export const VOICEMAIL_ENABLED = false;
function requireVoicemail(): void {
  if (!VOICEMAIL_ENABLED) throw new Error('PHONE11_VOICEMAIL_UNAVAILABLE');
}
export function signInFailureMessage(error: unknown): string {
  const text = String(error);
  if (text.includes('PHONE11_CREDENTIALS_REJECTED')) return 'Email or password was not accepted.';
  if (text.includes('PHONE11_ORIGIN_REJECTED')) return 'Desktop sign-in blocked by Phone11 origin check.';
  if (text.includes('PHONE11_EMAIL_UNVERIFIED')) return 'Verify your Phone11 email before signing in.';
  if (text.includes('PHONE11_AUTH_BLOCKED')) return 'Phone11 blocked this sign-in request. Contact support.';
  if (text.includes('PHONE11_PHONE_ACCESS_UNAVAILABLE'))
    return 'Signed in, but calling access could not be loaded. Check your extension assignment or retry.';
  if (text.includes('PHONE11_CALLING_UNAVAILABLE')) return 'Signed in, but calling could not start on this Mac.';
  return 'Phone11 sign-in is unavailable. Try again.';
}
export function callHistoryFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes('PHONE11_HISTORY_UNAUTHORIZED')) return 'Your session has expired. Sign in again to load call history.';
  if (text.includes('PHONE11_HISTORY_FORBIDDEN')) return 'Your account cannot access call history in this workspace.';
  if (text.includes('PHONE11_HISTORY_ENDPOINT_UNAVAILABLE')) return 'Call history is unavailable in this Desktop version. Update Phone11 or try again later.';
  if (text.includes('PHONE11_HISTORY_SERVER_ERROR')) return 'Call history is temporarily unavailable. Refresh to try again.';
  if (text.includes('PHONE11_HISTORY_SESSION_CHANGED')) return 'Your session changed. Sign in again to load call history.';
  if (text.includes('PHONE11_HISTORY_TENANT_MISMATCH')) return 'Phone11 could not verify the workspace for call history. Sign in again or contact support.';
  if (text.includes('PHONE11_HISTORY_INVALID_RESPONSE')) return 'Call history returned an unexpected response. Refresh to try again.';
  if (text.includes('PHONE11_HISTORY_REQUEST_FAILED')) return 'Phone11 could not reach the call history service. Check your connection and refresh.';
  return 'Call history could not load. Refresh to try again.';
}
export function applyTaggedSnapshot(state: PublicState | null, update: TaggedSnapshot): PublicState | null {
  return state?.signedIn && state.sessionRevision === update.sessionRevision &&
    state.generation === update.generation ? { ...state, calling: update.snapshot } : state;
}
export function validSender(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
                            owner: WebContents, rendererUrl: string): boolean {
  return event.sender === owner && event.senderFrame === owner.mainFrame &&
    event.senderFrame?.url === rendererUrl && !event.sender.isDestroyed();
}
export function createHandlers(provider: AuthenticatedDesktopProvider, helper: DesktopHelperSupervisor,
                               getGeneration: () => string | null, setGeneration: (value: string | null) => void, additionalMediaBlocked: () => boolean = () => false,
                               confirmVoicemailDelete: () => Promise<boolean> = async () => false) {
  const state = (): PublicState => {
    const session = provider.currentSession();
    return { signedIn: !!session, sessionRevision: session?.revision ?? null,
      generation: session ? getGeneration() : null, tenantId: session?.tenantId ?? null,
      extensionNumber: session ? provider.currentExtensionNumber() : null, calling: helper.snapshot() };
  };
  const signOut = async () => {
    setGeneration(null);
    const stopped = await helper.stop();
    await provider.signOut();
    if (!stopped) throw new Error('Calling helper exit could not be verified');
    return state();
  };
  const startCalling = async (cancelled: () => boolean): Promise<PublicState> => {
    try {
      if (cancelled()) throw new Error('PHONE11_ACCOUNT_CANCELLED');
      const nextGeneration = await helper.start();
      if (cancelled()) throw new Error('PHONE11_ACCOUNT_CANCELLED');
      setGeneration(nextGeneration);
      return state();
    }
    catch {
      try { await signOut(); } catch { /* Never restore an unverified calling helper. */ }
      throw new Error('PHONE11_CALLING_UNAVAILABLE');
    }
  };
  const inboxSession = (input: unknown, needsId = false): { revision: string; id: number } => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid inbox request');
    const { sessionRevision, id } = input as Record<string, unknown>;
    if (typeof sessionRevision !== 'string' || provider.currentSession()?.revision !== sessionRevision ||
        (needsId && (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)))
      throw new Error('Invalid inbox request');
    return { revision: sessionRevision, id: id as number };
  };
  const mediaBlocked = (): boolean => {
    const calling = helper.snapshot();
    return !!calling.call || calling.dialState !== 'idle' || calling.callActionState !== 'idle' || additionalMediaBlocked();
  };
  const directorySession = (input: unknown): { revision: string; search: string; offset: number; tenantId: number } => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid directory request');
    const { sessionRevision, search, offset } = input as Record<string, unknown>;
    const session = provider.currentSession();
    if (!session || session.revision !== sessionRevision || typeof search !== 'string' ||
        search.length > 64 || /[\u0000-\u001f\u007f-\u009f]/u.test(search) ||
        typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000)
      throw new Error('Invalid directory request');
    return { revision: session.revision, search: search.trim(), offset, tenantId: session.tenantId };
  };
  const deleting = new Set<string>();
  return {
    state,
    signOut,
    signIn: async (input: unknown, cancelled: () => boolean = () => false) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid sign-in request');
      const { email, password } = input as Record<string, unknown>;
      if (typeof email !== 'string' || typeof password !== 'string') throw new Error('Invalid sign-in request');
      await signOut();
      try {
        const result = await provider.signIn(email, password);
        if (cancelled()) {
          await signOut();
          throw new Error('PHONE11_ACCOUNT_CANCELLED');
        }
        if (result && typeof result === 'object' && 'selectionRevision' in result)
          return result as DesktopTenantSelection;
      } catch (error) {
        try { await signOut(); } catch { /* Never restore an unverified calling helper. */ }
        const authCode = error instanceof Error && error.name === 'DesktopAuthenticationError' &&
          'code' in error ? (error as DesktopAuthenticationError).code : null;
        if (authCode === 'credentials_rejected')
          throw new Error('PHONE11_CREDENTIALS_REJECTED');
        if (authCode === 'origin_rejected') throw new Error('PHONE11_ORIGIN_REJECTED');
        if (authCode === 'email_unverified') throw new Error('PHONE11_EMAIL_UNVERIFIED');
        if (authCode === 'auth_blocked') throw new Error('PHONE11_AUTH_BLOCKED');
        if (authCode === 'phone_access_unavailable')
          throw new Error('PHONE11_PHONE_ACCESS_UNAVAILABLE');
        throw new Error('PHONE11_AUTH_UNAVAILABLE');
      }
      return startCalling(cancelled);
    },
    selectTenant: async (input: unknown, cancelled: () => boolean = () => false): Promise<PublicState> => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid workspace selection');
      const { selectionRevision, tenantId } = input as Record<string, unknown>;
      if (typeof selectionRevision !== 'string' || typeof tenantId !== 'number' ||
          !Number.isSafeInteger(tenantId) || tenantId <= 0)
        throw new Error('Invalid workspace selection');
      try {
        if (cancelled()) throw new Error('PHONE11_ACCOUNT_CANCELLED');
        await provider.selectTenant(selectionRevision, tenantId);
        if (cancelled()) throw new Error('PHONE11_ACCOUNT_CANCELLED');
      }
      catch {
        try { await signOut(); } catch { /* Pending authority is already invalidated. */ }
        throw new Error('PHONE11_PHONE_ACCESS_UNAVAILABLE');
      }
      return startCalling(cancelled);
    },
    action: async (input: unknown) => {
      const action = parseRendererAction(input);
      const session = provider.currentSession();
      if (!session || action.sessionRevision !== session.revision) throw new Error('Calling session changed');
      const generation = getGeneration();
      if (!generation) throw new Error('Calling helper unavailable');
      const snapshot = await helper.handleRendererAction(action);
      return { sessionRevision: session.revision, generation, snapshot } satisfies TaggedSnapshot;
    },
    historyList: async (input: unknown): Promise<{ sessionRevision: string; items: readonly DesktopCallHistory[];
      nextCursor: DesktopCallHistoryCursor | null }> => {
      const { revision } = inboxSession(input);
      const requested = input as Record<string, unknown>;
      let cursor: DesktopCallHistoryCursor | undefined;
      if (requested.cursor !== undefined) {
        const value = requested.cursor;
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            !Number.isSafeInteger((value as DesktopCallHistoryCursor).id) ||
            (value as DesktopCallHistoryCursor).id <= 0 ||
            typeof (value as DesktopCallHistoryCursor).startedAt !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test((value as DesktopCallHistoryCursor).startedAt) ||
            !Number.isFinite(Date.parse((value as DesktopCallHistoryCursor).startedAt)))
          throw new Error('Invalid history cursor');
        cursor = { startedAt: (value as DesktopCallHistoryCursor).startedAt, id: (value as DesktopCallHistoryCursor).id };
      }
      let page: Awaited<ReturnType<AuthenticatedDesktopProvider['listCallHistoryPage']>>;
      try { page = await provider.listCallHistoryPage(revision, cursor); }
      catch (error) {
        if (error instanceof DesktopCallHistoryError)
          throw new Error(`PHONE11_HISTORY_${error.code.toUpperCase()}${error.status ? `_${error.status}` : ''}`);
        throw error;
      }
      if (provider.currentSession()?.revision !== revision) throw new Error('Calling session changed');
      return { sessionRevision: revision, ...page };
    },
    directoryList: async (input: unknown): Promise<TaggedDirectory> => {
      const { revision, search, offset, tenantId } = directorySession(input);
      const page = await provider.listDirectory(revision, search, offset);
      if (provider.currentSession()?.revision !== revision) throw new Error('Calling session changed');
      if (page.tenantId !== tenantId) throw new Error('PHONE11_DIRECTORY_TENANT_MISMATCH');
      return { sessionRevision: revision, ...page };
    },
    voicemailDelete: async (input: unknown) => {
      requireVoicemail();
      const { revision, id } = inboxSession(input, true);
      if (Object.keys(input as object).sort().join(',') !== 'id,sessionRevision') throw new Error('Invalid inbox request');
      const session = provider.currentSession();
      const key = `${revision}:${id}`;
      if (deleting.has(key)) throw new Error('Voicemail deletion already pending');
      deleting.add(key);
      try {
        const confirmed = await confirmVoicemailDelete();
        if (provider.currentSession() !== session) throw new Error('Calling session changed');
        if (confirmed !== true) return { sessionRevision: revision, id, deleted: false };
        await provider.deleteVoicemail(revision, id, true);
        if (provider.currentSession() !== session) throw new Error('Calling session changed');
        return { sessionRevision: revision, id, deleted: true };
      } finally { deleting.delete(key); }
    },
    voicemailAudio: async (input: unknown) => {
      requireVoicemail();
      const { revision, id } = inboxSession(input, true);
      if (mediaBlocked()) throw new Error('Finish your call or meeting before playing voicemail');
      const audio = await provider.voicemailAudio(revision, id);
      if (provider.currentSession()?.revision !== revision || mediaBlocked()) throw new Error('Voicemail playback unavailable');
      return { sessionRevision: revision, ...audio };
    },
    voicemailMarkRead: async (input: unknown) => {
      requireVoicemail();
      const { revision, id } = inboxSession(input, true);
      await provider.markVoicemailRead(revision, id);
      if (provider.currentSession()?.revision !== revision) throw new Error('Calling session changed');
      return { sessionRevision: revision, id };
    },
    voicemailList: async (input: unknown): Promise<TaggedVoicemail> => {
      requireVoicemail();
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          typeof (input as Record<string, unknown>).sessionRevision !== 'string')
        throw new Error('Invalid voicemail request');
      const expectedRevision = (input as { sessionRevision: string }).sessionRevision;
      const session = provider.currentSession();
      if (!session || expectedRevision !== session.revision) throw new Error('Calling session changed');
      const items = await provider.listVoicemail(expectedRevision);
      if (provider.currentSession()?.revision !== expectedRevision)
        throw new Error('Calling session changed');
      return { sessionRevision: expectedRevision, items };
    },
  };
}
