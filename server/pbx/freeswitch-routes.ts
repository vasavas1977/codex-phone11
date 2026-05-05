/**
 * FreeSWITCH REST Callback Routes
 * 
 * Per Opus review: Separate REST (FS callbacks) from tRPC (portal).
 * These are Express routes mounted at /api/freeswitch/*
 * 
 * Endpoints:
 * 1. POST /api/freeswitch/directory — mod_xml_curl directory lookup
 * 2. POST /api/freeswitch/dialplan  — mod_xml_curl dialplan routing
 * 3. POST /api/freeswitch/cdr       — CDR webhook (call end)
 * 4. POST /api/freeswitch/event     — Event socket webhook
 */
import { Router, Request, Response } from "express";
import { query } from "./db";
import { cacheGetOrSet, rateLimitCheck, invalidateCache } from "./redis";
import { normalizeToE164, THAI_EMERGENCY_NUMBERS } from "./e164";
import { processCdr } from "./cdr-processor";
import { generateIvrDialplan, generateRingGroupDialplan, generateQueueDialplan, evaluateTimeCondition } from "./dialplan-generators";

const router = Router();

// Shared secret for FS → Backend auth
const FS_SHARED_SECRET = process.env.FS_SHARED_SECRET || "phone11-fs-secret-change-me";

/**
 * Middleware: verify FreeSWITCH shared secret
 */
function verifyFsAuth(req: Request, res: Response, next: Function) {
  const authHeader = req.headers["x-fs-secret"] || req.body?.secret || req.query?.secret;
  if (authHeader !== FS_SHARED_SECRET) {
    console.warn("[FS Routes] Unauthorized request from:", req.ip);
    return res.status(403).send("Forbidden");
  }
  next();
}

// ============================================================================
// 1. Directory Lookup (mod_xml_curl)
// ============================================================================
/**
 * FreeSWITCH calls this when a SIP REGISTER or INVITE arrives.
 * Returns XML with user credentials for digest auth.
 * 
 * Per Opus review: Cache responses in Redis (30s TTL) with DB fallback.
 */
router.post("/directory", verifyFsAuth, async (req: Request, res: Response) => {
  try {
    const { user, domain, action, purpose } = req.body;

    if (!user || !domain) {
      return res.type("xml").send(notFoundXml());
    }

    // Cache key: directory:{domain}:{user}
    const cacheKey = `directory:${domain}:${user}`;
    
    const xmlResponse = await cacheGetOrSet(cacheKey, 30, async () => {
      // Look up SIP account from database
      const result = await query(
        `SELECT sa.*, e.extension_number, e.display_name, e.voicemail_enabled,
                e.call_forwarding_enabled, e.cfu_destination, e.cfb_destination,
                e.cfna_destination, e.cfna_timeout_seconds, e.dnd_enabled,
                t.slug as tenant_slug
         FROM sip_accounts sa
         JOIN extensions e ON sa.extension_id = e.id
         JOIN tenants t ON sa.tenant_id = t.id
         WHERE sa.sip_username = $1 AND sa.sip_domain = $2 
               AND sa.status = 'active' AND sa.deleted_at IS NULL`,
        [user, domain]
      );

      if (result.rows.length === 0) {
        return notFoundXml();
      }

      const account = result.rows[0];
      return directoryXml(account);
    });

    res.type("xml").send(xmlResponse);
  } catch (error: any) {
    console.error("[FS Directory] Error:", error.message);
    res.type("xml").send(notFoundXml());
  }
});

