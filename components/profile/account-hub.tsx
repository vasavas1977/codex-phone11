import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextStyle, type ViewStyle } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import {
  dndExpiryOptions,
  manualAvailabilityOptions,
  statusExpiryOptions,
  type DndDurationMinutes,
  type ManualAvailability,
  type StatusExpiryPreset,
  type WorkspaceProfileStatus,
  type WorkspaceProfileUpdate,
  type WorkLocation,
} from "@/lib/profile/contracts";

export type AccountHubIdentity = { name: string | null; email: string | null };
export type AccountHubPhone = { extension: string } | null;
type IconName = ComponentProps<typeof IconSymbol>["name"];

export function accountInitials(name: string | null): string {
  const initials = (name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part.slice(0, 1).toLocaleUpperCase()).join("");
  return initials || "P";
}

export function availabilitySummary(availability: ManualAvailability | null): string {
  return availability === "out_of_office" ? "Out of office"
    : availability === "dnd" ? "Do not disturb"
    : availability ? availability.slice(0, 1).toLocaleUpperCase() + availability.slice(1)
    : "Automatic";
}

export const workspaceStatusPresets = [
  { label: "In a meeting", text: "In a meeting", expiry: "1h" },
  { label: "Commuting", text: "Commuting", expiry: "1h" },
  { label: "Vacation", text: "Vacation", expiry: "always" },
  { label: "Working remotely", text: "Working remotely", expiry: "today" },
] as const;

export function statusExpiryLabel(expiry: StatusExpiryPreset): string {
  return statusExpiryOptions.find((option) => option.value === expiry)?.label ?? "Always";
}

