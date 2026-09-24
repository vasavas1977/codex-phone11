/** A presentation label only. Never use this value as a member or media identity. */
export function normalizePlainVideoDisplayName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.normalize("NFC").trim();
  const codepoints = Array.from(name);
  if (!codepoints.length || codepoints.length > 80 || Buffer.byteLength(name, "utf8") > 256) return undefined;
  if (/[\u0000-\u001f\u007f-\u009f\ud800-\udfff\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(name)) return undefined;
  return name;
}
