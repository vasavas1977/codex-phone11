import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FeatureUnavailable } from "@/components/feature-unavailable";
import { useColors } from "@/hooks/use-colors";
import { useSip } from "@/lib/sip/sip-provider";
import { useSipCallStore } from "@/lib/sip/call-store";
import { resolveCurrentCall } from "@/lib/sip/current-call";
import { addAuthChangeListener, getAuthSnapshot } from "@/lib/_core/auth";
import { sameSipAccount, useSipAccountStore, type SipAccount } from "@/lib/sip/account-store";
import type { SipCall } from "@/lib/sip/call-store";

type TransferScope = {
  owner: ReturnType<typeof getAuthSnapshot>["user"];
  account: SipAccount | null;
  requestedId?: string | string[];
  callId?: string;
  callIdentity: unknown;
  active: boolean;
  locked: boolean;
  confirmed: boolean;
};
// Store updates replace the call object. Its history/start identity survives
// mute/hold updates, but changes when a native ID is reused for another call.
function callIdentity(call: SipCall | null): unknown {
  return call?.history?.id ?? call?.startTime ?? call;
}
function scopeMatches(scope: TransferScope): boolean {
  const account = useSipAccountStore.getState().account;
  const call = resolveCurrentCall(useSipCallStore.getState(), scope.requestedId);
  return scope.owner === getAuthSnapshot().user && !!scope.owner &&
    !!scope.account && !!account && account.enabled && account.ownerUserId === scope.owner.id &&
    sameSipAccount(scope.account, account) && scope.callId === call?.id && scope.callIdentity === callIdentity(call);
}
type TransferView = { scope: TransferScope; destination: string; pending: boolean; confirmed: boolean; error: string; mode: "blind" | "warm" };
const emptyView = (scope: TransferScope): TransferView => ({ scope, destination: "", pending: false, confirmed: false, error: "", mode: "blind" });