export function statusDisplayTimeLabel(expiry: StatusExpiryPreset | undefined, expiresAt: Date | null): string {
  if (expiry !== undefined) return statusExpiryLabel(expiry);
  if (!expiresAt) return "Always";
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return "Scheduled end";
  return `Until ${end.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

function workLocationSummary(location: WorkLocation | null): string {
  return location === "office" ? "Office" : location === "remote" ? "Remote" : "Off";
}

type AccountHubProps = {
  identity: AccountHubIdentity | null;
  phone: AccountHubPhone;
  onBack: () => void;
  onOpenSettings: () => void;
  workspaceProfile?: WorkspaceProfileStatus;
  profileAvailable?: boolean;
  profileSaving?: boolean;
  profileError?: string | null;
  onUpdateWorkspaceProfile?: (update: WorkspaceProfileUpdate) => Promise<unknown>;
  workspaceName?: string | null;
  isPreview?: boolean;
};

function MenuRow({ icon, title, detail, onPress, last = false }: { icon: IconName; title: string; detail: string; onPress: () => void; last?: boolean }) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
    style={({ pressed }) => [styles.row, { borderBottomColor: colors.border, opacity: pressed ? 0.72 : 1 }, last && styles.lastRow]}>
    <View style={[styles.rowIcon, { backgroundColor: colors.primary + "18" }]}><IconSymbol name={icon} size={19} color={colors.primary} /></View>
    <View style={styles.rowContent}><Text style={[styles.rowTitle, { color: colors.foreground }]}>{title}</Text><Text numberOfLines={1} style={[styles.rowDetail, { color: colors.muted }]}>{detail}</Text></View>
    <IconSymbol name="chevron.right" size={19} color={colors.muted} />
  </Pressable>;
}

function Sheet({ visible, title, onClose, children, keyboardSafe = false }: { visible: boolean; title: string; onClose: () => void; children: ReactNode; keyboardSafe?: boolean }) {
  const colors = useColors();
  const content = <View style={styles.sheetBackdrop}>
    <Pressable accessibilityRole="button" accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose} />
    <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.background }]}>
      <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
        <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.foreground }]}>{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.closeButton}><IconSymbol name="xmark" size={20} color={colors.foreground} /></Pressable>
      </View>
      {children}
    </View>
  </View>;
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
    {keyboardSafe ? <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboardSheet}>{content}</KeyboardAvoidingView> : content}
  </Modal>;
}

function SheetChoice({ label, detail, selected, disabled, disclosure = false, onPress }: { label: string; detail?: string; selected?: boolean; disabled?: boolean; disclosure?: boolean; onPress: () => void }) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.sheetChoice, { borderBottomColor: colors.border, opacity: disabled ? 0.5 : pressed ? 0.72 : 1 }]}>
    <View style={styles.rowContent}><Text style={[styles.rowTitle, { color: colors.foreground }]}>{label}</Text>{detail && <Text style={[styles.rowDetail, { color: colors.muted }]}>{detail}</Text>}</View>
    {selected && <IconSymbol name="checkmark" size={20} color={colors.primary} />}
    {disclosure && <IconSymbol name="chevron.right" size={19} color={colors.muted} />}
  </Pressable>;
}

function StatusEditor({ profile, visible, saving, onClose, onSave }: { profile: WorkspaceProfileStatus; visible: boolean; saving: boolean; onClose: () => void; onSave: (update: WorkspaceProfileUpdate) => void }) {
  const colors = useColors();
  const [text, setText] = useState(profile.statusText ?? "");
  const [expiry, setExpiry] = useState<StatusExpiryPreset | undefined>();
  const [choosingDisplayTime, setChoosingDisplayTime] = useState(false);
  useEffect(() => { if (visible) { setText(profile.statusText ?? ""); setExpiry(undefined); setChoosingDisplayTime(false); } }, [profile.statusText, visible]);
  const trimmed = text.trim();
  const closeEditor = () => { setChoosingDisplayTime(false); onClose(); };
  const clearStatus = () => onSave({ status: { text: null } });
  const saveStatus = () => {
    const status = trimmed
      ? { text: trimmed, ...(expiry === undefined ? {} : { expiry }) }
      : { text: null };
    onSave({ status });
  };
  return <>
    <Sheet visible={visible && !choosingDisplayTime} title="Set status" onClose={closeEditor} keyboardSafe>
      <ScrollView contentContainerStyle={styles.editorContent} keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"} keyboardShouldPersistTaps="handled">
      <TextInput accessibilityLabel="Status text" value={text} maxLength={280} editable={!saving} onChangeText={setText}
        placeholder="Share a short update" placeholderTextColor={colors.muted} multiline style={[styles.statusInput, { color: colors.foreground, borderColor: colors.border }]} />
      <Text style={[styles.sheetLabel, { color: colors.muted }]}>QUICK STATUS</Text>
      <View style={styles.presetGrid}>
        {workspaceStatusPresets.map((preset) => {
          const selected = text === preset.text && expiry === preset.expiry;
          return <Pressable key={preset.label} accessibilityRole="button" accessibilityLabel={`Set status: ${preset.label}`} accessibilityState={{ selected }} disabled={saving}
            onPress={() => { setText(preset.text); setExpiry(preset.expiry); }}
            style={({ pressed }) => [styles.presetButton, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + "12" : colors.surface, opacity: saving ? 0.5 : pressed ? 0.72 : 1 }]}>
            <Text style={[styles.presetLabel, { color: colors.foreground }]}>{preset.label}</Text>
            <Text style={[styles.presetDetail, { color: colors.muted }]}>{statusExpiryLabel(preset.expiry)}</Text>
          </Pressable>;
        })}
      </View>
      <SheetChoice label="Display time" detail={statusDisplayTimeLabel(expiry, profile.statusExpiresAt)} disabled={saving} disclosure onPress={() => setChoosingDisplayTime(true)} />
      {(profile.statusText || trimmed) && <Pressable accessibilityRole="button" accessibilityLabel="Clear status" disabled={saving} onPress={clearStatus} style={({ pressed }) => [styles.clearStatus, { opacity: saving ? 0.5 : pressed ? 0.72 : 1 }]}><Text style={[styles.clearStatusText, { color: colors.primary }]}>Clear status</Text></Pressable>}
      <View style={styles.sheetActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" disabled={saving} onPress={closeEditor} style={({ pressed }) => [styles.secondaryButton, { borderColor: colors.border, opacity: saving ? 0.5 : pressed ? 0.72 : 1 }]}><Text style={[styles.buttonText, { color: colors.foreground }]}>Cancel</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Save status" disabled={saving} onPress={saveStatus}
          style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.primary, opacity: saving ? 0.5 : pressed ? 0.72 : 1 }]}><Text style={styles.primaryButtonText}>Save</Text></Pressable>
      </View>
      </ScrollView>
    </Sheet>
    <Sheet visible={visible && choosingDisplayTime} title="Display time" onClose={() => setChoosingDisplayTime(false)}>
      <View style={styles.sheetList}>{statusExpiryOptions.map((option) => <SheetChoice key={option.value} label={option.label} selected={expiry === option.value || (expiry === undefined && profile.statusExpiresAt === null && option.value === "always")} disabled={saving} onPress={() => { setExpiry(option.value); setChoosingDisplayTime(false); }} />)}</View>
    </Sheet>
  </>;
}

function AccountDetails({ identity, phone, visible, onClose }: { identity: AccountHubIdentity | null; phone: AccountHubPhone; visible: boolean; onClose: () => void }) {
  const colors = useColors();
  return <Sheet visible={visible} title="My profile" onClose={onClose}>
    <View style={styles.detailsContent}>
      <Text style={[styles.detailsLabel, { color: colors.muted }]}>ACCOUNT</Text>
      <Text style={[styles.detailsValue, { color: colors.foreground }]}>{identity?.name?.trim() || "Your work account"}</Text>
      <Text style={[styles.detailsLabel, { color: colors.muted }]}>EMAIL</Text>
      <Text style={[styles.detailsValue, { color: colors.foreground }]}>{identity?.email?.trim() || "Not signed in"}</Text>
      {phone && <><Text style={[styles.detailsLabel, { color: colors.muted }]}>ASSIGNED EXTENSION</Text><Text style={[styles.detailsValue, { color: colors.foreground }]}>{phone.extension}</Text></>}
      <Text style={[styles.detailsNote, { color: colors.muted }]}>Your company manages account identity and assigned phone number.</Text>
    </View>
  </Sheet>;
}

/** Shows auth-owned identity and server-persisted workspace preferences. */
export function AccountHub({ identity, phone, onBack, onOpenSettings, workspaceProfile, profileAvailable = false, profileSaving = false, profileError = null, onUpdateWorkspaceProfile, workspaceName = null, isPreview = false }: AccountHubProps) {
  const colors = useColors();
  const [sheet, setSheet] = useState<"availability" | "availabilityDuration" | "status" | "location" | "details" | null>(null);
  const [dndDuration, setDndDuration] = useState<DndDurationMinutes>(60);
  const name = identity?.name?.trim() || "Your work account";
  const email = identity?.email?.trim() || "Sign in to view your account";
  const profile = profileAvailable && workspaceProfile && onUpdateWorkspaceProfile ? workspaceProfile : undefined;
  const save = (update: WorkspaceProfileUpdate) => {
    if (!onUpdateWorkspaceProfile) return;
    void onUpdateWorkspaceProfile(update);
    setSheet(null);
  };
  const chooseAvailability = (value: ManualAvailability | null) => {
    if (value === "dnd") { setDndDuration(60); setSheet("availabilityDuration"); return; }
    save({ availability: { value } });
  };
  return <View style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.back}><IconSymbol name="chevron.left" size={23} color={colors.primary} /></Pressable>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Profile</Text><View style={styles.back} />
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {isPreview && <Text style={[styles.preview, { color: colors.muted }]}>Preview only — changes stay in this browser</Text>}
      <View style={styles.identityBlock}>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}><Text accessibilityLabel="Profile initials" style={styles.avatarText}>{accountInitials(identity?.name ?? null)}</Text></View>
        <Text style={[styles.name, { color: colors.foreground }]}>{name}</Text>
        <Text numberOfLines={1} style={[styles.email, { color: colors.muted }]}>{email}</Text>
        {phone && <Text style={[styles.extension, { color: colors.muted }]}>Extension {phone.extension}</Text>}
        {workspaceName && <Text accessibilityLabel="Profile workspace" style={[styles.workspaceName, { color: colors.muted }]}>Availability, status, and location apply to {workspaceName}</Text>}
      </View>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {profile ? <>
          <MenuRow icon={profile.manualAvailability === "dnd" ? "minus.circle" : profile.manualAvailability === "away" || profile.manualAvailability === "out_of_office" ? "moon.fill" : "circle.fill"} title="Availability" detail={availabilitySummary(profile.manualAvailability)} onPress={() => setSheet("availability")} />
          <MenuRow icon="face.smiling" title="Status" detail={profile.statusText || "Set a status"} onPress={() => setSheet("status")} />
          <MenuRow icon="building.2.fill" title="Work location" detail={workLocationSummary(profile.workLocation)} onPress={() => setSheet("location")} last />
        </> : <Text style={[styles.unavailable, { color: colors.muted }]}>Workspace status will be available after your company updates this app.</Text>}
      </View>
      {profileError && <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{profileError}</Text>}
      <Text style={[styles.sectionTitle, { color: colors.muted }]}>ACCOUNT</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <MenuRow icon="person.fill" title="My profile" detail="Account and assigned extension" onPress={() => setSheet("details")} />
        <MenuRow icon="gearshape.fill" title="Settings" detail="Phone and app preferences" onPress={onOpenSettings} last />
      </View>
    </ScrollView>
    {profile && <>
      <Sheet visible={sheet === "availability"} title="Availability" onClose={() => setSheet(null)}>
        <View style={styles.sheetList}>
          {manualAvailabilityOptions.map(option => <SheetChoice key={option.value} label={option.label} selected={profile.manualAvailability === option.value} disabled={profileSaving} onPress={() => chooseAvailability(option.value)} />)}
          <SheetChoice label="Reset automatic" detail="Use your current activity" selected={profile.manualAvailability === null} disabled={profileSaving} onPress={() => chooseAvailability(null)} />
        </View>
      </Sheet>
      <Sheet visible={sheet === "availabilityDuration"} title="Do not disturb" onClose={() => setSheet(null)}>
        <View style={styles.sheetList}><Text style={[styles.sheetDescription, { color: colors.muted }]}>Choose when Do not disturb ends.</Text>
          {dndExpiryOptions.map(option => <SheetChoice key={option.value} label={option.label} selected={dndDuration === option.value} disabled={profileSaving} onPress={() => { setDndDuration(option.value); save({ availability: { value: "dnd", expiresInMinutes: option.value } }); }} />)}
        </View>
      </Sheet>
      <StatusEditor profile={profile} visible={sheet === "status"} saving={profileSaving} onClose={() => setSheet(null)} onSave={save} />
      <Sheet visible={sheet === "location"} title="Work location" onClose={() => setSheet(null)}>
        <View style={styles.sheetList}>
          <SheetChoice label="Office" selected={profile.workLocation === "office"} disabled={profileSaving} onPress={() => save({ workLocation: "office" })} />
          <SheetChoice label="Remote" selected={profile.workLocation === "remote"} disabled={profileSaving} onPress={() => save({ workLocation: "remote" })} />
          <SheetChoice label="Turn off" detail="Do not share a work location" selected={profile.workLocation === null} disabled={profileSaving} onPress={() => save({ workLocation: null })} />
        </View>
      </Sheet>
    </>}
    <AccountDetails identity={identity} phone={phone} visible={sheet === "details"} onClose={() => setSheet(null)} />
  </View>;
}

type AccountHubStyles = {
  screen: ViewStyle; header: ViewStyle; back: ViewStyle; title: TextStyle; content: ViewStyle; preview: TextStyle; identityBlock: ViewStyle; avatar: ViewStyle; avatarText: TextStyle; name: TextStyle; email: TextStyle; extension: TextStyle; workspaceName: TextStyle; card: ViewStyle; unavailable: TextStyle; sectionTitle: TextStyle; error: TextStyle; row: ViewStyle; lastRow: ViewStyle; rowIcon: ViewStyle; rowContent: ViewStyle; rowTitle: TextStyle; rowDetail: TextStyle; keyboardSheet: ViewStyle; sheetBackdrop: ViewStyle; sheet: ViewStyle; sheetHeader: ViewStyle; sheetTitle: TextStyle; closeButton: ViewStyle; sheetList: ViewStyle; sheetChoice: ViewStyle; sheetDescription: TextStyle; sheetLabel: TextStyle; editorContent: ViewStyle; statusInput: TextStyle; presetGrid: ViewStyle; presetButton: ViewStyle; presetLabel: TextStyle; presetDetail: TextStyle; clearStatus: ViewStyle; clearStatusText: TextStyle; sheetActions: ViewStyle; secondaryButton: ViewStyle; primaryButton: ViewStyle; buttonText: TextStyle; primaryButtonText: TextStyle; detailsContent: ViewStyle; detailsLabel: TextStyle; detailsValue: TextStyle; detailsNote: TextStyle;
};

const styles = StyleSheet.create<AccountHubStyles>({
  screen: { flex: 1 }, header: { minHeight: 58, paddingHorizontal: 12, alignItems: "center", flexDirection: "row", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth }, back: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }, title: { fontSize: 17, fontWeight: "700" }, content: { padding: 20, paddingBottom: 36, gap: 12 }, preview: { alignSelf: "center", fontSize: 12, fontWeight: "600" }, identityBlock: { alignItems: "center", paddingTop: 8, paddingBottom: 12 }, avatar: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center" }, avatarText: { color: "#fff", fontSize: 30, fontWeight: "700" }, name: { fontSize: 22, fontWeight: "700", marginTop: 13 }, email: { fontSize: 14, marginTop: 4, maxWidth: "100%" }, extension: { fontSize: 13, marginTop: 7, fontWeight: "600" }, workspaceName: { fontSize: 12, lineHeight: 18, marginTop: 8, textAlign: "center", maxWidth: 300 }, card: { borderWidth: 1, borderRadius: 15, overflow: "hidden" }, unavailable: { fontSize: 14, lineHeight: 20, padding: 16, textAlign: "center" }, sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginTop: 14, marginLeft: 4 }, error: { fontSize: 13, lineHeight: 19, paddingHorizontal: 4 }, row: { minHeight: 76, paddingHorizontal: 16, alignItems: "center", flexDirection: "row", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth }, lastRow: { borderBottomWidth: 0 }, rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" }, rowContent: { flex: 1, minWidth: 0 }, rowTitle: { fontSize: 16, fontWeight: "600" }, rowDetail: { fontSize: 13, lineHeight: 18, marginTop: 3 }, keyboardSheet: { flex: 1 }, sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000066" }, sheet: { maxHeight: "82%", borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: "hidden" }, sheetHeader: { minHeight: 60, paddingLeft: 20, paddingRight: 10, alignItems: "center", flexDirection: "row", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth }, sheetTitle: { fontSize: 17, fontWeight: "700" }, closeButton: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }, sheetList: { paddingBottom: 16 }, sheetChoice: { minHeight: 62, paddingHorizontal: 20, alignItems: "center", flexDirection: "row", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth }, sheetDescription: { fontSize: 14, lineHeight: 20, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }, sheetLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7, marginTop: 14, marginBottom: 8 }, editorContent: { padding: 20, paddingTop: 8, paddingBottom: 24 }, statusInput: { minHeight: 94, maxHeight: 140, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderRadius: 11, fontSize: 16, textAlignVertical: "top" }, presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, presetButton: { width: "48%", minHeight: 58, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 9, justifyContent: "center" }, presetLabel: { fontSize: 14, lineHeight: 18, fontWeight: "600" }, presetDetail: { fontSize: 12, lineHeight: 17, marginTop: 2 }, clearStatus: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 4, marginTop: 2 }, clearStatusText: { fontSize: 14, fontWeight: "600" }, sheetActions: { flexDirection: "row", gap: 10, marginTop: 14 }, secondaryButton: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: 1 }, primaryButton: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 10 }, buttonText: { fontSize: 15, fontWeight: "700" }, primaryButtonText: { color: "#fff", fontSize: 15, fontWeight: "700" }, detailsContent: { padding: 20, gap: 4 }, detailsLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7, marginTop: 12 }, detailsValue: { fontSize: 16, lineHeight: 22 }, detailsNote: { fontSize: 13, lineHeight: 19, marginTop: 18 },
});
