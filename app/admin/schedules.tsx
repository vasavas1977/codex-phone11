import { useEffect, useState } from "react";
import { AdminWorkspaceBoundary } from "@/components/admin/admin-workspace-boundary";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { UnavailableAdminScreen } from "@/components/admin/unavailable-admin-screen";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import {
  useCreateTimeCondition,
  useDeleteTimeCondition,
  usePbxCapabilities,
  useSetTimeConditionRules,
  useTenant,
  useTimeCondition,
  useTimeConditions,
  useUpdateTimeCondition,
} from "@/hooks/use-pbx-admin";
import {
  businessHoursFromRules,
  buildBusinessHoursRule,
  describeSchedule,
  isValidBusinessHours,
} from "@/lib/pbx/admin-schedules";

const ROUTES = [
  { value: "transfer", label: "Extension" },
  { value: "voicemail", label: "Voicemail" },
  { value: "ivr", label: "IVR" },
  { value: "hangup", label: "End call" },
] as const;

type RouteAction = (typeof ROUTES)[number]["value"];

export default function AdminSchedules() {
  return (
    <AdminWorkspaceBoundary requiresImplicitTenant>
      <AdminSchedulesContent />
    </AdminWorkspaceBoundary>
  );
}

function AdminSchedulesContent() {
  const colors = useColors();
  const tenantQuery = useTenant();
  const tenantId = tenantQuery.data?.id ?? 0;
  const capabilitiesQuery = usePbxCapabilities(tenantQuery.isSuccess);
  const businessHoursAvailable = capabilitiesQuery.data?.businessHours === true;
  const schedulesQuery = useTimeConditions(tenantId, businessHoursAvailable);
  const createMutation = useCreateTimeCondition();
  const updateMutation = useUpdateTimeCondition();
  const rulesMutation = useSetTimeConditionRules();
  const deleteMutation = useDeleteTimeCondition();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number>();
  const scheduleQuery = useTimeCondition(editingId ?? 0, businessHoursAvailable);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Bangkok");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [openAction, setOpenAction] = useState<RouteAction>("transfer");
  const [openTarget, setOpenTarget] = useState("");
  const [closedAction, setClosedAction] = useState<RouteAction>("voicemail");
  const [closedTarget, setClosedTarget] = useState("");

  const schedules = schedulesQuery.data ?? [];
  const isSaving =
    createMutation.isPending || rulesMutation.isPending || updateMutation.isPending;

  const resetForm = () => {
    setName("");
    setTimezone(tenantQuery.data?.timezone || "Asia/Bangkok");
    setStartTime("09:00");
    setEndTime("18:00");
    setOpenAction("transfer");
    setOpenTarget("");
    setClosedAction("voicemail");
    setClosedTarget("");
  };

  useEffect(() => {
    if (!editingId || !scheduleQuery.data) return;
    const schedule = scheduleQuery.data as any;
    const hours = businessHoursFromRules(schedule.rules);
    setName(schedule.name || "");
    setTimezone(schedule.timezone || "Asia/Bangkok");
    setStartTime(hours.startTime);
    setEndTime(hours.endTime);
    setOpenAction(asRouteAction(schedule.match_action, "transfer"));
    setOpenTarget(schedule.match_target || "");
    setClosedAction(asRouteAction(schedule.nomatch_action, "voicemail"));
    setClosedTarget(schedule.nomatch_target || "");
  }, [editingId, scheduleQuery.data]);

  const closeForm = () => {
    setShowCreate(false);
    setEditingId(undefined);
    resetForm();
  };

  const handleSave = async () => {
    if (!tenantId || !name.trim()) {
      Alert.alert("Missing details", "Enter a schedule name.");
      return;
    }
    if (!isValidBusinessHours(startTime, endTime)) {
      Alert.alert(
        "Invalid hours",
        "Use 24-hour times such as 09:00 and 18:00. Closing must be later than opening.",
      );
      return;
    }
    if (!timezone.trim()) {
      Alert.alert("Missing details", "Enter the schedule timezone.");
      return;
    }
    if (
      (openAction !== "hangup" && !openTarget.trim()) ||
      (closedAction !== "hangup" && !closedTarget.trim())
    ) {
      Alert.alert(
        "Missing destination",
        "Enter both open and closed destinations.",
      );
      return;
    }

    let createdId: number | undefined;
    try {
      const schedule = {
        name: name.trim(),
        description: `Monday–Friday, ${startTime}–${endTime}`,
        timezone: timezone.trim(),
        match_action: openAction,
        match_target: openAction === "hangup" ? undefined : openTarget.trim(),
        nomatch_action: closedAction,
        nomatch_target:
          closedAction === "hangup" ? undefined : closedTarget.trim(),
      };
      const rules = [buildBusinessHoursRule(startTime, endTime)];
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, ...schedule, rules });
      } else {
        const created = await createMutation.mutateAsync({ tenant_id: tenantId, ...schedule });
        createdId = created.id;
        await rulesMutation.mutateAsync({
          time_condition_id: created.id,
          rules,
        });
      }
      closeForm();
      void schedulesQuery.refetch().catch(() => undefined);
    } catch (error: any) {
      if (createdId) {
        try {
          await deleteMutation.mutateAsync({ id: createdId });
        } catch {
          // The partial schedule remains visible after refresh so the admin can remove it.
        }
      }
      Alert.alert(
        editingId ? "Schedule not updated" : "Schedule not created",
        error?.message || "Please try again.",
      );
    }
  };

  const handleDelete = (id: number, scheduleName: string) => {
    Alert.alert(
      "Delete business hours?",
      `“${scheduleName}” will no longer control routing.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync({ id });
            } catch (error: any) {
              Alert.alert(
                "Schedule not deleted",
                error?.message || "Please try again.",
              );
            }
          },
        },
      ],
    );
  };

  const renderSchedule = ({ item }: { item: any }) => {
    const routes = describeSchedule(item);
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.icon, { backgroundColor: "#F9731615" }]}>
            <IconSymbol name="clock.fill" size={20} color="#F97316" />
          </View>
          <View style={styles.cardTitle}>
            <Text style={[styles.name, { color: colors.foreground }]}>
              {item.name}
            </Text>
            <Text style={[styles.description, { color: colors.muted }]}>
              {item.description || item.timezone || "Business hours"}
            </Text>
          </View>
          <View
            style={[
              styles.badge,
              { backgroundColor: colors.primary + "15" },
            ]}
          >
            <Text style={[styles.badgeText, { color: colors.primary }]}>
              CONFIGURED
            </Text>
          </View>
        </View>
        <View style={[styles.routeRows, { borderTopColor: colors.border }]}>
          <RouteRow label="Open" value={routes.open} colors={colors} />
          <RouteRow label="Closed" value={routes.closed} colors={colors} />
        </View>
        <View style={[styles.cardFooter, { borderTopColor: colors.border }]}>
          <Text style={[styles.ruleCount, { color: colors.muted }]}>
            {Number(item.rule_count) || 0} time rule
            {(Number(item.rule_count) || 0) === 1 ? "" : "s"}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Edit ${item.name}`}
            style={[styles.editButton, { borderColor: colors.border }]}
            onPress={() => {
              resetForm();
              setEditingId(item.id);
              setShowCreate(true);
            }}
          >
            <Text style={[styles.editText, { color: colors.primary }]}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Delete ${item.name}`}
            style={styles.deleteButton}
            onPress={() => handleDelete(item.id, item.name)}
          >
            <IconSymbol name="trash.fill" size={15} color="#EF4444" />
            <Text style={styles.deleteText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const loading = tenantQuery.isLoading || schedulesQuery.isLoading;
  const error = tenantQuery.error || schedulesQuery.error;

  if (capabilitiesQuery.isLoading) {
    return (
      <UnavailableAdminScreen
        checking
        title="Business hours"
        description="Phone11 is checking whether business-hours management is available for this workspace."
      />
    );
  }

  if (!businessHoursAvailable) {
    return (
      <UnavailableAdminScreen
        title="Business hours"
        description="This feature is not available for your workspace yet. Phone11 will not load or change call schedules."
      />
    );
  }

  return (
    <ScreenContainer>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Business hours
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Route calls by working hours
          </Text>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Create business hours"
          style={[styles.addButton, { backgroundColor: colors.primary }]}
          onPress={() => {
            resetForm();
            setEditingId(undefined);
            setShowCreate(true);
          }}
          disabled={!tenantId}
        >
          <IconSymbol name="plus" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.centerText, { color: colors.muted }]}>
            Loading business hours…
          </Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Couldn’t load business hours
          </Text>
          <TouchableOpacity onPress={() => schedulesQuery.refetch()}>
            <Text style={[styles.retryText, { color: colors.primary }]}>
              Try again
            </Text>
          </TouchableOpacity>
        </View>
      ) : schedules.length === 0 ? (
        <View style={styles.center}>
          <IconSymbol name="clock.fill" size={46} color={colors.muted} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No business hours
          </Text>
          <Text style={[styles.emptyText, { color: colors.muted }]}>
            Create weekday hours and choose where calls go when the office is
            closed.
          </Text>
        </View>
      ) : (
        <FlatList
          data={schedules}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={renderSchedule}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshing={schedulesQuery.isRefetching}
          onRefresh={schedulesQuery.refetch}
        />
      )}

      <Modal
        visible={showCreate}
        animationType="slide"
        transparent
        onRequestClose={closeForm}
      >
        <View style={styles.overlay}>
          <View
            style={[
              styles.modal,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View
              style={[styles.modalHeader, { borderBottomColor: colors.border }]}
            >
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                {editingId ? "Edit business hours" : "New business hours"}
              </Text>
              <TouchableOpacity onPress={closeForm}>
                <IconSymbol
                  name="xmark.circle.fill"
                  size={24}
                  color={colors.muted}
                />
              </TouchableOpacity>
            </View>
            {editingId && scheduleQuery.isLoading ? (
              <View style={styles.editorLoading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : editingId && scheduleQuery.isError ? (
              <View style={styles.editorLoading}>
                <Text style={[styles.description, { color: colors.muted }]}>
                  Couldn’t load this schedule. Close and try again.
                </Text>
              </View>
            ) : (
              <ScrollView
                style={styles.modalBody}
                keyboardShouldPersistTaps="handled"
              >
              <Label text="Name" colors={colors} />
              <TextInput
                style={inputStyle(colors)}
                value={name}
                onChangeText={setName}
                placeholder="Main office"
                placeholderTextColor={colors.muted}
              />
              <Label text="Timezone" colors={colors} />
              <TextInput
                style={inputStyle(colors)}
                value={timezone}
                onChangeText={setTimezone}
                placeholder="Asia/Bangkok"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
              />
              <Text style={[styles.weekdays, { color: colors.foreground }]}>
                Monday to Friday
              </Text>
              <View style={styles.timeRow}>
                <View style={styles.timeField}>
                  <Label text="Opens" colors={colors} />
                  <TextInput
                    style={inputStyle(colors)}
                    value={startTime}
                    onChangeText={setStartTime}
                    placeholder="09:00"
                    placeholderTextColor={colors.muted}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
                <View style={styles.timeField}>
                  <Label text="Closes" colors={colors} />
                  <TextInput
                    style={inputStyle(colors)}
                    value={endTime}
                    onChangeText={setEndTime}
                    placeholder="18:00"
                    placeholderTextColor={colors.muted}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
              </View>
              <RouteEditor
                label="During business hours"
                action={openAction}
                target={openTarget}
                onAction={setOpenAction}
                onTarget={setOpenTarget}
                colors={colors}
              />
              <RouteEditor
                label="When closed"
                action={closedAction}
                target={closedTarget}
                onAction={setClosedAction}
                onTarget={setClosedTarget}
                colors={colors}
              />
              </ScrollView>
            )}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.cancelButton, { borderColor: colors.border }]}
                onPress={closeForm}
              >
                <Text style={[styles.cancelText, { color: colors.muted }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.createButton,
                  { backgroundColor: colors.primary },
                ]}
                onPress={handleSave}
                disabled={
                  isSaving ||
                  (Boolean(editingId) && (scheduleQuery.isLoading || scheduleQuery.isError))
                }
              >
                {isSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.createText}>
                    {editingId ? "Save changes" : "Create hours"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function asRouteAction(value: unknown, fallback: RouteAction): RouteAction {
  return ROUTES.some((route) => route.value === value)
    ? (value as RouteAction)
    : fallback;
}

function RouteEditor(props: {
  label: string;
  action: RouteAction;
  target: string;
  onAction: (action: RouteAction) => void;
  onTarget: (target: string) => void;
  colors: any;
}) {
  return (
    <>
      <Label text={props.label} colors={props.colors} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.routeChoices}>
          {ROUTES.map((route) => (
            <TouchableOpacity
              key={route.value}
              style={[
                styles.choice,
                {
                  borderColor:
                    props.action === route.value
                      ? props.colors.primary
                      : props.colors.border,
                },
                props.action === route.value && {
                  backgroundColor: props.colors.primary + "12",
                },
              ]}
              onPress={() => props.onAction(route.value)}
            >
              <Text
                style={[
                  styles.choiceText,
                  {
                    color:
                      props.action === route.value
                        ? props.colors.primary
                        : props.colors.foreground,
                  },
                ]}
              >
                {route.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      {props.action !== "hangup" && (
        <TextInput
          style={[inputStyle(props.colors), styles.targetInput]}
          value={props.target}
          onChangeText={props.onTarget}
          placeholder="Destination number"
          placeholderTextColor={props.colors.muted}
          keyboardType="phone-pad"
        />
      )}
    </>
  );
}

function RouteRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: any;
}) {
  return (
    <View style={styles.routeRow}>
      <Text style={[styles.routeLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.routeValue, { color: colors.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

function Label({ text, colors }: { text: string; colors: any }) {
  return <Text style={[styles.label, { color: colors.muted }]}>{text}</Text>;
}

function inputStyle(colors: any) {
  return [
    styles.input,
    {
      color: colors.foreground,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
  ];
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    gap: 12,
  },
  backButton: { padding: 4 },
  headerCopy: { flex: 1 },
  title: { fontSize: 20, fontWeight: "700" },
  subtitle: { fontSize: 12, marginTop: 1 },
  addButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { padding: 16, gap: 12 },
  card: { borderRadius: 14, borderWidth: 0.5, overflow: "hidden" },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { flex: 1 },
  name: { fontSize: 15, fontWeight: "700" },
  description: { fontSize: 12, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  routeRows: { borderTopWidth: 0.5, padding: 12, gap: 8 },
  routeRow: { flexDirection: "row", gap: 12 },
  routeLabel: { width: 54, fontSize: 12 },
  routeValue: { flex: 1, fontSize: 12, textTransform: "capitalize" },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 10,
    borderTopWidth: 0.5,
  },
  ruleCount: { fontSize: 11 },
  editButton: {
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginLeft: "auto",
  },
  editText: { fontSize: 12, fontWeight: "600" },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 6,
    gap: 5,
  },
  deleteText: { color: "#EF4444", fontSize: 12, fontWeight: "600" },
  center: { alignItems: "center", padding: 40, gap: 10 },
  centerText: { fontSize: 13 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptyText: { fontSize: 13, lineHeight: 18, textAlign: "center" },
  retryText: { fontSize: 14, fontWeight: "600", padding: 8 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modal: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 0.5,
    maxHeight: "90%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 0.5,
  },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  modalBody: { padding: 16 },
  editorLoading: { minHeight: 180, alignItems: "center", justifyContent: "center", padding: 16 },
  label: { fontSize: 12, fontWeight: "600", marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 0.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  weekdays: { fontSize: 14, fontWeight: "600", marginTop: 18 },
  timeRow: { flexDirection: "row", gap: 12 },
  timeField: { flex: 1 },
  routeChoices: { flexDirection: "row", gap: 8 },
  choice: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  choiceText: { fontSize: 12, fontWeight: "600" },
  targetInput: { marginTop: 8 },
  modalFooter: { flexDirection: "row", padding: 16, gap: 12 },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelText: { fontSize: 15, fontWeight: "600" },
  createButton: {
    flex: 2,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  createText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
