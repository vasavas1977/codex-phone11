/**
 * E.164 Phone Number Normalization
 * 
 * Handles Thai phone number formats:
 * - Mobile: 08x, 09x, 06x → +668x, +669x, +666x
 * - Bangkok landline: 02xxxxxxx → +662xxxxxxx
 * - Provincial landline: 03x-07x → +663x-+667x
 * - Toll-free: 1800xxxxxx → +661800xxxxxx
 * - Emergency: 191, 199, 1669 → unchanged (special routing)
 * - International dialed with 00: 001xxx → +1xxx
 * - Already E.164: +66xxx → unchanged
 * 
 * Per Opus review: Thai-specific normalization is critical.
 * Leading 0 must be stripped for mobile/landline.
 * 00 prefix = international dialing from Thailand.
 */

/** Thai emergency numbers — must never be normalized or blocked */
export const THAI_EMERGENCY_NUMBERS = ["191", "199", "1669", "1554", "1155", "1646"];

/** Thai short codes (3-4 digits) that should not be normalized */
export const THAI_SHORT_CODES = [
  "100", "1100", "1133", "1137", "1175", "1323", "1330", "1331",
  "1348", "1390", "1506", "1584", "1678", "1691",
  ...THAI_EMERGENCY_NUMBERS,
];

export interface NormalizeResult {
  /** E.164 formatted number (e.g., +66812345678) */
  e164: string;
  /** Display formatted number (e.g., 081-234-5678) */
  display: string;
  /** Country code (e.g., TH, US) */
  country: string;
  /** Number type */
  type: "mobile" | "landline" | "toll_free" | "emergency" | "short_code" | "international" | "extension" | "unknown";
  /** Whether this is an emergency number */
  isEmergency: boolean;
  /** Whether this is a premium-rate number */
  isPremiumRate: boolean;
}

/**
 * Normalize a dialed number to E.164 format.
 * Default country is Thailand (+66).
 */
export function normalizeToE164(
  input: string,
  defaultCountryCode: string = "+66"
): NormalizeResult {
  // Strip whitespace, dashes, parentheses, dots
  let cleaned = input.replace(/[\s\-\(\)\.]/g, "");

  // Handle empty input
  if (!cleaned) {
    return { e164: "", display: "", country: "XX", type: "unknown", isEmergency: false, isPremiumRate: false };
  }

  // 1. Check if it's an internal extension (3-4 digit, starts with 1-9)
  if (/^\d{3,4}$/.test(cleaned) && !THAI_SHORT_CODES.includes(cleaned)) {
    return {
      e164: cleaned,
      display: cleaned,
      country: "INT",
      type: "extension",
      isEmergency: false,
      isPremiumRate: false,
    };
  }

  // 2. Check Thai emergency numbers
  if (THAI_EMERGENCY_NUMBERS.includes(cleaned)) {
    return {
      e164: cleaned,
      display: cleaned,
      country: "TH",
      type: "emergency",
      isEmergency: true,
      isPremiumRate: false,
    };
  }

  // 3. Check Thai short codes
  if (THAI_SHORT_CODES.includes(cleaned)) {
    return {
      e164: cleaned,
      display: cleaned,
      country: "TH",
      type: "short_code",
      isEmergency: false,
      isPremiumRate: false,
    };
  }

  // 4. Already in E.164 format (+xxx)
  if (cleaned.startsWith("+")) {
    return classifyE164(cleaned);
  }

  // 5. International dialing from Thailand (00 prefix)
  if (cleaned.startsWith("00") && cleaned.length > 4) {
    const international = "+" + cleaned.substring(2);
    return classifyE164(international);
  }

  // 6. Thai mobile: 06x, 08x, 09x (10 digits with leading 0)
  if (/^0[689]\d{8}$/.test(cleaned)) {
    const e164 = "+66" + cleaned.substring(1);
    return {
      e164,
      display: formatThaiMobile(cleaned),
      country: "TH",
      type: "mobile",
      isEmergency: false,
      isPremiumRate: false,
    };
  }

  // 7. Thai Bangkok landline: 02xxxxxxx (9 digits with leading 0)
  if (/^02\d{7}$/.test(cleaned)) {
    const e164 = "+66" + cleaned.substring(1);
    return {
      e164,
      display: formatThaiLandline(cleaned),
      country: "TH",
      type: "landline",
      isEmergency: false,
      isPremiumRate: false,
    };
  }

  // 8. Thai provincial landline: 03x-07x (9 digits with leading 0)
  if (/^0[3-7]\d{7}$/.test(cleaned)) {
    const e164 = "+66" + cleaned.substring(1);
    return {
      e164,
      display: formatThaiLandline(cleaned),
      country: "TH",
      type: "landline",
      isEmergency: false,
      isPremiumRate: false,
    };
  }

  // 9. Thai toll-free: 1800xxxxxx
  if (/^1800\d{6}$/.test(cleaned)) {
    return {
      e164: "+66" + cleaned,
      display: cleaned.replace(/(\d{4})(\d{3})(\d{3})/, "$1-$2-$3"),
      country: "TH",
      type: "toll_free",
      isEmergency: false,
      isPremiumRate: false,
    };
  }

  // 10. Thai premium rate: 1900xxxxxx
  if (/^1900\d{6}$/.test(cleaned)) {
    return {
      e164: "+66" + cleaned,
      display: cleaned.replace(/(\d{4})(\d{3})(\d{3})/, "$1-$2-$3"),
      country: "TH",
      type: "toll_free",
      isEmergency: false,
      isPremiumRate: true,
    };
  }

  // 11. Fallback: assume Thai number without leading 0 (e.g., 812345678)
  if (/^\d{9}$/.test(cleaned) && /^[2-9]/.test(cleaned)) {
    const e164 = "+66" + cleaned;
    const withZero = "0" + cleaned;
    return {
      e164,
      display: /^[689]/.test(cleaned) ? formatThaiMobile(withZero) : formatThaiLandline(withZero),
      country: "TH",
      type: /^[689]/.test(cleaned) ? "mobile" : "landline",
      isEmergency: false,
      isPremiumRate: false,
    };
  }

  // 12. Unknown format — return as-is
  return {
    e164: cleaned,
    display: cleaned,
    country: "XX",
    type: "unknown",
    isEmergency: false,
    isPremiumRate: false,
  };
}

