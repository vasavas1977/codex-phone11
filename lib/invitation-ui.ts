export function isValidInvitationEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isCurrentInvitationScope(
  expectedTenant: number,
  expectedUser: number,
  current: { tenantId: number | null; userId: number | null; workspaceValid: boolean },
  authenticatedUserId: number | undefined,
): boolean {
  return current.workspaceValid && current.tenantId === expectedTenant &&
    current.userId === expectedUser && authenticatedUserId === expectedUser;
}

export function invitationCapabilityView(input: {
  workspaceValid: boolean;
  tenantId: number | null;
  userId: number | null;
  checking: boolean;
  enabled: boolean | null;
}): "hidden" | "loading" | "unavailable" | "available" {
  if (!input.workspaceValid || !input.tenantId || !input.userId) return "hidden";
  if (input.checking && input.enabled === null) return "loading";
  return input.enabled === true ? "available" : "unavailable";
}


/** Clears bearer data from the address bar and Expo Router's focused route params. */
export function scrubInvitationBrowserUrl(clearRouteFragment: () => void): void {
  if (typeof window === "undefined") return;
  const cleanAddressBar = () => {
    const url = new URL(window.location.href);
    if (!url.hash && !url.searchParams.has("token")) return false;
    url.hash = "";
    url.searchParams.delete("token");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    return true;
  };
  if (!cleanAddressBar()) return;
  // Expo Router stores a URL fragment in its focused route's '#' param. Updating
  // that param preserves this screen instance and prevents a later route write
  // from restoring the token to the browser URL.
  clearRouteFragment();
  cleanAddressBar();
}
