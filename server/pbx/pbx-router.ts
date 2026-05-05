/**
 * PBX tRPC Router
 * 
 * All admin portal CRUD APIs for Cloud PBX management.
 * Every procedure is tenant-scoped via middleware.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { query, withTransaction } from "./db";
import { writeAuditLog, queryAuditLogs } from "./audit";
import { createSipCredentials, regenerateSipCredentials, decryptSecret } from "./sip-secrets";
import { normalizeToE164, isValidE164 } from "./e164";
import { resolveTenantContext, hasRole, validateTenantOwnership } from "./tenant-middleware";
import { buildPaginationSQL, buildPaginatedResponse } from "./pagination";
import { invalidateCache } from "./redis";
import { getCallStats, getVoicemails } from "./cdr-processor";

// ============================================================================
// Zod Schemas
// ============================================================================

const paginationSchema = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(25),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// ============================================================================
// Helper: resolve tenant from user context
// ============================================================================
async function getTenantCtx(ctx: any, requestedTenantId?: number) {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return resolveTenantContext(ctx.user.id, requestedTenantId);
}

// ============================================================================
// PBX Router
// ============================================================================
export const pbxRouter = router({
  // ========================================================================
  // TENANT
  // ========================================================================
  tenant: router({
    /** Get current tenant details */
    get: protectedProcedure.query(async ({ ctx }) => {
      const tc = await getTenantCtx(ctx);
      const result = await query(
        `SELECT t.*, ts.default_caller_id, ts.emergency_address_required, 
                ts.recording_default_policy, ts.voicemail_default_enabled,
                ts.business_hours_timezone, ts.max_ring_timeout_seconds
         FROM tenants t
         LEFT JOIN tenant_settings ts ON t.id = ts.tenant_id
         WHERE t.id = $1`,
        [tc.tenantId]
      );
      if (!result.rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      return { ...result.rows[0], userRole: tc.role, memberships: tc.memberships };
    }),

    /** Update tenant settings */
    updateSettings: adminProcedure
      .input(z.object({
        tenantId: z.number().optional(),
        defaultCallerId: z.string().optional(),
        emergencyAddressRequired: z.boolean().optional(),
        recordingDefaultPolicy: z.enum(["disabled", "always", "on_demand", "inbound_only", "outbound_only"]).optional(),
        voicemailDefaultEnabled: z.boolean().optional(),
        businessHoursTimezone: z.string().optional(),
        maxRingTimeoutSeconds: z.number().min(10).max(120).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx, input.tenantId);
        if (!hasRole(tc.role, "admin")) throw new TRPCError({ code: "FORBIDDEN" });

        const sets: string[] = [];
        const vals: any[] = [];
        let idx = 1;

        if (input.defaultCallerId !== undefined) { sets.push(`default_caller_id = $${idx++}`); vals.push(input.defaultCallerId); }
        if (input.emergencyAddressRequired !== undefined) { sets.push(`emergency_address_required = $${idx++}`); vals.push(input.emergencyAddressRequired); }
        if (input.recordingDefaultPolicy !== undefined) { sets.push(`recording_default_policy = $${idx++}`); vals.push(input.recordingDefaultPolicy); }
        if (input.voicemailDefaultEnabled !== undefined) { sets.push(`voicemail_default_enabled = $${idx++}`); vals.push(input.voicemailDefaultEnabled); }
        if (input.businessHoursTimezone !== undefined) { sets.push(`business_hours_timezone = $${idx++}`); vals.push(input.businessHoursTimezone); }
        if (input.maxRingTimeoutSeconds !== undefined) { sets.push(`max_ring_timeout_seconds = $${idx++}`); vals.push(input.maxRingTimeoutSeconds); }

        if (sets.length === 0) return { success: true };

        sets.push(`updated_at = NOW()`);
        vals.push(tc.tenantId);

        await query(
          `UPDATE tenant_settings SET ${sets.join(", ")} WHERE tenant_id = $${idx}`,
          vals
        );

        await writeAuditLog({
          tenantId: tc.tenantId,
          actorUserId: ctx.user!.id,
          action: "update",
          resourceType: "tenant_settings",
          resourceId: String(tc.tenantId),
          newValue: input,
          ipAddress: ctx.req.ip,
        });

        return { success: true };
      }),

    /** List user's tenant memberships */
    memberships: protectedProcedure.query(async ({ ctx }) => {
      const tc = await getTenantCtx(ctx);
      return tc.memberships;
    }),
  }),

  // ========================================================================
  // EXTENSIONS
  // ========================================================================
  extensions: router({
    /** List extensions for current tenant */
    list: protectedProcedure
      .input(paginationSchema.optional())
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
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
             ORDER BY ${p.orderBy} LIMIT $2 OFFSET $3`,
            [tc.tenantId, p.limit, p.offset]
          ),
          query(
            `SELECT COUNT(*) as total FROM extensions WHERE tenant_id = $1 AND deleted_at IS NULL`,
            [tc.tenantId]
          ),
        ]);

        return buildPaginatedResponse(
          dataResult.rows,
          parseInt(countResult.rows[0]?.total || "0"),
          input || {}
        );
      }),

    /** Get single extension */
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        const result = await query(
          `SELECT e.*, sa.sip_username, sa.sip_domain, sa.status as sip_status,
                  sa.last_registered_at, sa.transport_preference, sa.websocket_enabled,
                  u.name as user_name, u.email as user_email
           FROM extensions e
           LEFT JOIN sip_accounts sa ON e.id = sa.extension_id AND sa.deleted_at IS NULL
           LEFT JOIN users u ON e.user_id = u.id
           WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`,
          [input.id, tc.tenantId]
        );
        if (!result.rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        return result.rows[0];
      }),

    /** Create a new extension with SIP account */
    create: adminProcedure
      .input(z.object({
        extensionNumber: z.string().min(2).max(10),
        displayName: z.string().optional(),
        type: z.enum(["user", "shared", "queue", "ivr", "ring_group", "voicemail", "parking"]).default("user"),
        userId: z.number().optional(),
        callerIdName: z.string().optional(),
        callerIdNumber: z.string().optional(),
        transport: z.string().default("UDP"),
      }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        if (!hasRole(tc.role, "admin")) throw new TRPCError({ code: "FORBIDDEN" });

        return withTransaction(async (client) => {
          // Check uniqueness
          const existing = await client.query(
            `SELECT id FROM extensions WHERE tenant_id = $1 AND extension_number = $2 AND deleted_at IS NULL`,
            [tc.tenantId, input.extensionNumber]
          );
          if (existing.rows.length > 0) {
            throw new TRPCError({ code: "CONFLICT", message: `Extension ${input.extensionNumber} already exists` });
          }

          // Create extension
          const extResult = await client.query(
            `INSERT INTO extensions (tenant_id, user_id, extension_number, display_name, type, 
                                     sip_username, sip_domain, sip_password, caller_id_name, caller_id_number, transport, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'sip.phone11.ai', '', $7, $8, $9, 'active')
             RETURNING *`,
            [
              tc.tenantId, input.userId || null, input.extensionNumber,
              input.displayName || `Extension ${input.extensionNumber}`,
              input.type, input.extensionNumber,
              input.callerIdName || null, input.callerIdNumber || null,
              input.transport,
            ]
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
              tc.tenantId, ext.id, input.userId || null,
              creds.sipUsername, creds.sipDomain, creds.ha1, creds.ha1b,
              creds.secretCiphertext, creds.secretIv, creds.secretTag,
              creds.dekId, input.transport,
            ]
          );

          // Audit log
          await writeAuditLog({
            tenantId: tc.tenantId,
            actorUserId: ctx.user!.id,
            action: "create",
            resourceType: "extension",
            resourceId: String(ext.id),
            newValue: { extensionNumber: input.extensionNumber, type: input.type },
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
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        displayName: z.string().optional(),
        callerIdName: z.string().optional(),
        callerIdNumber: z.string().optional(),
        status: z.enum(["active", "suspended", "disabled"]).optional(),
        userId: z.number().nullable().optional(),
        dndEnabled: z.boolean().optional(),
        callForwardingEnabled: z.boolean().optional(),
        cfuDestination: z.string().nullable().optional(),
        cfbDestination: z.string().nullable().optional(),
        cfnaDestination: z.string().nullable().optional(),
        cfnaTimeoutSeconds: z.number().min(5).max(120).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        if (!await validateTenantOwnership("extensions", input.id, tc.tenantId)) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        // Get old values for audit
        const oldResult = await query(`SELECT * FROM extensions WHERE id = $1`, [input.id]);
        const oldValue = oldResult.rows[0];

        const sets: string[] = [];
        const vals: any[] = [];
        let idx = 1;

        const fields: Record<string, string> = {
          displayName: "display_name", callerIdName: "caller_id_name",
          callerIdNumber: "caller_id_number", status: "status",
          userId: "user_id", dndEnabled: "dnd_enabled",
          callForwardingEnabled: "call_forwarding_enabled",
          cfuDestination: "cfu_destination", cfbDestination: "cfb_destination",
          cfnaDestination: "cfna_destination", cfnaTimeoutSeconds: "cfna_timeout_seconds",
        };

        for (const [key, col] of Object.entries(fields)) {
          if ((input as any)[key] !== undefined) {
            sets.push(`${col} = $${idx++}`);
            vals.push((input as any)[key]);
          }
        }

        if (sets.length === 0) return { success: true };

        sets.push(`updated_at = NOW()`);
        vals.push(input.id);

        await query(`UPDATE extensions SET ${sets.join(", ")} WHERE id = $${idx}`, vals);

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
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        if (!await validateTenantOwnership("extensions", input.id, tc.tenantId)) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        await withTransaction(async (client) => {
          // Soft delete extension
          await client.query(
            `UPDATE extensions SET deleted_at = NOW(), status = 'disabled' WHERE id = $1`,
            [input.id]
          );
          // Soft delete associated SIP account
          await client.query(
            `UPDATE sip_accounts SET deleted_at = NOW(), status = 'disabled' WHERE extension_id = $1`,
            [input.id]
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
    resetPassword: adminProcedure
      .input(z.object({ extensionId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        if (!await validateTenantOwnership("extensions", input.extensionId, tc.tenantId)) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        // Get SIP account
        const saResult = await query(
          `SELECT * FROM sip_accounts WHERE extension_id = $1 AND deleted_at IS NULL`,
          [input.extensionId]
        );
        if (!saResult.rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No SIP account found" });

        const sa = saResult.rows[0];
        const creds = regenerateSipCredentials(sa.sip_username, sa.sip_domain);

        await query(
          `UPDATE sip_accounts SET ha1 = $1, ha1b = $2, secret_ciphertext = $3, 
           secret_iv = $4, secret_tag = $5, dek_id = $6, updated_at = NOW()
           WHERE id = $7`,
          [creds.ha1, creds.ha1b, creds.secretCiphertext, creds.secretIv, creds.secretTag, creds.dekId, sa.id]
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
      .input(paginationSchema.optional())
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        const p = buildPaginationSQL(input || {});

        const [dataResult, countResult] = await Promise.all([
          query(
            `SELECT pn.*, ea.street as e911_street, ea.city as e911_city
             FROM phone_numbers pn
             LEFT JOIN emergency_addresses ea ON pn.e911_address_id = ea.id
             WHERE pn.tenant_id = $1 AND pn.deleted_at IS NULL
             ORDER BY ${p.orderBy} LIMIT $2 OFFSET $3`,
            [tc.tenantId, p.limit, p.offset]
          ),
          query(
            `SELECT COUNT(*) as total FROM phone_numbers WHERE tenant_id = $1 AND deleted_at IS NULL`,
            [tc.tenantId]
          ),
        ]);

        return buildPaginatedResponse(dataResult.rows, parseInt(countResult.rows[0]?.total || "0"), input || {});
      }),

    /** Add a phone number */
    create: adminProcedure
      .input(z.object({
        number: z.string(),
        numberType: z.enum(["local", "mobile", "toll_free", "international"]).default("local"),
        provider: z.string().default("1toall"),
        country: z.string().default("TH"),
      }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        const normalized = normalizeToE164(input.number);

        const result = await query(
          `INSERT INTO phone_numbers (tenant_id, number_e164, number_display, country, number_type, provider, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'active')
           RETURNING *`,
          [tc.tenantId, normalized.e164, normalized.display, input.country, input.numberType, input.provider]
        );

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
    assignRoute: adminProcedure
      .input(z.object({
        id: z.number(),
        assignedRouteType: z.enum(["extension", "ring_group", "queue", "ivr", "voicemail"]).nullable(),
        assignedRouteId: z.number().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        if (!await validateTenantOwnership("phone_numbers", input.id, tc.tenantId)) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        await query(
          `UPDATE phone_numbers SET assigned_route_type = $1, assigned_route_id = $2, updated_at = NOW()
           WHERE id = $3`,
          [input.assignedRouteType, input.assignedRouteId, input.id]
        );

        await invalidateCache(`routing:${tc.tenantId}:*`);

        await writeAuditLog({
          tenantId: tc.tenantId,
          actorUserId: ctx.user!.id,
          action: "assign_route",
          resourceType: "phone_number",
          resourceId: String(input.id),
          newValue: { routeType: input.assignedRouteType, routeId: input.assignedRouteId },
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
      const result = await query(
        `SELECT * FROM sites WHERE tenant_id = $1 AND status = 'active' ORDER BY is_main DESC, name`,
        [tc.tenantId]
      );
      return result.rows;
    }),

    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        addressLine1: z.string().optional(),
        city: z.string().optional(),
        stateProvince: z.string().optional(),
        postalCode: z.string().optional(),
        country: z.string().default("TH"),
        timezone: z.string().default("Asia/Bangkok"),
        isMain: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        const result = await query(
          `INSERT INTO sites (tenant_id, name, address_line1, city, state_province, postal_code, country, timezone, is_main)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [tc.tenantId, input.name, input.addressLine1, input.city, input.stateProvince, input.postalCode, input.country, input.timezone, input.isMain]
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
        [tc.tenantId]
      );
      return result.rows;
    }),

    create: adminProcedure
      .input(z.object({
        label: z.string().optional(),
        street: z.string().min(1),
        city: z.string().min(1),
        stateProvince: z.string().optional(),
        postalCode: z.string().optional(),
        country: z.string().default("TH"),
        callerName: z.string().optional(),
        siteId: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        const result = await query(
          `INSERT INTO emergency_addresses (tenant_id, site_id, label, street, city, state_province, postal_code, country, caller_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [tc.tenantId, input.siteId || null, input.label, input.street, input.city, input.stateProvince, input.postalCode, input.country, input.callerName]
        );
        return result.rows[0];
      }),
  }),

  // ========================================================================
  // FRAUD CONTROLS
  // ========================================================================
  fraudControls: router({
    get: adminProcedure.query(async ({ ctx }) => {
      const tc = await getTenantCtx(ctx);
      const result = await query(`SELECT * FROM fraud_controls WHERE tenant_id = $1`, [tc.tenantId]);
      return result.rows[0] || null;
    }),

    update: adminProcedure
      .input(z.object({
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
      }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        if (!hasRole(tc.role, "admin")) throw new TRPCError({ code: "FORBIDDEN" });

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

        await query(`UPDATE fraud_controls SET ${sets.join(", ")} WHERE tenant_id = $${idx}`, vals);

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
      .input(z.object({
        ...paginationSchema.shape,
        direction: z.enum(["inbound", "outbound", "internal"]).optional(),
        disposition: z.string().optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        userId: z.number().optional(),
        extensionNumber: z.string().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        const p = buildPaginationSQL(input || {});
        
        const conditions = ["cr.tenant_id = $1"];
        const vals: any[] = [tc.tenantId];
        let idx = 2;

        if (input?.direction) { conditions.push(`cr.direction = $${idx++}`); vals.push(input.direction); }
        if (input?.disposition) { conditions.push(`cr.disposition = $${idx++}`); vals.push(input.disposition); }
        if (input?.fromDate) { conditions.push(`cr.started_at >= $${idx++}`); vals.push(input.fromDate); }
        if (input?.toDate) { conditions.push(`cr.started_at <= $${idx++}`); vals.push(input.toDate); }
        if (input?.userId) { conditions.push(`(cr.caller_user_id = $${idx} OR cr.callee_user_id = $${idx++})`); vals.push(input.userId); }

        const where = conditions.join(" AND ");

        const [dataResult, countResult] = await Promise.all([
          query(
            `SELECT cr.*, 
                    (SELECT COUNT(*) FROM call_legs cl WHERE cl.call_record_id = cr.id) as leg_count
             FROM call_records cr
             WHERE ${where}
             ORDER BY cr.started_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
            [...vals, p.limit, p.offset]
          ),
          query(`SELECT COUNT(*) as total FROM call_records cr WHERE ${where}`, vals),
        ]);

        return buildPaginatedResponse(dataResult.rows, parseInt(countResult.rows[0]?.total || "0"), input || {});
      }),

    /** Get single call record with legs and events */
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        
        const [recordResult, legsResult, eventsResult] = await Promise.all([
          query(`SELECT * FROM call_records WHERE id = $1 AND tenant_id = $2`, [input.id, tc.tenantId]),
          query(`SELECT * FROM call_legs WHERE call_record_id = $1 ORDER BY started_at`, [input.id]),
          query(`SELECT * FROM call_events WHERE call_record_id = $1 ORDER BY event_timestamp`, [input.id]),
        ]);

        if (!recordResult.rows[0]) throw new TRPCError({ code: "NOT_FOUND" });

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
          vals
        );
        return result.rows;
      }),

    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        category: z.enum(["greeting", "moh", "announcement", "voicemail_greeting", "system"]),
        fileUrl: z.string().url(),
        durationMs: z.number().optional(),
        format: z.string().default("wav"),
        language: z.string().default("th"),
        description: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        const result = await query(
          `INSERT INTO audio_files (tenant_id, name, category, file_url, duration_ms, format, language, description, owner_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [tc.tenantId, input.name, input.category, input.fileUrl, input.durationMs, input.format, input.language, input.description, ctx.user!.id]
        );
        return result.rows[0];
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        if (!await validateTenantOwnership("audio_files", input.id, tc.tenantId)) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await query(`UPDATE audio_files SET status = 'deleted' WHERE id = $1`, [input.id]);
        return { success: true };
      }),
  }),

  // ========================================================================
  // AUDIT LOGS
  // ========================================================================
  auditLogs: router({
    list: adminProcedure
      .input(z.object({
        ...paginationSchema.shape,
        resourceType: z.string().optional(),
        action: z.string().optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
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
      const tc = await getTenantCtx(ctx);
      
      const [
        extensionCount,
        activeExtensions,
        phoneNumberCount,
        callsToday,
        missedToday,
        avgDuration,
      ] = await Promise.all([
        query(`SELECT COUNT(*) as c FROM extensions WHERE tenant_id = $1 AND deleted_at IS NULL`, [tc.tenantId]),
        query(`SELECT COUNT(*) as c FROM extensions WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL`, [tc.tenantId]),
        query(`SELECT COUNT(*) as c FROM phone_numbers WHERE tenant_id = $1 AND deleted_at IS NULL`, [tc.tenantId]),
        query(`SELECT COUNT(*) as c FROM call_records WHERE tenant_id = $1 AND started_at >= CURRENT_DATE`, [tc.tenantId]),
        query(`SELECT COUNT(*) as c FROM call_records WHERE tenant_id = $1 AND started_at >= CURRENT_DATE AND disposition = 'missed'`, [tc.tenantId]),
        query(`SELECT COALESCE(AVG(total_duration_seconds), 0) as avg FROM call_records WHERE tenant_id = $1 AND started_at >= CURRENT_DATE AND disposition = 'answered'`, [tc.tenantId]),
      ]);

      return {
        totalExtensions: parseInt(extensionCount.rows[0]?.c || "0"),
        activeExtensions: parseInt(activeExtensions.rows[0]?.c || "0"),
        phoneNumbers: parseInt(phoneNumberCount.rows[0]?.c || "0"),
        callsToday: parseInt(callsToday.rows[0]?.c || "0"),
        missedCallsToday: parseInt(missedToday.rows[0]?.c || "0"),
        avgCallDuration: Math.round(parseFloat(avgDuration.rows[0]?.avg || "0")),
      };
    }),

    /** Recent calls for dashboard */
    recentCalls: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(50).default(10) }).optional())
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        const result = await query(
          `SELECT * FROM call_records WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT $2`,
          [tc.tenantId, input?.limit || 10]
        );
        return result.rows;
      }),

    /** Call analytics with hourly distribution, top callers, etc. */
    analytics: protectedProcedure
      .input(z.object({
        period: z.enum(["today", "week", "month"]).default("today"),
      }).optional())
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        return getCallStats(tc.tenantId, input?.period || "today");
      }),
  }),

  // ========================================================================
  // VOICEMAIL
  // ========================================================================
  voicemail: router({
    /** List voicemail messages */
    list: protectedProcedure
      .input(z.object({
        extension: z.string().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        return getVoicemails(tc.tenantId, input?.extension);
      }),

    /** Mark voicemail as read */
    markRead: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        await query(
          `UPDATE voicemail_messages SET status = 'read', read_at = NOW() 
           WHERE id = $1 AND tenant_id = $2 AND status = 'new'`,
          [input.id, tc.tenantId]
        );
        return { success: true };
      }),

    /** Delete voicemail */
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        await query(
          `UPDATE voicemail_messages SET status = 'deleted' 
           WHERE id = $1 AND tenant_id = $2`,
          [input.id, tc.tenantId]
        );
        return { success: true };
      }),

    /** Get voicemail count (new/total) */
    count: protectedProcedure
      .input(z.object({ extension: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const tc = await getTenantCtx(ctx);
        const conditions = ["tenant_id = $1", "status != 'deleted'"];
        const vals: any[] = [tc.tenantId];
        if (input?.extension) {
          conditions.push("extension_number = $2");
          vals.push(input.extension);
        }
        const result = await query(
          `SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'new') as unread
           FROM voicemail_messages
           WHERE ${conditions.join(" AND ")}`,
          vals
        );
        return {
          total: parseInt(result.rows[0]?.total || "0"),
          unread: parseInt(result.rows[0]?.unread || "0"),
        };
      }),
  }),
});
