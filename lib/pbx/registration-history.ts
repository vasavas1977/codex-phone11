/** A PBX event timestamp is registration history, not current device presence. */
export function lastRegistrationLabel(value?: string | null): string {
  if (!value) return "Not reported";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not reported";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
