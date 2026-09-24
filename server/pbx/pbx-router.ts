/**
 * PBX tRPC Router
 *
 * All admin portal CRUD APIs for Cloud PBX management.
 * Every procedure is tenant-scoped via middleware.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import { router, protectedProcedure } from "../_core/trpc";
import { query, withTransaction } from "./db";
import { writeAuditLog, queryAuditLogs } from "./audit";
import { createSipCredentials, regenerateSipCredentials } from "./sip-secrets";
import { normalizeToE164 } from "./e164";
import {
  resolveTenantContext,
  hasRole,
  requireLiveTenantAdminMembership,
  validateTenantOwnership,
} from "./tenant-middleware";
import { buildPaginationSQL, buildPaginatedResponse } from "./pagination";
import { invalidateCache } from "./redis";
import {
  readManagementCapabilities,
  schemaHasRequiredColumns,
} from "./schema-capabilities";
import {
  getCallStats,
  getVoicemails,
  requireVoicemailStorage,
  VoicemailStorageUnavailableError,
} from "./cdr-processor";
import { SELF_SERVICE_CALL_OWNERSHIP_SQL } from "../../lib/pbx/self-service-usage";
import { profilePhotoDescriptors } from "../profile/photo";

// ============================================================================
// Zod Schemas
// ============================================================================

const paginationSchema = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(25),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const selectedTenantSchema = z.object({
  tenantId: z.number().int().positive(),
}).strict();

// ============================================================================
// Helper: resolve tenant from user context
// ============================================================================
async function getTenantCtx(ctx: any, requestedTenantId?: number) {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return resolveTenantContext(ctx.user.id, requestedTenantId);
}

async function getTenantAdminCtx(ctx: any, requestedTenantId?: number) {
  const tenant = await getTenantCtx(ctx, requestedTenantId);
  if (!hasRole(tenant.role, "admin")) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return tenant;
}

async function getTenantAdminReadCtx(ctx: any, requestedTenantId?: number) {
  const tenant = await getTenantAdminCtx(ctx, requestedTenantId);
  if (requestedTenantId === undefined && tenant.memberships.length !== 1) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Select a workspace before viewing phone administration",
    });
  }
  return tenant;
}

async function attachMemberPhotoDescriptors<T extends { id: number }>(
  tenantId: number,
  rows: T[],
  eligibleUserIds: number[],
): Promise<T[]> {
  // The shared query wrapper has a narrower signature than pg's overloaded
  // client query method, but supports the text-and-parameters call used here.
  const photos = await profilePhotoDescriptors(
    { query: query as unknown as PoolClient["query"] },
    tenantId,
    eligibleUserIds,
  );
  return rows.map((row) => {
    const photo = photos.get(Number(row.id));
    return photo
      ? { ...row, photoUrl: photo.photoUrl, photoVersion: photo.photoVersion }
      : row;
  });
}

async function getTenantAdminMutationCtx(ctx: any, requestedTenantId?: number) {
  const tenant = await getTenantAdminCtx(ctx, requestedTenantId);
  if (requestedTenantId === undefined && tenant.memberships.length !== 1) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Select a workspace before changing phone settings",
    });
  }
  // A cached membership can remain valid for five minutes after revocation.
  // Recheck every PBX admin mutation against the current database role.
  const liveRole = await requireLiveTenantAdminMembership(ctx.user!.id, tenant.tenantId);
  return { ...tenant, role: liveRole };
}

/** Hold the actor's admin role through a DID write's transaction commit. */
async function lockLiveDidAdmin(
  client: PoolClient,
  actorUserId: number,
  tenantId: number,
): Promise<void> {
  const actor = await client.query(
    `SELECT tm.role::text AS role
       FROM tenant_memberships tm
       JOIN tenants t ON t.id = tm.tenant_id
      WHERE tm.user_id = $1 AND tm.tenant_id = $2
        AND tm.status = 'active'
        AND tm.role::text IN ('owner', 'admin')
        AND t.status = 'active'
      FOR UPDATE OF tm, t`,
    [actorUserId, tenantId],
  );
  if (!actor.rows[0]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Workspace administrator access changed before the phone number was saved",
    });
  }
}

function voicemailUnavailable(error: unknown): never {
  if (error instanceof VoicemailStorageUnavailableError) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Voicemail inbox storage is not configured on this server",
    });
  }
  throw error;
}

type AssignableDidRouteType =
  | "extension"
  | "ring_group"
  | "queue"
  | "ivr"
  | "time_condition";

const didRouteTargets: Record<
  AssignableDidRouteType,
  {
    table: string;
    idColumn: string;
    tenantColumn: string;
    activeClause: string;
  }
> = {
  extension: {
    table:
      "extensions e JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = e.tenant_id",
    idColumn: "e.id",
    tenantColumn: "e.tenant_id",
    activeClause:
      " AND e.status = 'active' AND e.deleted_at IS NULL AND e.type = 'user' AND e.user_id IS NOT NULL AND sa.status = 'active' AND sa.deleted_at IS NULL AND sa.user_id IS NOT NULL",
  },
  ring_group: {
    table: "ring_groups",
    idColumn: "id",
    tenantColumn: "tenant_id",
    activeClause:
      " AND is_active = true AND strategy IN ('simultaneous', 'sequential')",
  },
  queue: {
    table: "call_queues",
    idColumn: "id",
    tenantColumn: "tenant_id",
    activeClause: " AND is_active = true AND strategy = 'ring_all'",
  },
  ivr: {
    table: "ivr_menus",
    idColumn: "id",
    tenantColumn: "tenant_id",
    activeClause: " AND is_active = true",
  },
  time_condition: {
    table: "time_conditions",
    idColumn: "id",
    tenantColumn: "tenant_id",
    activeClause: "",
  },
};

async function requireDidRouteTarget(
  client: PoolClient,
  routeType: AssignableDidRouteType,
  routeId: number,
  tenantId: number,
) {
  const route = didRouteTargets[routeType];
  const result = await client.query(
    `SELECT ${route.idColumn} AS id FROM ${route.table}
     WHERE ${route.idColumn} = $1 AND ${route.tenantColumn} = $2${route.activeClause}
     LIMIT 1 FOR SHARE`,
    [routeId, tenantId],
  );
  if (result.rows.length !== 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The selected call destination is unavailable in this workspace",
    });
  }
}

type SqlQuery = (
  sql: string,
  parameters: unknown[],
) => Promise<{ rows: unknown[] }>;

/**
 * An extension can only be assigned to an active member of the same workspace.
 *
 * User IDs are global, so extension ownership alone does not establish that the
 * assignee belongs to the active tenant. Keep this check beside every write
 * path to prevent an administrator from accidentally assigning an extension to
 * a person in another workspace.
 */
async function requireAssignableTenantMember(
  execute: SqlQuery,
  userId: number,
  tenantId: number,
) {
  const result = await execute(
    `SELECT 1 FROM tenant_memberships
     WHERE user_id = $1 AND tenant_id = $2 AND status = 'active'
     LIMIT 1`,
    [userId, tenantId],
  );

  if (result.rows.length !== 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The selected person is not an active member of this workspace",
    });
  }
}

async function phoneNumberSchemaAvailable(): Promise<boolean> {
  return (await readManagementCapabilities()).phoneNumbers;
}

