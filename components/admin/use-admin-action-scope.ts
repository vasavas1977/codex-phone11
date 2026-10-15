import { useLayoutEffect, useRef } from "react";
import { usePbxAdminWorkspace } from "@/hooks/use-pbx-admin";
import { addAuthChangeListener, getAuthSnapshot } from "@/lib/_core/auth";
import { trpc } from "@/lib/trpc";

/** Retires retained handlers and reserves one write before a mutation rerender. */
export function useAdminActionScope(tenantId: number, ready: boolean) {
  const workspace = usePbxAdminWorkspace();
  const utils = trpc.useUtils();
  const owner = getAuthSnapshot().user;
  const role = workspace.manageableMemberships.find(
    (row) => row.tenantId === tenantId,
  )?.role;
  const live = useRef({ workspace, utils, tenantId, ready });
  live.current = { workspace, utils, tenantId, ready };
  const mounted = useRef(false);
  const scope = useRef({ owner, tenantId, role, admission: workspace.admissionScope, active: true });
  if (
    scope.current.owner !== owner || scope.current.tenantId !== tenantId ||
    scope.current.role !== role || scope.current.admission !== workspace.admissionScope ||
    !scope.current.active
  ) {
    scope.current.active = false;
    scope.current = { owner, tenantId, role, admission: workspace.admissionScope, active: true };
  }
  const captured = scope.current;
  const pending = useRef<object | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    // Development effect replay has no user-action interval between lifetimes.
    scope.current.active = true;
    const unsubscribe = addAuthChangeListener(() => {
      const latest = getAuthSnapshot();
      if (latest.loading || latest.user !== scope.current.owner) scope.current.active = false;
    });
    return () => {
      mounted.current = false;
      scope.current.active = false;
      unsubscribe();
    };
  }, []);
  const current = () => {
    const auth = getAuthSnapshot();
    const view = live.current;
    const member = view.utils.pbx.tenant.memberships.getData()?.find(
      (row) => row.userId === auth.user?.id && row.tenantId === captured.tenantId,
    );
    return mounted.current && captured.active && scope.current === captured &&
      !auth.loading && auth.user !== null && auth.user === captured.owner &&
      captured.tenantId > 0 && view.tenantId === captured.tenantId &&
      view.workspace.isAdmitted && view.workspace.selectedTenantId === captured.tenantId &&
      view.workspace.admissionScope === captured.admission &&
      view.workspace.membershipsQuery.isSuccess && !view.workspace.membershipsQuery.isError &&
      member?.tenantStatus === "active" &&
      (member.role === "owner" || member.role === "admin") && member.role === captured.role;
  };
  const reserve = () => {
    if (pending.current || !live.current.ready || !current()) return null;
    const reservation = {};
    pending.current = reservation;
    return {
      current: () => pending.current === reservation && current(),
      finish: () => { if (pending.current === reservation) pending.current = null; },
    };
  };
  return {
    reserve, current, utils, busy: () => pending.current !== null,
    canRefreshImplicitStats: () => current() && live.current.workspace.canUseImplicitTenant,
  };
}
