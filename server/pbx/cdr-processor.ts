import { createCloudRecordingRepository } from "../cloud-recordings/repository";
import { trustedCdrRecordingRoute } from "../cloud-recordings/correlation";
/**
 * CDR Processor Module
 * 
 * Enhanced CDR processing per Opus review:
 * - call_records (parent) + call_legs (per-leg) model
 * - Proper call_events tracking
 * - Recording URL association
 * - Voicemail detection
 * - Duration calculations
 * - Hangup cause mapping
 * 
 * DB Schema (actual columns):
 * call_records: id, call_uuid, tenant_id, direction, from_number, to_number,
 *   caller_user_id, callee_user_id, phone_number_id, started_at, answered_at, ended_at,
 *   disposition, total_duration_seconds, total_billable_seconds, billing_increment,
 *   recording_url, recording_policy, voicemail_message_id, route_type, route_id,
 *   metadata, created_at, recording_duration_seconds
 * 
 * call_legs: id, call_record_id, leg_uuid, tenant_id, from_uri, to_uri,
 *   caller_user_id, callee_user_id, extension_id, phone_number_id, trunk_id,
 *   started_at, ringing_at, answered_at, ended_at, duration_seconds, billable_seconds,
 *   pdd_ms, mos_score, bytes_sent, bytes_received, codec, hangup_cause,
 *   hangup_disposition, sip_response_code, transferred_to, parent_leg_id,
 *   sip_call_id, metadata, created_at, codec_read, codec_write
 * 
 * call_events: id, tenant_id, call_record_id, call_leg_id, event_type,
 *   event_timestamp, actor_type, actor_id, metadata, created_at
 */
import { query, withTransaction } from "./db";
import { normalizeToE164 } from "./e164";
import { ownershipFromTrustedRoute } from "./cdr-ownership";

/**
 * Disposition mapping from FreeSWITCH hangup causes
 */
function mapDisposition(hangupCause: string, billSeconds: number): string {
  const missedCauses = ["NO_ANSWER", "NO_USER_RESPONSE", "ORIGINATOR_CANCEL", "ALLOTTED_TIMEOUT"];
  const busyCauses = ["USER_BUSY", "NORMAL_CIRCUIT_CONGESTION"];
  const rejectedCauses = ["CALL_REJECTED", "INCOMING_CALL_BARRED"];
  const failedCauses = ["UNALLOCATED_NUMBER", "NO_ROUTE_DESTINATION", "NORMAL_TEMPORARY_FAILURE",
    "SWITCH_CONGESTION", "REQUESTED_CHAN_UNAVAIL", "FACILITY_NOT_SUBSCRIBED",
    "NETWORK_OUT_OF_ORDER", "DESTINATION_OUT_OF_ORDER"];

  if (missedCauses.includes(hangupCause) || (billSeconds === 0 && hangupCause === "NORMAL_CLEARING")) {
    return "missed";
  }
  if (busyCauses.includes(hangupCause)) return "busy";
  if (rejectedCauses.includes(hangupCause)) return "rejected";
  if (failedCauses.includes(hangupCause)) return "failed";
  if (billSeconds > 0) return "answered";
  return "missed";
}

/**
 * Determine call direction from CDR variables
 */
function determineDirection(cdr: any): "inbound" | "outbound" | "internal" | "emergency" {
  const direction = cdr.variables?.call_direction;
  if (direction === "emergency") return "emergency";
  if (direction === "outbound") return "outbound";
  if (direction === "inbound") return "inbound";
  
  // Heuristic: if both caller and callee are 3-4 digit extensions, it's internal
  const caller = cdr.variables?.effective_caller_id_number || cdr.variables?.caller_id_number || "";
  const callee = cdr.variables?.sip_to_user || cdr.variables?.destination_number || "";
  if (/^[1-9]\d{2,3}$/.test(caller) && /^[1-9]\d{2,3}$/.test(callee)) {
    return "internal";
  }
  
  return "outbound";
}

