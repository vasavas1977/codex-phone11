import { useEffect } from "react";

import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { useSipAccountStore } from "./account-store";
import { sipAccountFromPhoneConfig } from "./provisioning";

export function PhoneProvisioner() {
  const { isAuthenticated, loading } = useAuth();
  const account = useSipAccountStore((s) => s.account);
  const setAccount = useSipAccountStore((s) => s.setAccount);

  const configQuery = trpc.phone.getConfig.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!configQuery.data?.configured || !configQuery.data.sip) return;

    const nextAccount = sipAccountFromPhoneConfig(configQuery.data, account?.id);
    const unchanged =
      account?.username === nextAccount.username &&
      account?.domain === nextAccount.domain &&
      account?.port === nextAccount.port &&
      account?.transport === nextAccount.transport &&
      account?.password === nextAccount.password;

    if (unchanged) return;

    // Keep root startup safe: provisioning may refresh while the app is launching,
    // but the native SIP stack should only start from an explicit sync/call path.
    setAccount(nextAccount).catch((error) =>
      console.error("[PhoneProvisioner] Failed to store SIP config:", error),
    );
  }, [account, configQuery.data, setAccount]);

  return null;
}
