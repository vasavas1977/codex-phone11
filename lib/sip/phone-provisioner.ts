import { useEffect } from "react";

import { useAuth } from "@/hooks/use-auth";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { useSipAccountStore } from "./account-store";
import { hasOngoingSipCall, useSipCallStore } from "./call-store";
import { sipAccountFromPhoneConfig } from "./provisioning";
import { fetchSelectedPhoneConfig, assertProvisioningScope, mayAutoProvisionSipAccount } from "./selected-provisioning";
import { useSipTenantSelection } from "./tenant-selection";

export function PhoneProvisioner() {
  const { user, isAuthenticated, loading } = useAuth();
  const account = useSipAccountStore((s) => s.account);
  const setAccount = useSipAccountStore((s) => s.setAccount);
  const callInProgress = useSipCallStore(hasOngoingSipCall);
  const workspace = useSipTenantSelection(user?.id);

  useEffect(() => {
    const tenantId = workspace.tenantId;
    if (!user || !isAuthenticated || loading || !workspace.ready || tenantId === null || callInProgress) return;
    // A workspace picker changes the intended scope, never the registered SIP
    // identity. Replacing another tenant's account requires an explicit sync.
    if (!mayAutoProvisionSipAccount(account, user.id, tenantId)) return;
    let cancelled = false;
    void fetchSelectedPhoneConfig(user, tenantId).then(async config => {
      if (cancelled || callInProgress || hasOngoingSipCall() || !config.configured || !config.sip || getAuthSnapshot().user !== user) return;
      assertProvisioningScope(user, tenantId, config);
      const current = useSipAccountStore.getState().account;
      if (!mayAutoProvisionSipAccount(current, user.id, tenantId)) return;
      const nextAccount = { ...sipAccountFromPhoneConfig(config, current?.id), ownerUserId: user.id };
      if (current &&
        current.username === nextAccount.username && current.domain === nextAccount.domain &&
        current.port === nextAccount.port && current.transport === nextAccount.transport &&
        current.password === nextAccount.password && current.displayName === nextAccount.displayName &&
        current.proxy === nextAccount.proxy && current.srtp === nextAccount.srtp &&
        current.stun === nextAccount.stun && current.enabled === nextAccount.enabled) return;
      if (cancelled || hasOngoingSipCall()) return;
      await setAccount(nextAccount);
    }).catch(() => console.warn("[PhoneProvisioner] Could not verify selected phone account"));
    return () => { cancelled = true; };
  }, [account, callInProgress, isAuthenticated, loading, setAccount, user, workspace.ready, workspace.tenantId]);

  return null;
}
