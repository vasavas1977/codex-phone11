/**
 * Protected-context foundation. There is intentionally NO production commissioning
 * factory: the mounted route uses productionProtectedOutboundXml(), always UNBOUND.
 * Service authentication does not prove subscriber identity. The application's
 * global body parser cannot establish raw form cardinality/encoding; it is never
 * admitted to the qualified core. A future ingress + resolver authority requires
 * independent review, without adding SIP-table grants to the policy LOGIN.
 */
import { isIP } from "node:net";
import { normalizeToE164 } from "./e164";
import { withFraudPolicyTransaction } from "./fraud-policy-db";

export const PROTECTED_OUTBOUND_CONTEXT = "phone11_protected_outbound";
export type ProtectedBinding = { status: "UNBOUND" } | {
  status: "QUALIFIED";
  mode: "KAM_DIGEST_ASSERTED_ONLY";
  tenantId: number;
  proxyIps: readonly string[];
  sofiaProfile: string;
  gateway: string;
  callerIdNumber: string;
};
export interface ProtectedDependencies {
  // Pure-core injection only. No production implementation/privileged fallback.
  // Returns the explicit active-assignment projection validated below, never a
  // preselected tenant based on From, domain_name or recording prerequisites.
  resolveCanonicalAssignments(user: string, realm: string): Promise<unknown>;
}
const REQUIRED = ["section", "Caller-Context", "Caller-Destination-Number",
  "variable_phone11_authenticated_user", "variable_phone11_authenticated_realm",
  "variable_sip_received_ip", "variable_sofia_profile_name", "variable_call_direction"] as const;
// mod_xml_curl always prepends hostname in its basic_data. It is bounded
// transport metadata only and must never select a subscriber or workspace.
const OPTIONAL = ["hostname", "tag_name", "key_name", "key_value", "Caller-Caller-ID-Number",
  "variable_sip_from_user", "variable_domain_name"];
const ALLOWED = new Set<string>([...REQUIRED, ...OPTIONAL]);
const text = (v: unknown, max: number): v is string => typeof v === "string" &&
  v.length > 0 && v.length <= max && v.trim() === v && /^[\x21-\x7e]+$/.test(v);
const identity = (v: unknown): v is string => text(v, 255) && !v.includes(",");
const positiveId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 2147483647;

/** Supplied malformed contexts cannot reach any legacy/default branch. */
export function selectsProtectedOutbound(body: unknown): boolean {
  if (!body || typeof body !== "object" || !Object.prototype.hasOwnProperty.call(body, "Caller-Context")) return false;
  const context = (body as Record<string, unknown>)["Caller-Context"];
  return typeof context !== "string" || context.length === 0 || /[\s\x00-\x1f\x7f]/.test(context) ||
    context === PROTECTED_OUTBOUND_CONTEXT;
}

export function protectedOutboundDenyXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml"><section name="dialplan"><context name="${PROTECTED_OUTBOUND_CONTEXT}"><extension name="protected_denied"><condition><action application="hangup" data="CALL_REJECTED"/></condition></extension></context></section></document>`;
}

/** Hard disabled: neither environment flags nor policy rows can qualify ingress. */
export function productionProtectedOutboundXml(): string {
  return protectedOutboundDenyXml();
}

/** Strict raw URL-encoded form only; do not pass global-parser reconstructed data. */
export function parseProtectedOutboundForm(raw: unknown): Record<string, string> | null {
  if (typeof raw !== "string" || raw.length > 8192 || !/^[\x20-\x7e]*$/.test(raw)) return null;
  const entries = raw.split("&");
  if (entries.length > 16) return null;
  const fields: Record<string, string> = Object.create(null);
  try {
    for (const entry of entries) {
      const at = entry.indexOf("=");
      if (at < 1) return null;
      const decode = (v: string) => decodeURIComponent(v.replace(/\+/g, " "));
      const key = decode(entry.slice(0, at)), value = decode(entry.slice(at + 1));
      if (!ALLOWED.has(key) || Object.prototype.hasOwnProperty.call(fields, key) ||
          value.length > 512 || !/^[\x20-\x7e]*$/.test(value)) return null;
      fields[key] = value;
    }
    if (Object.prototype.hasOwnProperty.call(fields, "hostname") && !text(fields.hostname, 255)) return null;
    return REQUIRED.every(key => Object.prototype.hasOwnProperty.call(fields, key)) ? fields : null;
  } catch { return null; }
}

/** Linear bounded dial scanner: each character advances the same index once. */
export function isProtectedDialString(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 32) return false;
  const digit = (char: string | undefined) => char !== undefined && char >= "0" && char <= "9";
  if (raw.startsWith("1900")) {
    if (raw.length !== 10) return false;
    for (let index = 4; index < raw.length; index++) if (!digit(raw[index])) return false;
    return true;
  }
  let index = raw.startsWith("+") ? 1 : raw.startsWith("00") ? 2 : -1;
  if (index < 0 || !digit(raw[index]) || raw[index] === "0") return false;
  while (index < raw.length) {
    if (digit(raw[index])) {
      while (index < raw.length && digit(raw[index])) index++;
    } else if (raw[index] === "(") {
      index++;
      if (!digit(raw[index])) return false;
      while (index < raw.length && digit(raw[index])) index++;
      if (raw[index] !== ")") return false;
      index++;
    } else return false;
    if (index < raw.length && (raw[index] === " " || raw[index] === "." || raw[index] === "-")) {
      index++;
      if (index === raw.length) return false;
    }
  }
  return true;
}

