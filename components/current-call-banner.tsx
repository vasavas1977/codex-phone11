import { useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSip } from "@/lib/sip/sip-provider";
import { useSipCallStore, type SipCall } from "@/lib/sip/call-store";
import { resolveCurrentCall } from "@/lib/sip/current-call";
import { getAuthSnapshot } from "@/lib/_core/auth";

type EndAction = { owner: ReturnType<typeof getAuthSnapshot>["user"]; call: SipCall };
function sameCall(first: SipCall, second: SipCall) {
  if (first.id !== second.id) return false;
  // Native IDs can be reused after a call ends. Match this call's durable identity.
  return first.history?.id ? second.history?.id === first.history.id
    : first.startTime ? second.startTime?.getTime() === first.startTime.getTime() : first === second;
}

export function CurrentCallBanner() {
  const call = useSipCallStore(state => resolveCurrentCall(state));
  const path = usePathname();
  const { callId: requestedCallId } = useGlobalSearchParams<{ callId?: string | string[] }>();
  const displayedCall = useSipCallStore(state => resolveCurrentCall(state, requestedCallId));
  const owner = getAuthSnapshot().user;
  const insets = useSafeAreaInsets();
  const { hangupCall } = useSip();
  const [endingAction, setEndingAction] = useState<EndAction | null>(null);
  const pending = useRef<EndAction | null>(null);
  if (!call) return null;
  const belongsToCurrentCall = (action: EndAction | null) => !!action && action.owner === owner && sameCall(action.call, call);
  const ending = belongsToCurrentCall(endingAction);
  const incoming = call.status === "incoming";
  const currentPath = incoming ? "/call/incoming" : "/call/active";
  if (path === currentPath && displayedCall?.id === call.id) return null;
  const current = () => {
    if (!owner || getAuthSnapshot().user !== owner) return null;
    const live = resolveCurrentCall(useSipCallStore.getState(), call.id);
    if (!live) return null;
    return sameCall(call, live) ? live : null;
  };
  const end = async () => {
    const live = current();
    if (belongsToCurrentCall(pending.current) || !live || (incoming && live.status !== "incoming")) return;
    const action = { owner, call };
    pending.current = action;
    setEndingAction(action);
    try { await hangupCall(call.id); }
    catch { if (current()) Alert.alert("Could not end call", "The call may still be connected. Please try End call again."); }
    finally {
      // A late result from an old call must not release a newer call's action.
      if (pending.current === action) { pending.current = null; setEndingAction(null); }
    }
  };
  return (
    <View style={[styles.container, { top: insets.top + 8 }]}>
      <Pressable style={styles.details} accessibilityRole="button" accessibilityLabel="Return to current call"
        onPress={() => {
          const live = current();
          if (live) router.push({ pathname: live.status === "incoming" ? "/call/incoming" : "/call/active", params: { callId: live.id, number: live.remoteNumber, type: "voice" } });
        }}>
        <Text style={styles.title}>{incoming ? "Incoming call" : "Call in progress"}</Text>
        <Text numberOfLines={1} style={styles.number}>{call.remoteName || call.remoteNumber}</Text>
        {incoming && <Text style={styles.number}>Tap to answer</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={incoming ? "Decline call" : "End call"}
        disabled={ending} onPress={end} style={[styles.end, ending && { opacity: 0.6 }]}>
        <Text style={styles.endLabel}>{ending ? "Ending…" : incoming ? "Decline" : "End call"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: "absolute", left: 12, right: 12, zIndex: 100, elevation: 10, backgroundColor: "#163D36", borderRadius: 16, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  details: { flex: 1, paddingVertical: 4 }, title: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  number: { color: "#D0E6DF", marginTop: 3, fontSize: 13 },
  end: { backgroundColor: "#B42335", borderRadius: 12, paddingHorizontal: 16, minHeight: 48, justifyContent: "center" },
  endLabel: { color: "#FFFFFF", fontWeight: "700" },
});
