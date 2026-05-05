import { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, TextInput, StyleSheet, Alert } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

export default function ProfileScreen() {
  const colors = useColors();
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState({
    firstName: "John",
    lastName: "Doe",
    email: "john.doe@company.com",
    phone: "+1 (555) 234-5678",
    company: "Acme Corp",
    department: "Engineering",
    extension: "1001",
    timezone: "America/New_York",
    language: "English",
  });

  const [passwords, setPasswords] = useState({ current: "", newPass: "", confirm: "" });
  const [showPassword, setShowPassword] = useState(false);

  const handleSave = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEditing(false);
  };

  const renderField = (label: string, key: keyof typeof profile, editable = true) => (
    <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.fieldLabel, { color: colors.muted }]}>{label}</Text>
      {editing && editable ? (
        <TextInput
          style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.primary }]}
          value={profile[key]}
          onChangeText={(v) => setProfile({ ...profile, [key]: v })}
          placeholderTextColor={colors.muted}
        />
      ) : (
        <Text style={[styles.fieldValue, { color: colors.foreground }]}>{profile[key]}</Text>
      )}
    </View>
  );

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>My Profile</Text>
        <TouchableOpacity
          onPress={() => {
            if (editing) handleSave();
            else setEditing(true);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
        >
          <Text style={[styles.editBtn, { color: colors.primary }]}>{editing ? "Save" : "Edit"}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarText}>
              {profile.firstName[0]}{profile.lastName[0]}
            </Text>
          </View>
          {editing && (
            <TouchableOpacity style={[styles.changePhotoBtn, { borderColor: colors.primary }]}>
              <Text style={[styles.changePhotoText, { color: colors.primary }]}>Change Photo</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Personal Info */}
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>PERSONAL INFORMATION</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {renderField("First Name", "firstName")}
          {renderField("Last Name", "lastName")}
          {renderField("Email", "email")}
          {renderField("Phone", "phone")}
        </View>

        {/* Company Info */}
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>COMPANY</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {renderField("Company", "company")}
          {renderField("Department", "department")}
          {renderField("Extension", "extension", false)}
        </View>

        {/* Preferences */}
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>PREFERENCES</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {renderField("Timezone", "timezone")}
          {renderField("Language", "language")}
        </View>

        {/* Change Password */}
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>SECURITY</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>Current Password</Text>
            <TextInput
              style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.border }]}
              value={passwords.current}
              onChangeText={(v) => setPasswords({ ...passwords, current: v })}
              secureTextEntry={!showPassword}
              placeholder="Enter current password"
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>New Password</Text>
            <TextInput
              style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.border }]}
              value={passwords.newPass}
              onChangeText={(v) => setPasswords({ ...passwords, newPass: v })}
              secureTextEntry={!showPassword}
              placeholder="Enter new password"
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={styles.fieldRow}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>Confirm Password</Text>
            <TextInput
              style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.border }]}
              value={passwords.confirm}
              onChangeText={(v) => setPasswords({ ...passwords, confirm: v })}
              secureTextEntry={!showPassword}
              placeholder="Confirm new password"
              placeholderTextColor={colors.muted}
            />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.updatePassBtn, { backgroundColor: colors.primary }]}
          onPress={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setPasswords({ current: "", newPass: "", confirm: "" });
          }}
        >
          <Text style={styles.updatePassText}>Update Password</Text>
        </TouchableOpacity>

        {/* Two-Factor Auth */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 16 }]}>
          <View style={styles.twoFactorRow}>
            <View style={styles.twoFactorInfo}>
              <Text style={[styles.twoFactorTitle, { color: colors.foreground }]}>Two-Factor Authentication</Text>
              <Text style={[styles.twoFactorSub, { color: colors.muted }]}>Add extra security to your account</Text>
            </View>
            <View style={[styles.twoFactorBadge, { backgroundColor: colors.error + "20" }]}>
              <Text style={[styles.twoFactorBadgeText, { color: colors.error }]}>Disabled</Text>
            </View>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  editBtn: { fontSize: 15, fontWeight: "600" },
  content: { paddingBottom: 20 },
  avatarSection: { alignItems: "center", paddingVertical: 24 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 28, fontWeight: "700", color: "#fff" },
  changePhotoBtn: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  changePhotoText: { fontSize: 13, fontWeight: "600" },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  fieldLabel: { fontSize: 13, fontWeight: "500", width: 120 },
  fieldValue: { fontSize: 14, fontWeight: "500", flex: 1, textAlign: "right" },
  fieldInput: {
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
    textAlign: "right",
    borderBottomWidth: 1,
    paddingVertical: 4,
  },
  updatePassBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  updatePassText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  twoFactorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  twoFactorInfo: { flex: 1 },
  twoFactorTitle: { fontSize: 14, fontWeight: "600" },
  twoFactorSub: { fontSize: 12, marginTop: 2 },
  twoFactorBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  twoFactorBadgeText: { fontSize: 11, fontWeight: "700" },
});
