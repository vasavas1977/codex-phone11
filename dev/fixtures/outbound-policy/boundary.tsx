/** Exact fixture alias boundary. None of the application's API/auth modules load. */
import { useSyncExternalStore } from "react";
import { createFixtureModel } from "./model.mjs";
export const fixture = createFixtureModel();
export const useFixture = () => useSyncExternalStore(fixture.subscribe, fixture.snapshot, fixture.snapshot);
export function useAuth(_options?: unknown) { const s = useFixture(); return { user: s.user, loading: false }; }
export function getAuthSnapshot() { return { user: fixture.snapshot().user, loading: false }; }
export const addAuthChangeListener = fixture.subscribeAuth;
export function usePbxAdminWorkspace() {
  const s = useFixture();
  return { selectedTenantId: s.tenantId, admissionScope: s.revoked ? null : s.scopeKey,
    isAdmitted: !s.revoked, capabilitiesQuery: { data: { explicitFraudControls: s.supported } } };
}
export function useFraudControls() {
  const s = useFixture();
  return { ...s.query, authIdentity: s.authIdentity, refetch: fixture.load };
}
export function useUpdateFraudControls() { const s = useFixture(); return { isPending: s.mutationPending, mutateAsync: fixture.mutate }; }
export const useColors = () => ({ surface: '#ffffff', border: '#d4d8df', foreground: '#17212e',
  muted: '#48576a', primary: '#075fb3', error: '#a51d25', success: '#126833', background: '#f4f6f9' });
