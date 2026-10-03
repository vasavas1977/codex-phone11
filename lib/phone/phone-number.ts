import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

function plainNumber(value: string): string | null {
  const text = value.normalize("NFKC").trim().replace(/^tel:/i, "");
  if (!/^[+\d().\s-]+$/.test(text)) return null;
  const compact = text.replace(/[().\s-]/g, "");
  return /^\+?\d{8,15}$/.test(compact) ? compact : null;
}

/** Bare international caller IDs need '+', but local numbers and extensions do not. */
export function internationalHistoryNumber(value: string): string {
  const compact = plainNumber(value);
  if (!compact || compact.startsWith("0")) return value;
  const parsed = parsePhoneNumberFromString(compact.startsWith("+") ? compact : `+${compact}`);
  return parsed?.isValid() ? parsed.number : value;
}

/** Local-only address-book comparison; never use this to rewrite SIP routing. */
export function contactPhoneKey(value: string, defaultCountry: CountryCode = "TH"): string | null {
  const compact = plainNumber(value);
  if (!compact) return null;
  const international = internationalHistoryNumber(compact);
  if (international.startsWith("+")) {
    const parsed = parsePhoneNumberFromString(international);
    return parsed?.isValid() ? parsed.number : null;
  }
  const local = parsePhoneNumberFromString(compact, defaultCountry);
  return local?.isValid() ? local.number : null;
}
