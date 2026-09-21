import { Redirect } from "expo-router";

/** Keep existing portal links on the supported Phone11 profile workflow. */
export default function PortalProfileRedirect() {
  return <Redirect href="/profile" />;
}
