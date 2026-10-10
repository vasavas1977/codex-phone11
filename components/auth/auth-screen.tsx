import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { IconSymbol } from "@/components/ui/icon-symbol";

export function AuthScreen({
  children,
  onClose,
  closeLabel,
  closeDisabled = false,
}: {
  children: ReactNode;
  onClose: () => void;
  closeLabel: string;
  closeDisabled?: boolean;
}) {
  return (
    <SafeAreaView style={authStyles.screen}>
      <KeyboardAvoidingView
        style={authStyles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={authStyles.toolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            disabled={closeDisabled}
            onPress={onClose}
            style={authStyles.iconButton}
          >
            <IconSymbol name="xmark" size={21} color="#64748B" />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={authStyles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={authStyles.form}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function AuthBrand({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={authStyles.brandBlock}>
      <View style={authStyles.brandIcon}>
        <IconSymbol name="phone.fill" size={21} color="#FFFFFF" />
      </View>
      <Text style={authStyles.brand}>Phone11</Text>
      <Text accessibilityRole="header" style={authStyles.heading}>
        {title}
      </Text>
      {detail ? <Text style={authStyles.detail}>{detail}</Text> : null}
    </View>
  );
}

export const authStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  toolbar: {
    minHeight: 52,
    paddingHorizontal: 12,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  form: { width: "100%", maxWidth: 420, alignSelf: "center" },
  brandBlock: { marginBottom: 30 },
  brandIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  brand: { color: "#0F172A", fontSize: 19, fontWeight: "700" },
  heading: {
    color: "#0F172A",
    fontSize: 27,
    lineHeight: 34,
    fontWeight: "700",
    marginTop: 5,
  },
  detail: { color: "#64748B", fontSize: 15, lineHeight: 22, marginTop: 8 },
  label: {
    color: "#1E293B",
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 8,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#0F172A",
    fontSize: 16,
    backgroundColor: "#FFFFFF",
  },
  inputWithMargin: { marginBottom: 22 },
  passwordField: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 11,
    backgroundColor: "#FFFFFF",
  },
  passwordInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#0F172A",
    fontSize: 16,
  },
  iconButton: {
    width: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: 11,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonWithMargin: { marginTop: 28 },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
  },
  disabled: { opacity: 0.48 },
  identity: { color: "#475569", fontSize: 16, lineHeight: 22 },
  status: { color: "#64748B", fontSize: 14, lineHeight: 21, marginTop: 16 },
  error: { color: "#B42318", fontSize: 14, lineHeight: 21, marginTop: 16 },
  textLink: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    marginTop: 12,
  },
  textLinkLabel: { color: "#0066CC", fontSize: 15, fontWeight: "600" },
  retry: {
    minHeight: 44,
    flexDirection: "row",
    gap: 7,
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: 8,
  },
  retryText: { color: "#0066CC", fontSize: 15, fontWeight: "600" },
});
