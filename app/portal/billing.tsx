import { PortalShell, PortalState } from "@/components/portal/portal-shell";

export default function BillingScreen() {
  return (
    <PortalShell title="Billing" active="billing">
      <PortalState
        title="Billing setup is not available for this workspace yet"
        detail="Plans, invoices, payment methods, and usage charges cannot be managed from Phone11 at this time."
      />
    </PortalShell>
  );
}
