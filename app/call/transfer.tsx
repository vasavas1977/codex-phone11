import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FeatureUnavailable } from "@/components/feature-unavailable";
import { useColors } from "@/hooks/use-colors";
import { useSip } from "@/lib/sip/sip-provider";
import { useSipCallStore } from "@/lib/sip/call-store";
import { resolveCurrentCall } from "@/lib/sip/current-call";

export default function TransferCallScreen() {
  const { callId } = useLocalSearchParams<{ callId?: string }>();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { transferCall, supportsBlindTransfer } = useSip();
  const call = useSipCallStore(state => resolveCurrentCall(state, callId));
  const [destination, setDestination] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  const backToCall = () => {
    if (router.canGoBack()) router.back();
    else if (call) router.replace({ pathname: "/call/active", params: { callId: call.id } });
    else router.replace("/(tabs)/recents");
  };

  if (!supportsBlindTransfer()) return <FeatureUnavailable
    title="Call transfer is unavailable"
    description="This Phone11 build cannot transfer calls. Your current call stays available."
  />;

  const connected = call?.status === "active" && !call.isHeld;
  const target = destination.trim();
  const validTarget = /^\+?[0-9*#]{1,32}$/.test(target);
  const submit = async () => {
    if (!connected || !call || !validTarget || lock.current || confirmed) return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      // Siprix resolves this promise only for the matching native success callback.
      await transferCall(call.id, target);
      setConfirmed(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Call transfer could not be confirmed.";
      setError(message);
    } finally {
      lock.current = false;
      setPending(false);
    }
  };

  return <View style={[styles.root, { backgroundColor: colors.background, paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 16) }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={pending ? "Return to active call; transfer may continue" : "Back to active call"} onPress={backToCall} style={styles.back}>
      <Text style={{ color: colors.primary, fontSize: 17 }}>‹ {pending ? "Return to call" : "Back to call"}</Text>
    </Pressable>
    <View style={styles.content}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Transfer call</Text>
      {confirmed ? <>
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.success }]}>Transfer confirmed.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Open Recents" style={[styles.action, { backgroundColor: colors.primary }]} onPress={() => router.replace("/(tabs)/recents")}><Text style={styles.actionText}>Open Recents</Text></Pressable>
      </> : !connected && !pending ? <>
        <Text style={[styles.body, { color: colors.muted }]}>{call?.isHeld ? "Resume the call before transferring it." : "This call is no longer connected."}</Text>
        {!!error && <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.error }]}>{error}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Return to call controls" style={[styles.action, { backgroundColor: colors.primary }]} onPress={backToCall}><Text style={styles.actionText}>Return to call</Text></Pressable>
      </> : <>
        <Text style={[styles.body, { color: colors.muted }]}>Enter an extension or phone number. Phone11 will transfer this call without first calling the destination.</Text>
        <TextInput accessibilityLabel="Transfer destination" value={destination} onChangeText={setDestination} editable={!pending} keyboardType="phone-pad" autoCapitalize="none" maxLength={32} placeholder="Extension or phone number" placeholderTextColor={colors.muted} style={[styles.input, { borderColor: colors.muted, color: colors.foreground, backgroundColor: colors.surface }]} />
        {pending && <View style={styles.progress}><ActivityIndicator color={colors.primary} /><Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.muted }]}>Waiting for transfer confirmation. You can return to the call; this request may still complete.</Text></View>}
        {!!error && <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.error }]}>{error}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Confirm blind transfer" accessibilityState={{ disabled: !validTarget || pending }} disabled={!validTarget || pending} style={[styles.action, { backgroundColor: colors.primary, opacity: !validTarget || pending ? 0.5 : 1 }]} onPress={submit}><Text style={styles.actionText}>Transfer now</Text></Pressable>
        <Text style={[styles.note, { color: colors.muted }]}>Before you tap Transfer now, Back to call cancels this screen. After the request is sent, returning to the call does not cancel it.</Text>
      </>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  back: { minHeight: 48, paddingHorizontal: 24, justifyContent: "center" },
  content: { flex: 1, padding: 24, gap: 18, justifyContent: "center", maxWidth: 540, width: "100%", alignSelf: "center" },
  title: { fontSize: 28, fontWeight: "700" },
  body: { fontSize: 16, lineHeight: 24 },
  input: { minHeight: 54, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, fontSize: 18 },
  action: { minHeight: 54, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actionText: { color: "white", fontSize: 17, fontWeight: "700" },
  progress: { flexDirection: "row", alignItems: "center", gap: 12 },
  note: { fontSize: 13, lineHeight: 19 },
});