// ============================================================================
// 2. Dialplan Routing (mod_xml_curl)
// ============================================================================
router.post("/dialplan", verifyFsAuth, async (req: Request, res: Response) => {
  try {
    const {
      "Caller-Destination-Number": destNumber,
      "Caller-Caller-ID-Number": callerIdNumber,
      "variable_sip_from_user": fromUser,
      "variable_domain_name": domain,
      "Caller-Context": context,
    } = req.body;

    if (!destNumber) {
      return res.type("xml").send(emptyDialplanXml());
    }

    // Normalize the destination
    const normalized = normalizeToE164(destNumber);

    // Emergency number routing — highest priority
    if (normalized.isEmergency) {
      return res.type("xml").send(emergencyDialplanXml(destNumber, callerIdNumber));
    }

    // ── IVR routing: *9xxx (e.g., *9001 = IVR menu ID 1)
    const ivrMatch = destNumber.match(/^\*9(\d{1,4})$/);
    if (ivrMatch) {
      const menuId = parseInt(ivrMatch[1], 10);
      const tenantId = await getTenantIdFromCaller(fromUser);
      if (tenantId) {
        const xml = await generateIvrDialplan(menuId, tenantId);
        return res.type("xml").send(xml);
      }
    }

    // ── Ring Group routing: *7xxx (e.g., *7001 = Ring Group ID 1)
    const rgMatch = destNumber.match(/^\*7(\d{1,4})$/);
    if (rgMatch) {
      const groupId = parseInt(rgMatch[1], 10);
      const tenantId = await getTenantIdFromCaller(fromUser);
      if (tenantId) {
        const xml = await generateRingGroupDialplan(groupId, tenantId);
        return res.type("xml").send(xml);
      }
    }

    // ── Call Queue routing: *8xxx (e.g., *8001 = Queue ID 1)
    const queueMatch = destNumber.match(/^\*8(\d{1,4})$/);
    if (queueMatch) {
      const queueId = parseInt(queueMatch[1], 10);
      const tenantId = await getTenantIdFromCaller(fromUser);
      if (tenantId) {
        const xml = await generateQueueDialplan(queueId, tenantId);
        return res.type("xml").send(xml);
      }
    }

    // ── Time Condition routing: *6xxx (e.g., *6001 = Time Condition ID 1)
    const tcMatch = destNumber.match(/^\*6(\d{1,4})$/);
    if (tcMatch) {
      const tcId = parseInt(tcMatch[1], 10);
      const tenantId = await getTenantIdFromCaller(fromUser);
      if (tenantId) {
        const result = await evaluateTimeCondition(tcId, tenantId);
        // Route based on time condition result
        if (result.action === "transfer" && result.target) {
          return res.type("xml").send(extensionDialplanXml({ extension_number: result.target, sip_username: result.target, sip_domain: domain || "phone11.cloud", voicemail_enabled: false, cfna_timeout_seconds: 30 }, callerIdNumber));
        } else if (result.action === "ivr" && result.target) {
          const xml = await generateIvrDialplan(parseInt(result.target), tenantId);
          return res.type("xml").send(xml);
        } else if (result.action === "voicemail") {
          return res.type("xml").send(voicemailDialplanXml(result.target || "1000", domain || "phone11.cloud"));
        } else {
          return res.type("xml").send(busyDialplanXml("Outside business hours"));
        }
      }
    }

    // Internal extension routing (3-4 digit)
    if (normalized.type === "extension") {
      const extResult = await query(
        `SELECT e.*, sa.sip_username, sa.sip_domain
         FROM extensions e
         JOIN sip_accounts sa ON e.id = sa.extension_id AND sa.deleted_at IS NULL
         WHERE e.extension_number = $1 AND e.status = 'active' AND e.deleted_at IS NULL
         LIMIT 1`,
        [destNumber]
      );

      if (extResult.rows.length > 0) {
        const ext = extResult.rows[0];
        return res.type("xml").send(extensionDialplanXml(ext, callerIdNumber));
      }
    }

    // PSTN outbound routing
    if (normalized.type === "mobile" || normalized.type === "landline" || normalized.type === "international") {
      // Check fraud controls
      const callerResult = await query(
        `SELECT sa.tenant_id FROM sip_accounts sa WHERE sa.sip_username = $1 AND sa.deleted_at IS NULL LIMIT 1`,
        [fromUser]
      );
      
      if (callerResult.rows.length > 0) {
        const tenantId = callerResult.rows[0].tenant_id;
        
        // Rate limit check
        const allowed = await rateLimitCheck(`fraud:cpm:${tenantId}`, 10, 60);
        if (!allowed) {
          console.warn(`[FS Dialplan] Rate limited tenant ${tenantId}`);
          return res.type("xml").send(busyDialplanXml("Rate limit exceeded"));
        }

        // Check if international is enabled
        if (normalized.type === "international") {
          const fraudResult = await query(
            `SELECT international_enabled FROM fraud_controls WHERE tenant_id = $1`,
            [tenantId]
          );
          if (fraudResult.rows.length > 0 && !fraudResult.rows[0].international_enabled) {
            return res.type("xml").send(busyDialplanXml("International calls disabled"));
          }
        }

        // Check premium rate
        if (normalized.isPremiumRate) {
          const fraudResult = await query(
            `SELECT premium_rate_enabled FROM fraud_controls WHERE tenant_id = $1`,
            [tenantId]
          );
          if (fraudResult.rows.length > 0 && !fraudResult.rows[0].premium_rate_enabled) {
            return res.type("xml").send(busyDialplanXml("Premium rate calls disabled"));
          }
        }
      }

      return res.type("xml").send(pstnDialplanXml(normalized.e164, callerIdNumber));
    }

    // Default: not found
    res.type("xml").send(emptyDialplanXml());
  } catch (error: any) {
    console.error("[FS Dialplan] Error:", error.message);
    res.type("xml").send(emptyDialplanXml());
  }
});

