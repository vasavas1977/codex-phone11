import { PortalShell, PortalState } from "@/components/portal/portal-shell";

export default function ForwardingScreen() {
  return (
    <PortalShell title="Call forwarding" active="forwarding">
      <PortalState
        title="Call forwarding is not available yet"
        detail="Contact your company administrator for routing changes."
      />
    </PortalShell>
  );
}
