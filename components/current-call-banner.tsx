import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSip } from "@/lib/sip/sip-provider";
import { useSipCallStore } from "@/lib/sip/call-store";
import { resolveCurrentCall } from "@/lib/sip/current-call";

export function CurrentCallBanner() {
  const call = useSipCallStore(state => resolveCurrentCall(state));
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const { hangupCall } = useSip();
  const [ending, setEnding] = useState(false);
  if (!call || path === "/call/active" || path === "/call/incoming") return null;
  const incoming = call.status === "incoming";
  const end = async () => {
    if (ending) return;
    setEnding(true);
    try { await hangupCall(call.id); }
    catch { Alert.alert("Could not end call", "The call may still be connected. Please try End call again."); }
    finally { setEnding(false); }
  };
  return (
    <View style={[styles.container, { top: insets.top + 8 }]}>
      <Pressable style={styles.details} accessibilityRole="button" accessibilityLabel="Return to current call"
        onPress={() => router.push({ pathname: incoming ? "/call/incoming" : "/call/active", params: { callId: call.id, number: call.remoteNumber, type: "voice" } })}>
        <Text style={styles.title}>{incoming ? "Incoming call" : "Call in progress"}</Text>
        <Text numberOfLines={1} style={styles.number}>{call.remoteName || call.remoteNumber}</Text>
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
