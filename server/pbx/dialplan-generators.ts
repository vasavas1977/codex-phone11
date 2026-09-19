/**
 * FreeSWITCH Dialplan XML Generators
 * Generates dynamic XML for IVR menus, ring groups, and call queues
 * Phone11 Cloud PBX — Milestone 7
 */
import { query } from "./db";
import { cacheGetOrSet } from "./redis";

// ═══════════════════════════════════════════════════════════════════════════════
// IVR Dialplan XML
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateIvrDialplan(menuId: number, tenantId: number): Promise<string> {
  return cacheGetOrSet(`dialplan:ivr:${menuId}`, 300, async () => {
    const menuRes = await query(`SELECT * FROM ivr_menus WHERE id = $1 AND tenant_id = $2`, [menuId, tenantId]);
    const menu = menuRes.rows[0];
    if (!menu) return generateNotFoundXml();

    const actionsRes = await query(
      `SELECT * FROM ivr_actions WHERE menu_id = $1 ORDER BY sort_order, digit`,
      [menuId]
    );
    const actions = actionsRes.rows;

    // Build IVR entries
    const entries = actions.map((a: any) => {
      const actionXml = getActionXml(a);
      return `        <entry action="menu-exec-app" digits="${a.digit}" param="${actionXml}"/>`;
    }).join("\n");

    // Greeting
    const greetSound = menu.greeting_file || `say:${menu.greeting_tts || "Welcome to Phone11"}`;
    const invalidSound = menu.invalid_sound || "ivr/ivr-that_was_an_invalid_entry.wav";

    return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="dialplan">
    <context name="default">
      <extension name="ivr-${menu.name}">
        <condition>
          <action application="answer"/>
          <action application="sleep" data="500"/>
          <action application="set" data="tenant_id=${tenantId}"/>
          <action application="ivr" data="ivr_menu_${menuId}"/>
        </condition>
      </extension>
    </context>
  </section>
  <section name="configuration">
    <configuration name="ivr.conf" description="IVR menus">
      <menus>
        <menu name="ivr_menu_${menuId}"
              greet-long="${greetSound}"
              greet-short="${greetSound}"
              invalid-sound="${invalidSound}"
              exit-sound="voicemail/vm-goodbye.wav"
              timeout="${menu.timeout_ms}"
              max-failures="${menu.max_retries}"
              inter-digit-timeout="${menu.digit_timeout_ms}"
              digit-len="4"
              tts-engine="flite"
              tts-voice="kal">
${entries}
        </menu>
      </menus>
    </configuration>
  </section>
</document>`;
  });
}

function getActionXml(action: any): string {
  switch (action.action_type) {
    case "transfer_ext":
      return `transfer ${action.target} XML default`;
    case "transfer_queue":
      return `transfer *8${action.target} XML default`;
    case "transfer_ringgroup":
      return `transfer *7${action.target} XML default`;
    case "sub_menu":
      return `ivr ivr_menu_${action.target}`;
    case "voicemail":
      return `transfer *98${action.target || ""} XML default`;
    case "hangup":
      return `hangup NORMAL_CLEARING`;
    case "repeat":
      return `menu-top`;
    case "dial_by_name":
      return `transfer dial_by_name XML default`;
    case "external_number":
      return `transfer ${action.target} XML default`;
    default:
      return `hangup NORMAL_CLEARING`;
  }
}

type RingGroupFallback = { action: "voicemail" | "transfer" | "ivr" | "hangup"; target?: string };

async function resolveRingGroupFallback(group: any, tenantId: number): Promise<RingGroupFallback> {
  if (group.fallback_action === "hangup") return { action: "hangup" };
  const target = typeof group.fallback_target === "string" ? group.fallback_target.trim() : "";
  if (group.fallback_action === "transfer" || group.fallback_action === "voicemail") {
    if (!/^\d{2,10}$/.test(target)) return { action: "hangup" };
    const result = await query(
      `SELECT 1 FROM extensions e
       JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = e.tenant_id
         AND sa.status = 'active' AND sa.deleted_at IS NULL AND sa.user_id IS NOT NULL
       WHERE e.tenant_id = $1 AND e.extension_number = $2 AND e.status = 'active' AND e.deleted_at IS NULL
         AND e.type = 'user' AND e.user_id IS NOT NULL${group.fallback_action === "voicemail" ? " AND e.voicemail_enabled = true" : ""} LIMIT 1`,
      [tenantId, target],
    );
    return result.rows.length === 1
      ? { action: group.fallback_action, target }
      : { action: "hangup" };
  }
  if (group.fallback_action === "ivr") {
    if (!/^\d+$/.test(target) || !Number.isSafeInteger(Number(target)) || Number(target) < 1) {
      return { action: "hangup" };
    }
    const result = await query(
      `SELECT 1 FROM ivr_menus WHERE id = $1 AND tenant_id = $2 AND is_active = true LIMIT 1`,
      [Number(target), tenantId],
    );
    return result.rows.length === 1 ? { action: "ivr", target } : { action: "hangup" };
  }
  return { action: "hangup" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Ring Group Dialplan XML
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateRingGroupDialplan(groupId: number, tenantId: number): Promise<string> {
  return cacheGetOrSet(`dialplan:ringgroup:${tenantId}:${groupId}`, 300, async () => {
    const groupRes = await query(`SELECT * FROM ring_groups WHERE id = $1 AND tenant_id = $2`, [groupId, tenantId]);
    const group = groupRes.rows[0];
    if (!group) return generateNotFoundXml();
    if (group.strategy !== "simultaneous" && group.strategy !== "sequential") {
      return generateNotFoundXml();
    }

    const membersRes = await query(
      `SELECT rgm.*, e.extension_number, sa.sip_username, sa.sip_domain
       FROM ring_group_members rgm
       JOIN extensions e ON e.id = rgm.extension_id AND e.tenant_id = $2
         AND e.status = 'active' AND e.deleted_at IS NULL AND e.type = 'user' AND e.user_id IS NOT NULL
       JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = e.tenant_id
         AND sa.status = 'active' AND sa.deleted_at IS NULL AND sa.user_id IS NOT NULL
       WHERE rgm.ring_group_id = $1 AND rgm.is_active = true
       ORDER BY rgm.priority, rgm.delay_seconds`,
      [groupId, tenantId]
    );
    const members = membersRes.rows;
    if (members.length === 0) return generateNotFoundXml();

    let bridgeString: string;
    const timeout = group.ring_timeout || 25;

    switch (group.strategy) {
      case "simultaneous":
        bridgeString = members.map((m: any) => `user/${m.sip_username}@${m.sip_domain}`).join(",");
        break;
      case "sequential":
        bridgeString = members.map((m: any) => `user/${m.sip_username}@${m.sip_domain}`).join("|");
        break;
      default:
        return generateNotFoundXml();
    }

    // Fallback action
    const fallback = await resolveRingGroupFallback(group, tenantId);
    let fallbackXml = "";
    switch (fallback.action) {
      case "voicemail":
        fallbackXml = `          <action application="voicemail" data="default \${domain_name} ${fallback.target}"/>`;
        break;
      case "transfer":
        fallbackXml = `          <action application="transfer" data="${fallback.target} XML default"/>`;
        break;
      case "ivr":
        fallbackXml = `          <action application="ivr" data="ivr_menu_${fallback.target}"/>`;
        break;
      case "hangup":
        fallbackXml = `          <action application="hangup" data="NORMAL_CLEARING"/>`;
        break;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="dialplan">
    <context name="default">
      <extension name="ring-group-${group.name}">
        <condition>
          <action application="set" data="tenant_id=${tenantId}"/>
          <action application="set" data="ring_group_id=${groupId}"/>
          <action application="set" data="call_timeout=${timeout}"/>
          <action application="set" data="continue_on_fail=true"/>
          <action application="set" data="hangup_after_bridge=true"/>
${group.moh_file ? `          <action application="set" data="hold_music=${group.moh_file}"/>` : ""}
${group.caller_id_mode === "group" ? `          <action application="set" data="effective_caller_id_name=${group.caller_id_name || group.name}"/>
          <action application="set" data="effective_caller_id_number=${group.caller_id_number || group.extension}"/>` : ""}
          <action application="bridge" data="${bridgeString}"/>
${fallbackXml}
        </condition>
      </extension>
    </context>
  </section>
</document>`;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Call Queue Dialplan XML
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateQueueDialplan(queueId: number, tenantId: number): Promise<string> {
  return cacheGetOrSet(`dialplan:queue:${tenantId}:${queueId}`, 120, async () => {
    const queueRes = await query(`SELECT * FROM call_queues WHERE id = $1 AND tenant_id = $2`, [queueId, tenantId]);
    const queue = queueRes.rows[0];
    if (!queue) return generateNotFoundXml();

    const agentsRes = await query(
      `SELECT qa.*, e.extension_number, sa.sip_username, sa.sip_domain
       FROM queue_agents qa
       JOIN extensions e ON e.id = qa.extension_id
         AND e.tenant_id = $2 AND e.status = 'active' AND e.deleted_at IS NULL
         AND e.type = 'user' AND e.user_id IS NOT NULL
       JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = $2
         AND sa.status = 'active' AND sa.deleted_at IS NULL AND sa.user_id IS NOT NULL
       WHERE qa.queue_id = $1 AND qa.is_logged_in = true
       ORDER BY qa.priority`,
      [queueId, tenantId]
    );
    const agents = agentsRes.rows;

    const mohFile = queue.moh_file || "local_stream://moh";

    return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="dialplan">
    <context name="default">
      <extension name="queue-${tenantId}-${queue.name}">
        <condition>
          <action application="answer"/>
          <action application="set" data="tenant_id=${tenantId}"/>
          <action application="set" data="queue_id=${queueId}"/>
          <action application="set" data="fifo_music=${mohFile}"/>
${queue.join_announcement ? `          <action application="playback" data="${queue.join_announcement}"/>` : ""}
${queue.announce_position ? `          <action application="playback" data="ivr/ivr-you_are_number.wav"/>
          <action application="say" data="en number pronounced \${fifo_position}"/>
          <action application="playback" data="ivr/ivr-in_queue.wav"/>` : ""}
          <action application="set" data="fifo_orbit_exten=queue_overflow_${tenantId}_${queueId}:${queue.max_wait_time}"/>
          <action application="fifo" data="queue_${tenantId}_${queueId} in"/>
        </condition>
      </extension>
      <extension name="queue-overflow-${tenantId}-${queue.name}">
        <condition field="destination_number" expression="^queue_overflow_${tenantId}_${queueId}$">
${getOverflowXml(queue)}
        </condition>
      </extension>
    </context>
  </section>
  <section name="configuration">
    <configuration name="fifo.conf" description="FIFO Configuration">
      <fifos>
        <fifo name="queue_${tenantId}_${queueId}" importance="0">
${agents.map((a: any) => `          <member simo="1" timeout="${queue.wrap_up_time + 20}" lag="0">{fifo_member}user/${a.sip_username}@${a.sip_domain}</member>`).join("\n")}
        </fifo>
      </fifos>
    </configuration>
  </section>
</document>`;
  });
}

function getOverflowXml(queue: any): string {
  switch (queue.overflow_action) {
    case "voicemail":
      return `          <action application="voicemail" data="default \${domain_name} ${queue.overflow_target || "1000"}"/>`;
    case "transfer":
      return `          <action application="transfer" data="${queue.overflow_target} XML default"/>`;
    case "ivr":
      return `          <action application="ivr" data="ivr_menu_${queue.overflow_target}"/>`;
    case "callback":
      return `          <action application="playback" data="ivr/ivr-call_back_later.wav"/>
          <action application="hangup" data="NORMAL_CLEARING"/>`;
    default:
      return `          <action application="hangup" data="NORMAL_CLEARING"/>`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Time Condition Evaluator
// ═══════════════════════════════════════════════════════════════════════════════

export async function evaluateTimeCondition(tcId: number, tenantId: number): Promise<{ matched: boolean; action: string; target: string }> {
  const tcRes = await query(`SELECT * FROM time_conditions WHERE id = $1 AND tenant_id = $2`, [tcId, tenantId]);
  const tc = tcRes.rows[0];
  if (!tc) return { matched: false, action: "hangup", target: "" };

  const rulesRes = await query(
    `SELECT * FROM time_condition_rules WHERE time_condition_id = $1 ORDER BY sort_order`,
    [tcId]
  );
  const rules = rulesRes.rows;

  // Get current time in the tenant's timezone
  const now = new Date();
  const tz = tc.timezone || "Asia/Bangkok";
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const dayOfWeek = localTime.getDay(); // 0=Sun
  const currentTime = `${String(localTime.getHours()).padStart(2, "0")}:${String(localTime.getMinutes()).padStart(2, "0")}:00`;
  const currentDate = localTime.toISOString().split("T")[0];

  // Check holidays first (they override regular rules)
  for (const rule of rules.filter((r: any) => r.is_holiday)) {
    if (rule.start_date && rule.end_date) {
      if (currentDate >= rule.start_date && currentDate <= rule.end_date) {
        return { matched: false, action: tc.nomatch_action, target: tc.nomatch_target || "" };
      }
    }
  }

  // Check regular time rules
  for (const rule of rules.filter((r: any) => !r.is_holiday)) {
    let dayMatch = true;
    let timeMatch = true;

    if (rule.day_of_week && rule.day_of_week.length > 0) {
      dayMatch = rule.day_of_week.includes(dayOfWeek);
    }

    if (rule.start_time && rule.end_time) {
      timeMatch = currentTime >= rule.start_time && currentTime <= rule.end_time;
    }

    if (dayMatch && timeMatch) {
      return { matched: true, action: tc.match_action, target: tc.match_target || "" };
    }
  }

  // No match — use nomatch action
  return { matched: false, action: tc.nomatch_action, target: tc.nomatch_target || "" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════════════════════

function generateNotFoundXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="dialplan">
    <context name="default">
      <extension name="not-found">
        <condition>
          <action application="playback" data="misc/error.wav"/>
          <action application="hangup" data="UNALLOCATED_NUMBER"/>
        </condition>
      </extension>
    </context>
  </section>
</document>`;
}
