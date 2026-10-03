import type { DirectoryContact } from "@/lib/phone/directory";

const phone11Identity = /^p11-t([1-9]\d*)-u([1-9]\d*)$/;

function coordinates(identity: string): { tenantId: number; userId: number } | null {
  const match = phone11Identity.exec(identity);
  if (!match) return null;
  const tenantId = Number(match[1]);
  const userId = Number(match[2]);
  return Number.isSafeInteger(tenantId) && Number.isSafeInteger(userId)
    ? { tenantId, userId } : null;
}

/** Derive scope only from the server-admitted local LiveKit identity. */
export function meetingAvatarTenant(localIdentity: string | undefined, ownerId: number | undefined): number | undefined {
  const local = localIdentity ? coordinates(localIdentity) : null;
  return local && local.userId === ownerId ? local.tenantId : undefined;
}

/** Never resolve a participant photo from a display name or an unscoped identity. */
export function meetingAvatarPerson(
  identity: string,
  tenantId: number | undefined,
  people: readonly DirectoryContact[],
): DirectoryContact | undefined {
  const participant = coordinates(identity);
  if (!participant || !tenantId || participant.tenantId !== tenantId) return undefined;
  return people.find((person) => person.id === participant.userId);
}
