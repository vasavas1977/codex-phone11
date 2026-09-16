import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { Pool } from "pg";
import { getPool } from "../pbx/db";
import type { ConferenceRepository } from "./service";
// Stable keys make retries independent of JSON object insertion order.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function createConferenceRepository(
  db: Pick<Pool, "query"> = getPool(),
): ConferenceRepository {
  return {
    async scope(userId) {
      const { rows } = await db.query(
        `SELECT tm.tenant_id,tm.is_default FROM tenant_memberships tm JOIN tenants t ON t.id=tm.tenant_id
    WHERE tm.user_id=$1 AND tm.status='active' AND t.status='active' ORDER BY tm.is_default DESC,tm.tenant_id`,
        [userId],
      );
      if (
        !rows.length ||
        (rows.length > 1 && (!rows[0].is_default || rows[1].is_default))
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "A single active workspace is required",
        });
      return { userId, tenantId: Number(rows[0].tenant_id) };
    },
    async assertRoom(scope, id, moderate) {
      const { rows } = await db.query(
        `SELECT r.id FROM phone11_conference_rooms r
    JOIN tenant_memberships tm ON tm.tenant_id=r.tenant_id AND tm.user_id=$1 AND tm.status='active'
    JOIN tenants t ON t.id=r.tenant_id AND t.status='active'
    WHERE r.id=$2 AND r.tenant_id=$3 AND (r.created_by=$1 OR tm.role IN ('owner','admin')
     OR ($4=false AND EXISTS(SELECT 1 FROM phone11_conference_members m WHERE m.room_id=r.id AND m.user_id=$1)))`,
        [scope.userId, id, scope.tenantId, moderate],
      );
      if (!rows.length)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conference not found",
        });
    },
    async once(scope, key, operation, run) {
      const fingerprint = createHash("sha256")
        .update(canonical(operation))
        .digest("hex");
      const inserted = await db.query(
        `INSERT INTO phone11_conference_operations(tenant_id,user_id,idempotency_key,fingerprint,state)
    VALUES($1,$2,$3,$4,'pending') ON CONFLICT DO NOTHING RETURNING idempotency_key`,
        [scope.tenantId, scope.userId, key, fingerprint],
      );
      if (!inserted.rows.length) {
        const { rows } = await db.query(
          `SELECT fingerprint,state,result FROM phone11_conference_operations WHERE tenant_id=$1 AND user_id=$2 AND idempotency_key=$3`,
          [scope.tenantId, scope.userId, key],
        );
        const existing = rows[0];
        if (!existing || existing.fingerprint !== fingerprint)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Idempotency key already used for another operation",
          });
        if (existing.state === "complete") return existing.result;
        throw new TRPCError({
          code: "CONFLICT",
          message: "Conference operation requires reconciliation before retry",
        });
      }
      try {
        const result = await run();
        await db.query(
          `UPDATE phone11_conference_operations SET state='complete',result=$4::jsonb WHERE tenant_id=$1 AND user_id=$2 AND idempotency_key=$3`,
          [scope.tenantId, scope.userId, key, JSON.stringify(result)],
        );
        return result;
      } catch {
        // Timeout may follow provider acceptance. Keep a durable uncertain claim; no redial.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Conference operation could not be confirmed. Refresh before retrying.",
        });
      }
    },
  };
}
