import { FeatureUnavailable } from "@/components/feature-unavailable";
export default function Screen() {
  return <FeatureUnavailable title="Billing is not available in the app" description="Contact your workspace administrator for your actual plan, invoices and usage." />;
}
