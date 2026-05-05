import { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Switch, TextInput } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface ForwardingRule {
  id: string;
  name: string;
  type: "unconditional" | "busy" | "no-answer" | "unreachable" | "time-based";
  enabled: boolean;
  destination: string;
  ringTimeout?: number;
  schedule?: { days: string; startTime: string; endTime: string };
}

const INITIAL_RULES: ForwardingRule[] = [
  { id: "1", name: "Always Forward", type: "unconditional", enabled: false, destination: "" },
  { id: "2", name: "When Busy", type: "busy", enabled: true, destination: "+1 (555) 100-1002" },
  { id: "3", name: "No Answer", type: "no-answer", enabled: true, destination: "Voicemail", ringTimeout: 20 },
  { id: "4", name: "Unreachable", type: "unreachable", enabled: true, destination: "Voicemail" },
  { id: "5", name: "After Hours", type: "time-based", enabled: true, destination: "IVR: After Hours", schedule: { days: "Mon-Fri", startTime: "18:00", endTime: "09:00" } },
  { id: "6", name: "Weekend", type: "time-based", enabled: true, destination: "IVR: Weekend Menu", schedule: { days: "Sat-Sun", startTime: "00:00", endTime: "23:59" } },
];

const TYPE_ICONS: Record<string, any> = {
  unconditional: "arrow.right",
  busy: "phone.down.fill",
  "no-answer": "clock.fill",
  unreachable: "wifi.slash",
  "time-based": "calendar",
};

