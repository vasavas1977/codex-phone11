import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextStyle, type ViewStyle } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { useColors } from "@/hooks/use-colors";
import type { ProfilePhotoDescriptor } from "@/lib/profile/photo-client";
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
  profileLoading?: boolean;
  profileLoadError?: boolean;
  profileUnavailable?: boolean;
  onRetryWorkspaceProfile?: () => Promise<unknown>;
  profileSaving?: boolean;
  profileError?: string | null;
  onUpdateWorkspaceProfile?: (update: WorkspaceProfileUpdate) => Promise<unknown>;
  workspaceName?: string | null;
  isPreview?: boolean;
  workspaceId?: number;
  profilePhotoAvailable?: boolean;
  profilePhotoDescriptor?: ProfilePhotoDescriptor | null;
  profilePhotoChecking?: boolean;
  profilePhotoCheckError?: boolean;
  profilePhotoSaving?: boolean;
  profilePhotoError?: string | null;
  onChangeProfilePhoto?: (source: "camera" | "library") => Promise<boolean>;
  onRemoveProfilePhoto?: () => Promise<unknown>;
  onRetryProfilePhoto?: () => Promise<unknown>;
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

function DetailRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  const colors = useColors();
  return <View style={[styles.detailsRow, { borderBottomColor: colors.border }, last && styles.lastRow]}>
    <Text style={[styles.detailsRowLabel, { color: colors.muted }]}>{label}</Text>
    <Text selectable style={[styles.detailsRowValue, { color: colors.foreground }]}>{value}</Text>
  </View>;
}

