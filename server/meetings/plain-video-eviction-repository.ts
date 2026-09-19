import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";
import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const state = z.enum(["pending", "completed", "failed"]);

export const plainVideoEvictionTargetSchema = z
  .object({
    meetingId: z.string().uuid(),
    tenantId: z.number().int().positive().refine(Number.isSafeInteger),
    userId: z.number().int().positive().refine(Number.isSafeInteger),
    participantId: identifier,
  })
  .strict();

export type PlainVideoEvictionTarget = z.infer<typeof plainVideoEvictionTargetSchema>;
export type PlainVideoEvictionState = z.infer<typeof state>;

const rowSchema = z
  .object({
    id: z.string().uuid(),
    tenant_id: z.coerce.number().int().positive().refine(Number.isSafeInteger),
    meeting_id: z.string().uuid(),
    user_id: z.coerce.number().int().positive().refine(Number.isSafeInteger),
    participant_id: identifier,
    idempotency_key: idempotencyKey,
    state,
    provider_eviction_id: z.string().uuid().nullable(),
    revoke_token_ts: z.coerce.number().int().positive().nullable(),
    provider_created_at: z.coerce.date().nullable(),
    provider_completed_at: z.coerce.date().nullable(),
  })
  .strict();

export type PlainVideoEvictionOperation = {
  id: string;
  target: PlainVideoEvictionTarget;
  idempotencyKey: string;
  state: PlainVideoEvictionState;
  providerEvictionId: string | null;
  revokeTokenTs: number | null;
  providerCreatedAt: Date | null;
  providerCompletedAt: Date | null;
};

export type PlainVideoEvictionObservation = {
  evictionId: string;
  state: PlainVideoEvictionState;
  revokeTokenTs: number;
  createdAt: Date;
  completedAt: Date | null;
};

export type PlainVideoEvictionQuery = Pick<PoolClient, "query">;
export type PlainVideoEvictionTransaction = <T>(
  fn: (db: PlainVideoEvictionQuery) => Promise<T>,
) => Promise<T>;

function operationFrom(row: unknown): PlainVideoEvictionOperation | null {
  const parsed = rowSchema.safeParse(row);
  if (!parsed.success) return null;
  const value = parsed.data;
  return {
    id: value.id,
    target: {
      meetingId: value.meeting_id,
      tenantId: value.tenant_id,
      userId: value.user_id,
      participantId: value.participant_id,
    },
    idempotencyKey: value.idempotency_key,
    state: value.state,
    providerEvictionId: value.provider_eviction_id,
    revokeTokenTs: value.revoke_token_ts,
    providerCreatedAt: value.provider_created_at,
    providerCompletedAt: value.provider_completed_at,
  };
}

function sameTarget(
  operation: PlainVideoEvictionOperation,
  target: PlainVideoEvictionTarget,
): boolean {
  return operation.target.meetingId === target.meetingId
    && operation.target.tenantId === target.tenantId
    && operation.target.userId === target.userId
    && operation.target.participantId === target.participantId;
}

const columns = `id, tenant_id, meeting_id, user_id, participant_id,
  idempotency_key, state, provider_eviction_id, revoke_token_ts,
  provider_created_at, provider_completed_at`;

/**
 * The persistent side of a removal. `begin` changes `revoked_at` before any
 * provider call, so the ordinary admission query refuses every later mint.
 */
