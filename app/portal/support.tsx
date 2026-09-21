import { PortalShell, PortalState } from "@/components/portal/portal-shell";

export default function SupportScreen() {
  return (
    <PortalShell title="Support" active="support">
      <PortalState
        title="Support tickets are not available in Phone11"
        detail="Phone11 has no connected ticket service for this workspace, so it cannot show ticket history or send a support request from this screen."
      />
    </PortalShell>
  );
}
