import { Platform } from "react-native";
import { Slot, router, usePathname } from "expo-router";
import { AdminShell } from "@/components/admin/admin-shell";
import {
  AdminWorkspaceProvider,
  usePbxAdminWorkspace,
  usePbxAdminCapabilities,
} from "@/hooks/use-pbx-admin";

export default function AdminLayout() {
  return (
    <AdminWorkspaceProvider>
      {Platform.OS === "web" ? <WebAdminLayout /> : <Slot />}
    </AdminWorkspaceProvider>
  );
}

function WebAdminLayout() {
  const pathname = usePathname();
  const workspace = usePbxAdminWorkspace();
  const canManage =
    workspace.membershipsQuery.isSuccess &&
    workspace.manageableMemberships.length > 0 &&
    workspace.isAdmitted;
  const capabilities = usePbxAdminCapabilities(canManage);
  const selected = workspace.manageableMemberships.find(
    (item) => item.tenantId === workspace.requestedTenantId,
  );
  return (
    <AdminShell
      pathname={pathname}
      canManage={canManage}
      workspaceName={selected?.tenantName ?? "Choose workspace"}
      workspaces={workspace.manageableMemberships.map((item) => ({
        id: item.tenantId,
        name: item.tenantName,
      }))}
      selectedTenantId={workspace.requestedTenantId}
      canUseImplicitTenant={workspace.canUseImplicitTenant}
      capabilities={capabilities.isSuccess ? capabilities.data : undefined}
      onNavigate={(path) => router.push(path as any)}
      onChooseWorkspace={workspace.chooseTenant}
    >
      <Slot />
    </AdminShell>
  );
}
