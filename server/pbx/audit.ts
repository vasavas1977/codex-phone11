/**
 * Audit Logging
 * 
 * Records all admin changes for compliance and debugging.
 * Writes to the audit_logs partitioned table.
 */
import { query } from "./db";

// Old extension rows can contain the legacy plaintext sip_password. Audit
// records are also read back through the admin API, so sanitize both new
// writes and historical rows before they cross that boundary.
const SECRET_FIELD = /(?:password|secret|credential|authorization|cookie|token|private[_-]?key|api[_-]?key|^ha1b?$)/i;

export function redactAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 16) return "[redacted]";
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item, depth + 1));
  if (value && typeof value === "object") {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return "[redacted]";
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SECRET_FIELD.test(key) ? "[redacted]" : redactAuditValue(item, depth + 1),
    ]));
  }
  return value;
}

function redactStoredAuditValue(value: unknown): unknown {
  if (typeof value !== "string") return redactAuditValue(value);
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? redactAuditValue(parsed) : "[redacted]";
  } catch {
    // Audit payloads are JSON objects. A malformed legacy payload must not
    // be echoed as raw text, since it may itself contain a credential.
    return "[redacted]";
  }
}

export function redactAuditRow<T extends Record<string, unknown>>(row: T): T {
  const safe = { ...row };
  for (const key of ["old_value", "new_value", "oldValue", "newValue"] as const) {
    if (key in safe) (safe as Record<string, unknown>)[key] = redactStoredAuditValue(safe[key]);
  }
  return safe;
}

export interface AuditEntry {
  tenantId: number;
  actorUserId?: number;
  action: string;
  resourceType: string;
  resourceId?: string;
  oldValue?: Record<string, any>;
  newValue?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  sessionId?: string;
}

/**
 * Write an audit log entry
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs 
        (tenant_id, actor_user_id, action, resource_type, resource_id, 
         old_value, new_value, ip_address, user_agent, request_id, session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        entry.tenantId,
        entry.actorUserId || null,
        entry.action,
        entry.resourceType,
        entry.resourceId || null,
        entry.oldValue ? JSON.stringify(redactAuditValue(entry.oldValue)) : null,
        entry.newValue ? JSON.stringify(redactAuditValue(entry.newValue)) : null,
        entry.ipAddress || null,
        entry.userAgent || null,
        entry.requestId || null,
        entry.sessionId || null,
      ]
    );
  } catch {
    // Audit logging should never break the main operation
    // A database error can include row details; never log an audit payload.
    console.error("[Audit] Failed to write log");
  }
}

/**
 * Query audit logs with filtering and pagination
 */
export async function queryAuditLogs(params: {
  tenantId: number;
  resourceType?: string;
  resourceId?: string;
  actorUserId?: number;
  action?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}): Promise<{ rows: any[]; total: number }> {
  const conditions: string[] = ["tenant_id = $1"];
  const values: any[] = [params.tenantId];
  let paramIdx = 2;

  if (params.resourceType) {
    conditions.push(`resource_type = $${paramIdx++}`);
    values.push(params.resourceType);
  }
  if (params.resourceId) {
    conditions.push(`resource_id = $${paramIdx++}`);
    values.push(params.resourceId);
  }
  if (params.actorUserId) {
    conditions.push(`actor_user_id = $${paramIdx++}`);
    values.push(params.actorUserId);
  }
  if (params.action) {
    conditions.push(`action = $${paramIdx++}`);
    values.push(params.action);
  }
  if (params.fromDate) {
    conditions.push(`created_at >= $${paramIdx++}`);
    values.push(params.fromDate);
  }
  if (params.toDate) {
    conditions.push(`created_at <= $${paramIdx++}`);
    values.push(params.toDate);
  }

  const where = conditions.join(" AND ");
  const limit = params.limit || 50;
  const offset = params.offset || 0;

  const [dataResult, countResult] = await Promise.all([
    query(
      `SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset]
    ),
    query(
      `SELECT COUNT(*) as total FROM audit_logs WHERE ${where}`,
      values
    ),
  ]);

  return {
    rows: dataResult.rows.map((row) => redactAuditRow(row)),
    total: parseInt(countResult.rows[0]?.total || "0"),
  };
}