/**
 * Classify an E.164 number by country and type
 */
function classifyE164(e164: string): NormalizeResult {
  // Thai numbers
  if (e164.startsWith("+66")) {
    const local = e164.substring(3);
    if (/^[689]\d{8}$/.test(local)) {
      return {
        e164,
        display: formatThaiMobile("0" + local),
        country: "TH",
        type: "mobile",
        isEmergency: false,
        isPremiumRate: false,
      };
    }
    if (/^2\d{7}$/.test(local)) {
      return {
        e164,
        display: formatThaiLandline("0" + local),
        country: "TH",
        type: "landline",
        isEmergency: false,
        isPremiumRate: false,
      };
    }
    if (/^[3-7]\d{7}$/.test(local)) {
      return {
        e164,
        display: formatThaiLandline("0" + local),
        country: "TH",
        type: "landline",
        isEmergency: false,
        isPremiumRate: false,
      };
    }
  }

  // Detect country from E.164 prefix
  const country = detectCountryFromE164(e164);
  const isPremium = isPremiumRateNumber(e164);

  return {
    e164,
    display: e164,
    country,
    type: "international",
    isEmergency: false,
    isPremiumRate: isPremium,
  };
}

/** Format Thai mobile: 081-234-5678 */
function formatThaiMobile(num: string): string {
  return num.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
}

/** Format Thai landline: 02-123-4567 */
function formatThaiLandline(num: string): string {
  return num.replace(/(\d{2})(\d{3})(\d{4})/, "$1-$2-$3");
}

/** Detect country code from E.164 */
function detectCountryFromE164(e164: string): string {
  const prefixMap: Record<string, string> = {
    "+1": "US", "+44": "GB", "+66": "TH", "+65": "SG", "+60": "MY",
    "+81": "JP", "+82": "KR", "+86": "CN", "+91": "IN", "+61": "AU",
    "+49": "DE", "+33": "FR", "+39": "IT", "+34": "ES", "+7": "RU",
    "+855": "KH", "+856": "LA", "+84": "VN", "+62": "ID", "+63": "PH",
    "+95": "MM", "+880": "BD",
  };
  for (const [prefix, country] of Object.entries(prefixMap)) {
    if (e164.startsWith(prefix)) return country;
  }
  return "XX";
}

/** Check if number is premium-rate (high-cost destinations) */
function isPremiumRateNumber(e164: string): boolean {
  const premiumPrefixes = [
    "+1900", "+44900", "+4490", "+61190",  // Various premium rate prefixes
    "+66190",  // Thai 1900 premium
  ];
  return premiumPrefixes.some((p) => e164.startsWith(p));
}

/**
 * Validate that a number is a valid E.164 format
 */
export function isValidE164(number: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(number);
}

/**
 * Extract country code from E.164 number
 */
export function getCountryCode(e164: string): string {
  return detectCountryFromE164(e164);
}
