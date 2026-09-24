import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { parseRendererAction } from '../../src/call-boundary';
import type { DesktopHelperSupervisor } from '../../src/helper-supervisor';
import type { AuthenticatedDesktopProvider, DesktopAuthenticationError } from '../../src/authenticated-provider';

export const CHANNELS = Object.freeze({ state: 'phone11:state', signIn: 'phone11:sign-in',
  action: 'phone11:action', signOut: 'phone11:sign-out', update: 'phone11:update' });
export type PublicState = { signedIn: boolean; sessionRevision: string | null; generation: string | null;
  tenantId: number | null; extensionNumber: string | null; calling: ReturnType<DesktopHelperSupervisor['snapshot']> };
export type TaggedSnapshot = { sessionRevision: string; generation: string;
  snapshot: ReturnType<DesktopHelperSupervisor['snapshot']> };
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
                               getGeneration: () => string | null, setGeneration: (value: string | null) => void) {
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
  return {
    state,
    signOut,
    signIn: async (input: unknown) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid sign-in request');
      const { email, password } = input as Record<string, unknown>;
      if (typeof email !== 'string' || typeof password !== 'string') throw new Error('Invalid sign-in request');
      await signOut();
      try {
        await provider.signIn(email, password);
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
      try { setGeneration(await helper.start()); return state(); }
      catch {
        try { await signOut(); } catch { /* Never restore an unverified calling helper. */ }
        throw new Error('PHONE11_CALLING_UNAVAILABLE');
      }
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
  };
}