async function requireManagementCapability(
  facility: "sites",
  name: string,
) {
  if (!(await readManagementCapabilities())[facility]) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${name} is unavailable on this server`,
    });
  }
}

function phoneNumberSchemaUnavailable(): TRPCError {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Phone number management is not available for this workspace.",
  });
}

const tenantSettingsRequirements = {
  tenant_settings: [
    "tenant_id",
    "business_hours_timezone",
    "created_at",
    "updated_at",
  ],
} as const;

const businessHoursTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((timeZone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format();
      return true;
    } catch {
      return false;
    }
  }, "Use a supported IANA time zone");

async function tenantSettingsSchemaAvailable(): Promise<boolean> {
  return schemaHasRequiredColumns(tenantSettingsRequirements);
}

function tenantSettingsUnavailable(): TRPCError {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Workspace settings are unavailable on this server",
  });
}

export async function upsertBusinessHoursTimezone(
  execute: SqlQuery,
  tenantId: number,
  actorUserId: number,
  businessHoursTimezone: string,
): Promise<{ rows: Array<{ business_hours_timezone: string }> }> {
  return execute(
    `INSERT INTO tenant_settings (
       tenant_id, business_hours_timezone, created_at, updated_at
     )
     SELECT tm.tenant_id, $2, NOW(), NOW()
       FROM tenant_memberships tm
       JOIN tenants t ON t.id = tm.tenant_id
      WHERE tm.user_id = $3
        AND tm.tenant_id = $1
        AND tm.status = 'active'
        AND tm.role::text IN ('owner', 'admin')
        AND t.status = 'active'
      FOR UPDATE OF tm, t
     ON CONFLICT (tenant_id) DO UPDATE
       SET business_hours_timezone = EXCLUDED.business_hours_timezone,
           updated_at = NOW()
     RETURNING business_hours_timezone`,
    [tenantId, businessHoursTimezone, actorUserId],
  ) as Promise<{ rows: Array<{ business_hours_timezone: string }> }>;
}

// ============================================================================
// PBX Router
// ============================================================================
export const pbxRouter = router({
  capabilities: protectedProcedure
    .input(selectedTenantSchema.optional())
    .query(async ({ ctx, input }) => {
      // The legacy self-service portal reads global schema availability. An
      // admin page supplying a workspace must prove a current admin role.
      if (input?.tenantId !== undefined) {
        const tc = await getTenantAdminReadCtx(ctx, input.tenantId);
        await requireLiveTenantAdminMembership(ctx.user!.id, tc.tenantId);
      }
      return readManagementCapabilities();
    }),

  // ========================================================================
  // TENANT
  // ========================================================================
  tenant: router({
    /** Get current tenant details */
    get: protectedProcedure
      .input(selectedTenantSchema.optional())
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx, input?.tenantId);
        const settingsAvailable = await tenantSettingsSchemaAvailable();
        const result = await query(
          `SELECT t.*, actor_tm.role::text AS live_user_role,
                ${
                  settingsAvailable
                    ? "ts.business_hours_timezone"
                    : "NULL::text AS business_hours_timezone"
                }
         FROM tenants t
         JOIN tenant_memberships actor_tm
           ON actor_tm.tenant_id = t.id
          AND actor_tm.user_id = $2
          AND actor_tm.status = 'active'
         ${settingsAvailable ? "LEFT JOIN tenant_settings ts ON t.id = ts.tenant_id" : ""}
         WHERE t.id = $1 AND t.status = 'active'`,
          [tc.tenantId, ctx.user!.id],
        );
        if (!result.rows[0]) throw new TRPCError({ code: "FORBIDDEN" });
        const { live_user_role, ...tenantDetails } = result.rows[0];
        return {
          ...tenantDetails,
          settingsAvailable,
          supportedSettings: settingsAvailable ? ["businessHoursTimezone"] : [],
          userRole: live_user_role,
          memberships: tc.memberships,
        };
      }),

    /** Update tenant settings */
    updateSettings: protectedProcedure
      .input(
        z
          .object({
            tenantId: z.number().int().positive().optional(),
            businessHoursTimezone: businessHoursTimezoneSchema.optional(),
          })
          .strict(),
      )
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantAdminMutationCtx(ctx, input.tenantId);
        if (!hasRole(tc.role, "admin"))
          throw new TRPCError({ code: "FORBIDDEN" });
        if (!(await tenantSettingsSchemaAvailable())) {
          throw tenantSettingsUnavailable();
        }

        if (input.businessHoursTimezone === undefined) return { success: true };

        // Recheck and lock the membership inside the write statement so a
        // concurrent revocation cannot race an already-resolved request.
        const saved = await upsertBusinessHoursTimezone(
          query,
          tc.tenantId,
          ctx.user!.id,
          input.businessHoursTimezone,
        );
        if (saved.rows.length !== 1) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Workspace administrator access changed before the setting was saved",
          });
        }

        await writeAuditLog({
          tenantId: tc.tenantId,
          actorUserId: ctx.user!.id,
          action: "update",
          resourceType: "tenant_settings",
          resourceId: String(tc.tenantId),
          newValue: input,
          ipAddress: ctx.req.ip,
        });

        return {
          success: true,
          businessHoursTimezone: saved.rows[0].business_hours_timezone,
        };
      }),

    /** List user's tenant memberships */
    memberships: protectedProcedure.query(async ({ ctx }) => {
      const tc = await getTenantCtx(ctx);
      return tc.memberships;
    }),

    /**
     * Current workspace people that an owner or administrator may assign to an
     * extension. Deliberately expose only public identity and assignment state;
     * SIP credentials and authentication records never enter this directory.
     */
    people: protectedProcedure
      .input(selectedTenantSchema.optional())
      .query(async ({ ctx, input }) => {
      const tc = await getTenantAdminReadCtx(ctx, input?.tenantId);
      const result = await query(
        `SELECT tm.user_id AS id, u.name, u.email,
                EXISTS (
                  SELECT 1 FROM user_extensions photo_ue
                  JOIN extensions photo_e
                    ON photo_e.id = photo_ue.extension_id
                   AND photo_e.tenant_id = $1
                   AND photo_e.status = 'active'
                   AND photo_e.deleted_at IS NULL
                  WHERE photo_ue.user_id = tm.user_id
                ) AS profile_photo_authorized,
                COALESCE(
                  array_agg(e.extension_number ORDER BY e.extension_number)
                    FILTER (WHERE e.id IS NOT NULL),
                  ARRAY[]::text[]
                ) AS assigned_extension_numbers
         FROM tenant_memberships tm
         JOIN users u ON u.id = tm.user_id
         LEFT JOIN extensions e
           ON e.tenant_id = tm.tenant_id
          AND e.user_id = tm.user_id
          AND e.status = 'active'
          AND e.deleted_at IS NULL
         WHERE tm.tenant_id = $1 AND tm.status = 'active'
           AND EXISTS (
             SELECT 1 FROM tenant_memberships actor_tm
             JOIN tenants actor_t ON actor_t.id = actor_tm.tenant_id
             WHERE actor_tm.tenant_id = $1 AND actor_tm.user_id = $2
               AND actor_tm.status = 'active'
               AND actor_tm.role::text IN ('owner', 'admin')
               AND actor_t.status = 'active'
           )
         GROUP BY tm.user_id, u.name, u.email
         ORDER BY lower(COALESCE(u.name, '')), lower(COALESCE(u.email, '')), tm.user_id`,
        [tc.tenantId, ctx.user!.id],
      );
      // The photo route independently requires an active membership and an
      // active assigned extension. Only issue descriptors for those people.
      const photoEligibleIds = result.rows
        .filter((row) => row.profile_photo_authorized === true)
        .map((row) => Number(row.id));
      const publicRows = result.rows.map(({ profile_photo_authorized, ...row }) => row);
      return attachMemberPhotoDescriptors(tc.tenantId, publicRows, photoEligibleIds);
      }),

    /**
     * Workspace membership directory for tenant administrators. This is
     * deliberately a directory of existing, canonical users only: adding a
     * person needs an identity-verification and invitation-delivery service,
     * neither of which is available through this PBX API.
     */
    members: protectedProcedure
      .input(selectedTenantSchema.optional())
      .query(async ({ ctx, input }) => {
      const tc = await getTenantAdminReadCtx(ctx, input?.tenantId);
      const result = await query(
        `SELECT tm.user_id AS id, u.name, u.email, tm.role, tm.status,
                tm.created_at,
                EXISTS (
                  SELECT 1 FROM user_extensions photo_ue
                  JOIN extensions photo_e
                    ON photo_e.id = photo_ue.extension_id
                   AND photo_e.tenant_id = $1
                   AND photo_e.status = 'active'
                   AND photo_e.deleted_at IS NULL
                  WHERE photo_ue.user_id = tm.user_id
                ) AS profile_photo_authorized,
                COALESCE(
                  array_agg(e.extension_number ORDER BY e.extension_number)
                    FILTER (WHERE e.id IS NOT NULL),
                  ARRAY[]::text[]
                ) AS assigned_extension_numbers
         FROM tenant_memberships tm
         JOIN users u ON u.id = tm.user_id
         LEFT JOIN extensions e
           ON e.tenant_id = tm.tenant_id
          AND e.user_id = tm.user_id
          AND e.status = 'active'
          AND e.deleted_at IS NULL
         WHERE tm.tenant_id = $1
           AND EXISTS (
             SELECT 1 FROM tenant_memberships actor_tm
             JOIN tenants actor_t ON actor_t.id = actor_tm.tenant_id
             WHERE actor_tm.tenant_id = $1 AND actor_tm.user_id = $2
               AND actor_tm.status = 'active'
               AND actor_tm.role::text IN ('owner', 'admin')
               AND actor_t.status = 'active'
           )
         GROUP BY tm.user_id, u.name, u.email, tm.role, tm.status, tm.created_at
         ORDER BY
           CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
           tm.status = 'active' DESC,
           lower(COALESCE(u.name, '')),
           lower(COALESCE(u.email, '')),
           tm.user_id`,
        [tc.tenantId, ctx.user!.id],
      );
      // Inactive memberships and active members without an assigned active
      // extension are not authorized by the photo route and remain initials-only.
      const photoEligibleIds = result.rows
        .filter((row) => row.status === "active" && row.profile_photo_authorized === true)
        .map((row) => Number(row.id));
      const publicRows = result.rows.map(({ profile_photo_authorized, ...row }) => row);
      return attachMemberPhotoDescriptors(tc.tenantId, publicRows, photoEligibleIds);
      }),

    /**
     * Update an existing workspace membership. Owners remain immutable here;
     * only an owner can promote or demote an administrator. This avoids
     * administrator escalation and preserves a final active administrator.
     */
    updateMember: protectedProcedure
      .input(
        z
          .object({
            tenantId: z.number().int().positive().optional(),
            userId: z.number().int().positive(),
            role: z.enum(["admin", "user"]).optional(),
            status: z.enum(["active", "inactive"]).optional(),
          })
          .refine((input) => input.role !== undefined || input.status !== undefined, {
            message: "Choose a role or membership status to update.",
          }),
      )
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantAdminMutationCtx(ctx, input.tenantId);
        const actorUserId = ctx.user!.id;

        const result = await withTransaction(async (client) => {
          // Serialize membership changes for this workspace so two concurrent
          // admin edits cannot remove the final active administrator.
          await client.query("SELECT pg_advisory_xact_lock($1)", [tc.tenantId]);

          const current = await client.query(
            `SELECT tm.user_id, tm.role, tm.status, u.name, u.email
             FROM tenant_memberships tm
             JOIN users u ON u.id = tm.user_id
             WHERE tm.tenant_id = $1 AND tm.user_id = $2
             FOR UPDATE OF tm`,
            [tc.tenantId, input.userId],
          );
          const member = current.rows[0] as
            | { user_id: number; role: string; status: string; name?: string | null; email?: string | null }
            | undefined;
          if (!member) throw new TRPCError({ code: "NOT_FOUND" });

          if (member.role === "owner") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Workspace owners cannot be changed here.",
            });
          }

          // An administrator may manage ordinary members, but cannot change
          // another administrator or grant administrator privilege.
          if (tc.role !== "owner" && (member.role !== "user" || input.role !== undefined)) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Only a workspace owner can change administrator roles.",
            });
          }

          const nextRole = input.role ?? member.role;
          const nextStatus = input.status ?? member.status;
          const currentlyProtectingAccess =
            member.status === "active" && ["owner", "admin"].includes(member.role);
          const willProtectAccess =
            nextStatus === "active" && ["owner", "admin"].includes(nextRole);

          if (currentlyProtectingAccess && !willProtectAccess) {
            const administrators = await client.query(
              `SELECT user_id FROM tenant_memberships
               WHERE tenant_id = $1
                 AND status = 'active'
                 AND role IN ('owner', 'admin')
               FOR UPDATE`,
              [tc.tenantId],
            );
            if (administrators.rows.length <= 1) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Keep at least one active workspace administrator.",
              });
            }
          }

          const updated = await client.query(
            `UPDATE tenant_memberships
             SET role = $1, status = $2
             WHERE tenant_id = $3 AND user_id = $4
             RETURNING user_id AS id, role, status`,
            [nextRole, nextStatus, tc.tenantId, input.userId],
          );
          if (!updated.rows[0]) throw new TRPCError({ code: "NOT_FOUND" });

          return { oldValue: member, member: updated.rows[0] };
        });

        await Promise.all([
          invalidateCache(`tenant:memberships:${input.userId}`),
          invalidateCache(`directory:${tc.tenantId}:*`),
        ]);
        await writeAuditLog({
          tenantId: tc.tenantId,
          actorUserId,
          action: "update",
          resourceType: "tenant_membership",
          resourceId: String(input.userId),
          oldValue: {
            userId: result.oldValue.user_id,
            role: result.oldValue.role,
            status: result.oldValue.status,
          },
          newValue: result.member,
          ipAddress: ctx.req.ip,
        });

        return { success: true, member: result.member };
      }),
  }),

  // ========================================================================
  // MEMBER SELF-SERVICE
  // ========================================================================
  selfService: router({
    /**
     * Return only extensions explicitly assigned to the signed-in member.
     * Tenant membership by itself never grants access to another person's
     * extension preferences or direct numbers.
     */
    overview: protectedProcedure.query(async ({ ctx }) => {
      const tc = await getTenantCtx(ctx);
      const phoneNumbersAvailable = await phoneNumberSchemaAvailable();
      const phoneNumberProjection = phoneNumbersAvailable
        ? `COALESCE(
             json_agg(
               json_build_object(
                 'id', pn.id,
                 'number_e164', pn.number_e164,
                 'number_display', pn.number_display,
                 'status', pn.status
               ) ORDER BY pn.number_e164
             ) FILTER (WHERE pn.id IS NOT NULL),
             '[]'::json
           )`
        : `'[]'::json`;
      const phoneNumberJoin = phoneNumbersAvailable
        ? `LEFT JOIN phone_numbers pn
             ON pn.tenant_id = e.tenant_id
            AND pn.assigned_route_type = 'extension'
            AND pn.assigned_route_id = e.id
            AND pn.deleted_at IS NULL`
        : "";
      const result = await query(
        `SELECT e.id, e.extension_number, e.display_name, e.status,
                ue.is_primary,
                sa.status AS sip_status, sa.last_registered_at,
                ${phoneNumbersAvailable ? "TRUE" : "FALSE"} AS phone_numbers_available,
                ${phoneNumberProjection} AS phone_numbers
         FROM tenant_memberships tm
         JOIN user_extensions ue ON ue.user_id = tm.user_id
         JOIN extensions e
           ON e.id = ue.extension_id
          AND e.tenant_id = tm.tenant_id
          AND e.deleted_at IS NULL
         LEFT JOIN sip_accounts sa
           ON sa.extension_id = e.id
          AND sa.tenant_id = e.tenant_id
          AND sa.user_id = tm.user_id
          AND sa.deleted_at IS NULL
         ${phoneNumberJoin}
         WHERE tm.tenant_id = $1
           AND tm.user_id = $2
           AND tm.status = 'active'
         GROUP BY e.id, ue.is_primary, sa.status, sa.last_registered_at
         ORDER BY ue.is_primary DESC, e.extension_number`,
        [tc.tenantId, ctx.user!.id],
      );
      return result.rows;
    }),

    /** CDR-backed usage for the signed-in member's assigned extensions. */
    usage: protectedProcedure
      .input(z.object({ period: z.enum(["week", "month"]).default("month") }).optional())
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        const interval = input?.period === "week" ? "7 days" : "30 days";
        const ownership = SELF_SERVICE_CALL_OWNERSHIP_SQL;
        const [summary, calls] = await Promise.all([
          query(
            `SELECT COUNT(*) AS total_calls,
                    COUNT(*) FILTER (WHERE disposition = 'answered') AS answered_calls,
                    COUNT(*) FILTER (WHERE disposition = 'missed') AS missed_calls,
                    COALESCE(SUM(total_duration_seconds), 0) AS total_duration_seconds
             FROM call_records cr
             WHERE cr.tenant_id = $1
               AND cr.started_at >= NOW() - $3::interval
               AND ${ownership}`,
            [tc.tenantId, ctx.user!.id, interval],
          ),
          query(
            `SELECT cr.id, cr.direction, cr.disposition,
                    cr.from_number AS caller_number,
                    cr.to_number AS callee_number,
                    cr.total_duration_seconds, cr.started_at
             FROM call_records cr
             WHERE cr.tenant_id = $1
               AND cr.started_at >= NOW() - $3::interval
               AND ${ownership}
             ORDER BY cr.started_at DESC
             LIMIT 50`,
            [tc.tenantId, ctx.user!.id, interval],
          ),
        ]);
        const row = summary.rows[0] || {};
        return {
          totalCalls: Number(row.total_calls || 0),
          answeredCalls: Number(row.answered_calls || 0),
          missedCalls: Number(row.missed_calls || 0),
          totalDurationSeconds: Number(row.total_duration_seconds || 0),
          calls: calls.rows,
        };
      }),
  }),

  // ========================================================================
  // EXTENSIONS
  // ========================================================================
  extensions: router({
    /** List extensions for current tenant */
    list: protectedProcedure
      .input(paginationSchema.extend({ tenantId: z.number().int().positive().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const tc = await getTenantAdminReadCtx(ctx, input?.tenantId);
        const p = buildPaginationSQL(input || {});

        const [dataResult, countResult] = await Promise.all([
          query(
            `SELECT e.*, sa.sip_username, sa.sip_domain, sa.status as sip_status,
                    sa.last_registered_at, sa.transport_preference,
                    u.name as user_name, u.email as user_email
             FROM extensions e
             LEFT JOIN sip_accounts sa ON e.id = sa.extension_id AND sa.deleted_at IS NULL
             LEFT JOIN users u ON e.user_id = u.id
             WHERE e.tenant_id = $1 AND e.deleted_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM tenant_memberships actor_tm
                 JOIN tenants actor_t ON actor_t.id = actor_tm.tenant_id
                 WHERE actor_tm.tenant_id = $1 AND actor_tm.user_id = $4
                   AND actor_tm.status = 'active'
                   AND actor_tm.role::text IN ('owner', 'admin')
                   AND actor_t.status = 'active'
               )
             ORDER BY ${p.orderBy} LIMIT $2 OFFSET $3`,
            [tc.tenantId, p.limit, p.offset, ctx.user!.id],
          ),
          query(
            `SELECT COUNT(*) as total FROM extensions e
             WHERE e.tenant_id = $1 AND e.deleted_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM tenant_memberships actor_tm
                 JOIN tenants actor_t ON actor_t.id = actor_tm.tenant_id
                 WHERE actor_tm.tenant_id = $1 AND actor_tm.user_id = $2
                   AND actor_tm.status = 'active'
                   AND actor_tm.role::text IN ('owner', 'admin')
                   AND actor_t.status = 'active'
               )`,
            [tc.tenantId, ctx.user!.id],
          ),
        ]);

        return buildPaginatedResponse(
          dataResult.rows,
          parseInt(countResult.rows[0]?.total || "0"),
          input || {},
        );
      }),

    /** Get single extension */
    get: protectedProcedure
      .input(z.object({ id: z.number(), tenantId: z.number().int().positive().optional() }))
      .query(async ({ ctx, input }) => {
        const tc = await getTenantAdminReadCtx(ctx, input.tenantId);
        const result = await query(
          `SELECT e.*, sa.sip_username, sa.sip_domain, sa.status as sip_status,
                  sa.last_registered_at, sa.transport_preference, sa.websocket_enabled,
                  u.name as user_name, u.email as user_email
           FROM extensions e
           LEFT JOIN sip_accounts sa ON e.id = sa.extension_id AND sa.deleted_at IS NULL
           LEFT JOIN users u ON e.user_id = u.id
           WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL
             AND EXISTS (
               SELECT 1 FROM tenant_memberships actor_tm
               JOIN tenants actor_t ON actor_t.id = actor_tm.tenant_id
               WHERE actor_tm.tenant_id = $2 AND actor_tm.user_id = $3
                 AND actor_tm.status = 'active'
                 AND actor_tm.role::text IN ('owner', 'admin')
                 AND actor_t.status = 'active'
             )`,
          [input.id, tc.tenantId, ctx.user!.id],
        );
        if (!result.rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        return result.rows[0];
      }),

    /** Create a new extension with SIP account */
    create: protectedProcedure
      .input(
        z.object({
          tenantId: z.number().int().positive().optional(),
          extensionNumber: z.string().min(2).max(10),
          displayName: z.string().optional(),
          type: z
            .enum([
              "user",
              "shared",
              "queue",
              "ivr",
              "ring_group",
              "voicemail",
              "parking",
            ])
            .default("user"),
          userId: z.number().int().positive().optional(),
          callerIdName: z.string().optional(),
          callerIdNumber: z.string().optional(),
          transport: z.string().default("UDP"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantAdminMutationCtx(ctx, input.tenantId);
        if (!hasRole(tc.role, "admin"))
          throw new TRPCError({ code: "FORBIDDEN" });

        return withTransaction(async (client) => {
          if (input.userId !== undefined) {
            await requireAssignableTenantMember(
              (sql, parameters) => client.query(sql, parameters),
              input.userId,
              tc.tenantId,
            );
          }

          // Check uniqueness
          const existing = await client.query(
            `SELECT id FROM extensions WHERE tenant_id = $1 AND extension_number = $2 AND deleted_at IS NULL`,
            [tc.tenantId, input.extensionNumber],
          );
          if (existing.rows.length > 0) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Extension ${input.extensionNumber} already exists`,
            });
          }

          // Create extension
          const extResult = await client.query(
            `INSERT INTO extensions (tenant_id, user_id, extension_number, display_name, type, 
                                     sip_username, sip_domain, sip_password, caller_id_name, caller_id_number, transport, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'sip.phone11.ai', '', $7, $8, $9, 'active')
             RETURNING *`,
            [
              tc.tenantId,
              input.userId || null,
              input.extensionNumber,
              input.displayName || `Extension ${input.extensionNumber}`,
              input.type,
              input.extensionNumber,
              input.callerIdName || null,
              input.callerIdNumber || null,
              input.transport,
            ],
          );
          const ext = extResult.rows[0];

          // Create SIP account with proper encryption
          const creds = createSipCredentials(input.extensionNumber);

          await client.query(
            `INSERT INTO sip_accounts 
              (tenant_id, extension_id, user_id, sip_username, sip_domain, ha1, ha1b,
               secret_ciphertext, secret_iv, secret_tag, dek_id, transport_preference, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')`,
            [
              tc.tenantId,
              ext.id,
              input.userId || null,
              creds.sipUsername,
              creds.sipDomain,
              creds.ha1,
              creds.ha1b,
              creds.secretCiphertext,
              creds.secretIv,
              creds.secretTag,
              creds.dekId,
              input.transport,
            ],
          );

          // Audit log
          await writeAuditLog({
            tenantId: tc.tenantId,
            actorUserId: ctx.user!.id,
            action: "create",
            resourceType: "extension",
            resourceId: String(ext.id),
            newValue: {
              extensionNumber: input.extensionNumber,
              type: input.type,
            },
            ipAddress: ctx.req.ip,
          });

          // Return extension + one-time password display
          return {
            ...ext,
            sipCredentials: {
              username: creds.sipUsername,
              domain: creds.sipDomain,
              password: creds.plaintextPassword, // One-time display only!
              transport: input.transport,
            },
          };
        });
      }),

    /** Update an extension */
    update: protectedProcedure
      .input(
        z.object({
          tenantId: z.number().int().positive().optional(),
          id: z.number(),
          displayName: z.string().optional(),
          callerIdName: z.string().optional(),
          callerIdNumber: z.string().optional(),
          status: z.enum(["active", "suspended", "disabled"]).optional(),
          userId: z.number().int().positive().nullable().optional(),
          dndEnabled: z.boolean().optional(),
          callForwardingEnabled: z.boolean().optional(),
          cfuDestination: z.string().nullable().optional(),
          cfbDestination: z.string().nullable().optional(),
          cfnaDestination: z.string().nullable().optional(),
          cfnaTimeoutSeconds: z.number().min(5).max(120).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantAdminMutationCtx(ctx, input.tenantId);
        const sets: string[] = [];
        const vals: any[] = [];
        let idx = 1;

        const fields: Record<string, string> = {
          displayName: "display_name",
          callerIdName: "caller_id_name",
          callerIdNumber: "caller_id_number",
          status: "status",
          userId: "user_id",
          dndEnabled: "dnd_enabled",
          callForwardingEnabled: "call_forwarding_enabled",
          cfuDestination: "cfu_destination",
          cfbDestination: "cfb_destination",
          cfnaDestination: "cfna_destination",
          cfnaTimeoutSeconds: "cfna_timeout_seconds",
        };

        for (const [key, col] of Object.entries(fields)) {
          if ((input as any)[key] !== undefined) {
            sets.push(`${col} = $${idx++}`);
            vals.push((input as any)[key]);
          }
        }

        if (sets.length === 0) return { success: true };

        sets.push(`updated_at = NOW()`);
        const hasAssignmentChange = input.userId !== undefined;
        const assignedUserId = input.userId;

        const applyUpdate = async (
          execute: SqlQuery,
          lockExtension: boolean,
        ) => {
          // Fetch and lock the tenant-owned source row before changing grants.
          const oldResult = await execute(
            `SELECT * FROM extensions
             WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL${
               lockExtension ? " FOR UPDATE" : ""
             }`,
            [input.id, tc.tenantId],
          );
          if (!oldResult.rows[0]) throw new TRPCError({ code: "NOT_FOUND" });

          if (
            hasAssignmentChange &&
            assignedUserId !== null &&
            assignedUserId !== undefined
          ) {
            await requireAssignableTenantMember(
              execute,
              assignedUserId,
              tc.tenantId,
            );
          }

          const updateValues = [...vals, input.id, tc.tenantId];
          const extensionResult = await execute(
            `UPDATE extensions SET ${sets.join(", ")}
             WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
             RETURNING id`,
            updateValues,
          );
          if (extensionResult.rows.length !== 1) {
            throw new TRPCError({ code: "NOT_FOUND" });
          }

          if (hasAssignmentChange) {
            // One-person assignment: revoke every prior explicit grant first.
            await execute(
              `DELETE FROM user_extensions ue
               USING extensions e
               WHERE ue.extension_id = e.id
                 AND ue.extension_id = $1
                 AND e.tenant_id = $2
                 AND e.deleted_at IS NULL`,
              [input.id, tc.tenantId],
            );

            if (assignedUserId !== null && assignedUserId !== undefined) {
              const primaryResult = await execute(
                `SELECT EXISTS(
                   SELECT 1
                   FROM user_extensions ue
                   WHERE ue.user_id = $1
                     AND ue.is_primary = true
                 ) AS has_primary`,
                [assignedUserId],
              );
              const primaryValue = (
                primaryResult.rows[0] as { has_primary?: unknown } | undefined
              )?.has_primary;
              const hasPrimary =
                primaryValue === true || primaryValue === "true" || primaryValue === 1;

              await execute(
                `INSERT INTO user_extensions (user_id, extension_id, is_primary)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, extension_id)
                 DO UPDATE SET is_primary = EXCLUDED.is_primary`,
                [assignedUserId, input.id, !hasPrimary],
              );
            }

            const sipResult = await execute(
              `UPDATE sip_accounts
               SET user_id = $1, updated_at = NOW()
               WHERE extension_id = $2
                 AND tenant_id = $3
                 AND status = 'active'
                 AND deleted_at IS NULL
               RETURNING id`,
              [assignedUserId ?? null, input.id, tc.tenantId],
            );
            if (sipResult.rows.length !== 1) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "The extension does not have one active SIP account",
              });
            }
          }

          return oldResult.rows[0];
        };

        const oldValue = hasAssignmentChange
          ? await withTransaction((client) =>
              applyUpdate(
                (sql, parameters) => client.query(sql, parameters),
                true,
              ),
            )
          : await applyUpdate(
              (sql, parameters) => query(sql, parameters),
              false,
            );

        // Invalidate cache
        await invalidateCache(`directory:${tc.tenantId}:*`);

        await writeAuditLog({
          tenantId: tc.tenantId,
          actorUserId: ctx.user!.id,
          action: "update",
          resourceType: "extension",
          resourceId: String(input.id),
          oldValue,
          newValue: input,
          ipAddress: ctx.req.ip,
        });

        return { success: true };
      }),

    /** Soft delete an extension */
    delete: protectedProcedure
      .input(z.object({ id: z.number(), tenantId: z.number().int().positive().optional() }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantAdminMutationCtx(ctx, input.tenantId);
        if (
          !(await validateTenantOwnership("extensions", input.id, tc.tenantId))
        ) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        await withTransaction(async (client) => {
          // Soft delete extension
          await client.query(
            `UPDATE extensions SET deleted_at = NOW(), status = 'disabled' WHERE id = $1`,
            [input.id],
          );
          // Soft delete associated SIP account
          await client.query(
            `UPDATE sip_accounts SET deleted_at = NOW(), status = 'disabled' WHERE extension_id = $1`,
            [input.id],
          );
        });

        await invalidateCache(`directory:${tc.tenantId}:*`);

        await writeAuditLog({
          tenantId: tc.tenantId,
          actorUserId: ctx.user!.id,
          action: "delete",
          resourceType: "extension",
          resourceId: String(input.id),
          ipAddress: ctx.req.ip,
        });

        return { success: true };
      }),

    /** Reset SIP password for an extension */
    resetPassword: protectedProcedure
      .input(z.object({ extensionId: z.number(), tenantId: z.number().int().positive().optional() }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantAdminMutationCtx(ctx, input.tenantId);
        if (
          !(await validateTenantOwnership(
            "extensions",
            input.extensionId,
            tc.tenantId,
          ))
        ) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        // Get SIP account
        const saResult = await query(
          `SELECT * FROM sip_accounts WHERE extension_id = $1 AND deleted_at IS NULL`,
          [input.extensionId],
        );
        if (!saResult.rows[0])
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No SIP account found",
          });

        const sa = saResult.rows[0];
        const creds = regenerateSipCredentials(sa.sip_username, sa.sip_domain);

        await query(
          `UPDATE sip_accounts SET ha1 = $1, ha1b = $2, secret_ciphertext = $3, 
           secret_iv = $4, secret_tag = $5, dek_id = $6, updated_at = NOW()
           WHERE id = $7`,
          [
            creds.ha1,
            creds.ha1b,
            creds.secretCiphertext,
            creds.secretIv,
            creds.secretTag,
            creds.dekId,
            sa.id,
          ],
        );

        await invalidateCache(`directory:${tc.tenantId}:*`);

        await writeAuditLog({
          tenantId: tc.tenantId,
          actorUserId: ctx.user!.id,
          action: "reset_password",
          resourceType: "sip_account",
          resourceId: String(sa.id),
          ipAddress: ctx.req.ip,
        });

        return {
          sipCredentials: {
            username: creds.sipUsername,
            domain: creds.sipDomain,
            password: creds.plaintextPassword,
          },
        };
      }),
  }),

  // ========================================================================
  // PHONE NUMBERS
  // ========================================================================
  phoneNumbers: router({
    /** List phone numbers */
    list: protectedProcedure
      .input(paginationSchema.extend({
        tenantId: z.number().int().positive().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        const tc = await getTenantAdminReadCtx(ctx, input?.tenantId);
        await requireLiveTenantAdminMembership(ctx.user!.id, tc.tenantId);
        const p = buildPaginationSQL(input || {});
        if (!(await phoneNumberSchemaAvailable())) {
          return {
            ...buildPaginatedResponse([], 0, input || {}),
            available: false,
          };
        }

        const [dataResult, countResult] = await Promise.all([
          query(
            `SELECT pn.*, ea.street as e911_street, ea.city as e911_city
             FROM phone_numbers pn
             LEFT JOIN emergency_addresses ea ON pn.e911_address_id = ea.id
             WHERE pn.tenant_id = $1 AND pn.deleted_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM tenant_memberships actor_tm
                 JOIN tenants actor_t ON actor_t.id = actor_tm.tenant_id
                 WHERE actor_tm.tenant_id = $1 AND actor_tm.user_id = $4
                   AND actor_tm.status = 'active'
                   AND actor_tm.role::text IN ('owner', 'admin')
                   AND actor_t.status = 'active'
               )
             ORDER BY ${p.orderBy} LIMIT $2 OFFSET $3`,
            [tc.tenantId, p.limit, p.offset, ctx.user!.id],
          ),
          query(
            `SELECT COUNT(*) as total FROM phone_numbers pn
             WHERE pn.tenant_id = $1 AND pn.deleted_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM tenant_memberships actor_tm
                 JOIN tenants actor_t ON actor_t.id = actor_tm.tenant_id
                 WHERE actor_tm.tenant_id = $1 AND actor_tm.user_id = $2
                   AND actor_tm.status = 'active'
                   AND actor_tm.role::text IN ('owner', 'admin')
                   AND actor_t.status = 'active'
               )`,
            [tc.tenantId, ctx.user!.id],
          ),
        ]);

        return {
          ...buildPaginatedResponse(
            dataResult.rows,
            parseInt(countResult.rows[0]?.total || "0"),
            input || {},
          ),
          available: true,
        };
      }),

    /** Add a phone number */
    create: protectedProcedure
      .input(
        z.object({
          tenantId: z.number().int().positive().optional(),
          number: z.string(),
          numberType: z
            .enum(["local", "mobile", "toll_free", "international"])
            .default("local"),
          provider: z.string().default("1toall"),
          country: z.string().default("TH"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantAdminMutationCtx(ctx, input.tenantId);
        if (!(await phoneNumberSchemaAvailable())) {
          throw phoneNumberSchemaUnavailable();
        }
        const normalized = normalizeToE164(input.number);

        const result = await withTransaction(async (client) => {
          await lockLiveDidAdmin(client, ctx.user!.id, tc.tenantId);
          return client.query(
            `INSERT INTO phone_numbers (tenant_id, number_e164, number_display, country, number_type, provider, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'active')
             RETURNING *`,
            [
              tc.tenantId,
              normalized.e164,
              normalized.display,
              input.country,
              input.numberType,
              input.provider,
            ],
          );
        });

        await writeAuditLog({
          tenantId: tc.tenantId,
          actorUserId: ctx.user!.id,
          action: "create",
          resourceType: "phone_number",
          resourceId: String(result.rows[0].id),
          newValue: { number: normalized.e164, type: input.numberType },
          ipAddress: ctx.req.ip,
        });

        return result.rows[0];
      }),

    /** Assign route to a phone number */
    assignRoute: protectedProcedure
      .input(
        z
          .object({
            tenantId: z.number().int().positive().optional(),
            id: z.number(),
            assignedRouteType: z
              .enum([
                "extension",
                "ring_group",
                "queue",
                "ivr",
                "time_condition",
              ])
              .nullable(),
            assignedRouteId: z.number().int().positive().nullable(),
          })
          .refine(
            (value) =>
              (value.assignedRouteType === null) ===
              (value.assignedRouteId === null),
            {
              message:
                "Call destination type and destination must be set together",
              path: ["assignedRouteId"],
            },
          ),
      )
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantAdminMutationCtx(ctx, input.tenantId);
        if (!(await phoneNumberSchemaAvailable())) {
          throw phoneNumberSchemaUnavailable();
        }
        if (
          !(await validateTenantOwnership(
            "phone_numbers",
            input.id,
            tc.tenantId,
          ))
        ) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await withTransaction(async (client) => {
          await lockLiveDidAdmin(client, ctx.user!.id, tc.tenantId);
          if (input.assignedRouteType && input.assignedRouteId) {
            // Lock every referenced destination row, including the SIP account
            // joined for user extensions, until the DID update commits.
            await requireDidRouteTarget(
              client,
              input.assignedRouteType,
              input.assignedRouteId,
              tc.tenantId,
            );
          }
          const updated = await client.query(
            `UPDATE phone_numbers SET assigned_route_type = $1, assigned_route_id = $2, updated_at = NOW()
             WHERE id = $3 AND tenant_id = $4 AND deleted_at IS NULL
             RETURNING id`,
            [
              input.assignedRouteType,
              input.assignedRouteId,
              input.id,
              tc.tenantId,
            ],
          );
          if (!updated.rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        });

        await invalidateCache(`routing:${tc.tenantId}:*`);

        await writeAuditLog({
          tenantId: tc.tenantId,
          actorUserId: ctx.user!.id,
          action: "assign_route",
          resourceType: "phone_number",
          resourceId: String(input.id),
          newValue: {
            routeType: input.assignedRouteType,
            routeId: input.assignedRouteId,
          },
          ipAddress: ctx.req.ip,
        });

        return { success: true };
      }),
  }),

  // ========================================================================
  // SITES
  // ========================================================================
  sites: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const tc = await getTenantCtx(ctx);
      await requireManagementCapability("sites", "Sites");
      const result = await query(
        `SELECT * FROM sites WHERE tenant_id = $1 AND status = 'active' ORDER BY is_main DESC, name`,
        [tc.tenantId],
      );
      return result.rows;
    }),

    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          addressLine1: z.string().optional(),
          city: z.string().optional(),
          stateProvince: z.string().optional(),
          postalCode: z.string().optional(),
          country: z.string().default("TH"),
          timezone: z.string().default("Asia/Bangkok"),
          isMain: z.boolean().default(false),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantAdminMutationCtx(ctx);
        await requireManagementCapability("sites", "Sites");
        const result = await query(
          `INSERT INTO sites (tenant_id, name, address_line1, city, state_province, postal_code, country, timezone, is_main)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            tc.tenantId,
            input.name,
            input.addressLine1,
            input.city,
            input.stateProvince,
            input.postalCode,
            input.country,
            input.timezone,
            input.isMain,
          ],
        );
        return result.rows[0];
      }),
  }),

  // ========================================================================
  // EMERGENCY ADDRESSES
  // ========================================================================
  emergencyAddresses: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const tc = await getTenantCtx(ctx);
      const result = await query(
        `SELECT * FROM emergency_addresses WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at DESC`,
        [tc.tenantId],
      );
      return result.rows;
    }),

    create: protectedProcedure
      .input(
        z.object({
          label: z.string().optional(),
          street: z.string().min(1),
          city: z.string().min(1),
          stateProvince: z.string().optional(),
          postalCode: z.string().optional(),
          country: z.string().default("TH"),
          callerName: z.string().optional(),
          siteId: z.number().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantAdminMutationCtx(ctx);
        const result = await query(
          `INSERT INTO emergency_addresses (tenant_id, site_id, label, street, city, state_province, postal_code, country, caller_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            tc.tenantId,
            input.siteId || null,
            input.label,
            input.street,
            input.city,
            input.stateProvince,
            input.postalCode,
            input.country,
            input.callerName,
          ],
        );
        return result.rows[0];
      }),
  }),

  // ========================================================================
  // FRAUD CONTROLS
  // ========================================================================
  fraudControls: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const tc = await getTenantAdminCtx(ctx);
      const result = await query(
        `SELECT * FROM fraud_controls WHERE tenant_id = $1`,
        [tc.tenantId],
      );
      return result.rows[0] || null;
    }),

    update: protectedProcedure
      .input(
        z.object({
          maxConcurrentOutbound: z.number().min(1).max(100).optional(),
          callsPerMinuteLimit: z.number().min(1).max(100).optional(),
          dailyCostCeiling: z.number().min(0).optional(),
          internationalEnabled: z.boolean().optional(),
          premiumRateEnabled: z.boolean().optional(),
          geoBlockList: z.array(z.string()).optional(),
          geoAllowList: z.array(z.string()).optional(),
          alertEmail: z.string().email().optional(),
          alertOnDailyCeiling: z.boolean().optional(),
          autoDisableOnCeiling: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantAdminMutationCtx(ctx);
        if (!hasRole(tc.role, "admin"))
          throw new TRPCError({ code: "FORBIDDEN" });

        const sets: string[] = [];
        const vals: any[] = [];
        let idx = 1;

        const fieldMap: Record<string, string> = {
          maxConcurrentOutbound: "max_concurrent_outbound",
          callsPerMinuteLimit: "calls_per_minute_limit",
          dailyCostCeiling: "daily_cost_ceiling",
          internationalEnabled: "international_enabled",
          premiumRateEnabled: "premium_rate_enabled",
          alertEmail: "alert_email",
          alertOnDailyCeiling: "alert_on_daily_ceiling",
          autoDisableOnCeiling: "auto_disable_on_ceiling",
        };

        for (const [key, col] of Object.entries(fieldMap)) {
          if ((input as any)[key] !== undefined) {
            sets.push(`${col} = $${idx++}`);
            vals.push((input as any)[key]);
          }
        }
        if (input.geoBlockList !== undefined) {
          sets.push(`geo_block_list = $${idx++}`);
          vals.push(JSON.stringify(input.geoBlockList));
        }
        if (input.geoAllowList !== undefined) {
          sets.push(`geo_allow_list = $${idx++}`);
          vals.push(JSON.stringify(input.geoAllowList));
        }

        if (sets.length === 0) return { success: true };

        sets.push(`updated_at = NOW()`);
        vals.push(tc.tenantId);

        await query(
          `UPDATE fraud_controls SET ${sets.join(", ")} WHERE tenant_id = $${idx}`,
          vals,
        );

        await writeAuditLog({
          tenantId: tc.tenantId,
          actorUserId: ctx.user!.id,
          action: "update",
          resourceType: "fraud_controls",
          resourceId: String(tc.tenantId),
          newValue: input,
          ipAddress: ctx.req.ip,
        });

        return { success: true };
      }),
  }),

  // ========================================================================
  // CALL RECORDS
  // ========================================================================
  callRecords: router({
    /** List call records with filtering */
    list: protectedProcedure
      .input(
        z
          .object({
            ...paginationSchema.shape,
            direction: z.enum(["inbound", "outbound", "internal"]).optional(),
            disposition: z.string().optional(),
            fromDate: z.string().optional(),
            toDate: z.string().optional(),
            userId: z.number().optional(),
            extensionNumber: z.string().optional(),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        const p = buildPaginationSQL(input || {});

        const conditions = ["cr.tenant_id = $1"];
        const vals: any[] = [tc.tenantId];
        let idx = 2;

        if (input?.direction) {
          conditions.push(`cr.direction = $${idx++}`);
          vals.push(input.direction);
        }
        if (input?.disposition) {
          conditions.push(`cr.disposition = $${idx++}`);
          vals.push(input.disposition);
        }
        if (input?.fromDate) {
          conditions.push(`cr.started_at >= $${idx++}`);
          vals.push(input.fromDate);
        }
        if (input?.toDate) {
          conditions.push(`cr.started_at <= $${idx++}`);
          vals.push(input.toDate);
        }
        if (input?.userId) {
          conditions.push(
            `(cr.caller_user_id = $${idx} OR cr.callee_user_id = $${idx++})`,
          );
          vals.push(input.userId);
        }

        const where = conditions.join(" AND ");

        const [dataResult, countResult] = await Promise.all([
          query(
            `SELECT cr.*, 
                    (SELECT COUNT(*) FROM call_legs cl WHERE cl.call_record_id = cr.id) as leg_count
             FROM call_records cr
             WHERE ${where}
             ORDER BY cr.started_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
            [...vals, p.limit, p.offset],
          ),
          query(
            `SELECT COUNT(*) as total FROM call_records cr WHERE ${where}`,
            vals,
          ),
        ]);

        return buildPaginatedResponse(
          dataResult.rows,
          parseInt(countResult.rows[0]?.total || "0"),
          input || {},
        );
      }),

    /** Get single call record with legs and events */
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        // Resolve the tenant-scoped parent first. Apart from avoiding needless
        // cross-workspace reads, this keeps child call metadata inaccessible
        // until ownership of the parent record is established.
        const recordResult = await query(
          `SELECT * FROM call_records WHERE id = $1 AND tenant_id = $2`,
          [input.id, tc.tenantId],
        );
        if (!recordResult.rows[0]) throw new TRPCError({ code: "NOT_FOUND" });

        const [legsResult, eventsResult] = await Promise.all([
          query(
            `SELECT * FROM call_legs WHERE call_record_id = $1 ORDER BY started_at`,
            [input.id],
          ),
          query(
            `SELECT * FROM call_events WHERE call_record_id = $1 ORDER BY event_timestamp`,
            [input.id],
          ),
        ]);

        return {
          ...recordResult.rows[0],
          legs: legsResult.rows,
          events: eventsResult.rows,
        };
      }),
  }),

  // ========================================================================
  // AUDIO FILES
  // ========================================================================
  audioFiles: router({
    list: protectedProcedure
      .input(z.object({ category: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        const conditions = ["tenant_id = $1", "status = 'active'"];
        const vals: any[] = [tc.tenantId];

        if (input?.category) {
          conditions.push("category = $2");
          vals.push(input.category);
        }

        const result = await query(
          `SELECT * FROM audio_files WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
          vals,
        );
        return result.rows;
      }),

    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          category: z.enum([
            "greeting",
            "moh",
            "announcement",
            "voicemail_greeting",
            "system",
          ]),
          fileUrl: z.string().url(),
          durationMs: z.number().optional(),
          format: z.string().default("wav"),
          language: z.string().default("th"),
          description: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantAdminMutationCtx(ctx);
        const result = await query(
          `INSERT INTO audio_files (tenant_id, name, category, file_url, duration_ms, format, language, description, owner_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            tc.tenantId,
            input.name,
            input.category,
            input.fileUrl,
            input.durationMs,
            input.format,
            input.language,
            input.description,
            ctx.user!.id,
          ],
        );
        return result.rows[0];
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantAdminMutationCtx(ctx);
        if (
          !(await validateTenantOwnership("audio_files", input.id, tc.tenantId))
        ) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await query(`UPDATE audio_files SET status = 'deleted' WHERE id = $1`, [
          input.id,
        ]);
        return { success: true };
      }),
  }),

  // ========================================================================
  // AUDIT LOGS
  // ========================================================================
  auditLogs: router({
    list: protectedProcedure
      .input(
        z
          .object({
            ...paginationSchema.shape,
            resourceType: z.string().optional(),
            action: z.string().optional(),
            fromDate: z.string().optional(),
            toDate: z.string().optional(),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        const tc = await getTenantAdminCtx(ctx);
        return queryAuditLogs({
          tenantId: tc.tenantId,
          resourceType: input?.resourceType,
          action: input?.action,
          fromDate: input?.fromDate ? new Date(input.fromDate) : undefined,
          toDate: input?.toDate ? new Date(input.toDate) : undefined,
          limit: input?.pageSize || 25,
          offset: ((input?.page || 1) - 1) * (input?.pageSize || 25),
        });
      }),
  }),

  // ========================================================================
  // DASHBOARD STATS
  // ========================================================================
  dashboard: router({
    stats: protectedProcedure.query(async ({ ctx }) => {
      const tc = await getTenantAdminCtx(ctx);
      const phoneNumbersAvailable = await phoneNumberSchemaAvailable();

      const [
        extensionCount,
        activeExtensions,
        phoneNumberCount,
        callsToday,
        missedToday,
        avgDuration,
      ] = await Promise.all([
        query(
          `SELECT COUNT(*) as c FROM extensions WHERE tenant_id = $1 AND deleted_at IS NULL`,
          [tc.tenantId],
        ),
        query(
          `SELECT COUNT(*) as c FROM extensions WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL`,
          [tc.tenantId],
        ),
        phoneNumbersAvailable
          ? query(
              `SELECT COUNT(*) as c FROM phone_numbers WHERE tenant_id = $1 AND deleted_at IS NULL`,
              [tc.tenantId],
            )
          : Promise.resolve({ rows: [{ c: "0" }] }),
        query(
          `SELECT COUNT(*) as c FROM call_records WHERE tenant_id = $1 AND started_at >= CURRENT_DATE`,
          [tc.tenantId],
        ),
        query(
          `SELECT COUNT(*) as c FROM call_records WHERE tenant_id = $1 AND started_at >= CURRENT_DATE AND disposition = 'missed'`,
          [tc.tenantId],
        ),
        query(
          `SELECT COALESCE(AVG(total_duration_seconds), 0) as avg FROM call_records WHERE tenant_id = $1 AND started_at >= CURRENT_DATE AND disposition = 'answered'`,
          [tc.tenantId],
        ),
      ]);

      return {
        totalExtensions: parseInt(extensionCount.rows[0]?.c || "0"),
        activeExtensions: parseInt(activeExtensions.rows[0]?.c || "0"),
        phoneNumbers: parseInt(phoneNumberCount.rows[0]?.c || "0"),
        phoneNumbersAvailable,
        callsToday: parseInt(callsToday.rows[0]?.c || "0"),
        missedCallsToday: parseInt(missedToday.rows[0]?.c || "0"),
        avgCallDuration: Math.round(
          parseFloat(avgDuration.rows[0]?.avg || "0"),
        ),
      };
    }),

    /** Recent calls for dashboard */
    recentCalls: protectedProcedure
      .input(
        z.object({ limit: z.number().min(1).max(50).default(10) }).optional(),
      )
      .query(async ({ ctx, input }) => {
        const tc = await getTenantAdminCtx(ctx);
        const result = await query(
          `SELECT * FROM call_records WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT $2`,
          [tc.tenantId, input?.limit || 10],
        );
        return result.rows;
      }),

    /** Call analytics with hourly distribution, top callers, etc. */
    analytics: protectedProcedure
      .input(
        z
          .object({
            period: z.enum(["today", "week", "month"]).default("today"),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        const tc = await getTenantAdminCtx(ctx);
        return getCallStats(tc.tenantId, input?.period || "today");
      }),
  }),

  // ========================================================================
  // VOICEMAIL
  // ========================================================================
  voicemail: router({
    /** List voicemail messages */
    list: protectedProcedure
      .input(
        z
          .object({
            extension: z.string().regex(/^[1-9][0-9]{0,15}$/).optional(),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        try {
          return await getVoicemails(tc.tenantId, ctx.user.id, input?.extension);
        } catch (error) {
          voicemailUnavailable(error);
        }
      }),

    /** Mark voicemail as read */
    markRead: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        try {
          await requireVoicemailStorage();
          await query(
            `UPDATE voicemail_messages vm
             SET status = 'read', read_at = NOW()
             FROM extensions e
             JOIN user_extensions ue ON ue.extension_id = e.id AND ue.user_id = $3
             JOIN tenant_memberships tm ON tm.user_id = ue.user_id AND tm.tenant_id = e.tenant_id AND tm.status = 'active'
             WHERE vm.id = $1 AND vm.tenant_id = $2 AND vm.status = 'new'
               AND e.id = vm.extension_id AND e.tenant_id = vm.tenant_id
               AND e.status = 'active' AND e.deleted_at IS NULL`,
            [input.id, tc.tenantId, ctx.user.id],
          );
        } catch (error) {
          voicemailUnavailable(error);
        }
        return { success: true };
      }),

    /** Delete voicemail */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        try {
          await requireVoicemailStorage();
          await query(
            `UPDATE voicemail_messages vm
             SET status = 'deleted', deleted_at = COALESCE(deleted_at, NOW())
             FROM extensions e
             JOIN user_extensions ue ON ue.extension_id = e.id AND ue.user_id = $3
             JOIN tenant_memberships tm ON tm.user_id = ue.user_id AND tm.tenant_id = e.tenant_id AND tm.status = 'active'
             WHERE vm.id = $1 AND vm.tenant_id = $2 AND vm.status != 'deleted'
               AND e.id = vm.extension_id AND e.tenant_id = vm.tenant_id
               AND e.status = 'active' AND e.deleted_at IS NULL`,
            [input.id, tc.tenantId, ctx.user.id],
          );
        } catch (error) {
          voicemailUnavailable(error);
        }
        return { success: true };
      }),

    /** Get voicemail count (new/total) */
    count: protectedProcedure
      .input(z.object({ extension: z.string().regex(/^[1-9][0-9]{0,15}$/).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        const conditions = ["vm.tenant_id = $1", "vm.status != 'deleted'"];
        const vals: Array<number | string> = [tc.tenantId, ctx.user.id];
        if (input?.extension) {
          conditions.push("e.extension_number = $3");
          vals.push(input.extension);
        }
        try {
          await requireVoicemailStorage();
          const result = await query(
            `SELECT
               COUNT(*) as total,
               COUNT(*) FILTER (WHERE vm.status = 'new') as unread
             FROM voicemail_messages vm
             JOIN extensions e
               ON e.id = vm.extension_id AND e.tenant_id = vm.tenant_id
             JOIN user_extensions ue
               ON ue.extension_id = e.id AND ue.user_id = $2
             JOIN tenant_memberships tm
               ON tm.user_id = ue.user_id AND tm.tenant_id = vm.tenant_id AND tm.status = 'active'
             WHERE ${conditions.join(" AND ")}
               AND e.status = 'active' AND e.deleted_at IS NULL`,
            vals,
          );
          return {
            total: parseInt(result.rows[0]?.total || "0"),
            unread: parseInt(result.rows[0]?.unread || "0"),
          };
        } catch (error) {
          voicemailUnavailable(error);
        }
      }),
  }),
});
