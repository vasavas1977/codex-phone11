import { DeviceContactAvatar } from "@/components/device-contacts-list";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { useChatStore } from "@/lib/chat/store";
import type { DeviceContact } from "@/lib/phone/device-contacts";
import { resolveLoadedCallAvatar } from "@/lib/phone/loaded-call-avatar";
import { useSipAccountStore } from "@/lib/sip/account-store";

/** Purely presentational during ringing: uses memory already loaded by Contacts/Team Chat. */
export function CallPersonAvatar({
  number,
  name,
  size,
  deviceContacts = [],
}: {
  number: string;
  name: string;
  size: number;
  deviceContacts?: DeviceContact[];
}) {
  const account = useSipAccountStore((state) => state.account);
  const chatUserId = useChatStore((state) => state.userId);
  const workspace = useChatStore((state) => state.workspace);
  const people = useChatStore((state) => state.people);
  const avatar = resolveLoadedCallAvatar(
    number,
    deviceContacts,
    getAuthSnapshot().user?.id,
    account,
    { userId: chatUserId, workspace, people },
  );
  if (avatar?.kind === "device")
    return <DeviceContactAvatar name={name} imageUri={avatar.imageUri} size={size} />;
  if (avatar?.kind === "team")
    return <ProfileAvatar name={name} photoUrl={avatar.person.photoUrl} tenantId={avatar.tenantId} userId={avatar.person.id} size={size} />;
  return <ProfileAvatar name={name} size={size} />;
}
