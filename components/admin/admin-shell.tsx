import { useEffect, useState, type ReactNode } from "react";
import {
  Platform,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import type { PbxManagementCapabilities } from "@/hooks/use-pbx-admin";

export const ADMIN_NAVIGATION = [
  {
    label: "Overview",
    route: "/admin",
    group: "Workspace",
    icon: "house.fill",
  },
  {
    label: "People",
    route: "/admin/users",
    group: "Workspace",
    icon: "person.2.fill",
  },
  {
    label: "Workspace settings",
    route: "/admin/workspace-settings",
    group: "Workspace",
    icon: "gearshape.fill",
  },
  {
    label: "Workspace status",
    route: "/admin/profile-status",
    group: "Workspace",
    icon: "person.fill",
  },
  {
    label: "Extensions",
    route: "/admin/extensions",
    group: "Phone system",
    icon: "phone.fill",
  },
  {
    label: "Phone numbers",
    route: "/admin/dids",
    group: "Phone system",
    icon: "number",
    facility: "phoneNumbers",
  },
  {
    label: "Auto receptionists",
    route: "/admin/ivr",
    group: "Phone system",
    icon: "rectangle.grid.3x2.fill",
    facility: "ivr",
  },
  {
    label: "Call queues",
    route: "/admin/queues",
    group: "Phone system",
    icon: "person.3.fill",
    facility: "queues",
    implicit: true,
  },
  {
    label: "Ring groups",
    route: "/admin/ring-groups",
    group: "Phone system",
    icon: "person.2.fill",
    facility: "ringGroups",
    implicit: true,
  },
  {
    label: "Business hours",
    route: "/admin/schedules",
    group: "Phone system",
    icon: "clock.fill",
    facility: "businessHours",
    implicit: true,
  },
  {
    label: "Voicemail",
    route: "/admin/voicemail",
    group: "Phone system",
    icon: "voicemail",
  },
  {
    label: "Meeting access",
    route: "/admin/meetings",
    group: "Meetings",
    icon: "video.fill",
  },
  {
    label: "Call analytics",
    route: "/admin/analytics",
    group: "Reports",
    icon: "chart.bar.fill",
    implicit: true,
  },
] as const;

type Workspace = { id: number; name: string };
export type AdminShellProps = {
  children: ReactNode;
  pathname: string;
  workspaceName: string;
  workspaces: Workspace[];
  selectedTenantId: number | null;
  canManage: boolean;
  canUseImplicitTenant: boolean;
  capabilities?: PbxManagementCapabilities;
  onNavigate: (path: string) => void;
  onChooseWorkspace: (id: number) => void;
};

/** Presentation only. Every page and API retains its own authorization boundary. */
export function AdminShell(props: AdminShellProps) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const [menuOpen, setMenuOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
    setWorkspaceOpen(false);
  }, [props.pathname, props.selectedTenantId]);
  const navigate = (path: string) => {
    setMenuOpen(false);
    setWorkspaceOpen(false);
    props.onNavigate(path);
  };
  const navigation = ADMIN_NAVIGATION.filter((item) => {
    if (item.route === "/admin") return true;
    if (!props.canManage || props.selectedTenantId === null) return false;
    if ("implicit" in item && item.implicit && !props.canUseImplicitTenant)
      return false;
    if ("facility" in item && !props.capabilities?.[item.facility])
      return false;
    return true;
  });
  const background = colors.surface;
  const foreground = colors.foreground;
  const border = colors.border;
  const nav = (
    <View
      style={[
        styles.sidebar,
        { backgroundColor: background, borderRightColor: border },
        !wide && styles.mobileSidebar,
      ]}
    >
      <ScrollView contentContainerStyle={styles.navContent}>
        {["Workspace", "Phone system", "Meetings", "Reports"].map((group) => {
          const items = navigation.filter((item) => item.group === group);
          if (!items.length) return null;
          return (
            <View key={group} style={styles.group}>
              <Text style={[styles.groupTitle, { color: colors.muted }]}>
                {group}
              </Text>
              {items.map((item) => {
                const selected = props.pathname === item.route;
                return (
                  <Pressable
                    key={item.route}
                    accessibilityRole="link"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected }}
                    onPress={() => navigate(item.route)}
                    style={({ hovered, pressed }: any) => [
                      styles.navItem,
                      {
                        backgroundColor: selected
                          ? `${colors.primary}12`
                          : hovered || pressed
                            ? colors.background
                            : "transparent",
                      },
                    ]}
                  >
                    <IconSymbol
                      name={item.icon as any}
                      size={18}
                      color={selected ? colors.primary : colors.muted}
                    />
                    <Text
                      style={[
                        styles.navLabel,
                        {
                          color: selected ? colors.primary : foreground,
                          fontWeight: selected ? "600" : "400",
                        },
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="My account"
        onPress={() => navigate("/portal")}
        style={[styles.myAccount, { borderTopColor: border }]}
      >
        <IconSymbol name="person.fill" size={18} color={colors.muted} />
        <Text style={[styles.navLabel, { color: foreground }]}>My account</Text>
        <IconSymbol name="chevron.right" size={17} color={colors.muted} />
      </Pressable>
    </View>
  );
  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <View
        style={[
          styles.topbar,
          !wide && { paddingHorizontal: 16, gap: 10 },
          { backgroundColor: background, borderBottomColor: border },
        ]}
      >
        {!wide && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              menuOpen ? "Close admin navigation" : "Open admin navigation"
            }
            accessibilityState={{ expanded: menuOpen }}
            onPress={() => {
              setMenuOpen(!menuOpen);
              setWorkspaceOpen(false);
            }}
            style={styles.iconButton}
          >
            <IconSymbol
              name={menuOpen ? "xmark" : "list.bullet"}
              size={24}
              color={foreground}
            />
          </Pressable>
        )}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Phone11 admin overview"
          onPress={() => navigate("/admin")}
        >
          <Text
            style={[
              styles.brand,
              !wide && { fontSize: 23 },
              { color: colors.primary },
            ]}
          >
            Phone11
          </Text>
        </Pressable>
        <View style={[styles.brandRule, { backgroundColor: border }]} />
        <Text
          numberOfLines={1}
          style={[
            styles.adminTitle,
            !wide && { fontSize: 14 },
            { color: foreground },
          ]}
        >
          Admin center
        </Text>
        <View style={styles.spacer} />
        {wide && (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Open my account"
            onPress={() => navigate("/portal")}
            style={styles.accountLink}
          >
            <Text style={[styles.smallText, { color: colors.muted }]}>
              My account
            </Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Workspace: ${props.workspaceName}`}
          accessibilityState={{
            expanded: workspaceOpen,
            disabled: props.workspaces.length < 2,
          }}
          disabled={props.workspaces.length < 2}
          onPress={() => {
            setWorkspaceOpen(!workspaceOpen);
            setMenuOpen(false);
          }}
          style={[styles.workspace, { borderColor: border }]}
        >
          <IconSymbol name="building.2.fill" size={17} color={colors.muted} />
          {wide && (
            <Text
              numberOfLines={1}
              style={[styles.workspaceText, { color: foreground }]}
            >
              {props.workspaceName}
            </Text>
          )}
          {props.workspaces.length > 1 && (
            <IconSymbol name="chevron.right" size={14} color={colors.muted} />
          )}
        </Pressable>
      </View>
      <View style={styles.body}>
        {wide && nav}
        <View style={styles.page}>{props.children}</View>
      </View>
      {!wide && menuOpen && (
        <Modal transparent visible onRequestClose={() => setMenuOpen(false)}>
          <View style={styles.mobileOverlay}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close admin navigation"
              onPress={() => setMenuOpen(false)}
              style={styles.scrim}
            />
            {nav}
          </View>
        </Modal>
      )}
      {workspaceOpen && (
        <Modal
          transparent
          visible
          onRequestClose={() => setWorkspaceOpen(false)}
        >
          <View style={styles.workspaceOverlay}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close workspace selector"
              onPress={() => setWorkspaceOpen(false)}
              style={styles.dismissWorkspace}
            />
            <View
              style={[
                styles.workspaceMenu,
                { backgroundColor: background, borderColor: border },
              ]}
            >
              <Text style={[styles.groupTitle, { color: colors.muted }]}>
                Switch workspace
              </Text>
              {props.workspaces.map((workspace) => (
                <Pressable
                  key={workspace.id}
                  accessibilityRole="button"
                  accessibilityLabel={workspace.name}
                  accessibilityState={{
                    selected: workspace.id === props.selectedTenantId,
                  }}
                  onPress={() => {
                    props.onChooseWorkspace(workspace.id);
                    setWorkspaceOpen(false);
                  }}
                  style={styles.workspaceOption}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.navLabel, { color: foreground, flex: 1 }]}
                  >
                    {workspace.name}
                  </Text>
                  {workspace.id === props.selectedTenantId && (
                    <IconSymbol
                      name="checkmark"
                      size={18}
                      color={colors.primary}
                    />
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}
const font =
  Platform.OS === "web"
    ? '-apple-system, BlinkMacSystemFont, "Inter", "Noto Sans Thai", "Helvetica Neue", Arial, sans-serif'
    : undefined;
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  topbar: {
    height: 66,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    gap: 15,
    borderBottomWidth: 1,
    zIndex: 3,
  },
  brand: {
    fontFamily: font,
    fontSize: 26,
    letterSpacing: -1,
    fontWeight: "700",
  },
  brandRule: { width: 1, height: 24 },
  adminTitle: { fontFamily: font, fontSize: 16, fontWeight: "600" },
  spacer: { flex: 1 },
  accountLink: { padding: 10 },
  smallText: { fontFamily: font, fontSize: 13 },
  workspace: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderWidth: 1,
    borderRadius: 8,
    padding: 9,
    maxWidth: 240,
  },
  workspaceText: { fontFamily: font, fontSize: 13, flexShrink: 1 },
  body: { flex: 1, flexDirection: "row", minHeight: 0 },
  sidebar: { width: 238, borderRightWidth: 1 },
  navContent: { padding: 14, paddingTop: 24 },
  group: { marginBottom: 20 },
  groupTitle: {
    fontFamily: font,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 9,
    paddingHorizontal: 12,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 6,
    minHeight: 39,
    paddingHorizontal: 12,
    marginBottom: 2,
  },
  navLabel: { fontFamily: font, fontSize: 13, lineHeight: 20 },
  myAccount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 24,
    borderTopWidth: 1,
  },
  page: { flex: 1, minWidth: 0, minHeight: 0 },
  iconButton: { padding: 5, marginLeft: -12 },
  mobileOverlay: {
    position: "absolute",
    top: 66,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 5,
  },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "#00000045" },
  mobileSidebar: { height: "100%", width: 260 },
  workspaceOverlay: { ...StyleSheet.absoluteFillObject, top: 66, zIndex: 6 },
  dismissWorkspace: { ...StyleSheet.absoluteFillObject },
  workspaceMenu: {
    position: "absolute",
    right: 24,
    top: 8,
    width: 280,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
  },
  workspaceOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    minHeight: 44,
  },
});
