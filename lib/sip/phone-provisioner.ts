import { useEffect } from "react";

import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { useSipAccountStore } from "./account-store";
import { sipEngine } from "./engine";
import { sipAccountFromPhoneConfig } from "./provisioning";

export function PhoneProvisioner() {
  const { isAuthenticated, loading } = useAuth();
  const account = useSipAccountStore((s) => s.account);
  const registrationState = useSipAccountStore((s) => s.registrationState);
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

    if (unchanged) {
      if (registrationState !== "registered" && registrationState !== "registering") {
        sipEngine.restart().catch((error) => console.error("[PhoneProvisioner] Failed to restart SIP:", error));
      }
      return;
    }

    setAccount(nextAccount)
      .then(() => sipEngine.restart())
      .catch((error) => console.error("[PhoneProvisioner] Failed to apply SIP config:", error));
  }, [account, configQuery.data, registrationState, setAccount]);

  return null;
}
