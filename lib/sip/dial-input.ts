// Reject ambiguous pasted text rather than silently dialing digits from prose.
export function normalizeDialInput(value: string): string | null {
  const text = value.normalize("NFKC").trim().replace(/^tel:/i, "");
  if (!/^[+\d*#().\s-]*$/.test(text)) return null;
  const number = text.replace(/[().\s-]/g, "");
  if (!/^\+?[\d*#]*$/.test(number) || number.length > 64) return null;
  return number;
}