export function AccountDetails({ identity, phone, workspaceName, photo, workspaceId, canEditPhoto, photoSaving, photoOptionsEnabled = true, onClose, onEditPhoto }: {
  identity: AccountHubIdentity | null;
  phone: AccountHubPhone;
  workspaceName: string | null;
  photo: ProfilePhotoDescriptor | null | undefined;
  workspaceId?: number;
  canEditPhoto: boolean;
  photoSaving: boolean;
  photoOptionsEnabled?: boolean;
  onClose: () => void;
  onEditPhoto: () => void;
}) {
  const colors = useColors();
  const displayName = identity?.name?.trim() || "Your work account";
  const rows = [
    { label: "Full name", value: identity?.name?.trim() || "Not available" },
    { label: "Email", value: identity?.email?.trim() || "Not available" },
    ...(workspaceName?.trim() ? [{ label: "Workspace", value: workspaceName.trim() }] : []),
  ];
  return <View style={[styles.detailsScreen, { backgroundColor: colors.background }]}>
    <View style={[styles.detailsHeader, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to profile" onPress={onClose} style={styles.detailsBack}>
        <IconSymbol name="chevron.left" size={23} color={colors.primary} />
      </Pressable>
      <Text accessibilityRole="header" style={[styles.detailsTitle, { color: colors.foreground }]}>My profile</Text>
      <View style={styles.detailsBack} />
    </View>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.detailsScroll}>
      <View style={styles.detailsIdentity}>
        <Pressable accessibilityRole="button" accessibilityLabel={canEditPhoto ? "Change profile photo" : "Profile photo options"}
          accessibilityHint={identity && photoOptionsEnabled ? "Opens profile photo options, including capability status and retry" : undefined}
          accessibilityState={{ disabled: !identity || photoSaving || !photoOptionsEnabled }} disabled={!identity || photoSaving || !photoOptionsEnabled} onPress={onEditPhoto}
          style={({ pressed }) => [styles.detailsAvatarButton, { opacity: !identity || photoSaving || !photoOptionsEnabled ? 1 : pressed ? 0.76 : 1 }]}>
          <ProfileAvatar name={identity?.name} photoUrl={photo?.photoUrl} photoVersion={photo?.photoVersion} tenantId={workspaceId} userId={photo?.userId} size={112} accessibilityLabel="Profile photo" interactive={false} />
          {canEditPhoto && <View pointerEvents="none" style={[styles.cameraBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
            <IconSymbol name="camera.fill" size={17} color="#fff" />
          </View>}
        </Pressable>
        <Text style={[styles.detailsHeroName, { color: colors.foreground }]}>{displayName}</Text>
      </View>
      <Text style={[styles.detailsGroupLabel, { color: colors.muted }]}>PERSONAL</Text>
      <View style={[styles.detailsGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {rows.map((row, index) => <DetailRow key={row.label} {...row} last={index === rows.length - 1} />)}
      </View>
      {phone && <>
        <Text style={[styles.detailsGroupLabel, { color: colors.muted }]}>CONTACT INFO</Text>
        <View style={[styles.detailsGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <DetailRow label="Extension" value={phone.extension} last />
        </View>
      </>}
    </ScrollView>
  </View>;
}

/** Shows auth-owned identity and server-persisted workspace preferences. */
export function AccountHub({ identity, phone, onBack, onOpenSettings, workspaceProfile, profileAvailable = false, profileLoading = false, profileLoadError = false, profileUnavailable = false, onRetryWorkspaceProfile, profileSaving = false, profileError = null, onUpdateWorkspaceProfile, workspaceName = null, isPreview = false, workspaceId, profilePhotoAvailable = false, profilePhotoDescriptor, profilePhotoChecking = false, profilePhotoCheckError = false, profilePhotoSaving = false, profilePhotoError = null, onChangeProfilePhoto, onRemoveProfilePhoto, onRetryProfilePhoto }: AccountHubProps) {
  const colors = useColors();
  const [sheet, setSheet] = useState<"availability" | "availabilityDuration" | "status" | "location" | "photo" | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [dndDuration, setDndDuration] = useState<DndDurationMinutes>(60);
  const name = identity?.name?.trim() || "Your work account";
  const email = identity?.email?.trim() || "Sign in to view your account";
  const profile = profileAvailable && workspaceProfile && onUpdateWorkspaceProfile ? workspaceProfile : undefined;
  const canChangePhoto = !!identity && profilePhotoAvailable && !!onChangeProfilePhoto && !!onRemoveProfilePhoto;
  const photo = profilePhotoDescriptor ?? (profile && { userId: profile.userId, photoUrl: profile.photoUrl ?? null, photoVersion: profile.photoVersion ?? null });
  const save = (update: WorkspaceProfileUpdate) => {
    if (!onUpdateWorkspaceProfile) return;
    void onUpdateWorkspaceProfile(update);
    setSheet(null);
  };
  const chooseAvailability = (value: ManualAvailability | null) => {
    if (value === "dnd") { setDndDuration(60); setSheet("availabilityDuration"); return; }
    save({ availability: { value } });
  };
  const changePhoto = async (source: "camera" | "library") => {
    if (!onChangeProfilePhoto) return;
    try {
      if (await onChangeProfilePhoto(source)) setSheet(null);
    } catch {
      // The caller exposes a scoped error below; do not imply an upload succeeded.
    }
  };
  const removePhoto = async () => {
    if (!onRemoveProfilePhoto) return;
    try {
      await onRemoveProfilePhoto();
      setSheet(null);
    } catch {
      // The caller exposes a scoped error below; do not imply removal succeeded.
    }
  };
  return <View style={[styles.screen, { backgroundColor: colors.background }]}>
    {showDetails ? <AccountDetails identity={identity} phone={phone} workspaceName={workspaceName} photo={photo} workspaceId={workspaceId}
      canEditPhoto={canChangePhoto} photoSaving={profilePhotoSaving} onClose={() => setShowDetails(false)} onEditPhoto={() => setSheet("photo")} /> : <>
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.back}><IconSymbol name="chevron.left" size={23} color={colors.primary} /></Pressable>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Profile</Text><View style={styles.back} />
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {isPreview && <Text style={[styles.preview, { color: colors.muted }]}>Preview only — changes stay in this browser</Text>}
      <View style={styles.identityBlock}>
        {identity && <Pressable accessibilityRole="button" accessibilityLabel="My profile" accessibilityHint="Opens your account details and profile photo options" disabled={profilePhotoSaving} onPress={() => setShowDetails(true)} style={styles.avatarButton}>
          <ProfileAvatar name={identity?.name} photoUrl={photo?.photoUrl} photoVersion={photo?.photoVersion} tenantId={workspaceId} userId={photo?.userId} size={88} accessibilityLabel="Profile photo" interactive={false} />
        </Pressable>}
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
        </> : <View>
          <Text style={[styles.unavailable, { color: colors.muted }]}>
            {profileLoading ? "Checking workspace status…" : profileUnavailable ? "Workspace status is not enabled for this workspace yet." : profileLoadError ? "Could not load workspace status." : "Workspace status is not available for this workspace."}
          </Text>
          {profileLoadError && onRetryWorkspaceProfile && <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry workspace status"
            onPress={() => { void onRetryWorkspaceProfile().catch(() => { /* The scoped query exposes the retry failure. */ }); }}
            style={{ minHeight: 44, alignSelf: "center", justifyContent: "center", paddingHorizontal: 16 }}
          ><Text style={{ color: colors.primary, fontSize: 15, fontWeight: "600" }}>Try again</Text></Pressable>}
        </View>}
      </View>
      {profileError && <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{profileError}</Text>}
      {profilePhotoError && <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{profilePhotoError}</Text>}
      <Text style={[styles.sectionTitle, { color: colors.muted }]}>ACCOUNT</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <MenuRow icon="person.fill" title="My profile" detail="Account and assigned extension" onPress={() => setShowDetails(true)} />
        <MenuRow icon="gearshape.fill" title="Settings" detail="Phone and app preferences" onPress={onOpenSettings} last />
      </View>
    </ScrollView>
    </>}
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
    <Sheet visible={sheet === "photo"} title="Profile photo" onClose={() => setSheet(null)}>
      {canChangePhoto ? <View style={styles.sheetList}>
        <Text style={[styles.sheetDescription, { color: colors.muted }]}>Your photo is visible to active people in {workspaceName || "this workspace"}.</Text>
        <SheetChoice label="Take photo" detail="Use your camera" disabled={profilePhotoSaving} onPress={() => void changePhoto("camera")} />
        <SheetChoice label="Choose photo" detail="Open your photo library" disabled={profilePhotoSaving} onPress={() => void changePhoto("library")} />
        {photo?.photoUrl && <SheetChoice label="Remove photo" detail="Show your initials instead" disabled={profilePhotoSaving} onPress={() => void removePhoto()} />}
        {profilePhotoError && <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{profilePhotoError}</Text>}
      </View> : <View style={styles.sheetList}>
        <Text accessibilityRole={profilePhotoCheckError ? "alert" : undefined} style={[styles.sheetDescription, { color: profilePhotoCheckError ? colors.error : colors.muted }]}>
          {profilePhotoChecking ? "Checking profile photo settings…" : profilePhotoCheckError ? "Could not check profile photo settings." : !workspaceId ? "Load your work workspace to manage your profile photo." : "Profile photo changes are unavailable for this workspace."}
        </Text>
        {onRetryProfilePhoto && <SheetChoice label="Retry" detail="Check again" onPress={() => { void onRetryProfilePhoto().catch(() => { /* The scoped state below explains the retry failure. */ }); }} />}
      </View>}
    </Sheet>
  </View>;
}

type AccountHubStyles = {
  screen: ViewStyle; header: ViewStyle; back: ViewStyle; title: TextStyle; content: ViewStyle; preview: TextStyle; identityBlock: ViewStyle; avatarButton: ViewStyle; name: TextStyle; email: TextStyle; extension: TextStyle; workspaceName: TextStyle; card: ViewStyle; unavailable: TextStyle; sectionTitle: TextStyle; error: TextStyle; row: ViewStyle; lastRow: ViewStyle; rowIcon: ViewStyle; rowContent: ViewStyle; rowTitle: TextStyle; rowDetail: TextStyle; keyboardSheet: ViewStyle; sheetBackdrop: ViewStyle; sheet: ViewStyle; sheetHeader: ViewStyle; sheetTitle: TextStyle; closeButton: ViewStyle; sheetList: ViewStyle; sheetChoice: ViewStyle; sheetDescription: TextStyle; sheetLabel: TextStyle; editorContent: ViewStyle; statusInput: TextStyle; presetGrid: ViewStyle; presetButton: ViewStyle; presetLabel: TextStyle; presetDetail: TextStyle; clearStatus: ViewStyle; clearStatusText: TextStyle; sheetActions: ViewStyle; secondaryButton: ViewStyle; primaryButton: ViewStyle; buttonText: TextStyle; primaryButtonText: TextStyle; detailsScreen: ViewStyle; detailsHeader: ViewStyle; detailsBack: ViewStyle; detailsTitle: TextStyle; detailsScroll: ViewStyle; detailsIdentity: ViewStyle; detailsAvatarButton: ViewStyle; cameraBadge: ViewStyle; detailsHeroName: TextStyle; detailsGroupLabel: TextStyle; detailsGroup: ViewStyle; detailsRow: ViewStyle; detailsRowLabel: TextStyle; detailsRowValue: TextStyle;
};

const styles = StyleSheet.create<AccountHubStyles>({
  screen: { flex: 1 }, header: { minHeight: 58, paddingHorizontal: 12, alignItems: "center", flexDirection: "row", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth }, back: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }, title: { fontSize: 17, fontWeight: "700" }, content: { padding: 20, paddingBottom: 36, gap: 12 }, preview: { alignSelf: "center", fontSize: 12, fontWeight: "600" }, identityBlock: { alignItems: "center", paddingTop: 8, paddingBottom: 12 }, avatarButton: { width: 88, height: 88, borderRadius: 44 }, name: { fontSize: 22, fontWeight: "700", marginTop: 13 }, email: { fontSize: 14, marginTop: 4, maxWidth: "100%" }, extension: { fontSize: 13, marginTop: 7, fontWeight: "600" }, workspaceName: { fontSize: 12, lineHeight: 18, marginTop: 8, textAlign: "center", maxWidth: 300 }, card: { borderWidth: 1, borderRadius: 15, overflow: "hidden" }, unavailable: { fontSize: 14, lineHeight: 20, padding: 16, textAlign: "center" }, sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginTop: 14, marginLeft: 4 }, error: { fontSize: 13, lineHeight: 19, paddingHorizontal: 4 }, row: { minHeight: 76, paddingHorizontal: 16, alignItems: "center", flexDirection: "row", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth }, lastRow: { borderBottomWidth: 0 }, rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" }, rowContent: { flex: 1, minWidth: 0 }, rowTitle: { fontSize: 16, fontWeight: "600" }, rowDetail: { fontSize: 13, lineHeight: 18, marginTop: 3 }, keyboardSheet: { flex: 1 }, sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000066" }, sheet: { maxHeight: "82%", borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: "hidden" }, sheetHeader: { minHeight: 60, paddingLeft: 20, paddingRight: 10, alignItems: "center", flexDirection: "row", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth }, sheetTitle: { fontSize: 17, fontWeight: "700" }, closeButton: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }, sheetList: { paddingBottom: 16 }, sheetChoice: { minHeight: 62, paddingHorizontal: 20, alignItems: "center", flexDirection: "row", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth }, sheetDescription: { fontSize: 14, lineHeight: 20, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }, sheetLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7, marginTop: 14, marginBottom: 8 }, editorContent: { padding: 20, paddingTop: 8, paddingBottom: 24 }, statusInput: { minHeight: 94, maxHeight: 140, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderRadius: 11, fontSize: 16, textAlignVertical: "top" }, presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, presetButton: { width: "48%", minHeight: 58, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 9, justifyContent: "center" }, presetLabel: { fontSize: 14, lineHeight: 18, fontWeight: "600" }, presetDetail: { fontSize: 12, lineHeight: 17, marginTop: 2 }, clearStatus: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 4, marginTop: 2 }, clearStatusText: { fontSize: 14, fontWeight: "600" }, sheetActions: { flexDirection: "row", gap: 10, marginTop: 14 }, secondaryButton: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: 1 }, primaryButton: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 10 }, buttonText: { fontSize: 15, fontWeight: "700" }, primaryButtonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  detailsScreen: { flex: 1 }, detailsHeader: { minHeight: 58, paddingHorizontal: 12, alignItems: "center", flexDirection: "row", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth }, detailsBack: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }, detailsTitle: { fontSize: 17, fontWeight: "700" }, detailsScroll: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 48, gap: 12 }, detailsIdentity: { alignItems: "center", paddingTop: 8, paddingBottom: 14 }, detailsAvatarButton: { width: 112, height: 112, borderRadius: 56, position: "relative" }, cameraBadge: { position: "absolute", right: 0, bottom: 0, width: 40, height: 40, borderRadius: 20, borderWidth: 3, alignItems: "center", justifyContent: "center" }, detailsHeroName: { fontSize: 22, lineHeight: 29, fontWeight: "700", marginTop: 14, textAlign: "center" }, detailsGroupLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8, marginTop: 8, marginLeft: 4 }, detailsGroup: { borderWidth: 1, borderRadius: 15, overflow: "hidden" }, detailsRow: { minHeight: 70, paddingHorizontal: 16, paddingVertical: 12, justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth }, detailsRowLabel: { fontSize: 13, lineHeight: 18 }, detailsRowValue: { fontSize: 16, lineHeight: 22, fontWeight: "500", marginTop: 2 },
});
