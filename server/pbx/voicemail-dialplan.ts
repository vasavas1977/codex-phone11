import { query } from "./db";

/**
 * The Phone11 inbox deposit path is opt-in.  FreeSWITCH must not be asked to
 * record for that inbox until its durable producer and relay are commissioned.
 */
export type VoicemailExtensionRoute = {
  tenant_id: number;
  extension_number: string;
  sip_username: string;
  sip_domain: string;
  voicemail_enabled: boolean;
  type?: string;
  user_id?: number;
};

export function voicemailDialplanActions(
  extension: VoicemailExtensionRoute,
  hookReady: boolean,
  entry: "bridge" | "direct" = "bridge",
): { beforeBridge: string; afterBridge: string } {
  if (extension.voicemail_enabled !== true) return { beforeBridge: "", afterBridge: "" };

  if (!hookReady) {
    // Preserve the existing PBX route until the new producer is commissioned.
    return {
      beforeBridge: "",
      afterBridge: legacyVoicemailAction(extension.sip_domain, extension.sip_username),
    };
  }

  // These values are selected by the authenticated tenant-scoped PBX query,
  // never by caller-supplied dialplan variables.  Reject anything that could
  // change the XML or Lua argument boundaries.
  // The Phone11 inbox has an individual owner, not a shared/team mailbox.
  // The pre-record admission checks the owner's current tenant membership.
  if (extension.type !== "user" || typeof extension.user_id !== "number" ||
      !Number.isSafeInteger(extension.user_id) || extension.user_id <= 0 ||
      !Number.isSafeInteger(extension.tenant_id) || extension.tenant_id <= 0 ||
      !/^[1-9][0-9]{0,15}$/.test(extension.extension_number) ||
      !/^[1-9][0-9]{0,15}$/.test(extension.sip_username) ||
      extension.sip_username !== extension.extension_number ||
      typeof extension.sip_domain !== "string" || extension.sip_domain.length > 253 ||
      !/^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$/.test(extension.sip_domain)) {
    return { beforeBridge: "", afterBridge: "" };
  }

  return {
    // A completed answered call hangs up after the bridge.  A failed bridge
    // may continue, but the Lua hook admits only the expected failure causes.
    beforeBridge: entry === "bridge" ? `<action application="set" data="continue_on_fail=true"/>` : "",
    afterBridge: `<action application="lua" data="/etc/freeswitch/scripts/phone11_voicemail_deposit.lua ${extension.tenant_id} ${extension.extension_number} ${extension.sip_username} ${extension.sip_domain}${entry === "direct" ? " direct" : ""}"/>`,
  };
}

/** Backend legacy mode is fixed by the generated application path. FreeSWITCH
 * checks its own process flag at execution time, including for cached XML. */
export function legacyVoicemailAction(domain: string, account: string): string {
  return `<action application="lua" data="/etc/freeswitch/scripts/phone11_legacy_voicemail.lua ${account} ${domain}"/>`;
}

export function voicemailHookReady(): boolean {
  return process.env.PHONE11_VOICEMAIL_HOOK_READY === "true";
}

/** Resolve only current personal mailbox assignments; never use call variables
 * as the tenant or domain for a protected deposit. The producer rechecks
 * ownership under its admission lock before allowing any recording. */
export async function protectedVoicemailAction(
  tenantId: number,
  target: string,
  entry: "bridge" | "direct",
): Promise<string> {
  const refused = '<action application="hangup" data="NORMAL_TEMPORARY_FAILURE"/>';
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0 ||
      typeof target !== "string" || !/^[1-9][0-9]{0,15}$/.test(target)) return refused;
  const result = await query(
    `SELECT e.tenant_id, e.extension_number, e.type, e.user_id, e.voicemail_enabled,
            sa.sip_username, sa.sip_domain
     FROM extensions e
     JOIN tenants t ON t.id = e.tenant_id AND t.status = 'active'
     JOIN user_extensions ue ON ue.extension_id = e.id AND ue.user_id = e.user_id
     JOIN tenant_memberships tm ON tm.user_id = e.user_id AND tm.tenant_id = e.tenant_id AND tm.status = 'active'
     JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = e.tenant_id
       AND sa.user_id = e.user_id AND sa.status = 'active' AND sa.deleted_at IS NULL
     WHERE e.tenant_id = $1 AND e.extension_number = $2
       AND e.type = 'user' AND e.user_id IS NOT NULL AND e.status = 'active'
       AND e.deleted_at IS NULL AND e.voicemail_enabled = true`,
    [tenantId, target],
  );
  // Ambiguous identities and reassigned SIP accounts must not pick a mailbox.
  if (result.rows.length !== 1 || result.rows[0].tenant_id !== tenantId ||
      result.rows[0].extension_number !== target) return refused;
  return voicemailDialplanActions(result.rows[0], true, entry).afterBridge || refused;
}
