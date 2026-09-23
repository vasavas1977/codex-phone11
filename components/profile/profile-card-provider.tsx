import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BackHandler, Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ContactDetails } from "@/components/contact-details";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/use-colors";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { ProfileCardContext, validProfileCardTarget, type ProfileCardTarget } from "./profile-card-context";

/** One inline card per native surface: picker modals use their own boundary so
 * opening a profile never stacks iOS modal controllers or unmounts a meeting. */
export function ProfileCardProvider({ children, selectionOnly = false }: { children: ReactNode; selectionOnly?: boolean }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth({ autoFetch: false });
  const pathname = usePathname();
  const [target, setTarget] = useState<(ProfileCardTarget & { ownerId: number; pathname: string }) | null>(null);
  const close = useCallback(() => setTarget(null), []);
  const open = useCallback((next: ProfileCardTarget) => {
    const owner = getAuthSnapshot().user?.id;
    if (!owner || !validProfileCardTarget(next.tenantId, next.userId)) return;
    Keyboard.dismiss();
    setTarget({ ...next, ownerId: owner, pathname });
  }, [pathname]);
  const visible = target?.ownerId === user?.id && target?.pathname === pathname ? target : null;
  useEffect(close, [user?.id, pathname, close]);
  useEffect(() => {
    if (!visible) return;
    const handler = BackHandler.addEventListener("hardwareBackPress", () => { close(); return true; });
    return () => handler.remove();
  }, [visible, close]);
  const actionsEnabled = !selectionOnly && !pathname.startsWith("/call/") && !pathname.startsWith("/conference");

  // Ringing must always leave Answer and Decline immediately accessible.
  return <ProfileCardContext.Provider value={pathname === "/call/incoming" ? null : open}>
    <View style={styles.surface}>
      <View style={styles.surface} pointerEvents={visible ? "none" : "auto"} accessibilityElementsHidden={!!visible} importantForAccessibility={visible ? "no-hide-descendants" : "auto"}>{children}</View>
      {visible && <View accessibilityViewIsModal style={[StyleSheet.absoluteFill, styles.card, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back from profile" onPress={close} style={styles.back}><IconSymbol name="chevron.left" size={23} color={colors.primary} /></Pressable>
          <Text accessibilityRole="header" style={{ color: colors.foreground, fontWeight: "700", fontSize: 17 }}>Contact profile</Text>
          <View style={styles.back} />
        </View>
        {visible.userId === user?.id && actionsEnabled && <Pressable accessibilityRole="button" onPress={() => { close(); router.push("/profile"); }} style={styles.selfLink}><Text style={{ color: colors.primary }}>My profile · Edit photo and preferences</Text></Pressable>}
        <ContactDetails key={`${visible.ownerId}:${visible.tenantId}:${visible.userId}`} id={String(visible.userId)} tenantId={String(visible.tenantId)} embedded actionsEnabled={actionsEnabled} onBeforeAction={close} />
      </View>}
    </View>
  </ProfileCardContext.Provider>;
}

const styles = StyleSheet.create({
  surface: { flex: 1 },
  card: { zIndex: 100, elevation: 20 },
  header: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8 },
  back: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  selfLink: { paddingHorizontal: 24, minHeight: 48, justifyContent: "center" },
});
