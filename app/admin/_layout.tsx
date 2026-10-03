import { Platform } from "react-native";
import { Slot, router, usePathname } from "expo-router";
import { AdminShell } from "@/components/admin/admin-shell";
import {
  usePbxAdminWorkspace,
  usePbxAdminCapabilities,
} from "@/hooks/use-pbx-admin";

export default function AdminLayout() {
  return Platform.OS === "web" ? <WebAdminLayout /> : <Slot />;
}

function WebAdminLayout() {
  const pathname = usePathname();
  const workspace = usePbxAdminWorkspace();
  const canManage =
    workspace.membershipsQuery.isSuccess &&
    workspace.manageableMemberships.length > 0;
  const capabilities = usePbxAdminCapabilities(canManage);
  const selected = workspace.manageableMemberships.find(
    (item) => item.tenantId === workspace.selectedTenantId,
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
      selectedTenantId={workspace.selectedTenantId}
      canUseImplicitTenant={workspace.canUseImplicitTenant}
      capabilities={capabilities.isSuccess ? capabilities.data : undefined}
      onNavigate={(path) => router.push(path as any)}
      onChooseWorkspace={workspace.chooseTenant}
    >
      <Slot />
    </AdminShell>
  );
}
