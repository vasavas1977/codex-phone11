import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { portalSignInRoute } from "@/constants/oauth";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { trpc } from "@/lib/trpc";

type GrantRow = { userId: number; name: string; canStartMeeting: boolean };
type ConversationRow = { id: string; name: string; kind: "group" | "channel" | "direct"; members: GrantRow[] };

function State({ title, detail, retry, actionLabel = "Try again", busy = false }: { title: string; detail: string; retry?: () => void; actionLabel?: string; busy?: boolean }) {
  const colors = useColors();
  return <ScreenContainer><View style={styles.state}>
    {busy ? <ActivityIndicator color={colors.primary} /> : null}
    <Text accessibilityRole="header" style={[styles.heading, { color: colors.foreground }]}>{title}</Text>
    <Text style={[styles.detail, { color: colors.muted }]}>{detail}</Text>
    {retry ? <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={retry}>
      <Text style={{ color: colors.primary }}>{actionLabel}</Text>
    </Pressable> : null}
  </View></ScreenContainer>;
}

export default function AdminMeetings() {
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const tenantQuery = trpc.pbx.tenant.get.useQuery(undefined,
    { enabled: Boolean(user), staleTime: 0, gcTime: 0, refetchOnMount: "always" });
  const tenant = tenantQuery.data;
  const tenantId = typeof tenant?.id === "number" ? tenant.id : null;
  const canManage = Boolean(user && tenantId && ["owner", "admin"].includes(String(tenant?.userRole || "")));
  const [section, setSection] = useState<"channels" | "direct">("channels");
  const [channelCursor, setChannelCursor] = useState<string | undefined>();
  const [channelHistory, setChannelHistory] = useState<Array<string | undefined>>([]);
  const [directCursor, setDirectCursor] = useState<string | undefined>();
  const [directHistory, setDirectHistory] = useState<Array<string | undefined>>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const mutationPending = useRef(false);
  useEffect(() => {
    setChannelCursor(undefined);
    setChannelHistory([]);
    setDirectCursor(undefined);
    setDirectHistory([]);
    setSaveError(null);
  }, [user?.id, tenantId]);
  const overview = trpc.meetings.adminOverview.useQuery(
    { tenantId: tenantId ?? 0, channelCursor, directCursor },
    { enabled: canManage, staleTime: 0, gcTime: 0, refetchOnMount: "always" },
  );
  const setChannelGrant = trpc.meetings.adminSetHostPermission.useMutation();
  const setDirectGrant = trpc.meetings.adminSetDirectHostPermission.useMutation();
  const currentScope = () => Boolean(user && getAuthSnapshot().user === user &&
    tenantQuery.data?.id === tenantId && canManage);

  const changeGrant = async (conversation: ConversationRow, member: GrantRow, allowed: boolean) => {
    if (!currentScope() || tenantId === null || mutationPending.current || overview.isFetching || !overview.data?.available) return;
    mutationPending.current = true;
    const key = `${conversation.id}:${member.userId}`;
    setSaving(key);
    setSaveError(null);
    try {
      if (conversation.kind === "direct") await setDirectGrant.mutateAsync({
        tenantId, conversationId: conversation.id, userId: member.userId, canStartMeeting: allowed,
      });
      else await setChannelGrant.mutateAsync({
        tenantId, channelId: conversation.id, userId: member.userId, canStartMeeting: allowed,
      });
      if (currentScope()) await overview.refetch();
    } catch {
      if (currentScope()) setSaveError("Could not update meeting hosting. Check workspace access and try again.");
    } finally {
      mutationPending.current = false;
      setSaving(null);
    }
  };

  if (!user) return <State title="Sign in to manage meetings" detail="Workspace administration requires an owner or administrator account."
    retry={() => router.replace(portalSignInRoute("/admin"))} actionLabel="Sign in" />;
  if (tenantQuery.isLoading || tenantQuery.isFetching) return <State title="Checking workspace access" detail="Confirming your meeting administration access." busy />;
  if (tenantQuery.isError || !tenant || tenantId === null) return <State title="Workspace unavailable"
    detail="Could not confirm the active workspace." retry={() => void tenantQuery.refetch()} />;
  if (!canManage) return <State title="Administrator access required"
    detail="Only workspace owners and administrators can change meeting hosting." />;

  const data = overview.data;
  const conversations: ConversationRow[] = section === "direct" ? (data?.directConversations ?? []) : (data?.channels ?? []);
  const nextDirect = data?.directNextCursor;
  const nextChannel = data?.channelNextCursor;
  const history = section === "direct" ? directHistory : channelHistory;
  const cursor = section === "direct" ? directCursor : channelCursor;
  const nextCursor = section === "direct" ? nextDirect : nextChannel;
  const setCursor = section === "direct" ? setDirectCursor : setChannelCursor;
  const setHistory = section === "direct" ? setDirectHistory : setChannelHistory;
  const pageLabel = section === "direct" ? "direct chats" : "channels and groups";
  return <ScreenContainer><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to admin" onPress={() => router.canGoBack() ? router.back() : router.replace("/admin")}>
        <IconSymbol name="chevron.left" size={22} color={colors.primary} />
      </Pressable>
      <View><Text accessibilityRole="header" style={[styles.heading, { color: colors.foreground }]}>Meeting hosting</Text>
        <Text style={[styles.detail, { color: colors.muted }]}>{tenant.name}</Text></View>
    </View>
    <Text style={[styles.detail, { color: colors.muted }]}>
      Choose who can start a meeting from each chat. Invited members can join without a host grant.
    </Text>
    <View style={styles.tabs}>
      {(["channels", "direct"] as const).map(kind => <Pressable key={kind} accessibilityRole="button"
        accessibilityLabel={kind === "channels" ? "Channels and groups" : "Direct chats"}
        accessibilityState={{ selected: section === kind }} onPress={() => { setSection(kind); setSaveError(null); }}
        style={[styles.tab, { borderColor: section === kind ? colors.primary : colors.border }]}>
        <Text style={{ color: section === kind ? colors.primary : colors.muted }}>{kind === "channels" ? "Channels and groups" : "Direct chats"}</Text>
      </Pressable>)}
    </View>
    {overview.isLoading || overview.isFetching ? <ActivityIndicator color={colors.primary} /> :
      overview.error ? <Pressable accessibilityRole="button" accessibilityLabel="Retry meeting settings" onPress={() => void overview.refetch()}>
        <Text style={{ color: colors.error }}>Could not load meeting settings. Tap to retry.</Text>
      </Pressable> : !data?.available ? <Text style={{ color: colors.muted }}>{data?.reason ?? "Meeting hosting is unavailable in this workspace."}</Text> : <>
        {conversations.length === 0 ? <Text style={{ color: colors.muted }}>No eligible {section === "direct" ? "direct chats" : "channels or groups"} on this page.</Text> :
          conversations.map(conversation => <View key={conversation.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{conversation.kind === "direct"
              ? conversation.members.map(member => member.name).join(" · ") : conversation.name}</Text>
            {conversation.members.map(member => <View key={member.userId} style={styles.member}>
              <Text style={{ color: colors.foreground, flex: 1 }}>{member.name}</Text>
              <Switch accessibilityLabel={`Allow ${member.name} to start meetings in ${conversation.name}`}
                value={member.canStartMeeting} disabled={saving !== null || overview.isFetching}
                onValueChange={value => void changeGrant(conversation, member, value)} />
            </View>)}
          </View>)}
        <View style={styles.pager}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Previous ${pageLabel}`} disabled={!history.length || saving !== null}
            onPress={() => { setCursor(history.at(-1)); setHistory(rows => rows.slice(0, -1)); }}>
            <Text style={{ color: history.length ? colors.primary : colors.muted }}>Previous</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Next ${pageLabel}`} disabled={!nextCursor || saving !== null}
            onPress={() => { if (nextCursor) { setHistory(rows => [...rows, cursor]); setCursor(nextCursor); } }}>
            <Text style={{ color: nextCursor ? colors.primary : colors.muted }}>Next</Text>
          </Pressable>
        </View>
      </>}
    {saveError ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{saveError}</Text> : null}
  </ScrollView></ScreenContainer>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 20, maxWidth: 900, width: "100%", alignSelf: "center" },
  state: { flex: 1, justifyContent: "center", alignItems: "center", padding: 28, gap: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 16 },
  heading: { fontSize: 24, fontWeight: "700" },
  detail: { fontSize: 15, lineHeight: 22 },
  tabs: { flexDirection: "row", gap: 10 },
  tab: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 15, paddingVertical: 10 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  cardTitle: { fontSize: 17, fontWeight: "600" },
  member: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  pager: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12 },
});
