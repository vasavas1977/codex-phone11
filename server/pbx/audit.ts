/**
 * Audit Logging
 * 
 * Records all admin changes for compliance and debugging.
 * Writes to the audit_logs partitioned table.
 */
import { query } from "./db";

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
        entry.oldValue ? JSON.stringify(entry.oldValue) : null,
        entry.newValue ? JSON.stringify(entry.newValue) : null,
        entry.ipAddress || null,
        entry.userAgent || null,
        entry.requestId || null,
        entry.sessionId || null,
      ]
    );
  } catch (error: any) {
    // Audit logging should never break the main operation
    console.error("[Audit] Failed to write log:", error.message);
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
    rows: dataResult.rows,
    total: parseInt(countResult.rows[0]?.total || "0"),
  };
}
