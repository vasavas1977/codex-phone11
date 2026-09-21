import { useState } from "react";
import { Alert, Pressable } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useDirectory } from "@/hooks/use-directory";
import { usePhoneCall } from "@/hooks/use-phone-call";
import { useSipAccountStore } from "@/lib/sip/account-store";
import { canCallDirectoryContact } from "@/lib/phone/directory";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { useColors } from "@/hooks/use-colors";
import type { ChatPerson } from "@/lib/chat/types";
export function ChatPeerCall({
  peerId,
  tenantId,
  person: suppliedPerson,
  directoryOwner,
  sharedDirectory = false,
}: {
  peerId: number;
  tenantId: number;
  /** A parent can share its protected directory lookup with the compact header. */
  person?: ChatPerson | null;
  directoryOwner?: number | null;
  sharedDirectory?: boolean;
}) {
  const directory = useDirectory(tenantId, !sharedDirectory),
    account = useSipAccountStore((s) => s.account),
    { placeCall } = usePhoneCall(),
    c = useColors();
  const [busy, setBusy] = useState(false);
  const person = sharedDirectory
    ? suppliedPerson
    : directory.people.find((p) => p.id === peerId);
  const owner = sharedDirectory ? directoryOwner : directory.owner;
  if (
    !person ||
    !canCallDirectoryContact(
      person,
      tenantId,
      account,
      owner ?? undefined,
    )
  )
    return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Call ${person.name}`}
      disabled={busy}
      onPress={() => {
        if (busy) return;
        setBusy(true);
        if (
          !canCallDirectoryContact(
            person,
            tenantId,
            useSipAccountStore.getState().account,
            getAuthSnapshot().user?.id,
          )
        ) {
          setBusy(false);
          return;
        }
        void placeCall(person.extension!)
          .catch(() =>
            Alert.alert(
              "Call could not start",
              "Check your phone connection and try again.",
            ),
          )
          .finally(() => setBusy(false));
      }}
      style={{
        minWidth: 44,
        minHeight: 44,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <MaterialIcons name="call" size={24} color={c.primary} />
    </Pressable>
  );
}
