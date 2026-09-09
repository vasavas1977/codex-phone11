import { Redirect } from "expo-router";
import { SIGN_IN_ROUTE } from "@/constants/oauth";

// Legacy callback links are navigation only. Never read credentials from a URL.
export default function OAuthCallback() {
  return <Redirect href={SIGN_IN_ROUTE} />;
}
