import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Platform,
  Text,
  TextInput,
  View,
} from "react-native";
import { createTRPCClient } from "@/lib/trpc";
import * as Auth from "@/lib/_core/auth";
import { invitationCapabilityView, isCurrentInvitationScope, isValidInvitationEmail } from "@/lib/invitation-ui";
import { useColors } from "@/hooks/use-colors";

type InvitationRole = "user" | "admin";
type InvitationSummary = {
  id: string;
  email: string;
  role: InvitationRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
  deliveryStatus: "pending" | "sent" | "failed";
  deliveryError?: string | null;
};
type Props = {
  tenantId: number | null;
  actorRole: string;
  userId: number | null;
  workspaceValid: boolean;
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}

export function AdminInvitations({ tenantId, actorRole, userId, workspaceValid }: Props) {
  const colors = useColors();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<InvitationSummary[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationRole>("user");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const currentScope = useRef({ tenantId, userId, workspaceValid });
  currentScope.current = { tenantId, userId, workspaceValid };
  const attempt = useRef(0);
  const busy = useRef(false);

  const admissionStillCurrent = useCallback((expectedTenant: number, expectedUser: number) => {
    return isCurrentInvitationScope(expectedTenant, expectedUser, currentScope.current, Auth.getAuthSnapshot().user?.id);
  }, []);

  const load = useCallback(async () => {
    const request = ++attempt.current;
    if (!tenantId || !userId || !workspaceValid) {
      setEnabled(null);
      setRows([]);
      setListLoaded(false);
      setChecking(false);
      return;
    }
    const requestedTenant = tenantId;
    const requestedUser = userId;
    setChecking(true);
    setLoadError(null);
    setEnabled(null);
    setListLoaded(false);
    let client: ReturnType<typeof createTRPCClient>;
    try {
      client = createTRPCClient();
      const capability = await client.invitations.availability.query({ tenantId: requestedTenant });
      if (request !== attempt.current || !admissionStillCurrent(requestedTenant, requestedUser)) return;
      setEnabled(capability.enabled);
      if (!capability.enabled) {
        setRows([]);
        setListLoaded(true);
        setChecking(false);
        return;
      }
    } catch (failure) {
      if (request === attempt.current && admissionStillCurrent(requestedTenant, requestedUser)) {
        setEnabled(false);
        setRows([]);
        setListLoaded(false);
        setLoadError(messageOf(failure));
        setChecking(false);
      }
      return;
    }
    try {
      const next = await client.invitations.list.query({ tenantId: requestedTenant });
      if (request === attempt.current && admissionStillCurrent(requestedTenant, requestedUser)) {
        setRows(next);
        setListLoaded(true);
      }
    } catch (failure) {
      if (request === attempt.current && admissionStillCurrent(requestedTenant, requestedUser)) {
        setRows([]);
        setListLoaded(false);
        setLoadError(messageOf(failure));
      }
    } finally {
      if (request === attempt.current) setChecking(false);
    }
  }, [admissionStillCurrent, tenantId, userId, workspaceValid]);

  useEffect(() => {
    setRows([]);
    setFormOpen(false);
    setEmail("");
    setRole("user");
    setError(null);
    setNotice(null);
    void load();
    return () => { attempt.current += 1; };
  }, [load]);

  const refresh = async () => {
    await load();
  };

  const runAction = async (
    id: string | null,
    action: (client: ReturnType<typeof createTRPCClient>, input: { tenantId: number; invitationId: string }) => Promise<InvitationSummary>,
    actionKind: "create" | "resend" | "revoke",
  ) => {
    if (busy.current || !tenantId || !userId || !workspaceValid || !admissionStillCurrent(tenantId, userId)) {
      setError("Workspace access changed. Refresh before managing invitations.");
      return;
    }
    busy.current = true;
    setBusyId(id ?? "create");
    setError(null);
    setNotice(null);
    const expectedTenant = tenantId;
    const expectedUser = userId;
    let client: ReturnType<typeof createTRPCClient>;
    let result: InvitationSummary;
    try {
      client = createTRPCClient();
      result = await action(client, { tenantId: expectedTenant, invitationId: id ?? "" });
    } catch (failure) {
      if (admissionStillCurrent(expectedTenant, expectedUser)) setError(messageOf(failure));
      busy.current = false;
      setBusyId(null);
      return;
    }
    if (!admissionStillCurrent(expectedTenant, expectedUser)) {
      busy.current = false;
      setBusyId(null);
      return;
    }
    setNotice(actionKind === "revoke"
      ? `Invitation to ${result.email} was revoked.`
      : actionKind === "resend"
        ? result.deliveryStatus === "sent"
          ? `Email provider accepted the invitation to ${result.email}.`
          : result.deliveryStatus === "failed"
            ? `Invitation to ${result.email} remains undelivered. Retry delivery below.`
            : `Invitation delivery to ${result.email} is pending.`
        : result.deliveryStatus === "sent"
          ? `Email provider accepted the invitation to ${result.email}.`
          : result.deliveryStatus === "failed"
            ? `Invitation created for ${result.email}, but delivery failed. You can retry delivery below.`
            : `Invitation created for ${result.email}. Email delivery is pending.`);
    if (id === null) {
      setEmail("");
      setError(null);
      setFormOpen(false);
    }
    try {
      const next = await client.invitations.list.query({ tenantId: expectedTenant });
      if (admissionStillCurrent(expectedTenant, expectedUser)) {
        setRows(next);
        setListLoaded(true);
        setLoadError(null);
      }
    } catch {
      if (admissionStillCurrent(expectedTenant, expectedUser)) {
        setListLoaded(false);
        setLoadError("The invitation was updated, but the list could not refresh. Try again.");
      }
    } finally {
      busy.current = false;
      setBusyId(null);
    }
  };

  const create = () => {
    if (!isValidInvitationEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (role === "admin" && actorRole !== "owner") {
      setError("Only a workspace owner can invite an administrator.");
      return;
    }
    void runAction(null, async (client, input) => client.invitations.create.mutate({
      tenantId: input.tenantId,
      email: email.trim(),
      role,
    }), "create");
  };

  const inviteAction = (kind: "resend" | "revoke", row: InvitationSummary) => {
    void runAction(row.id, async (client, input) => client.invitations[kind].mutate({
      tenantId: input.tenantId,
      invitationId: row.id,
    }), kind);
  };

  const baseCard = {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  };
  const capabilityView = invitationCapabilityView({ workspaceValid, tenantId, userId, checking, enabled });
  if (capabilityView === "hidden") return null;
  if (capabilityView === "loading") {
    return <View style={[styles.notice, baseCard]}><ActivityIndicator color={colors.primary} /><Text style={[styles.help, { color: colors.muted }]}>Checking invitation availability…</Text></View>;
  }
  if (capabilityView === "unavailable") {
    return (
      <View style={[styles.notice, baseCard]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Invitations are not available yet</Text>
        <Text style={[styles.help, { color: colors.muted }]}>You can manage existing workspace members here. Adding new people will be available when invitations are enabled.</Text>
        {loadError ? <Text accessibilityRole="alert" style={styles.error}>{loadError}</Text> : null}
        {loadError ? <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.inlineButton}><Text style={{ color: colors.primary, fontWeight: "600" }}>Try again</Text></Pressable> : null}
      </View>
    );
  }

  return (
    <View style={[styles.panel, baseCard]}>
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground, flex: 1 }]}>Invitations</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={formOpen ? "Cancel invitation" : "Invite people"}
          accessibilityState={{ expanded: formOpen }}
          disabled={busyId !== null}
          onPress={() => {
            if (formOpen) {
              setFormOpen(false);
              setEmail("");
              setRole("user");
              setError(null);
            } else {
              setError(null);
              setNotice(null);
              setFormOpen(true);
            }
          }}
          style={[styles.compactButton, { borderColor: colors.border }]}
        >
          <Text style={{ color: colors.primary, fontWeight: "600" }}>{formOpen ? "Cancel" : "Invite people"}</Text>
        </Pressable>
      </View>
      {formOpen ? <>
        <Text style={[styles.help, { color: colors.muted, marginTop: -12, marginBottom: 16 }]}>Invitations expire after a limited time. Delivery status is shown below.</Text>
        <Text style={[styles.label, { color: colors.foreground }]}>Email address</Text>
        <TextInput
          accessibilityLabel="Invitation email address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy.current}
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="name@example.com"
          placeholderTextColor={colors.muted}
          value={email}
          style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
        />
        <Text style={[styles.label, { color: colors.foreground, marginTop: 14 }]}>Workspace role</Text>
        <View style={styles.roleRow}>
          {(["user", ...(actorRole === "owner" ? ["admin"] : [])] as InvitationRole[]).map((value) => {
            const checked = role === value;
            const webCheckedProp = Platform.OS === "web" ? ({ "aria-checked": checked } as never) : {};
            return <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked }} {...webCheckedProp} onPress={() => setRole(value)} style={[styles.roleOption, { borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? `${colors.primary}12` : colors.background }]}>
              <Text style={{ color: colors.foreground, fontWeight: "600" }}>{value === "admin" ? "Administrator" : "Member"}</Text>
            </Pressable>;
          })}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Create invitation" disabled={busyId !== null} onPress={create} style={[styles.primary, { backgroundColor: colors.primary, opacity: busyId ? 0.6 : 1 }]}>
          {busyId === "create" ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Create invitation</Text>}
        </Pressable>
      </> : null}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.noticeText}>{notice}</Text> : null}
      <View style={styles.listHeadingRow}>
        <Text style={[styles.listTitle, { color: colors.foreground }]}>Recent invitations</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh invitations" onPress={() => void refresh()} disabled={checking} style={styles.inlineButton}><Text style={{ color: colors.primary, fontWeight: "600" }}>{checking ? "Refreshing…" : "Refresh"}</Text></Pressable>
      </View>
      {!listLoaded ? <View>
        <Text accessibilityRole={loadError ? "alert" : undefined} style={[loadError ? styles.error : styles.help, loadError ? undefined : { color: colors.muted }]}>{loadError ? "Could not load invitations. Try again." : "Loading invitations…"}</Text>
        {loadError ? <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.inlineButton}><Text style={{ color: colors.primary, fontWeight: "600" }}>Try again</Text></Pressable> : null}
      </View> : rows.length === 0 ? <Text style={[styles.help, { color: colors.muted }]}>No invitations to show.</Text> : rows.map((row) => {
        const pendingRow = row.status === "pending" || row.status === "expired";
        return (
          <View key={row.id} style={[styles.row, { borderTopColor: colors.border }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.rowEmail, { color: colors.foreground }]} numberOfLines={1}>{row.email}</Text>
              <Text style={[styles.help, { color: colors.muted }]}>{row.role === "admin" ? "Administrator" : "Member"} · {row.status} · Expires {displayDate(row.expiresAt)}</Text>
              <Text style={[styles.help, { color: colors.muted }]}>{row.deliveryStatus === "sent" ? "Accepted by email provider" : row.deliveryStatus === "failed" ? "Email delivery failed" : "Email delivery pending"}</Text>
              {row.deliveryStatus === "failed" && row.deliveryError ? <Text style={styles.help}>{row.deliveryError}</Text> : null}
            </View>
            {pendingRow ? <View style={styles.actions}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Resend invitation to ${row.email}`} disabled={busyId !== null} onPress={() => inviteAction("resend", row)} style={styles.inlineButton}><Text style={{ color: colors.primary, fontWeight: "600" }}>Resend</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Revoke invitation to ${row.email}`} disabled={busyId !== null} onPress={() => inviteAction("revoke", row)} style={styles.inlineButton}><Text style={{ color: "#B42318", fontWeight: "600" }}>Revoke</Text></Pressable>
            </View> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = {
  notice: { flexDirection: "column" as const, alignItems: "flex-start" as const, gap: 8, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 18 },
  panel: { borderWidth: 1, borderRadius: 12, padding: 18, marginBottom: 18 },
  headingRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 8, marginBottom: 18 },
  title: { fontSize: 17, fontWeight: "700" as const },
  help: { fontSize: 13, lineHeight: 19, marginTop: 5 },
  label: { fontSize: 14, fontWeight: "600" as const, marginBottom: 7 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, fontSize: 15 },
  roleRow: { flexDirection: "row" as const, gap: 8 },
  roleOption: { borderWidth: 1, borderRadius: 9, paddingVertical: 11, paddingHorizontal: 14 },
  primary: { minHeight: 46, alignItems: "center" as const, justifyContent: "center" as const, borderRadius: 9, marginTop: 16, paddingHorizontal: 18 },
  primaryText: { color: "#fff", fontWeight: "700" as const },
  inlineButton: { minHeight: 40, justifyContent: "center" as const, paddingHorizontal: 7 },
  compactButton: { minHeight: 38, justifyContent: "center" as const, paddingHorizontal: 11, borderWidth: 1, borderRadius: 8 },
  error: { color: "#B42318", fontSize: 13, marginTop: 10 },
  noticeText: { color: "#25613C", fontSize: 13, marginTop: 10 },
  listHeadingRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, marginTop: 12 },
  listTitle: { fontWeight: "700" as const, fontSize: 14, marginBottom: 4 },
  row: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: 10, borderTopWidth: 1, paddingVertical: 12 },
  rowEmail: { fontSize: 14, fontWeight: "600" as const },
  actions: { flexDirection: "row" as const, alignItems: "center" as const },
};
