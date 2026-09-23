import type { DeviceContact } from "./device-contacts";
import type { DirectoryContact } from "./directory";
import { contactPhoneKey } from "./phone-number";

export type RecentCallAvatar =
  | { kind: "device"; imageUri: string }
  | { kind: "team"; person: DirectoryContact; tenantId: number };

/** Require a unique number match; names alone are never enough to select a photo. */
export function resolveRecentCallAvatar(
  number: string,
  deviceContacts: DeviceContact[],
  teamPeople: DirectoryContact[],
  teamTenantId: number | undefined,
): RecentCallAvatar | undefined {
  const key = contactPhoneKey(number);
  if (key) {
    const matches = deviceContacts.filter((person) =>
      person.phones.some((phone) => phone.key === key),
    );
    if (matches.length > 1) return undefined;
    if (matches[0]?.imageUri)
      return { kind: "device", imageUri: matches[0].imageUri };
  }

  const extension = number.trim();
  if (!teamTenantId || !/^\d{1,20}$/.test(extension)) return undefined;
  const matches = teamPeople.filter((person) => person.extension === extension);
  return matches.length === 1 && matches[0].photoUrl
    ? { kind: "team", person: matches[0], tenantId: teamTenantId }
    : undefined;
}