/**
 * Parse a FreeSWITCH XML CDR or JSON CDR into structured data
 */
function parseCdrData(cdr: any) {
  const vars = cdr.variables || {};
  const callUuid = vars.uuid || cdr.uuid || cdr.call_uuid;
  const callerNumber = vars.effective_caller_id_number || vars.caller_id_number || "";
  const callerName = vars.effective_caller_id_name || vars.caller_id_name || "";
  const calleeNumber = vars.sip_to_user || vars.destination_number || "";
  const direction = determineDirection(cdr);
  
  const startEpoch = parseInt(vars.start_epoch || "0");
  const answerEpoch = parseInt(vars.answer_epoch || "0");
  const endEpoch = parseInt(vars.end_epoch || "0");
  const bridgeEpoch = parseInt(vars.bridge_epoch || "0");
  const progressEpoch = parseInt(vars.progress_epoch || "0");
  
  // If epochs are 0, try to parse timestamp strings
  const startStamp = vars.start_stamp || null;
  const answerStamp = vars.answer_stamp || null;
  const endStamp = vars.end_stamp || null;
  
  const duration = parseInt(vars.duration || "0") || (endEpoch - startEpoch);
  const billSeconds = parseInt(vars.billsec || "0");
  const hangupCause = vars.hangup_cause || "NORMAL_CLEARING";
  const sipResponseCode = parseInt(vars.sip_term_status || "0") || null;
  const disposition = mapDisposition(hangupCause, billSeconds);

  // Recording info
  const recordingPath = vars.record_file_path || vars.recording_file || null;
  
  // Codec info
  const readCodec = vars.read_codec || null;
  const writeCodec = vars.write_codec || null;

  // Tenant info
  const tenantId = Number(vars.tenant_id);

  // SIP call ID
  const sipCallId = vars.sip_call_id || null;

  return {
    callUuid,
    callerNumber,
    callerName,
    calleeNumber,
    direction,
    disposition,
    startEpoch,
    answerEpoch,
    endEpoch,
    bridgeEpoch,
    progressEpoch,
    startStamp,
    answerStamp,
    endStamp,
    duration,
    billSeconds,
    hangupCause,
    sipResponseCode,
    recordingPath,
    readCodec,
    writeCodec,
    tenantId,
    sipCallId,
    rawCdr: cdr,
  };
}

/**
 * Build a timestamp expression for SQL
 * Prefers epoch-based timestamps, falls back to string timestamps
 */
function tsExpr(epoch: number, stamp: string | null): { sql: string; val: any } {
  if (epoch > 0) return { sql: "to_timestamp($%d)", val: epoch };
  if (stamp) return { sql: "$%d::timestamp", val: stamp };
  return { sql: "NULL", val: null };
}

/**
 * Process a CDR from FreeSWITCH and store in call_records + call_legs
 */
