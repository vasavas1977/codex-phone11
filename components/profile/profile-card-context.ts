import { createContext, useContext } from "react";

export type ProfileCardTarget = {
  tenantId: number;
  userId: number;
  name?: string | null;
  photoUrl?: string | null;
  photoVersion?: string | null;
};
export const ProfileCardContext = createContext<((target: ProfileCardTarget) => void) | null>(null);
export const useOpenProfileCard = () => useContext(ProfileCardContext);

export function validProfileCardTarget(tenantId: unknown, userId: unknown): boolean {
  return typeof tenantId === "number" && Number.isSafeInteger(tenantId) && tenantId > 0 &&
    typeof userId === "number" && Number.isSafeInteger(userId) && userId > 0;
}
