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
  const tenantId = parseInt(vars.tenant_id || "1");

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
         disposition, started_at, answered_at, ended_at, 
         total_duration_seconds, total_billable_seconds,
         recording_url, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (call_uuid) DO UPDATE SET
         disposition = EXCLUDED.disposition,
         ended_at = EXCLUDED.ended_at,
         total_duration_seconds = EXCLUDED.total_duration_seconds,
         total_billable_seconds = EXCLUDED.total_billable_seconds,
         recording_url = COALESCE(EXCLUDED.recording_url, call_records.recording_url)
       RETURNING id`,
      [
        parsed.tenantId,           // $1
        parsed.callUuid,           // $2
        parsed.direction,          // $3
        parsed.callerNumber,       // $4 → from_number
        parsed.calleeNumber,       // $5 → to_number
        parsed.disposition,        // $6
        startedAt,                 // $7 → started_at
        answeredAt,                // $8 → answered_at
        endedAt,                   // $9 → ended_at
        parsed.duration,           // $10 → total_duration_seconds
        parsed.billSeconds,        // $11 → total_billable_seconds
        parsed.recordingPath,      // $12 → recording_url
        JSON.stringify({           // $13 → metadata
          caller_name: parsed.callerName,
          hangup_cause: parsed.hangupCause,
          sip_response_code: parsed.sipResponseCode,
        }),
      ]
    );
    const callRecordId = recordResult.rows[0].id;

    // 2. Insert call_leg
    const ringingAt = parsed.progressEpoch > 0 ? new Date(parsed.progressEpoch * 1000) : null;
    const pddMs = parsed.progressEpoch > 0 && parsed.startEpoch > 0
      ? (parsed.progressEpoch - parsed.startEpoch) * 1000
      : null;

    const legResult = await client.query(
      `INSERT INTO call_legs
        (call_record_id, leg_uuid, tenant_id, from_uri, to_uri,
         started_at, ringing_at, answered_at, ended_at, 
         duration_seconds, billable_seconds, pdd_ms,
         codec, codec_read, codec_write,
         hangup_cause, hangup_disposition, sip_response_code,
         sip_call_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING id`,
      [
        callRecordId,              // $1
        parsed.callUuid,           // $2 → leg_uuid
        parsed.tenantId,           // $3
        `sip:${parsed.callerNumber}@phone11.ai`,  // $4 → from_uri
        `sip:${parsed.calleeNumber}@phone11.ai`,  // $5 → to_uri
        startedAt,                 // $6 → started_at (Date object)
        ringingAt,                 // $7 → ringing_at (Date or null)
        answeredAt,                // $8 → answered_at (Date or null)
        endedAt,                   // $9 → ended_at (Date or null)
        parsed.duration,           // $10 → duration_seconds
        parsed.billSeconds,        // $11 → billable_seconds
        pddMs,                     // $12 → pdd_ms
        parsed.readCodec || parsed.writeCodec,  // $13 → codec (primary)
        parsed.readCodec,          // $14 → codec_read
        parsed.writeCodec,         // $15 → codec_write
        parsed.hangupCause,        // $16 → hangup_cause
        parsed.disposition,        // $17 → hangup_disposition
        parsed.sipResponseCode,    // $18 → sip_response_code
        parsed.sipCallId,          // $19 → sip_call_id
        JSON.stringify({           // $20 → metadata
          caller_name: parsed.callerName,
          raw_direction: parsed.direction,
        }),
      ]
    );
    const callLegId = legResult.rows[0].id;

    return { callRecordId, callLegId };
  });

  // 3. Insert call_events OUTSIDE the transaction (fire-and-forget)
  // call_events is partitioned and may fail if partition doesn't exist.
  // This must NOT abort the main call_records/call_legs transaction.
  const events: Array<[string, number, string?]> = [];
  if (parsed.startEpoch > 0) events.push(["call_start", parsed.startEpoch]);
  if (parsed.progressEpoch > 0) events.push(["ringing", parsed.progressEpoch]);
  if (parsed.answerEpoch > 0) events.push(["answer", parsed.answerEpoch]);
  if (parsed.bridgeEpoch > 0) events.push(["bridge", parsed.bridgeEpoch]);
  if (parsed.endEpoch > 0) events.push(["hangup", parsed.endEpoch, parsed.hangupCause]);

  for (const [eventType, epoch, detail] of events) {
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

  return result;
}

/**
 * Get call statistics for dashboard
 */
export async function getCallStats(tenantId: number, period: "today" | "week" | "month" = "today") {
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
export async function getVoicemails(tenantId: number, extension?: string) {
  const conditions = ["tenant_id = $1", "status != 'deleted'"];
  const vals: any[] = [tenantId];

  if (extension) {
    conditions.push("extension_number = $2");
    vals.push(extension);
  }

  const result = await query(
    `SELECT * FROM voicemail_messages 
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT 100`,
    vals
  );

  return result.rows;
}
