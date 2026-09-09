import { useEffect } from "react";

import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { useSipAccountStore } from "./account-store";
import { sipAccountFromPhoneConfig } from "./provisioning";

export function PhoneProvisioner() {
  const { user, isAuthenticated, loading } = useAuth();
  const account = useSipAccountStore((s) => s.account);
  const setAccount = useSipAccountStore((s) => s.setAccount);

  const configQuery = trpc.phone.getConfig.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!user || !isAuthenticated || loading || !configQuery.data?.configured || !configQuery.data.sip) return;

    const nextAccount = { ...sipAccountFromPhoneConfig(configQuery.data, account?.id), ownerUserId: user.id };
    const unchanged =
      account?.ownerUserId === user.id &&
      account?.username === nextAccount.username &&
      account?.domain === nextAccount.domain &&
      account?.port === nextAccount.port &&
      account?.transport === nextAccount.transport &&
      account?.password === nextAccount.password;

    if (unchanged) return;

    // Keep root startup safe: provisioning may refresh while the app is launching,
    // but the native SIP stack should only start from an explicit sync/call path.
    setAccount(nextAccount).catch((error) =>
      console.error("[PhoneProvisioner] Could not securely store provisioning"),
    );
  }, [account, configQuery.data, setAccount, user, isAuthenticated, loading]);

  return null;
}
