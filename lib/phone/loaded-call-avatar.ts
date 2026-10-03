import type { ChatPerson, ChatWorkspace } from "@/lib/chat/types";
import type { SipAccount } from "@/lib/sip/account-store";
import { resolveRecentCallAvatar, type RecentCallAvatar } from "./recent-call-avatar";
import type { DeviceContact } from "./device-contacts";

/** Only an already-loaded directory for this signed-in SIP tenant may label a caller. */
export function resolveLoadedCallAvatar(
  number: string,
  deviceContacts: DeviceContact[],
  ownerId: number | undefined,
  account: SipAccount | null,
  chat: { userId: number | null; workspace: ChatWorkspace | null; people: ChatPerson[] },
): RecentCallAvatar | undefined {
  const tenantId = account?.enabled && account.ownerUserId === ownerId &&
    Number.isSafeInteger(account.tenantId) && (account.tenantId ?? 0) > 0 &&
    chat.userId === ownerId && chat.workspace?.id === account.tenantId
    ? account.tenantId
    : undefined;
  return resolveRecentCallAvatar(number, deviceContacts, tenantId ? chat.people : [], tenantId);
}