function qualified(binding: ProtectedBinding): binding is Extract<ProtectedBinding, { status: "QUALIFIED" }> {
  return binding?.status === "QUALIFIED" && binding.mode === "KAM_DIGEST_ASSERTED_ONLY" &&
    positiveId(binding.tenantId) && Array.isArray(binding.proxyIps) && binding.proxyIps.length > 0 &&
    binding.proxyIps.length <= 8 && binding.proxyIps.every(ip => typeof ip === "string" && isIP(ip) !== 0) &&
    new Set(binding.proxyIps).size === binding.proxyIps.length && text(binding.sofiaProfile, 80) &&
    /^[A-Za-z0-9_-]{1,80}$/.test(binding.sofiaProfile) &&
    text(binding.gateway, 80) && /^[A-Za-z0-9_-]{1,80}$/.test(binding.gateway) &&
    text(binding.callerIdNumber, 16) && /^\+?[1-9]\d{2,14}$/.test(binding.callerIdNumber);
}
function assignment(rows: unknown, user: string, realm: string, tenantId: number): boolean {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== "object") return false;
  const row = rows[0];
  return row.tenant_id === tenantId && row.extension_tenant_id === tenantId && positiveId(row.extension_id) &&
    row.sip_username === user && row.sip_domain === realm && row.account_status === "active" &&
    row.account_deleted_at === null && row.extension_status === "active" && row.extension_deleted_at === null &&
    row.tenant_status === "active";
}
function attribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function allowXml(raw: string, e164: string, binding: Extract<ProtectedBinding, { status: "QUALIFIED" }>): string {
  const exactRaw = attribute(`^${raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml"><section name="dialplan"><context name="${PROTECTED_OUTBOUND_CONTEXT}"><extension name="protected_outbound"><condition field="destination_number" expression="${exactRaw}"><action application="set" data="call_direction=outbound"/><action application="set" data="hangup_after_bridge=true"/><action application="set" data="effective_caller_id_number=${attribute(binding.callerIdNumber)}"/><action application="bridge" data="sofia/gateway/${binding.gateway}/${e164}"/></condition></extension></context></section></document>`;
}

/**
 * Qualified PURE core, for generated tests/future reviewed commissioning only.
 * The caller must provide raw bytes from a separately reviewed strict ingress and
 * an exclusive authenticated Kam->FS binding; a caller-supplied marker is not proof.
 */
export async function evaluateProtectedOutbound(rawForm: unknown, binding: ProtectedBinding, dependencies: ProtectedDependencies): Promise<string> {
  const deny = protectedOutboundDenyXml();
  try {
    if (!qualified(binding)) return deny;
    // Snapshot mutable caller objects before any awaited dependency runs.
    const selected = { ...binding, proxyIps: [...binding.proxyIps] };
    const fields = parseProtectedOutboundForm(rawForm);
    if (!fields || fields.section !== "dialplan" || fields["Caller-Context"] !== PROTECTED_OUTBOUND_CONTEXT ||
        !identity(fields.variable_phone11_authenticated_user) || !identity(fields.variable_phone11_authenticated_realm) ||
        !isIP(fields.variable_sip_received_ip) || !selected.proxyIps.includes(fields.variable_sip_received_ip) ||
        fields.variable_sofia_profile_name !== selected.sofiaProfile || fields.variable_call_direction !== "outbound") return deny;
    const raw = fields["Caller-Destination-Number"];
    // Narrow dial grammar, independent of the legacy normalizer's stripping.
    // Permit plain Thai1900 or formatted +/00 international numbers only.
    if (!isProtectedDialString(raw)) return deny;
    const normalized = normalizeToE164(raw);
    const thaiPremium = normalized.isPremiumRate && /^\+661900\d{6}$/.test(normalized.e164);
    // The legacy normalizer labels unsupported +66 shapes international.
    // Protected routing admits Thai1900 only; other Thai forms stay legacy.
    if (normalized.e164.startsWith("+66") && !thaiPremium) return deny;
    const requiresInternationalPermission = normalized.type === "international" && !thaiPremium;
    // Domestic/internal/emergency routing belongs exclusively to legacy branches.
    if (!requiresInternationalPermission && !normalized.isPremiumRate) return deny;
    if (!/^\+[1-9]\d{6,14}$/.test(normalized.e164)) return deny;
    const rows = await dependencies.resolveCanonicalAssignments(fields.variable_phone11_authenticated_user, fields.variable_phone11_authenticated_realm);
    if (!assignment(rows, fields.variable_phone11_authenticated_user, fields.variable_phone11_authenticated_realm, selected.tenantId)) return deny;
    // No shared PBX policy pool, actor helper, recording write or transaction control.
    // Await the entire dedicated transaction, including COMMIT/release, before XML.
    const policy = await withFraudPolicyTransaction(selected.tenantId, async client => {
      const result = await client.query(`SELECT tenant_id, international_enabled, premium_rate_enabled
        FROM fraud_controls WHERE tenant_id = $1`, [selected.tenantId]);
      const row = result.rows[0];
      return result.rows.length === 1 && row?.tenant_id === selected.tenantId &&
        typeof row.international_enabled === "boolean" && typeof row.premium_rate_enabled === "boolean" ? row : null;
    });
    if (!policy || (requiresInternationalPermission && policy.international_enabled !== true) ||
        (normalized.isPremiumRate && policy.premium_rate_enabled !== true)) return deny;
    return allowXml(raw, normalized.e164, selected);
  } catch { return deny; } // Never expose DB/credential/raw input error details.
}
