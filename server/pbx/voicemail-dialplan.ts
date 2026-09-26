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
};

export function voicemailDialplanActions(
  extension: VoicemailExtensionRoute,
  hookReady: boolean,
): { beforeBridge: string; afterBridge: string } {
  if (extension.voicemail_enabled !== true) return { beforeBridge: "", afterBridge: "" };

  if (!hookReady) {
    // Preserve the existing PBX route until the new producer is commissioned.
    return {
      beforeBridge: "",
      afterBridge: `<action application="voicemail" data="default ${extension.sip_domain} ${extension.sip_username}"/>`,
    };
  }

  // These values are selected by the authenticated tenant-scoped PBX query,
  // never by caller-supplied dialplan variables.  Reject anything that could
  // change the XML or Lua argument boundaries.
  if (!Number.isSafeInteger(extension.tenant_id) || extension.tenant_id <= 0 ||
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
    beforeBridge: `<action application="set" data="continue_on_fail=true"/>`,
    afterBridge: `<action application="lua" data="/etc/freeswitch/scripts/phone11_voicemail_deposit.lua ${extension.tenant_id} ${extension.extension_number} ${extension.sip_username} ${extension.sip_domain}"/>`,
  };
}