export default function TransferCallScreen() {
  const { callId } = useLocalSearchParams<{ callId?: string }>();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { transferCall, supportsBlindTransfer, hasAttemptedBlindTransfer, supportsWarmTransfer, consultation, beginConsultation, cancelConsultation, completeConsultation } = useSip();
  const owner = useSyncExternalStore(addAuthChangeListener, getAuthSnapshot, getAuthSnapshot).user;
  const account = useSipAccountStore(state => state.account);
  const call = useSipCallStore(state => resolveCurrentCall(state, callId));
  const mounted = useRef(true);
  const currentScope = useRef<TransferScope | null>(null);
  let nextScope = currentScope.current;
  if (!nextScope || !nextScope.active || !scopeMatches(nextScope) || nextScope.owner !== owner ||
      nextScope.callId !== call?.id || nextScope.callIdentity !== callIdentity(call)) {
    if (nextScope) nextScope.active = false;
    nextScope = { owner, account: account ? { ...account } : null, requestedId: callId,
      callId: call?.id, callIdentity: callIdentity(call), active: true, locked: false, confirmed: false };
    currentScope.current = nextScope;
  }
  const scope = nextScope;
  const [savedView, setView] = useState<TransferView>(() => emptyView(scope));
  const view = savedView.scope === scope ? savedView : emptyView(scope);
  const { destination, pending, confirmed, error } = view;
  const current = () => {
    if (!mounted.current || currentScope.current !== scope || !scope.active) return false;
    if (!scopeMatches(scope)) { scope.active = false; return false; }
    return true;
  };
  useEffect(() => {
    mounted.current = true;
    if (currentScope.current && scopeMatches(currentScope.current)) currentScope.current.active = true;
    const retire = () => {
      const active = currentScope.current;
      if (active && !scopeMatches(active)) active.active = false;
    };
    const remove = [addAuthChangeListener(retire), useSipAccountStore.subscribe(retire), useSipCallStore.subscribe(retire)];
    return () => {
      mounted.current = false;
      if (currentScope.current) currentScope.current.active = false;
      for (const unsubscribe of remove) unsubscribe();
    };
  }, []);

  const backToCall = () => {
    if (!current()) return;
    if (router.canGoBack()) router.back();
    else if (call) router.replace({ pathname: "/call/active", params: { callId: call.id } });
    else router.replace("/(tabs)/recents");
  };

  if (!supportsBlindTransfer()) return <FeatureUnavailable
    title="Call transfer is unavailable"
    description="This Phone11 build cannot transfer calls. Your current call stays available."
  />;

  const warmSupported = supportsWarmTransfer?.() === true;
  const warm = call ? consultation?.(call.id) : null;
  const connected = call?.status === "active" && !call.isHeld;
  const attempted = !!call && hasAttemptedBlindTransfer(call.id);
  const target = destination.trim();
  const validTarget = /^\+?[0-9*#]{1,32}$/.test(target);
  const submit = async () => {
    const liveCall = resolveCurrentCall(useSipCallStore.getState(), callId);
    if (!current() || !supportsBlindTransfer() || !liveCall || liveCall.status !== "active" || liveCall.isHeld ||
        !validTarget || scope.locked || scope.confirmed || hasAttemptedBlindTransfer(liveCall.id) ||
        (view.mode === "warm" && supportsWarmTransfer?.() !== true)) return;
    scope.locked = true;
    setView({ ...view, pending: true, error: "" });
    try {
      // Only a matching SDK success outcome resolves; acceptance never ends the call.
      if (view.mode === "warm") {
        await beginConsultation(liveCall.id,target);
        if (current()) setView({ ...view, pending: false });
        return;
      }
      await transferCall(liveCall.id, target);
      if (current()) {
        scope.confirmed = true;
        setView({ ...view, confirmed: true, pending: false });
      }
    } catch (cause) {
      if (current()) setView({ ...view, pending: false, error: cause instanceof Error ? cause.message : "Call transfer could not be confirmed." });
    } finally {
      if (current()) scope.locked = false;
    }
  };

  const warmAction = async (complete: boolean) => {
    const liveWarm = call ? consultation?.(call.id) : null;
    if (!current() || !call || !warm || scope.locked || supportsWarmTransfer?.() !== true ||
        liveWarm?.requestId !== warm.requestId || (complete && liveWarm.phase !== "ready")) return;
    const requestId = warm.requestId;
    scope.locked = true; setView({ ...view,pending:true,error:"" });
    try {
      if (complete) await completeConsultation(call.id,requestId);
      else await cancelConsultation(call.id,requestId);
      if (current()) setView({ ...view,pending:false });
    } catch (cause) {
      if (current()) setView({ ...view,pending:false,error:cause instanceof Error ? cause.message : "Consultation could not be confirmed." });
    } finally { if (current()) scope.locked = false; }
  };
  const warmMessage = warm ? ({
    holding: "Placing the original call on hold. The destination is called only after hold is confirmed.",
    held_ready: "Original call hold confirmed. Checking the phone session before calling the destination.",
    calling: "Calling the destination. Your original caller is on hold.",
    switching: "The destination connected. Waiting for consultation audio focus.",
    restoring_audio: "Original call hold was restored. Waiting for audio focus confirmation.",
    consultation_failed: "Consultation audio could not be confirmed. Return to your original caller.",
    ready: "Consultation connected. Speak to the destination, then complete transfer or return to your original caller.",
    canceling: "Ending the consultation. Your original call resumes only after the consultation has ended.",
    returning: "Restoring the original call. Waiting for hold confirmation.",
    returned: "Consultation ended. Your original call is available. One consultation attempt per call.",
    return_failed: "The original call could not be resumed. Tap Return to original call to request restoration again.",
    transferring: "Waiting for transfer confirmation. Keep both calls open; the server may still complete the transfer.",
    transfer_failed: "Transfer failed. Your original caller remains on hold. Return to the original call to end the consultation and resume it.",
    completed: "Transfer confirmed.",
  }[warm.phase]) : "";

  return <View style={[styles.root, { backgroundColor: colors.background, paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 16) }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={pending ? "Return to active call; transfer may continue" : "Back to active call"} onPress={backToCall} style={styles.back}>
      <Text style={{ color: colors.primary, fontSize: 17 }}>‹ {pending ? "Return to call" : "Back to call"}</Text>
    </Pressable>
    <View style={styles.content}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Transfer call</Text>
      {warm ? <>
        <Text accessibilityLiveRegion="polite" style={[styles.body,{ color: colors.muted }]}>{warmMessage}</Text>
        {!!error && <Text accessibilityLiveRegion="polite" style={[styles.body,{ color: colors.error }]}>{error}</Text>}
        {warm.phase === "ready" && <Pressable accessibilityRole="button" accessibilityLabel="Complete consultation transfer" disabled={pending || attempted} onPress={() => warmAction(true)} style={[styles.action,{ backgroundColor: colors.primary, opacity: pending || attempted ? 0.5 : 1 }]}><Text style={styles.actionText}>Complete transfer</Text></Pressable>}
        {["holding","held_ready","calling","switching","ready","return_failed","consultation_failed","transfer_failed"].includes(warm.phase) && <Pressable accessibilityRole="button" accessibilityLabel="Return to original call" disabled={pending} onPress={() => warmAction(false)} style={[styles.action,{ backgroundColor: colors.primary,opacity:pending ? 0.5 : 1 }]}><Text style={styles.actionText}>Return to original call</Text></Pressable>}
        {warm.phase === "returned" && <Pressable accessibilityRole="button" accessibilityLabel="Open original call controls" onPress={backToCall} style={[styles.action,{backgroundColor:colors.primary}]}><Text style={styles.actionText}>Open original call</Text></Pressable>}
        <Text style={[styles.note,{color:colors.muted}]}>This Siprix trial limits each call to 60 seconds. Returning to call controls keeps this consultation open until you choose Return to original call.</Text>
      </> : confirmed ? <>
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.success }]}>Transfer confirmed.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Open Recents" style={[styles.action, { backgroundColor: colors.primary }]} onPress={() => { if (current()) router.replace("/(tabs)/recents"); }}><Text style={styles.actionText}>Open Recents</Text></Pressable>
      </> : (!connected || attempted) && !pending ? <>
        <Text style={[styles.body, { color: colors.muted }]}>{attempted ? "Transfer is unavailable for this call. One transfer attempt per call; return to call controls." : call?.isHeld ? "Resume the call before transferring it." : "This call is no longer connected."}</Text>
        {!!error && <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.error }]}>{error}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Return to call controls" style={[styles.action, { backgroundColor: colors.primary }]} onPress={backToCall}><Text style={styles.actionText}>Return to call</Text></Pressable>
      </> : <>
        {warmSupported && <View style={styles.progress}>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose blind transfer" disabled={pending} onPress={() => { if (current()) setView({...view,mode:"blind"}); }}><Text style={{color:colors.primary}}>Transfer now</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose consultation transfer" disabled={pending} onPress={() => { if (current()) setView({...view,mode:"warm"}); }}><Text style={{color:colors.primary}}>Call first</Text></Pressable>
        </View>}
        <Text style={[styles.body, { color: colors.muted }]}>{view.mode === "warm" ? "Call the destination first. Your original caller is held while you consult; complete transfer only after the destination connects." : "Enter an extension or phone number. Phone11 will transfer this call without first calling the destination."}</Text>
        <TextInput accessibilityLabel="Transfer destination" value={destination} onChangeText={value => { if (current()) setView({ ...view, destination: value }); }} editable={!pending} keyboardType="phone-pad" autoCapitalize="none" maxLength={32} placeholder="Extension or phone number" placeholderTextColor={colors.muted} style={[styles.input, { borderColor: colors.muted, color: colors.foreground, backgroundColor: colors.surface }]} />
        {pending && <View style={styles.progress}><ActivityIndicator color={colors.primary} /><Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.muted }]}>{view.mode === "warm" ? "Starting consultation. Wait for confirmed hold before the destination is called." : "Waiting for transfer confirmation. You can return to the call; this request may still complete."}</Text></View>}
        {!!error && <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.error }]}>{error}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel={view.mode === "warm" ? "Start consultation call" : "Confirm blind transfer"} accessibilityState={{ disabled: !validTarget || pending }} disabled={!validTarget || pending} style={[styles.action, { backgroundColor: colors.primary, opacity: !validTarget || pending ? 0.5 : 1 }]} onPress={submit}><Text style={styles.actionText}>{view.mode === "warm" ? "Call destination first" : "Transfer now"}</Text></Pressable>
        <Text style={[styles.note, { color: colors.muted }]}>{view.mode === "warm" ? "Back to call closes this screen. After consultation begins, use Return to original call to cancel it and restore your original call. This trial limits each call to 60 seconds." : "Before you tap Transfer now, Back to call cancels this screen. After the request is sent, returning to the call does not cancel it."}</Text>
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
