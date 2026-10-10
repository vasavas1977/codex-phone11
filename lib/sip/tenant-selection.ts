import { useSyncExternalStore } from "react";
import { trpc } from "@/lib/trpc";
import { addAuthChangeListener, getAuthSnapshot } from "@/lib/_core/auth";

export type SipMembership = { userId: number; tenantId: number; tenantName: string };
type Choice = { ownerId: number | null; tenantId: number | null };
let choice: Choice = { ownerId: null, tenantId: null };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => choice;

export function selectSipTenant(ownerId: number, tenantId: number | null): void {
  if (getAuthSnapshot().user?.id !== ownerId) return;
  if (choice.ownerId === ownerId && choice.tenantId === tenantId) return;
  choice = { ownerId, tenantId };
  listeners.forEach(listener => listener());
}

addAuthChangeListener(() => {
  const ownerId = getAuthSnapshot().user?.id ?? null;
  if (choice.ownerId !== ownerId) {
    choice = { ownerId, tenantId: null };
    listeners.forEach(listener => listener());
  }
});

export function resolveSipTenant(ownerId: number, memberships: SipMembership[], selectedTenantId: number | null): number | null {
  const active = memberships.filter(row => row.userId === ownerId && Number.isSafeInteger(row.tenantId) && row.tenantId > 0);
  const unique = [...new Set(active.map(row => row.tenantId))];
  if (selectedTenantId !== null && !unique.includes(selectedTenantId)) return null;
  if (unique.length === 1) return unique[0];
  return selectedTenantId !== null && unique.includes(selectedTenantId) ? selectedTenantId : null;
}

export function selectedSipTenant(ownerId: number): number | null {
  return choice.ownerId === ownerId ? choice.tenantId : null;
}

/** Memberships are owner-filtered and withheld while a refetch could expose stale cache data. */
export function useSipTenantSelection(ownerId: number | null | undefined) {
  const selection = useSyncExternalStore(subscribe, snapshot, snapshot);
  const query = trpc.pbx.tenant.memberships.useQuery(undefined, {
    enabled: !!ownerId,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const ready = !!ownerId && query.isSuccess && !query.isFetching;
  const memberships = ready
    ? (query.data ?? []).filter(row => row.userId === ownerId && Number.isSafeInteger(row.tenantId) && row.tenantId > 0)
    : [];
  const explicit = selection.ownerId === ownerId ? selection.tenantId : null;
  const tenantId = ready ? resolveSipTenant(ownerId!, memberships, explicit) : null;
  const chooseTenant = (nextTenantId: number) => {
    if (ready && memberships.some(row => row.tenantId === nextTenantId)) selectSipTenant(ownerId!, nextTenantId);
  };
  return { memberships, tenantId, ready, loading: query.isLoading || query.isFetching,
    error: query.error, needsSelection: ready && memberships.length > 0 && tenantId === null,
    chooseTenant, refetch: query.refetch };
}
