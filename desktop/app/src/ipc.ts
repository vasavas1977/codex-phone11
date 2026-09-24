import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { parseRendererAction } from '../../src/call-boundary';
import type { DesktopHelperSupervisor } from '../../src/helper-supervisor';
import type { AuthenticatedDesktopProvider } from '../../src/authenticated-provider';

export const CHANNELS = Object.freeze({ state: 'phone11:state', signIn: 'phone11:sign-in',
  action: 'phone11:action', signOut: 'phone11:sign-out', update: 'phone11:update' });
export type PublicState = { signedIn: boolean; sessionRevision: string | null; generation: string | null;
  tenantId: number | null; extensionNumber: string | null; calling: ReturnType<DesktopHelperSupervisor['snapshot']> };
export type TaggedSnapshot = { sessionRevision: string; generation: string;
  snapshot: ReturnType<DesktopHelperSupervisor['snapshot']> };
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
        setGeneration(await helper.start());
        return state();
      } catch {
        await signOut();
        throw new Error('Sign-in or calling setup unavailable');
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
