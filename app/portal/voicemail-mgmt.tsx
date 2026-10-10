import { Redirect } from "expo-router";

/** The main voicemail route already enforces mailbox ownership and media access. */
export default function PortalVoicemailRedirect() {
  return <Redirect href="/voicemail" />;
}
