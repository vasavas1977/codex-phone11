export const BUSINESS_HOURS_TIMEZONE_CAPABILITY = "businessHoursTimezone";

type WorkspaceTimezoneAccess = {
  userRole?: string | null;
  settingsAvailable?: boolean | null;
  supportedSettings?: readonly string[] | null;
};

/**
 * Mirrors the server-side settings contract before the screen exposes a
 * writable control. The server rechecks both membership and schema support
 * when saving; this keeps an unavailable setting from looking editable.
 */
export function canManageWorkspaceTimezone(
  access: WorkspaceTimezoneAccess,
): boolean {
  return (
    ["owner", "admin"].includes(String(access.userRole || "")) &&
    access.settingsAvailable === true &&
    access.supportedSettings?.includes(BUSINESS_HOURS_TIMEZONE_CAPABILITY) ===
      true
  );
}

/**
 * Normalizes exactly as the API input schema does, then asks the platform's
 * IANA database to validate the value. It deliberately does not supply a
 * default: an unset workspace remains unset until an administrator saves one.
 */
export function normalizeIanaTimezone(value: string): string | null {
  const timezone = value.trim();
  if (!timezone || timezone.length > 64) return null;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return null;
  }
}