export function createPlainVideoEvictionRepository(
  transaction: PlainVideoEvictionTransaction,
) {
  async function findByKey(
    db: PlainVideoEvictionQuery,
    tenantId: number,
    userId: number,
    key: string,
  ): Promise<PlainVideoEvictionOperation | null> {
    const result = await db.query(
      `SELECT ${columns}
         FROM phone11_plain_video_eviction_operations
        WHERE tenant_id = $1 AND user_id = $2 AND idempotency_key = $3
        FOR UPDATE`,
      [tenantId, userId, key],
    );
    if (result.rows.length !== 1) return null;
    return operationFrom(result.rows[0]);
  }

  return {
    async begin(
      rawTarget: PlainVideoEvictionTarget,
      rawKey: string,
    ): Promise<PlainVideoEvictionOperation | null> {
      const target = plainVideoEvictionTargetSchema.safeParse(rawTarget);
      const key = idempotencyKey.safeParse(rawKey);
      if (!target.success || !key.success) return null;
      return transaction(async (db) => {
        const existing = await findByKey(db, target.data.tenantId, target.data.userId, key.data);
        if (existing) return sameTarget(existing, target.data) ? existing : null;

        // A member must be durable, tenant-scoped, and not previously revoked.
        // This happens before external I/O and is the permanent local remint
        // denial even if the provider is slow, fails, or cannot be reached.
        const revoked = await db.query(
          `UPDATE phone11_plain_video_admission_members m
              SET revoked_at = clock_timestamp(), revision = $5
             FROM phone11_plain_video_admission_rooms r
             JOIN tenants t ON t.id = r.tenant_id AND t.status = 'active'
            WHERE m.meeting_id = r.id AND m.tenant_id = r.tenant_id
              AND r.id = $1 AND r.tenant_id = $2
              AND m.user_id = $3 AND m.participant_id = $4
              AND m.revoked_at IS NULL
            RETURNING m.meeting_id`,
          [
            target.data.meetingId,
            target.data.tenantId,
            target.data.userId,
            target.data.participantId,
            randomUUID(),
          ],
        );
        if (revoked.rows.length !== 1) return null;

        // Reconciliation stays local until the server-side Connect11 facade
        // acknowledges it. In the meantime this prevents a pending or just
        // issued lease from completing after the member has been revoked.
        await db.query(
          `UPDATE phone11_plain_video_admission_leases
              SET state = 'revoked', revoked_at = clock_timestamp()
            WHERE tenant_id = $1 AND meeting_id = $2 AND user_id = $3
              AND participant_id = $4 AND state IN ('pending', 'issued')`,
          [
            target.data.tenantId,
            target.data.meetingId,
            target.data.userId,
            target.data.participantId,
          ],
        );

        const created = await db.query(
          `INSERT INTO phone11_plain_video_eviction_operations
            (id, tenant_id, meeting_id, user_id, participant_id, idempotency_key, state)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending')
           RETURNING ${columns}`,
          [
            randomUUID(),
            target.data.tenantId,
            target.data.meetingId,
            target.data.userId,
            target.data.participantId,
            key.data,
          ],
        );
        return created.rows.length === 1 ? operationFrom(created.rows[0]) : null;
      });
    },

    async get(
      rawTarget: PlainVideoEvictionTarget,
      rawKey: string,
    ): Promise<PlainVideoEvictionOperation | null> {
      const target = plainVideoEvictionTargetSchema.safeParse(rawTarget);
      const key = idempotencyKey.safeParse(rawKey);
      if (!target.success || !key.success) return null;
      return transaction(async (db) => {
        const existing = await findByKey(db, target.data.tenantId, target.data.userId, key.data);
        return existing && sameTarget(existing, target.data) ? existing : null;
      });
    },

    async record(
      operation: PlainVideoEvictionOperation,
      observation: PlainVideoEvictionObservation,
    ): Promise<PlainVideoEvictionOperation | null> {
      return transaction(async (db) => {
        const updated = await db.query(
          `UPDATE phone11_plain_video_eviction_operations
              SET provider_eviction_id = $2, state = $3, revoke_token_ts = $4,
                  provider_created_at = $5, provider_completed_at = $6,
                  updated_at = clock_timestamp()
            WHERE id = $1 AND state = 'pending'
              AND (provider_eviction_id IS NULL OR provider_eviction_id = $2)
            RETURNING ${columns}`,
          [
            operation.id,
            observation.evictionId,
            observation.state,
            observation.revokeTokenTs,
            observation.createdAt,
            observation.completedAt,
          ],
        );
        if (updated.rows.length === 1) return operationFrom(updated.rows[0]);
        const existing = await findByKey(
          db,
          operation.target.tenantId,
          operation.target.userId,
          operation.idempotencyKey,
        );
        return existing && sameTarget(existing, operation.target)
          && existing.providerEvictionId === observation.evictionId
          ? existing
          : null;
      });
    },
  };
}

export function createPlainVideoEvictionPostgresTransaction(
  pool: Pick<Pool, "connect">,
): PlainVideoEvictionTransaction {
  return async <T>(fn: (db: PlainVideoEvictionQuery) => Promise<T>) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '3s'");
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
}
