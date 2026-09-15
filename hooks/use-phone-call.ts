import { useRef, useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { useSip } from "@/lib/sip/sip-provider";
import { useSipAccountStore } from "@/lib/sip/account-store";
import { useSipCallStore } from "@/lib/sip/call-store";
import { resolveCurrentCall } from "@/lib/sip/current-call";
import { getAuthSnapshot } from "@/lib/_core/auth";

/** Every call entry point must create a real session before opening controls. */
export function usePhoneCall() {
  const { user } = useAuth({ autoFetch: false });
  const { makeCall } = useSip();
  const busy = useRef(false);
  const [calling, setCalling] = useState(false);

  const placeCall = async (number: string) => {
    const target = number.trim();
    if (!target || busy.current) return;
    if (!user || getAuthSnapshot().user?.id !== user.id) { router.push("/auth/sign-in"); return; }
    const { account, registrationState } = useSipAccountStore.getState();
    if (!account?.enabled || account.ownerUserId !== user.id) {
      Alert.alert("Set up your work phone", "Your account needs an assigned extension before you can call.", [
        { text: "Cancel", style: "cancel" },
        { text: "Open account", onPress: () => router.push("/settings/sip") },
      ]);
      return;
    }
    const current = resolveCurrentCall(useSipCallStore.getState());
    if (current) {
      router.push({ pathname: current.status === "incoming" ? "/call/incoming" : "/call/active", params: { callId: current.id } });
      return;
    }
    if (registrationState !== "registered") {
      Alert.alert("Phone is connecting", "Wait until your phone shows Ready to call. If it stays offline, use Reconnect on the phone screen.");
      return;
    }
    busy.current = true;
    setCalling(true);
    const stillCurrent = () => getAuthSnapshot().user?.id === user.id && useSipAccountStore.getState().account === account;
    try {
      const id = await makeCall(target, false);
      if (!stillCurrent()) return;
      if (!id) {
        Alert.alert("Call could not start", "The call ended before it connected. Please try again.");
        return;
      }
      router.push({ pathname: "/call/active", params: { callId: id, number: target, type: "voice" } });
    } catch {
      if (!stillCurrent()) return;
      Alert.alert("Call could not start", "Check your connection and try again. Your call history will show calls that actually started.");
    } finally {
      busy.current = false;
      setCalling(false);
    }
  };
  return { placeCall, calling };
}
