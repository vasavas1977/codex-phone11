/** Returns a participant's human label, or the caller-provided safe fallback. */
export function meetingParticipantDisplayName(
  name: string | null | undefined,
  identity: string,
  fallback: string,
) {
  const label = name?.trim();
  if (!label || label.toLowerCase() === identity.trim().toLowerCase()) {
    return fallback;
  }
  // Provider identities can be copied into `name` when no display name exists.
  if (
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(label) ||
    /^[0-9a-f]{16,}(?:::|$)/i.test(label) ||
    /^p11-t\d+-u\d+$/i.test(label)
  ) {
    return fallback;
  }
  return label;
}
