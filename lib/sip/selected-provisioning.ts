import { getAuthSnapshot, type User } from "@/lib/_core/auth";
import { createTRPCClient } from "@/lib/trpc";
import type { PhoneProvisioningConfig } from "./provisioning";
import { selectedSipTenant } from "./tenant-selection";
import type { SipAccount } from "./account-store";

export function mayAutoProvisionSipAccount(account: SipAccount | null, ownerId: number, tenantId: number): boolean {
  return account === null || (account.ownerUserId === ownerId && account.tenantId === tenantId);
}

export function assertProvisioningScope(owner: User, tenantId: number, config?: PhoneProvisioningConfig): void {
  if (getAuthSnapshot().user !== owner || getAuthSnapshot().loading) {
    throw new Error("Your sign-in changed. Please sync your phone account again.");
  }
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new Error("Select a Phone11 workspace before syncing.");
  }
  const currentChoice = selectedSipTenant(owner.id);
  if (currentChoice !== null && currentChoice !== tenantId) {
    throw new Error("Your Phone11 workspace changed. Please sync again.");
  }
  if (config && config.configured && (config.tenantId !== tenantId || config.organization?.id !== tenantId)) {
    throw new Error("The server returned a phone account for a different workspace.");
  }
}

/** Fresh requests avoid applying a previous sign-in's cached SIP credential. */
export async function fetchSelectedPhoneConfig(owner: User, tenantId: number): Promise<PhoneProvisioningConfig> {
  assertProvisioningScope(owner, tenantId);
  const result = await createTRPCClient().phone.getConfig.query({ tenantId });
  assertProvisioningScope(owner, tenantId, result);
  return result;
}

export async function fetchSelectedPilotConfig(owner: User, tenantId: number): Promise<PhoneProvisioningConfig> {
  assertProvisioningScope(owner, tenantId);
  const result = await createTRPCClient().phone.ensurePilotConfig.mutate({ tenantId });
  assertProvisioningScope(owner, tenantId, result);
  return result;
}
