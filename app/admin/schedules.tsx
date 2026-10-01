import { useEffect, useState } from "react";
import { AdminWorkspaceBoundary } from "@/components/admin/admin-workspace-boundary";
import {
  Platform, useWindowDimensions,
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
  buildScheduleRules,
  BUSINESS_WEEK,
  describeSchedule,
  SCHEDULE_DAYS,
  isValidScheduleTimezone,
  parseEditableScheduleRules,
  validateEditableSchedule,
  type BusinessInterval,
  type HolidayRange,
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
  const { width } = useWindowDimensions();
  const wideWeb = Platform.OS === "web" && width >= 1000;
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
  const [intervals, setIntervals] = useState<BusinessInterval[]>([{ startTime: "09:00", endTime: "18:00" }]);
  const [holidays, setHolidays] = useState<HolidayRange[]>([]);
  const [expandedDateWindows, setExpandedDateWindows] = useState<number[]>([]);
  const [unsupportedRules, setUnsupportedRules] = useState<string>();
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
    setIntervals([{ startTime: "09:00", endTime: "18:00" }]);
    setHolidays([]);
    setExpandedDateWindows([]);
    setUnsupportedRules(undefined);
    setOpenAction("transfer");
    setOpenTarget("");
    setClosedAction("voicemail");
    setClosedTarget("");
  };

  useEffect(() => {
    if (!editingId || !scheduleQuery.data) return;
    const schedule = scheduleQuery.data as any;
    const parsed = parseEditableScheduleRules(schedule.rules);
    setName(schedule.name || "");
    setTimezone(schedule.timezone || "Asia/Bangkok");
    setUnsupportedRules(parsed.ok ? undefined : parsed.reason);
    if (parsed.ok) {
      setIntervals(parsed.schedule.intervals);
      setHolidays(parsed.schedule.holidays);
    }
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
    if (unsupportedRules) {
      Alert.alert("Schedule cannot be edited", unsupportedRules);
      return;
    }
    const ruleIssue = validateEditableSchedule({ intervals, holidays });
    if (ruleIssue) {
      Alert.alert("Invalid schedule", ruleIssue);
      return;
    }
    if (!isValidScheduleTimezone(timezone.trim())) {
      Alert.alert("Invalid timezone", "Use a timezone such as Asia/Bangkok.");
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
        description: `${intervals.length} time ${intervals.length === 1 ? "range" : "ranges"}${holidays.length ? `, ${holidays.length} holiday ${holidays.length === 1 ? "closure" : "closures"}` : ""}`,
        timezone: timezone.trim(),
        match_action: openAction,
        match_target: openAction === "hangup" ? undefined : openTarget.trim(),
        nomatch_action: closedAction,
        nomatch_target:
          closedAction === "hangup" ? undefined : closedTarget.trim(),
      };
      const rules = buildScheduleRules({ intervals, holidays });
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
    <ScreenContainer style={Platform.OS === "web" ? { backgroundColor: colors.surface, paddingHorizontal: wideWeb ? 32 : 0, paddingTop: wideWeb ? 20 : 0 } : undefined}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {Platform.OS !== "web" ? (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to administration" onPress={() => router.back()} style={styles.backButton}>
            <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground, fontSize: wideWeb ? 28 : 20 }]}>
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
            Configure weekday hours and holiday closures, then choose the open and closed destinations.
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
        <View style={[styles.overlay, wideWeb ? { justifyContent: "center", alignItems: "center" } : undefined]}>
          <View
            style={[
              styles.modal,
              wideWeb ? { width: 680, borderRadius: 16 } : undefined,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View
              style={[styles.modalHeader, { borderBottomColor: colors.border }]}
            >
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                {editingId ? "Edit business hours" : "New business hours"}
              </Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close business hours editor" onPress={closeForm}>
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
              <Text style={[styles.helper, { color: colors.muted }]}>Times and holiday dates use this timezone. Holiday closures take priority over weekday hours.</Text>
              {unsupportedRules ? <Text style={styles.errorText}>{unsupportedRules} Saving is disabled to protect existing rules.</Text> : null}
              <Text style={[styles.weekdays, { color: colors.foreground }]}>Business hours</Text>
              {intervals.map((interval, index) => (
                <View key={`interval-${index}`}>
                <Label text={`Days for time range ${index + 1}`} colors={colors} />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {SCHEDULE_DAYS.map((day) => {
                    const intervalDays: readonly number[] = interval.days ?? BUSINESS_WEEK;
                    const selected = intervalDays.includes(day.value);
                    return <TouchableOpacity key={day.value} accessibilityRole="checkbox" accessibilityLabel={`${day.label} for time range ${index + 1}`} accessibilityState={{ checked: selected }} onPress={() => setIntervals((current) => current.map((item, itemIndex) => {
                      if (itemIndex !== index) return item;
                      const days = item.days ?? [...BUSINESS_WEEK];
                      return { ...item, days: days.includes(day.value) ? days.filter((value) => value !== day.value) : [...days, day.value] };
                    }))} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : colors.surface }}><Text style={{ color: selected ? "#FFFFFF" : colors.foreground }}>{day.short}</Text></TouchableOpacity>;
                  })}
                </View>
                <View style={styles.timeRow}>
                  <View style={styles.timeField}>
                    <Label text={`Opens ${index + 1}`} colors={colors} />
                    <TextInput style={inputStyle(colors)} value={interval.startTime} onChangeText={(value) => setIntervals((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, startTime: value } : item))} placeholder="09:00" placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation" />
                  </View>
                  <View style={styles.timeField}>
                    <Label text="Closes" colors={colors} />
                    <TextInput style={inputStyle(colors)} value={interval.endTime} onChangeText={(value) => setIntervals((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, endTime: value } : item))} placeholder="18:00" placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation" />
                  </View>
                  {intervals.length > 1 ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove time range ${index + 1}`} onPress={() => { setIntervals((current) => current.filter((_, itemIndex) => itemIndex !== index)); setExpandedDateWindows((current) => current.filter((itemIndex) => itemIndex !== index).map((itemIndex) => itemIndex > index ? itemIndex - 1 : itemIndex)); }} style={styles.removeButton}><Text style={styles.removeText}>Remove</Text></TouchableOpacity> : null}
                </View>
                {!interval.startDate && !interval.endDate && !expandedDateWindows.includes(index) ? (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Limit time range ${index + 1} to dates`} onPress={() => setExpandedDateWindows((current) => [...current, index])} style={styles.addRowButton}><Text style={{ color: colors.primary }}>Limit to dates</Text></TouchableOpacity>
                ) : (
                <>
                <Text style={[styles.helper, { color: colors.muted }]}>Optional dates for this weekday range; enter both dates to limit it.</Text>
                <View style={styles.timeRow}>
                  <View style={styles.timeField}><Label text="First date" colors={colors} /><TextInput style={inputStyle(colors)} value={interval.startDate || ""} onChangeText={(value) => setIntervals((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, startDate: value } : item))} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} autoCapitalize="none" /></View>
                  <View style={styles.timeField}><Label text="Last date" colors={colors} /><TextInput style={inputStyle(colors)} value={interval.endDate || ""} onChangeText={(value) => setIntervals((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, endDate: value } : item))} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} autoCapitalize="none" /></View>
                </View>
                {!interval.startDate && !interval.endDate ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Hide date limit for range ${index + 1}`} onPress={() => setExpandedDateWindows((current) => current.filter((itemIndex) => itemIndex !== index))} style={styles.addRowButton}><Text style={{ color: colors.muted }}>Hide dates</Text></TouchableOpacity> : null}
                </>
                )}
                </View>
              ))}
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add time range" onPress={() => setIntervals((current) => [...current, { startTime: "13:00", endTime: "18:00" }])} style={styles.addRowButton}><Text style={{ color: colors.primary }}>+ Add time range</Text></TouchableOpacity>
              <Text style={[styles.weekdays, { color: colors.foreground }]}>Holiday closures</Text>
              {holidays.map((holiday, index) => (
                <View key={`holiday-${index}`}>
                  <Label text={`Holiday ${index + 1} name (optional)`} colors={colors} />
                  <TextInput style={inputStyle(colors)} value={holiday.label} onChangeText={(value) => setHolidays((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: value } : item))} placeholder="Public holiday" placeholderTextColor={colors.muted} />
                  <View style={styles.timeRow}>
                    <View style={styles.timeField}><Label text="First date" colors={colors} /><TextInput style={inputStyle(colors)} value={holiday.startDate} onChangeText={(value) => setHolidays((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, startDate: value } : item))} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} autoCapitalize="none" /></View>
                    <View style={styles.timeField}><Label text="Last date" colors={colors} /><TextInput style={inputStyle(colors)} value={holiday.endDate} onChangeText={(value) => setHolidays((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, endDate: value } : item))} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} autoCapitalize="none" /></View>
                  </View>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove holiday ${index + 1}`} onPress={() => setHolidays((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.addRowButton}><Text style={styles.removeText}>Remove holiday</Text></TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add holiday closure" onPress={() => setHolidays((current) => [...current, { startDate: "", endDate: "", label: "" }])} style={styles.addRowButton}><Text style={{ color: colors.primary }}>+ Add holiday closure</Text></TouchableOpacity>
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
                  (Boolean(editingId) && (scheduleQuery.isLoading || scheduleQuery.isError || Boolean(unsupportedRules)))
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
  helper: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  errorText: { color: "#DC2626", fontSize: 12, marginTop: 10 },
  timeRow: { flexDirection: "row", gap: 12 },
  timeField: { flex: 1 },
  removeButton: { justifyContent: "flex-end", paddingBottom: 15 },
  removeText: { color: "#DC2626", fontSize: 12 },
  addRowButton: { alignSelf: "flex-start", paddingVertical: 10 },
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
