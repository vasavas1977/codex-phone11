import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { useFraudControls, usePbxAdminWorkspace, useUpdateFraudControls } from "@/hooks/use-pbx-admin";
import { addAuthChangeListener, getAuthSnapshot } from "@/lib/_core/auth";

type Values = { internationalEnabled: boolean; premiumRateEnabled: boolean };
type Scope = {
  owner: ReturnType<typeof getAuthSnapshot>["user"];
  tenantId: number | null;
  admission: string | null;
  active: boolean;
};

/** A saved policy is confirmed by a fresh read in the original admitted scope. */
export function OutboundCallPolicy() {
  const colors = useColors();
  const { user, loading } = useAuth({ autoFetch: false });
  const workspace = usePbxAdminWorkspace();
  const policy = useFraudControls();
  const update = useUpdateFraudControls();
  const supported = workspace.capabilitiesQuery.data?.explicitFraudControls === true;
  const admitted = !loading && Boolean(user) && workspace.isAdmitted &&
    workspace.selectedTenantId !== null && workspace.admissionScope !== null && supported;
  const scope = useRef<Scope>({ owner: user, tenantId: workspace.selectedTenantId,
    admission: workspace.admissionScope, active: true });
  if (scope.current.owner !== user || scope.current.tenantId !== workspace.selectedTenantId ||
      scope.current.admission !== workspace.admissionScope || !scope.current.active) {
    scope.current.active = false;
    scope.current = { owner: user, tenantId: workspace.selectedTenantId,
      admission: workspace.admissionScope, active: true };
  }
  const renderedScope = scope.current;
  const mounted = useRef(false);
  const latest = useRef<{ admitted: boolean; ready: boolean; values: Values | null }>({ admitted, ready: false, values: null });
  const pending = useRef<Scope | null>(null);
  const [saving, setSaving] = useState<Scope | null>(null);
  const [draft, setDraft] = useState<{ scope: Scope; values: Values } | null>(null);
  const [feedback, setFeedback] = useState<{ scope: Scope; error: boolean; text: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    scope.current.active = true;
    const unsubscribe = addAuthChangeListener(() => {
      const auth = getAuthSnapshot();
      if (auth.loading || auth.user !== scope.current.owner) scope.current.active = false;
    });
    return () => {
      mounted.current = false;
      scope.current.active = false;
      unsubscribe();
    };
  }, []);
  const owns = (captured: Scope) => {
    const auth = getAuthSnapshot();
    return mounted.current && captured === scope.current && captured.active &&
      captured.owner !== null && auth.user === captured.owner && !auth.loading && latest.current.admitted;
  };
  const matches = (value: typeof policy.data, captured: Scope) => value !== undefined &&
    policy.authIdentity !== null && value.authIdentity === policy.authIdentity &&
    value.ownerId === captured.owner?.id && value.tenantId === captured.tenantId &&
    value.admissionScope === captured.admission &&
    typeof value.internationalEnabled === "boolean" && typeof value.premiumRateEnabled === "boolean";
  const ready = admitted && policy.isSuccess && !policy.isFetching && !policy.isError &&
    matches(policy.data, renderedScope);
  const saved: Values = { internationalEnabled: policy.data?.internationalEnabled === true,
    premiumRateEnabled: policy.data?.premiumRateEnabled === true };
  const values = draft?.scope === renderedScope ? draft.values : saved;
  latest.current = { admitted, ready, values };
  const changed = values.internationalEnabled !== saved.internationalEnabled ||
    values.premiumRateEnabled !== saved.premiumRateEnabled;
  const busy = saving === renderedScope || update.isPending;
  const editable = ready && !busy;
  const change = (key: keyof Values, value: boolean) => {
    if (!editable || !latest.current.ready || latest.current.values !== values || !owns(renderedScope)) return;
    setDraft({ scope: renderedScope, values: { ...values, [key]: value } });
    setFeedback(null);
  };
  const save = async () => {
    const captured = renderedScope;
    if (pending.current || !editable || !latest.current.ready || latest.current.values !== values || !changed || !owns(captured)) return;
    const intended = { ...values };
    pending.current = captured;
    setSaving(captured);
    setFeedback(null);
    try {
      const acknowledged = await update.mutateAsync({ tenantId: captured.tenantId!, ...intended });
      if (!owns(captured)) return;
      if (acknowledged?.success !== true) throw new Error("SAVE_UNCONFIRMED");
      // Retire any focus read started before the mutation committed.
      const result = await policy.refetch({ cancelRefetch: true });
      if (!owns(captured)) return;
      if (result.isError || !matches(result.data, captured) || result.data?.configured !== true ||
          result.data?.internationalEnabled !== intended.internationalEnabled ||
          result.data?.premiumRateEnabled !== intended.premiumRateEnabled)
        throw new Error("READBACK_UNCONFIRMED");
      setDraft(null);
      setFeedback({ scope: captured, error: false, text: "Outbound call policy saved and confirmed." });
    } catch {
      if (owns(captured)) setFeedback({ scope: captured, error: true,
        text: "The policy change could not be confirmed. Refresh the policy and check its current values before trying again." });
    } finally {
      if (pending.current === captured) pending.current = null;
      if (mounted.current && captured === scope.current) setSaving(null);
    }
  };
  const message = feedback?.scope === renderedScope && admitted ? feedback : null;
  let unavailable = "";
  if (!supported) unavailable = "This server does not support selected-workspace outbound call settings yet.";
  else if (!admitted) unavailable = "Confirm current workspace administrator access before changing this policy.";
  else if (policy.isLoading || policy.isFetching) unavailable = "Checking this workspace’s outbound call policy…";
  else if (!ready) unavailable = "Outbound call policy is unavailable. Refresh to confirm this workspace’s current policy.";
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Outbound call policy</Text>
      <Text style={[styles.description, { color: colors.muted }]}>
        Allow international and premium-rate calls for this workspace. Domestic, internal and emergency calling behavior is unchanged. These permissions do not set or enforce a spending budget.
      </Text>
      {unavailable ? <Text accessibilityRole="alert" style={[styles.description, { color: colors.muted }]}>{unavailable}</Text> : null}
      {policy.isFetching && admitted ? <ActivityIndicator color={colors.primary} /> : null}
      {ready && policy.data?.configured === false ? <Text style={[styles.description, { color: colors.muted }]}>No policy has been configured. International and premium-rate permissions are off until explicitly saved.</Text> : null}
      {([ ["internationalEnabled", "Allow international calls"], ["premiumRateEnabled", "Allow premium-rate calls"] ] as const).map(([key, label]) => (
        <View key={key} style={styles.row}>
          <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
          <Switch accessibilityLabel={label} accessibilityState={{ disabled: !editable }}
            disabled={!editable} value={ready && values[key]} onValueChange={(value) => change(key, value)} />
        </View>
      ))}
      <Text style={[styles.description, { color: colors.muted }]}>An international premium-rate number may require both permissions.</Text>
      {message ? <Text accessibilityRole={message.error ? "alert" : undefined} accessibilityLiveRegion="polite"
        style={[styles.description, { color: message.error ? colors.error : colors.success }]}>{message.text}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Save outbound call policy"
        accessibilityState={{ disabled: !editable || !changed, busy }} disabled={!editable || !changed}
        onPress={save} style={[styles.button, { backgroundColor: colors.primary }, (!editable || !changed) && styles.disabled]}>
        <Text style={styles.buttonText}>{busy ? "Saving and confirming…" : "Save policy"}</Text>
      </Pressable>
      {supported && admitted && !busy ? <Pressable accessibilityRole="button" accessibilityLabel="Refresh outbound call policy"
        disabled={policy.isFetching} accessibilityState={{ disabled: policy.isFetching }}
        onPress={() => { if (!owns(renderedScope) || pending.current || policy.isFetching) return;
          setDraft(null); setFeedback(null); void policy.refetch(); }}
        style={[styles.refresh, { borderColor: colors.border }]}>
        <Text style={{ color: colors.primary }}>Refresh policy</Text>
      </Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 20, marginBottom: 20 },
  title: { fontSize: 20, fontWeight: "700" },
  description: { fontSize: 14, lineHeight: 21, marginTop: 10 },
  row: { alignItems: "center", flexDirection: "row", gap: 12, marginTop: 20 },
  label: { flex: 1, fontSize: 15, fontWeight: "600" },
  button: { alignItems: "center", borderRadius: 10, justifyContent: "center", minHeight: 48, marginTop: 20 },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  refresh: { alignItems: "center", borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 44, marginTop: 12 },
});