// ============================================================================
// 3. CDR Webhook (Enhanced — uses call_records + call_legs + call_events)
// ============================================================================
router.post("/cdr", verifyFsAuth, async (req: Request, res: Response) => {
  try {
    // Handle both: {cdr: {variables: ...}} (test/wrapper) and {variables: ...} (direct FS)
    const cdr = req.body.cdr || req.body;
    const result = await processCdr(cdr);
    console.log(`[FS CDR] Processed: record=${result.callRecordId}, leg=${result.callLegId}`);
    res.json({ ok: true, ...result });
  } catch (error: any) {
    console.error("[FS CDR] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// 4. Event Webhook (registration, BLF, etc.)
// ============================================================================
router.post("/event", verifyFsAuth, async (req: Request, res: Response) => {
  try {
    const { event, user, domain, status, contact } = req.body;

    if (event === "REGISTER" && user && domain) {
      // Update last_registered_at
      await query(
        `UPDATE sip_accounts SET last_registered_at = NOW(), last_registered_contact = $1
         WHERE sip_username = $2 AND sip_domain = $3 AND deleted_at IS NULL`,
        [contact || "", user, domain]
      );
      // Invalidate directory cache
      await invalidateCache(`directory:${domain}:${user}`);
    }

    res.json({ ok: true });
  } catch (error: any) {
    console.error("[FS Event] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// XML Generators
// ============================================================================

function directoryXml(account: any): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="directory">
    <domain name="${account.sip_domain}">
      <params>
        <param name="dial-string" value="{^^:sip_invite_domain=\${dialed_domain}:presence_id=\${dialed_user}@\${dialed_domain}}$\{sofia_contact(*/${account.sip_username}@${account.sip_domain})}"/>
      </params>
      <user id="${account.sip_username}">
        <params>
          <param name="a1-hash" value="${account.ha1}"/>
          <param name="vm-enabled" value="${account.voicemail_enabled ? 'true' : 'false'}"/>
        </params>
        <variables>
          <variable name="toll_allow" value="domestic,local"/>
          <variable name="accountcode" value="${account.tenant_slug || 'default'}"/>
          <variable name="user_context" value="default"/>
          <variable name="effective_caller_id_name" value="${account.display_name || account.sip_username}"/>
          <variable name="effective_caller_id_number" value="${account.extension_number}"/>
          <variable name="callgroup" value="${account.tenant_slug || 'default'}"/>
          <variable name="tenant_id" value="${account.tenant_id}"/>
        </variables>
      </user>
    </domain>
  </section>
</document>`;
}

function notFoundXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="directory">
  </section>
</document>`;
}

function extensionDialplanXml(ext: any, callerIdNumber: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="dialplan">
    <context name="default">
      <extension name="ext_${ext.extension_number}">
        <condition>
          <action application="set" data="call_direction=internal"/>
          <action application="set" data="hangup_after_bridge=true"/>
          <action application="set" data="call_timeout=${ext.cfna_timeout_seconds || 30}"/>
          <action application="bridge" data="user/${ext.sip_username}@${ext.sip_domain}"/>
          ${ext.voicemail_enabled ? `<action application="voicemail" data="default ${ext.sip_domain} ${ext.sip_username}"/>` : ''}
        </condition>
      </extension>
    </context>
  </section>
</document>`;
}

function pstnDialplanXml(e164: string, callerIdNumber: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="dialplan">
    <context name="default">
      <extension name="pstn_outbound">
        <condition>
          <action application="set" data="call_direction=outbound"/>
          <action application="set" data="hangup_after_bridge=true"/>
          <action application="set" data="effective_caller_id_number=${callerIdNumber}"/>
          <action application="bridge" data="sofia/gateway/pstn_gateway/${e164}"/>
        </condition>
      </extension>
    </context>
  </section>
</document>`;
}

function emergencyDialplanXml(destNumber: string, callerIdNumber: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="dialplan">
    <context name="default">
      <extension name="emergency_${destNumber}">
        <condition>
          <action application="set" data="call_direction=emergency"/>
          <action application="set" data="hangup_after_bridge=true"/>
          <action application="set" data="effective_caller_id_number=${callerIdNumber}"/>
          <action application="log" data="CRIT Emergency call to ${destNumber} from ${callerIdNumber}"/>
          <action application="bridge" data="sofia/gateway/pstn_gateway/${destNumber}"/>
        </condition>
      </extension>
    </context>
  </section>
</document>`;
}

function busyDialplanXml(reason: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="dialplan">
    <context name="default">
      <extension name="blocked">
        <condition>
          <action application="log" data="WARNING Call blocked: ${reason}"/>
          <action application="respond" data="486"/>
        </condition>
      </extension>
    </context>
  </section>
</document>`;
}

function emptyDialplanXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="dialplan">
  </section>
</document>`;
}

// ============================================================================
// Helper: Get tenant ID from caller SIP username
// ============================================================================
async function getTenantIdFromCaller(fromUser: string): Promise<number | null> {
  if (!fromUser) return null;
  const result = await query(
    `SELECT tenant_id FROM sip_accounts WHERE sip_username = $1 AND deleted_at IS NULL LIMIT 1`,
    [fromUser]
  );
  return result.rows.length > 0 ? result.rows[0].tenant_id : null;
}

function voicemailDialplanXml(extension: string, domain: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="dialplan">
    <context name="default">
      <extension name="voicemail_${extension}">
        <condition>
          <action application="voicemail" data="default ${domain} ${extension}"/>
        </condition>
      </extension>
    </context>
  </section>
</document>`;
}

export { router as freeswitchRouter };