export default function ForwardingScreen() {
  const colors = useColors();
  const [rules, setRules] = useState(INITIAL_RULES);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dndEnabled, setDndEnabled] = useState(false);
  const [simultaneousRing, setSimultaneousRing] = useState(false);
  const [simRingNumbers, setSimRingNumbers] = useState("+1 (555) 987-6543");

  const toggleRule = (id: string) => {
    setRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Call Forwarding</Text>
        <TouchableOpacity onPress={() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)}>
          <Text style={[styles.saveBtn, { color: colors.primary }]}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* DND Toggle */}
        <View style={[styles.dndCard, { backgroundColor: colors.error + "10", borderColor: colors.error + "30" }]}>
          <View style={styles.dndInfo}>
            <View style={[styles.dndIcon, { backgroundColor: colors.error + "20" }]}>
              <IconSymbol name="bell.slash.fill" size={18} color={colors.error} />
            </View>
            <View style={styles.dndText}>
              <Text style={[styles.dndTitle, { color: colors.foreground }]}>Do Not Disturb</Text>
              <Text style={[styles.dndSub, { color: colors.muted }]}>Send all calls to voicemail</Text>
            </View>
          </View>
          <Switch
            value={dndEnabled}
            onValueChange={(v) => { setDndEnabled(v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
            trackColor={{ false: colors.border, true: colors.error }}
          />
        </View>

        {/* Simultaneous Ring */}
        <View style={[styles.simRingCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.simRingHeader}>
            <View style={styles.dndInfo}>
              <View style={[styles.dndIcon, { backgroundColor: colors.primary + "15" }]}>
                <IconSymbol name="phone.fill" size={18} color={colors.primary} />
              </View>
              <View style={styles.dndText}>
                <Text style={[styles.dndTitle, { color: colors.foreground }]}>Simultaneous Ring</Text>
                <Text style={[styles.dndSub, { color: colors.muted }]}>Ring multiple devices at once</Text>
              </View>
            </View>
            <Switch
              value={simultaneousRing}
              onValueChange={(v) => { setSimultaneousRing(v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
          {simultaneousRing && (
            <View style={[styles.simRingInput, { borderTopColor: colors.border }]}>
              <Text style={[styles.simRingLabel, { color: colors.muted }]}>Also ring:</Text>
              <TextInput
                style={[styles.simRingField, { color: colors.foreground, borderColor: colors.border }]}
                value={simRingNumbers}
                onChangeText={setSimRingNumbers}
                placeholder="Enter phone number"
                placeholderTextColor={colors.muted}
              />
            </View>
          )}
        </View>

        {/* Forwarding Rules */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Forwarding Rules</Text>
        <Text style={[styles.sectionHint, { color: colors.muted }]}>
          Rules are evaluated in order. The first matching rule will be applied.
        </Text>

        {rules.map((rule) => (
          <TouchableOpacity
            key={rule.id}
            style={[styles.ruleCard, { backgroundColor: colors.surface, borderColor: rule.enabled ? colors.primary + "40" : colors.border }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setExpandedId(expandedId === rule.id ? null : rule.id);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.ruleMain}>
              <View style={[styles.ruleIcon, { backgroundColor: rule.enabled ? colors.primary + "15" : colors.border + "40" }]}>
                <IconSymbol name={TYPE_ICONS[rule.type]} size={18} color={rule.enabled ? colors.primary : colors.muted} />
              </View>
              <View style={styles.ruleInfo}>
                <Text style={[styles.ruleName, { color: colors.foreground }]}>{rule.name}</Text>
                <Text style={[styles.ruleType, { color: colors.muted }]}>
                  {rule.type === "no-answer" && rule.ringTimeout ? `After ${rule.ringTimeout}s → ` : ""}
                  {rule.destination || "Not configured"}
                </Text>
                {rule.schedule && (
                  <Text style={[styles.ruleSchedule, { color: colors.primary }]}>
                    {rule.schedule.days} · {rule.schedule.startTime}–{rule.schedule.endTime}
                  </Text>
                )}
              </View>
              <Switch
                value={rule.enabled}
                onValueChange={() => toggleRule(rule.id)}
                trackColor={{ false: colors.border, true: colors.primary }}
              />
            </View>

            {expandedId === rule.id && (
              <View style={[styles.ruleExpanded, { borderTopColor: colors.border }]}>
                <View style={styles.expandedField}>
                  <Text style={[styles.expandedLabel, { color: colors.muted }]}>Forward to:</Text>
                  <TextInput
                    style={[styles.expandedInput, { color: colors.foreground, borderColor: colors.border }]}
                    value={rule.destination}
                    placeholder="Phone, extension, or voicemail"
                    placeholderTextColor={colors.muted}
                    onChangeText={(v) => setRules(rules.map(r => r.id === rule.id ? { ...r, destination: v } : r))}
                  />
                </View>
                {rule.type === "no-answer" && (
                  <View style={styles.expandedField}>
                    <Text style={[styles.expandedLabel, { color: colors.muted }]}>Ring timeout (seconds):</Text>
                    <TextInput
                      style={[styles.expandedInput, { color: colors.foreground, borderColor: colors.border }]}
                      value={String(rule.ringTimeout || 20)}
                      keyboardType="numeric"
                      onChangeText={(v) => setRules(rules.map(r => r.id === rule.id ? { ...r, ringTimeout: parseInt(v) || 20 } : r))}
                    />
                  </View>
                )}
                {rule.type === "time-based" && rule.schedule && (
                  <>
                    <View style={styles.expandedField}>
                      <Text style={[styles.expandedLabel, { color: colors.muted }]}>Days:</Text>
                      <TextInput
                        style={[styles.expandedInput, { color: colors.foreground, borderColor: colors.border }]}
                        value={rule.schedule.days}
                        onChangeText={(v) => setRules(rules.map(r => r.id === rule.id ? { ...r, schedule: { ...r.schedule!, days: v } } : r))}
                      />
                    </View>
                    <View style={styles.timeRow}>
                      <View style={[styles.expandedField, { flex: 1 }]}>
                        <Text style={[styles.expandedLabel, { color: colors.muted }]}>Start:</Text>
                        <TextInput
                          style={[styles.expandedInput, { color: colors.foreground, borderColor: colors.border }]}
                          value={rule.schedule.startTime}
                          onChangeText={(v) => setRules(rules.map(r => r.id === rule.id ? { ...r, schedule: { ...r.schedule!, startTime: v } } : r))}
                        />
                      </View>
                      <View style={[styles.expandedField, { flex: 1 }]}>
                        <Text style={[styles.expandedLabel, { color: colors.muted }]}>End:</Text>
                        <TextInput
                          style={[styles.expandedInput, { color: colors.foreground, borderColor: colors.border }]}
                          value={rule.schedule.endTime}
                          onChangeText={(v) => setRules(rules.map(r => r.id === rule.id ? { ...r, schedule: { ...r.schedule!, endTime: v } } : r))}
                        />
                      </View>
                    </View>
                  </>
                )}
              </View>
            )}
          </TouchableOpacity>
        ))}

        {/* Add Rule Button */}
        <TouchableOpacity
          style={[styles.addRuleBtn, { borderColor: colors.primary }]}
          onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
        >
          <IconSymbol name="plus" size={16} color={colors.primary} />
          <Text style={[styles.addRuleText, { color: colors.primary }]}>Add Custom Rule</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  saveBtn: { fontSize: 15, fontWeight: "600" },
  content: { paddingBottom: 20 },
  dndCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", margin: 16, padding: 16, borderRadius: 12, borderWidth: 1 },
  dndInfo: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  dndIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dndText: { flex: 1 },
  dndTitle: { fontSize: 14, fontWeight: "600" },
  dndSub: { fontSize: 12, marginTop: 2 },
  simRingCard: { marginHorizontal: 16, marginBottom: 16, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  simRingHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  simRingInput: { paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: 0.5 },
  simRingLabel: { fontSize: 12, fontWeight: "600", marginTop: 12, marginBottom: 6 },
  simRingField: { fontSize: 14, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "700", paddingHorizontal: 16, marginBottom: 4 },
  sectionHint: { fontSize: 12, paddingHorizontal: 16, marginBottom: 12 },
  ruleCard: { marginHorizontal: 16, marginBottom: 8, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  ruleMain: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  ruleIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  ruleInfo: { flex: 1 },
  ruleName: { fontSize: 14, fontWeight: "600" },
  ruleType: { fontSize: 12, marginTop: 2 },
  ruleSchedule: { fontSize: 11, fontWeight: "600", marginTop: 2 },
  ruleExpanded: { padding: 14, borderTopWidth: 0.5 },
  expandedField: { marginBottom: 12 },
  expandedLabel: { fontSize: 12, fontWeight: "600", marginBottom: 6 },
  expandedInput: { fontSize: 14, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  timeRow: { flexDirection: "row", gap: 12 },
  addRuleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 16, marginTop: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderStyle: "dashed" },
  addRuleText: { fontSize: 14, fontWeight: "600" },
});
