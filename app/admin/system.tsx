import { UnavailableAdminScreen } from "@/components/admin/unavailable-admin-screen";

export default function AdminScreen() {
  return (
    <UnavailableAdminScreen
      title="System health"
      description="System health will be available after approved telemetry is connected to this workspace."
    />
  );
}