export async function processCdr(cdr: any): Promise<{ callRecordId: number; callLegId: number }> {
  const parsed = parseCdrData(cdr);
  if (!Number.isSafeInteger(parsed.tenantId) || parsed.tenantId <= 0) throw new Error("Explicit CDR tenant required");
  const recordingRoute = await trustedCdrRecordingRoute(parsed.callUuid,parsed.sipCallId);
  if (recordingRoute && recordingRoute.tenantId !== parsed.tenantId) throw new Error("Trusted call tenant mismatch");
  const ownership = ownershipFromTrustedRoute(recordingRoute);

  const result = await withTransaction(async (client) => {
    // 1. Upsert call_record (parent)
    // Use parameterized timestamps — pass epoch as number or null, always use to_timestamp
    // to_timestamp(NULL) returns NULL in PostgreSQL
    const startedAt = parsed.startEpoch > 0 ? new Date(parsed.startEpoch * 1000) : (parsed.startStamp ? new Date(parsed.startStamp) : new Date());
    const answeredAt = parsed.answerEpoch > 0 ? new Date(parsed.answerEpoch * 1000) : null;
    const endedAt = parsed.endEpoch > 0 ? new Date(parsed.endEpoch * 1000) : (parsed.endStamp ? new Date(parsed.endStamp) : null);

    const recordResult = await client.query(
      `INSERT INTO call_records 
        (tenant_id, call_uuid, direction, from_number, to_number,
         caller_user_id, callee_user_id, disposition, started_at, answered_at, ended_at,
         total_duration_seconds, total_billable_seconds,
         recording_url, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (call_uuid) DO UPDATE SET
         disposition = EXCLUDED.disposition,
         answered_at = COALESCE(EXCLUDED.answered_at, call_records.answered_at),
         metadata = call_records.metadata || EXCLUDED.metadata,
         ended_at = EXCLUDED.ended_at,
         total_duration_seconds = EXCLUDED.total_duration_seconds,
         total_billable_seconds = EXCLUDED.total_billable_seconds,
         recording_url = COALESCE(EXCLUDED.recording_url, call_records.recording_url),
         caller_user_id = COALESCE(call_records.caller_user_id, EXCLUDED.caller_user_id),
         callee_user_id = COALESCE(call_records.callee_user_id, EXCLUDED.callee_user_id)
       WHERE call_records.tenant_id = EXCLUDED.tenant_id
         AND (call_records.ended_at IS NULL OR EXCLUDED.ended_at IS NOT NULL)
         AND (EXCLUDED.caller_user_id IS NULL OR (call_records.caller_user_id IS NULL OR call_records.caller_user_id = EXCLUDED.caller_user_id) AND call_records.callee_user_id IS NULL)
         AND (EXCLUDED.callee_user_id IS NULL OR (call_records.callee_user_id IS NULL OR call_records.callee_user_id = EXCLUDED.callee_user_id) AND call_records.caller_user_id IS NULL)
       RETURNING id`,
      [
        parsed.tenantId,           // $1
        parsed.callUuid,           // $2
        parsed.direction,          // $3
        parsed.callerNumber,       // $4 → from_number
        parsed.calleeNumber,       // $5 → to_number
        ownership.callerUserId,    // $6 → immutable call-time caller
        ownership.calleeUserId,    // $7 → immutable call-time callee
        parsed.disposition,        // $8
        startedAt,                 // $9 → started_at
        answeredAt,                // $10 → answered_at
        endedAt,                   // $11 → ended_at
        parsed.duration,           // $12 → total_duration_seconds
        parsed.billSeconds,        // $13 → total_billable_seconds
        process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED === "true" ? null : parsed.recordingPath, // Cloud media only comes from authenticated storage.
        JSON.stringify({           // $15 → metadata
          completion: endedAt ? "complete" : "unknown",
          source: "authenticated_freeswitch_cdr",
          caller_name: parsed.callerName,
          hangup_cause: parsed.hangupCause,
          sip_response_code: parsed.sipResponseCode,
        }),
      ]
    );
    if (!recordResult.rows.length) throw new Error("Call tenant collision");
    const callRecordId = recordResult.rows[0].id;

    // The parent upsert holds its row lock until commit, serializing CDR retries
    // with each other and with authenticated ESL snapshots for this channel.
    const existingLegs = await client.query(
      "SELECT id, call_record_id, tenant_id, extension_id, sip_call_id, caller_user_id, callee_user_id, ended_at FROM call_legs WHERE leg_uuid=$1 FOR UPDATE",
      [parsed.callUuid]
    );
    if (existingLegs.rows.length > 1) throw new Error("Ambiguous existing call legs");
    const existingLeg = existingLegs.rows[0];
    if (existingLeg && (Number(existingLeg.tenant_id) !== parsed.tenantId || Number(existingLeg.call_record_id) !== Number(callRecordId)
      || (existingLeg.sip_call_id && existingLeg.sip_call_id !== parsed.sipCallId)
      || (existingLeg.caller_user_id != null && ownership.callerUserId != null && Number(existingLeg.caller_user_id) !== ownership.callerUserId)
      || (existingLeg.callee_user_id != null && ownership.calleeUserId != null && Number(existingLeg.callee_user_id) !== ownership.calleeUserId)
      || (ownership.callerUserId != null && existingLeg.callee_user_id != null)
      || (ownership.calleeUserId != null && existingLeg.caller_user_id != null)
      || (recordingRoute && existingLeg.extension_id != null && Number(existingLeg.extension_id) !== recordingRoute.extensionId))) {
      throw new Error("Call leg ownership mismatch");
    }

    // 2. Complete the exact snapshot leg or insert the channel's first leg.
    const ringingAt = parsed.progressEpoch > 0 ? new Date(parsed.progressEpoch * 1000) : null;
    const pddMs = parsed.progressEpoch > 0 && parsed.startEpoch > 0
      ? (parsed.progressEpoch - parsed.startEpoch) * 1000
      : null;

    const legResult = await client.query(
      existingLeg ? `UPDATE call_legs SET
        from_uri=$4, to_uri=$5,
        caller_user_id=COALESCE(caller_user_id,$6), callee_user_id=COALESCE(callee_user_id,$7),
        started_at=$8, ringing_at=$9, answered_at=COALESCE($10,answered_at), ended_at=$11,
        duration_seconds=$12, billable_seconds=$13, pdd_ms=$14,
        codec=$15, codec_read=$16, codec_write=$17,
        hangup_cause=$18, hangup_disposition=$19, sip_response_code=$20,
        sip_call_id=$21, metadata=metadata || $22::jsonb
       WHERE call_record_id=$1 AND leg_uuid=$2 AND tenant_id=$3 AND id=$23 RETURNING id`
      : `INSERT INTO call_legs
        (call_record_id, leg_uuid, tenant_id, from_uri, to_uri, caller_user_id, callee_user_id,
         started_at, ringing_at, answered_at, ended_at, 
         duration_seconds, billable_seconds, pdd_ms,
         codec, codec_read, codec_write,
         hangup_cause, hangup_disposition, sip_response_code,
         sip_call_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING id`,
      [
        callRecordId,              // $1
        parsed.callUuid,           // $2 → leg_uuid
        parsed.tenantId,           // $3
        `sip:${parsed.callerNumber}@phone11.ai`,  // $4 → from_uri
        `sip:${parsed.calleeNumber}@phone11.ai`,  // $5 → to_uri
        ownership.callerUserId,    // $6
        ownership.calleeUserId,    // $7
        startedAt,                 // $8 → started_at (Date object)
        ringingAt,                 // $9 → ringing_at (Date or null)
        answeredAt,                // $10 → answered_at (Date or null)
        endedAt,                   // $11 → ended_at (Date or null)
        parsed.duration,           // $12 → duration_seconds
        parsed.billSeconds,        // $13 → billable_seconds
        pddMs,                     // $14 → pdd_ms
        parsed.readCodec || parsed.writeCodec,  // $15 → codec (primary)
        parsed.readCodec,          // $16 → codec_read
        parsed.writeCodec,         // $17 → codec_write
        parsed.hangupCause,        // $18 → hangup_cause
        parsed.disposition,        // $19 → hangup_disposition
        parsed.sipResponseCode,    // $20 → sip_response_code
        parsed.sipCallId,          // $21 → sip_call_id
        JSON.stringify({           // $22 → metadata
          completion: endedAt ? "complete" : "unknown",
          source: "authenticated_freeswitch_cdr",
          caller_name: parsed.callerName,
          raw_direction: parsed.direction,
        }),
        ...(existingLeg ? [existingLeg.id] : []),
      ]
    );
    const callLegId = legResult.rows[0].id;
    if(recordingRoute) await client.query("UPDATE call_legs SET extension_id=$2 WHERE id=$1 AND tenant_id=$3",[callLegId,recordingRoute.extensionId,recordingRoute.tenantId]);

    return { callRecordId, callLegId, previouslyCompleted: existingLeg?.ended_at != null };
  });

  if(process.env.PHONE11_CLOUD_RECORDING_CAPTURE_ENABLED === "true" && recordingRoute) {
    try { await createCloudRecordingRepository().registerCall(parsed.callUuid); }
    catch { /* CDR already committed; recording reconciliation retries separately. */ }
  }

  // 3. Insert call_events OUTSIDE the transaction (fire-and-forget)
  // call_events is partitioned and may fail if partition doesn't exist.
  // This must NOT abort the main call_records/call_legs transaction.
  const events: Array<[string, number, string?]> = [];
  if (parsed.startEpoch > 0) events.push(["call_start", parsed.startEpoch]);
  if (parsed.progressEpoch > 0) events.push(["ringing", parsed.progressEpoch]);
  if (parsed.answerEpoch > 0) events.push(["answer", parsed.answerEpoch]);
  if (parsed.bridgeEpoch > 0) events.push(["bridge", parsed.bridgeEpoch]);
  if (parsed.endEpoch > 0) events.push(["hangup", parsed.endEpoch, parsed.hangupCause]);

  for (const [eventType, epoch, detail] of result.previouslyCompleted ? [] : events) {
    try {
      await query(
        `INSERT INTO call_events (tenant_id, call_record_id, call_leg_id, event_type, event_timestamp, metadata)
         VALUES ($1, $2, $3, $4, to_timestamp($5), $6)`,
        [parsed.tenantId, result.callRecordId, result.callLegId, eventType, epoch, 
         detail ? JSON.stringify({ cause: detail }) : '{}']
      );
    } catch (e: any) {
      // call_events is partitioned — may fail if partition doesn't exist, that's OK
      console.warn(`[CDR] Failed to insert call_event ${eventType}:`, e.message);
    }
  }

  return { callRecordId: result.callRecordId, callLegId: result.callLegId };
}

