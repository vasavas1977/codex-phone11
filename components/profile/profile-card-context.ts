import { createContext, useContext } from "react";

export type ProfileCardTarget = { tenantId: number; userId: number };
export const ProfileCardContext = createContext<((target: ProfileCardTarget) => void) | null>(null);
export const useOpenProfileCard = () => useContext(ProfileCardContext);

export function validProfileCardTarget(tenantId: unknown, userId: unknown): boolean {
  return typeof tenantId === "number" && Number.isSafeInteger(tenantId) && tenantId > 0 &&
    typeof userId === "number" && Number.isSafeInteger(userId) && userId > 0;
}