/**
 * Get call statistics for dashboard
 */
export async function getCallStats(tenantId: number, period: "today" | "week" | "month" = "today") {
  // These boundaries and EXTRACT(HOUR) use the database session timezone. The
  // current API has no validated workspace-timezone input, so clients must not
  // label this distribution as local workspace time.
  const dateFilter = period === "today" 
    ? "started_at >= CURRENT_DATE"
    : period === "week"
    ? "started_at >= CURRENT_DATE - INTERVAL '7 days'"
    : "started_at >= CURRENT_DATE - INTERVAL '30 days'";

  const [summary, hourly, topCallers, topDestinations] = await Promise.all([
    // Summary stats
    query(
      `SELECT 
        COUNT(*) as total_calls,
        COUNT(*) FILTER (WHERE disposition = 'answered') as answered,
        COUNT(*) FILTER (WHERE disposition = 'missed') as missed,
        COUNT(*) FILTER (WHERE disposition = 'busy') as busy,
        COUNT(*) FILTER (WHERE disposition = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE disposition = 'failed') as failed,
        COUNT(*) FILTER (WHERE direction = 'inbound') as inbound,
        COUNT(*) FILTER (WHERE direction = 'outbound') as outbound,
        COUNT(*) FILTER (WHERE direction = 'internal') as internal,
        COALESCE(AVG(total_duration_seconds) FILTER (WHERE disposition = 'answered'), 0) as avg_duration,
        COALESCE(MAX(total_duration_seconds), 0) as max_duration,
        COALESCE(SUM(total_billable_seconds), 0) as total_billable
       FROM call_records
       WHERE tenant_id = $1 AND ${dateFilter}`,
      [tenantId]
    ),

    // Hourly distribution
    query(
      `SELECT 
        EXTRACT(HOUR FROM started_at) as hour,
        COUNT(*) as calls,
        COUNT(*) FILTER (WHERE disposition = 'answered') as answered
       FROM call_records
       WHERE tenant_id = $1 AND ${dateFilter}
       GROUP BY EXTRACT(HOUR FROM started_at)
       ORDER BY hour`,
      [tenantId]
    ),

    // Top callers (from_number)
    query(
      `SELECT from_number as caller_number, COUNT(*) as call_count,
              SUM(total_billable_seconds) as total_seconds
       FROM call_records
       WHERE tenant_id = $1 AND ${dateFilter} AND direction != 'inbound'
       GROUP BY from_number
       ORDER BY call_count DESC
       LIMIT 10`,
      [tenantId]
    ),

    // Top destinations (to_number)
    query(
      `SELECT to_number as callee_number, COUNT(*) as call_count,
              SUM(total_billable_seconds) as total_seconds
       FROM call_records
       WHERE tenant_id = $1 AND ${dateFilter} AND direction != 'inbound'
       GROUP BY to_number
       ORDER BY call_count DESC
       LIMIT 10`,
      [tenantId]
    ),
  ]);

  return {
    summary: summary.rows[0],
    hourlyDistribution: hourly.rows,
    topCallers: topCallers.rows,
    topDestinations: topDestinations.rows,
  };
}

/**
 * Get voicemail messages for an extension
 */
export class VoicemailStorageUnavailableError extends Error {
  constructor() {
    super("Voicemail inbox storage is not configured on this server");
  }
}

/** Do not treat an absent migration as an empty inbox. */
export async function requireVoicemailStorage() {
  const result = await query(`SELECT to_regclass('voicemail_messages') AS name,
    to_regclass('voicemail_deposit_admissions') AS admissions,
    (SELECT COUNT(*) FROM pg_attribute
      WHERE attrelid = to_regclass('voicemail_messages')
        AND attname IN ('owner_user_id', 'owner_epoch')
        AND attnotnull AND NOT attisdropped) AS owner_columns,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('voicemail_messages')
      AND tgname='phone11_voicemail_extension_tenant_guard' AND tgenabled='O'
      AND tgfoid=to_regprocedure('phone11_voicemail_extension_tenant_guard()')) AS guard_trigger,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('extensions')
      AND tgname='phone11_voicemail_owner_epoch_rotate' AND tgenabled='O'
      AND tgfoid=to_regprocedure('phone11_voicemail_owner_epoch_rotate()')) AS epoch_trigger`);
  if (!result.rows[0]?.name || !result.rows[0]?.admissions || Number(result.rows[0].owner_columns) !== 2
    || result.rows[0].guard_trigger !== true || result.rows[0].epoch_trigger !== true)
    throw new VoicemailStorageUnavailableError();
}

export async function getVoicemails(
  tenantId: number,
  userId: number,
  extension?: string,
) {
  await requireVoicemailStorage();
  const conditions = ["vm.tenant_id = $1", "vm.owner_user_id = $2", "vm.status != 'deleted'"];
  const vals: Array<number | string> = [tenantId, userId];

  if (extension) {
    conditions.push("e.extension_number = $3");
    vals.push(extension);
  }

  const result = await query(
    `SELECT vm.id, vm.extension_id, e.extension_number, vm.caller_number,
            vm.caller_name, vm.duration_seconds, vm.status, vm.created_at,
            vm.read_at
     FROM voicemail_messages vm
     LEFT JOIN extensions e
       ON e.id = vm.extension_id AND e.tenant_id = vm.tenant_id
     JOIN tenant_memberships tm
       ON tm.user_id = vm.owner_user_id AND tm.tenant_id = vm.tenant_id AND tm.status = 'active'
     JOIN tenants t ON t.id = vm.tenant_id AND t.status = 'active'
     WHERE ${conditions.join(" AND ")}
     ORDER BY vm.created_at DESC
     LIMIT 100`,
    vals
  );

  return result.rows;
}
