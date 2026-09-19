/**
 * IVR, Ring Group, and Call Queue Router
 * Phone11 Cloud PBX — Milestone 7
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { query, withTransaction } from "./db";
import { writeAuditLog } from "./audit";
import { invalidateCache } from "./redis";
import { hasRole, resolveTenantContext } from "./tenant-middleware";

type TenantResourceTable = "ivr_menus" | "ring_groups" | "call_queues" | "time_conditions";

async function requireTenantAdmin(ctx: any, requestedTenantId?: number) {
  const tenant = await resolveTenantContext(ctx.user.id, requestedTenantId);
  if (!hasRole(tenant.role, "admin")) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return tenant;
}

async function requireTenantResource(table: TenantResourceTable, id: number, tenantId: number) {
  const result = await query(`SELECT id FROM ${table} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!result.rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
}

async function requireTenantExtensions(extensionIds: number[], tenantId: number) {
  const uniqueIds = [...new Set(extensionIds)];
  if (uniqueIds.length === 0) return;
  const result = await query(
    `SELECT id FROM extensions WHERE tenant_id = $1 AND id = ANY($2::bigint[]) AND status = 'active' AND deleted_at IS NULL`,
    [tenantId, uniqueIds],
  );
  if (result.rows.length !== uniqueIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Every extension must belong to the selected workspace" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// IVR Menus
// ═══════════════════════════════════════════════════════════════════════════════

const ivrMenuInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  greeting_file: z.string().optional(),
  greeting_tts: z.string().optional(),
  timeout_ms: z.number().min(1000).max(30000).default(5000),
  max_retries: z.number().min(1).max(10).default(3),
  digit_timeout_ms: z.number().min(1000).max(10000).default(3000),
  invalid_sound: z.string().optional(),
  exit_action: z.enum(["hangup", "transfer", "voicemail"]).default("hangup"),
  exit_target: z.string().optional(),
  is_active: z.boolean().default(true),
});

const ivrActionInput = z.object({
  digit: z.string().regex(/^[0-9*#]{1,5}$/, "Use 1 to 5 DTMF digits (0-9, * or #)"),
  action_type: z.enum([
    "transfer_ext", "transfer_queue", "transfer_ringgroup",
    "sub_menu", "voicemail", "hangup", "repeat", "dial_by_name",
  ]),
  target: z.string().max(100).optional(),
  description: z.string().max(240).optional(),
  sort_order: z.number().int().min(0).max(10000).default(0),
});

type IvrAction = z.infer<typeof ivrActionInput>;

function invalidIvrAction(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

/**
 * Validate every action against the selected tenant before replacing the menu.
 * The dialplan consumes these values directly, so a menu-scoped authorization
 * check alone is insufficient for extension, queue, ring-group, and submenu
 * destinations.
 */
async function requireIvrActionTargets(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  tenantId: number,
  actions: IvrAction[],
) {
  const digits = new Set<string>();
  for (const action of actions) {
    if (digits.has(action.digit)) invalidIvrAction(`Duplicate IVR digit: ${action.digit}`);
    digits.add(action.digit);

    const target = action.target?.trim();
    const requiresTarget = [
      "transfer_ext",
      "transfer_queue",
      "transfer_ringgroup",
      "sub_menu",
      "voicemail",
    ].includes(action.action_type);
    if (requiresTarget && !target) {
      invalidIvrAction(`A destination is required for ${action.action_type}`);
    }
    if (!requiresTarget && target) {
      invalidIvrAction(`${action.action_type} does not accept a destination`);
    }
    if (!target) continue;

    let result: { rows: unknown[] };
    if (action.action_type === "transfer_ext" || action.action_type === "voicemail") {
      if (!/^\d{2,10}$/.test(target)) {
        invalidIvrAction(`The ${action.action_type} destination must be a valid extension`);
      }
      result = await client.query(
        `SELECT 1 FROM extensions
         WHERE tenant_id = $1 AND extension_number = $2
           AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
        [tenantId, target],
      );
    } else if (action.action_type === "transfer_queue") {
      if (!/^\d{2,10}$/.test(target)) invalidIvrAction("The queue destination must be a valid queue extension");
      result = await client.query(
        `SELECT 1 FROM call_queues
         WHERE tenant_id = $1 AND extension = $2 AND is_active = true LIMIT 1`,
        [tenantId, target],
      );
    } else if (action.action_type === "transfer_ringgroup") {
      if (!/^\d{2,10}$/.test(target)) invalidIvrAction("The ring-group destination must be a valid extension");
      result = await client.query(
        `SELECT 1 FROM ring_groups
         WHERE tenant_id = $1 AND extension = $2 AND is_active = true LIMIT 1`,
        [tenantId, target],
      );
    } else if (action.action_type === "sub_menu") {
      if (!/^\d+$/.test(target) || !Number.isSafeInteger(Number(target)) || Number(target) < 1) {
        invalidIvrAction("The submenu destination is invalid");
      }
      result = await client.query(
        `SELECT 1 FROM ivr_menus
         WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [Number(target), tenantId],
      );
    } else {
      continue;
    }
    if (result.rows.length !== 1) {
      invalidIvrAction(`The ${action.action_type} destination is unavailable in this workspace`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Ring Groups
// ═══════════════════════════════════════════════════════════════════════════════

const ringGroupInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  extension: z.string().trim().max(32).nullable().optional(),
  strategy: z.enum(["simultaneous", "sequential"]).default("simultaneous"),
  ring_timeout: z.number().min(5).max(120).default(25),
  caller_id_mode: z.enum(["caller", "group", "fixed"]).default("caller"),
  caller_id_name: z.string().optional(),
  caller_id_number: z.string().optional(),
  skip_busy: z.boolean().default(true),
  skip_offline: z.boolean().default(true),
  enable_pickup: z.boolean().default(true),
  fallback_action: z.enum(["voicemail", "transfer", "ivr", "hangup"]).default("hangup"),
  fallback_target: z.string().trim().max(100).optional(),
  moh_file: z.string().optional(),
  is_active: z.boolean().default(true),
});

async function requireRingGroupFallbackTarget(
  action: "voicemail" | "transfer" | "ivr" | "hangup",
  target: string | undefined,
  tenantId: number,
) {
  if (action === "hangup") {
    if (target) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Hangup fallback cannot have a destination" });
    }
    return;
  }
  if (!target) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `A destination is required for ${action} fallback` });
  }
  if (action === "transfer" || action === "voicemail") {
    if (!/^\d{2,10}$/.test(target)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Fallback destination must be a valid workspace extension" });
    }
    const result = await query(
      `SELECT 1 FROM extensions e
       JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = e.tenant_id
         AND sa.status = 'active' AND sa.deleted_at IS NULL AND sa.user_id IS NOT NULL
       WHERE e.tenant_id = $1 AND e.extension_number = $2 AND e.status = 'active' AND e.deleted_at IS NULL
         AND e.type = 'user' AND e.user_id IS NOT NULL${action === "voicemail" ? " AND e.voicemail_enabled = true" : ""} LIMIT 1`,
      [tenantId, target],
    );
    if (result.rows.length !== 1) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Fallback destination is unavailable in this workspace" });
    }
    return;
  }
  if (!/^\d+$/.test(target) || !Number.isSafeInteger(Number(target)) || Number(target) < 1) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Fallback IVR menu is invalid" });
  }
  const result = await query(
    `SELECT 1 FROM ivr_menus WHERE id = $1 AND tenant_id = $2 AND is_active = true LIMIT 1`,
    [Number(target), tenantId],
  );
  if (result.rows.length !== 1) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Fallback IVR menu is unavailable in this workspace" });
  }
}

async function requireTenantCallableRingGroupExtensions(extensionIds: number[], tenantId: number) {
  const uniqueIds = [...new Set(extensionIds)];
  if (uniqueIds.length === 0) return;
  const result = await query(
    `SELECT DISTINCT e.id FROM extensions e
     JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = e.tenant_id
       AND sa.status = 'active' AND sa.deleted_at IS NULL AND sa.user_id IS NOT NULL
     WHERE e.tenant_id = $1 AND e.id = ANY($2::bigint[]) AND e.status = 'active' AND e.deleted_at IS NULL
       AND e.type = 'user' AND e.user_id IS NOT NULL`,
    [tenantId, uniqueIds],
  );
  if (result.rows.length !== uniqueIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Every ring-group member must be an active, callable workspace extension" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Call Queues
// ═══════════════════════════════════════════════════════════════════════════════

const callQueueInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(240).optional(),
  extension: z.string().trim().regex(/^\d{2,10}$/, "Queue extension must be 2 to 10 digits").nullable().optional(),
  strategy: z.literal("ring_all").default("ring_all"),
  max_wait_time: z.number().int().min(10).max(3600).default(300),
  max_callers: z.number().min(1).max(100).default(20),
  wrap_up_time: z.number().min(0).max(120).default(10),
  announce_position: z.boolean().default(true),
  announce_frequency: z.number().min(10).max(300).default(30),
  moh_file: z.string().optional(),
  join_announcement: z.string().optional(),
  agent_announcement: z.string().optional(),
  overflow_action: z.enum(["voicemail", "transfer", "ivr", "hangup", "callback"]).default("hangup"),
  overflow_target: z.string().trim().max(100).optional(),
  service_level_secs: z.number().min(5).max(120).default(20),
  record_calls: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

async function requireQueueOverflowTarget(
  action: "voicemail" | "transfer" | "ivr" | "hangup" | "callback",
  target: string | undefined,
  tenantId: number,
) {
  if (action === "callback") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Callback overflow is unsupported by the current FIFO runtime; choose hangup, voicemail, transfer, or ivr" });
  }
  if (action === "hangup") {
    if (target) throw new TRPCError({ code: "BAD_REQUEST", message: "Hangup overflow cannot have a destination" });
    return;
  }
  if (!target) throw new TRPCError({ code: "BAD_REQUEST", message: `A destination is required for ${action} overflow` });
  if (action === "voicemail" || action === "transfer") {
    if (!/^\d{2,10}$/.test(target)) throw new TRPCError({ code: "BAD_REQUEST", message: "Overflow destination must be an active workspace extension" });
    const result = await query(
      `SELECT 1 FROM extensions e
       JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = e.tenant_id
         AND sa.status = 'active' AND sa.deleted_at IS NULL AND sa.user_id IS NOT NULL
       WHERE e.tenant_id = $1 AND e.extension_number = $2 AND e.status = 'active' AND e.deleted_at IS NULL
         AND e.type = 'user' AND e.user_id IS NOT NULL${action === "voicemail" ? " AND e.voicemail_enabled = true" : ""} LIMIT 1`,
      [tenantId, target],
    );
    if (result.rows.length !== 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Overflow destination is unavailable in this workspace" });
    return;
  }
  if (!/^\d+$/.test(target) || !Number.isSafeInteger(Number(target)) || Number(target) < 1) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Overflow IVR menu is invalid" });
  }
  const result = await query(
    `SELECT 1 FROM ivr_menus WHERE id = $1 AND tenant_id = $2 AND is_active = true LIMIT 1`,
    [Number(target), tenantId],
  );
  if (result.rows.length !== 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Overflow IVR menu is unavailable in this workspace" });
}

const timeConditionAction = z.enum(["voicemail", "transfer", "ivr", "hangup"]);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const timeConditionRuleInput = z.object({
  day_of_week: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  start_time: z.string().regex(timePattern, "Use a 24-hour time such as 09:00").optional(),
  end_time: z.string().regex(timePattern, "Use a 24-hour time such as 18:00").optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  is_holiday: z.boolean().default(false),
  label: z.string().trim().max(240).optional(),
  sort_order: z.number().int().min(0).max(10000).default(0),
}).superRefine((rule, ctx) => {
  if (Boolean(rule.start_time) !== Boolean(rule.end_time)) {
    ctx.addIssue({ code: "custom", message: "Opening and closing times must be provided together" });
  }
  if (rule.start_time && rule.end_time && rule.start_time >= rule.end_time) {
    ctx.addIssue({ code: "custom", message: "Closing time must be later than opening time" });
  }
  if (Boolean(rule.start_date) !== Boolean(rule.end_date)) {
    ctx.addIssue({ code: "custom", message: "Start and end dates must be provided together" });
  }
  if (rule.start_date && rule.end_date && rule.start_date > rule.end_date) {
    ctx.addIssue({ code: "custom", message: "End date must not be before start date" });
  }
  if (rule.day_of_week && new Set(rule.day_of_week).size !== rule.day_of_week.length) {
    ctx.addIssue({ code: "custom", message: "Each weekday can appear only once per rule" });
  }
});

const timeConditionInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(240).optional(),
  timezone: z.string().trim().min(1).max(100).default("Asia/Bangkok"),
  match_action: timeConditionAction.default("transfer"),
  match_target: z.string().trim().max(100).optional(),
  nomatch_action: timeConditionAction.default("voicemail"),
  nomatch_target: z.string().trim().max(100).optional(),
});

type TimeConditionAction = z.infer<typeof timeConditionAction>;

function requireSupportedTimezone(timezone: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Timezone is not recognized" });
  }
}

async function requireTimeConditionRoute(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  action: TimeConditionAction,
  target: string | undefined,
  tenantId: number,
) {
  if (action === "hangup") {
    if (target) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Hangup routing cannot have a destination" });
    }
    return;
  }
  if (!target) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `A destination is required for ${action} routing` });
  }
  if (action === "transfer" || action === "voicemail") {
    if (!/^\d{2,10}$/.test(target)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Routing destination must be an active workspace extension" });
    }
    const result = await client.query(
      `SELECT 1 FROM extensions e
       JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = e.tenant_id
         AND sa.status = 'active' AND sa.deleted_at IS NULL AND sa.user_id IS NOT NULL
       WHERE e.tenant_id = $1 AND e.extension_number = $2 AND e.status = 'active' AND e.deleted_at IS NULL
         AND e.type = 'user' AND e.user_id IS NOT NULL${action === "voicemail" ? " AND e.voicemail_enabled = true" : ""} LIMIT 1`,
      [tenantId, target],
    );
    if (result.rows.length !== 1) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Routing destination is unavailable in this workspace" });
    }
    return;
  }
  if (!/^\d+$/.test(target) || !Number.isSafeInteger(Number(target)) || Number(target) < 1) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "IVR destination is invalid" });
  }
  const result = await client.query(
    `SELECT 1 FROM ivr_menus WHERE id = $1 AND tenant_id = $2 AND is_active = true LIMIT 1`,
    [Number(target), tenantId],
  );
  if (result.rows.length !== 1) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "IVR destination is unavailable in this workspace" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════════

export const ivrRouter = router({
  // ─── IVR Menus ─────────────────────────────────────────────────────────────
  ivr: router({
    list: protectedProcedure
      .input(z.object({ tenant_id: z.number() }))
      .query(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx, input.tenant_id);
        const res = await query(
          `SELECT m.*, 
            (SELECT count(*) FROM ivr_actions WHERE menu_id = m.id) as action_count
           FROM ivr_menus m WHERE m.tenant_id = $1 ORDER BY m.name`,
          [tenant.tenantId]
        );
        return res.rows;
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        const menu = await query(`SELECT * FROM ivr_menus WHERE id = $1 AND tenant_id = $2`, [input.id, tenant.tenantId]);
        if (!menu.rows[0]) throw new Error("IVR menu not found");
        const actions = await query(
          `SELECT * FROM ivr_actions WHERE menu_id = $1 ORDER BY sort_order, digit`,
          [input.id]
        );
        return { ...menu.rows[0], actions: actions.rows };
      }),

    create: protectedProcedure
      .input(z.object({ tenant_id: z.number() }).merge(ivrMenuInput))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx, input.tenant_id);
        const { tenant_id: _tenantId, ...data } = input;
        const res = await query(
          `INSERT INTO ivr_menus (tenant_id, name, description, greeting_file, greeting_tts, timeout_ms, max_retries, digit_timeout_ms, invalid_sound, exit_action, exit_target, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
          [tenant.tenantId, data.name, data.description, data.greeting_file, data.greeting_tts, data.timeout_ms, data.max_retries, data.digit_timeout_ms, data.invalid_sound, data.exit_action, data.exit_target, data.is_active]
        );
        await writeAuditLog({ tenantId: tenant.tenantId, actorUserId: ctx.user.id, action: "ivr_menu.created", resourceType: "ivr_menu", resourceId: String(res.rows[0].id), newValue: { name: data.name }, ipAddress: ctx.req.ip });
        await invalidateCache(`dialplan:ivr:${res.rows[0].id}`);
        return res.rows[0];
      }),

    update: protectedProcedure
      .input(z.object({ id: z.number() }).merge(ivrMenuInput.partial()))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        await requireTenantResource("ivr_menus", input.id, tenant.tenantId);
        const { id, ...data } = input;
        const sets = Object.entries(data)
          .filter(([_, v]) => v !== undefined)
          .map(([k], i) => `${k} = $${i + 2}`);
        if (sets.length === 0) return;
        const values = Object.values(data).filter(v => v !== undefined);
        sets.push(`updated_at = now()`);
        const res = await query(
          `UPDATE ivr_menus SET ${sets.join(", ")} WHERE id = $1 AND tenant_id = $${values.length + 2} RETURNING *`,
          [id, ...values, tenant.tenantId]
        );
        await invalidateCache(`ivr:menu:${id}`);
        await invalidateCache(`dialplan:ivr:${id}`);
        return res.rows[0];
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        await requireTenantResource("ivr_menus", input.id, tenant.tenantId);
        await query(`DELETE FROM ivr_menus WHERE id = $1 AND tenant_id = $2`, [input.id, tenant.tenantId]);
        await invalidateCache(`ivr:menu:${input.id}`);
        await invalidateCache(`dialplan:ivr:${input.id}`);
        return { ok: true };
      }),

    // IVR Actions (digits)
    setActions: protectedProcedure
      .input(z.object({
        menu_id: z.number(),
        actions: z.array(ivrActionInput),
      }))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        await requireTenantResource("ivr_menus", input.menu_id, tenant.tenantId);
        const normalizedActions = input.actions.map((action) => ({
          ...action,
          target: action.target?.trim() || undefined,
          description: action.description?.trim() || undefined,
        }));
        await withTransaction(async (client) => {
          await requireIvrActionTargets(client, tenant.tenantId, normalizedActions);
          await client.query(`DELETE FROM ivr_actions WHERE menu_id = $1`, [input.menu_id]);
          for (const action of normalizedActions) {
            await client.query(
              `INSERT INTO ivr_actions (menu_id, digit, action_type, target, description, sort_order)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [input.menu_id, action.digit, action.action_type, action.target, action.description, action.sort_order]
            );
          }
        });
        await invalidateCache(`ivr:menu:${input.menu_id}`);
        await invalidateCache(`dialplan:ivr:${input.menu_id}`);
        return { ok: true, count: input.actions.length };
      }),
  }),

  // ─── Ring Groups ───────────────────────────────────────────────────────────
  ringGroups: router({
    list: protectedProcedure
      .input(z.object({ tenant_id: z.number() }))
      .query(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx, input.tenant_id);
        const res = await query(
          `SELECT rg.*, 
            (SELECT count(*) FROM ring_group_members rgm
             JOIN extensions e ON e.id = rgm.extension_id AND e.tenant_id = rg.tenant_id
               AND e.status = 'active' AND e.deleted_at IS NULL AND e.type = 'user' AND e.user_id IS NOT NULL
             JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = rg.tenant_id
               AND sa.status = 'active' AND sa.deleted_at IS NULL AND sa.user_id IS NOT NULL
             WHERE rgm.ring_group_id = rg.id AND rgm.is_active = true) as member_count
           FROM ring_groups rg WHERE rg.tenant_id = $1 ORDER BY rg.name`,
          [tenant.tenantId]
        );
        return res.rows;
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        const group = await query(`SELECT * FROM ring_groups WHERE id = $1 AND tenant_id = $2`, [input.id, tenant.tenantId]);
        if (!group.rows[0]) throw new Error("Ring group not found");
        const members = await query(
          `SELECT rgm.*, e.extension_number, e.display_name, e.first_name, e.last_name
           FROM ring_group_members rgm
           JOIN extensions e ON e.id = rgm.extension_id AND e.tenant_id = $2
             AND e.status = 'active' AND e.deleted_at IS NULL AND e.type = 'user' AND e.user_id IS NOT NULL
           JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = e.tenant_id
             AND sa.status = 'active' AND sa.deleted_at IS NULL AND sa.user_id IS NOT NULL
           WHERE rgm.ring_group_id = $1 ORDER BY rgm.priority`,
          [input.id, tenant.tenantId]
        );
        return { ...group.rows[0], members: members.rows };
      }),

    create: protectedProcedure
      .input(z.object({ tenant_id: z.number() }).merge(ringGroupInput))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx, input.tenant_id);
        const { tenant_id: _tenantId, ...data } = input;
        await requireRingGroupFallbackTarget(data.fallback_action, data.fallback_target, tenant.tenantId);
        const res = await query(
          `INSERT INTO ring_groups (tenant_id, name, description, extension, strategy, ring_timeout, caller_id_mode, caller_id_name, caller_id_number, skip_busy, skip_offline, enable_pickup, fallback_action, fallback_target, moh_file, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
          [tenant.tenantId, data.name, data.description, data.extension, data.strategy, data.ring_timeout, data.caller_id_mode, data.caller_id_name, data.caller_id_number, data.skip_busy, data.skip_offline, data.enable_pickup, data.fallback_action, data.fallback_action === "hangup" ? null : data.fallback_target, data.moh_file, data.is_active]
        );
        await writeAuditLog({ tenantId: tenant.tenantId, actorUserId: ctx.user.id, action: "ring_group.created", resourceType: "ring_group", resourceId: String(res.rows[0].id), newValue: { name: data.name }, ipAddress: ctx.req.ip });
        await invalidateCache(`dialplan:ringgroup:${tenant.tenantId}:${res.rows[0].id}`);
        return res.rows[0];
      }),

    update: protectedProcedure
      .input(z.object({ id: z.number() }).merge(ringGroupInput.partial()))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        await requireTenantResource("ring_groups", input.id, tenant.tenantId);
        const { id, ...inputData } = input;
        const data: Record<string, unknown> = { ...inputData };
        const current = await query(
          `SELECT fallback_action, fallback_target FROM ring_groups WHERE id = $1 AND tenant_id = $2`,
          [id, tenant.tenantId],
        );
        const fallbackAction = (data.fallback_action ?? current.rows[0]?.fallback_action) as "voicemail" | "transfer" | "ivr" | "hangup";
        const fallbackTarget = fallbackAction === "hangup"
          ? undefined
          : (data.fallback_target ?? current.rows[0]?.fallback_target) as string | undefined;
        await requireRingGroupFallbackTarget(fallbackAction, fallbackTarget, tenant.tenantId);
        if (fallbackAction === "hangup") data.fallback_target = null;
        const sets = Object.entries(data)
          .filter(([_, v]) => v !== undefined)
          .map(([k], i) => `${k} = $${i + 2}`);
        if (sets.length === 0) return;
        const values = Object.values(data).filter(v => v !== undefined);
        sets.push(`updated_at = now()`);
        const res = await query(
          `UPDATE ring_groups SET ${sets.join(", ")} WHERE id = $1 AND tenant_id = $${values.length + 2} RETURNING *`,
          [id, ...values, tenant.tenantId]
        );
        await invalidateCache(`ringgroup:${id}`);
        await invalidateCache(`dialplan:ringgroup:${tenant.tenantId}:${id}`);
        return res.rows[0];
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        await requireTenantResource("ring_groups", input.id, tenant.tenantId);
        await query(`DELETE FROM ring_groups WHERE id = $1 AND tenant_id = $2`, [input.id, tenant.tenantId]);
        await invalidateCache(`ringgroup:${input.id}`);
        await invalidateCache(`dialplan:ringgroup:${tenant.tenantId}:${input.id}`);
        return { ok: true };
      }),

    setMembers: protectedProcedure
      .input(z.object({
        ring_group_id: z.number(),
        members: z.array(z.object({
          extension_id: z.number().int().positive(),
          priority: z.number().int().min(1).max(10000).default(1),
          delay_seconds: z.number().int().min(0).max(120).default(0),
          is_active: z.boolean().default(true),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        await requireTenantResource("ring_groups", input.ring_group_id, tenant.tenantId);
        const extensionIds = input.members.map((member) => member.extension_id);
        if (new Set(extensionIds).size !== extensionIds.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "An extension can appear only once in a ring group" });
        }
        await requireTenantCallableRingGroupExtensions(extensionIds, tenant.tenantId);
        await withTransaction(async (client) => {
          await client.query(`DELETE FROM ring_group_members WHERE ring_group_id = $1`, [input.ring_group_id]);
          for (const member of input.members) {
            await client.query(
              `INSERT INTO ring_group_members (ring_group_id, extension_id, priority, delay_seconds, is_active)
               VALUES ($1, $2, $3, $4, $5)`,
              [input.ring_group_id, member.extension_id, member.priority, member.delay_seconds, member.is_active]
            );
          }
        });
        await invalidateCache(`ringgroup:${input.ring_group_id}`);
        await invalidateCache(`dialplan:ringgroup:${tenant.tenantId}:${input.ring_group_id}`);
        return { ok: true, count: input.members.length };
      }),
  }),

  // ─── Call Queues ───────────────────────────────────────────────────────────
  queues: router({
    list: protectedProcedure
      .input(z.object({ tenant_id: z.number() }))
      .query(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx, input.tenant_id);
        const res = await query(
          `SELECT q.*, 
            (SELECT count(*) FROM queue_agents qa
             JOIN extensions e ON e.id = qa.extension_id AND e.tenant_id = q.tenant_id
               AND e.status = 'active' AND e.deleted_at IS NULL AND e.type = 'user' AND e.user_id IS NOT NULL
             JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = q.tenant_id
               AND sa.status = 'active' AND sa.deleted_at IS NULL AND sa.user_id IS NOT NULL
             WHERE qa.queue_id = q.id AND qa.is_logged_in = true) as agents_online,
            (SELECT count(*) FROM queue_agents qa
             JOIN extensions e ON e.id = qa.extension_id AND e.tenant_id = q.tenant_id
               AND e.status = 'active' AND e.deleted_at IS NULL AND e.type = 'user' AND e.user_id IS NOT NULL
             JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = q.tenant_id
               AND sa.status = 'active' AND sa.deleted_at IS NULL AND sa.user_id IS NOT NULL
             WHERE qa.queue_id = q.id) as total_agents
           FROM call_queues q WHERE q.tenant_id = $1 ORDER BY q.name`,
          [tenant.tenantId]
        );
        return res.rows;
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        const queue = await query(`SELECT * FROM call_queues WHERE id = $1 AND tenant_id = $2`, [input.id, tenant.tenantId]);
        if (!queue.rows[0]) throw new Error("Queue not found");
        const agents = await query(
          `SELECT qa.*, e.extension_number, e.display_name
           FROM queue_agents qa
           JOIN extensions e ON e.id = qa.extension_id
             AND e.tenant_id = $2 AND e.status = 'active' AND e.deleted_at IS NULL
             AND e.type = 'user' AND e.user_id IS NOT NULL
           JOIN sip_accounts sa ON sa.extension_id = e.id AND sa.tenant_id = $2
             AND sa.status = 'active' AND sa.deleted_at IS NULL AND sa.user_id IS NOT NULL
           WHERE qa.queue_id = $1 ORDER BY qa.priority`,
          [input.id, tenant.tenantId]
        );
        return { ...queue.rows[0], agents: agents.rows };
      }),

    create: protectedProcedure
      .input(z.object({ tenant_id: z.number() }).merge(callQueueInput))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx, input.tenant_id);
        const { tenant_id: _tenantId, ...data } = input;
        await requireQueueOverflowTarget(data.overflow_action, data.overflow_target, tenant.tenantId);
        const res = await query(
          `INSERT INTO call_queues (tenant_id, name, description, extension, strategy, max_wait_time, max_callers, wrap_up_time, announce_position, announce_frequency, moh_file, join_announcement, agent_announcement, overflow_action, overflow_target, service_level_secs, record_calls, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
          [tenant.tenantId, data.name, data.description, data.extension, data.strategy, data.max_wait_time, data.max_callers, data.wrap_up_time, data.announce_position, data.announce_frequency, data.moh_file, data.join_announcement, data.agent_announcement, data.overflow_action, data.overflow_target, data.service_level_secs, data.record_calls, data.is_active]
        );
        await writeAuditLog({ tenantId: tenant.tenantId, actorUserId: ctx.user.id, action: "queue.created", resourceType: "call_queue", resourceId: String(res.rows[0].id), newValue: { name: data.name }, ipAddress: ctx.req.ip });
        await invalidateCache(`dialplan:queue:${tenant.tenantId}:${res.rows[0].id}`);
        return res.rows[0];
      }),

    update: protectedProcedure
      .input(z.object({ id: z.number() }).merge(callQueueInput.partial()))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        await requireTenantResource("call_queues", input.id, tenant.tenantId);
        const { id, ...inputData } = input;
        const current = await query(`SELECT overflow_action, overflow_target FROM call_queues WHERE id = $1 AND tenant_id = $2`, [id, tenant.tenantId]);
        const data: Record<string, unknown> = { ...inputData };
        const overflowAction = (data.overflow_action ?? current.rows[0]?.overflow_action) as any;
        const overflowTarget = overflowAction === "hangup" ? undefined : (data.overflow_target ?? current.rows[0]?.overflow_target) as string | undefined;
        await requireQueueOverflowTarget(overflowAction, overflowTarget, tenant.tenantId);
        if (overflowAction === "hangup") data.overflow_target = null;
        const sets = Object.entries(data)
          .filter(([_, v]) => v !== undefined)
          .map(([k], i) => `${k} = $${i + 2}`);
        if (sets.length === 0) return;
        const values = Object.values(data).filter(v => v !== undefined);
        sets.push(`updated_at = now()`);
        const res = await query(
          `UPDATE call_queues SET ${sets.join(", ")} WHERE id = $1 AND tenant_id = $${values.length + 2} RETURNING *`,
          [id, ...values, tenant.tenantId]
        );
        await invalidateCache(`queue:${id}`);
        await invalidateCache(`dialplan:queue:${tenant.tenantId}:${id}`);
        return res.rows[0];
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        await requireTenantResource("call_queues", input.id, tenant.tenantId);
        await query(`DELETE FROM call_queues WHERE id = $1 AND tenant_id = $2`, [input.id, tenant.tenantId]);
        await invalidateCache(`queue:${input.id}`);
        await invalidateCache(`dialplan:queue:${tenant.tenantId}:${input.id}`);
        return { ok: true };
      }),

    // Agent management
    setAgents: protectedProcedure
      .input(z.object({
        queue_id: z.number().int().positive(),
        agents: z.array(z.object({
          extension_id: z.number().int().positive(),
          priority: z.number().int().min(1).max(10000).default(1),
          skills: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
          max_no_answer: z.number().int().min(0).max(100).default(3),
          is_logged_in: z.boolean().default(false),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        await requireTenantResource("call_queues", input.queue_id, tenant.tenantId);
        const extensionIds = input.agents.map((agent) => agent.extension_id);
        if (new Set(extensionIds).size !== extensionIds.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "An extension can appear only once in a queue" });
        }
        await requireTenantExtensions(extensionIds, tenant.tenantId);
        await withTransaction(async (client) => {
          await client.query(`DELETE FROM queue_agents WHERE queue_id = $1`, [input.queue_id]);
          for (const agent of input.agents) {
            await client.query(
              `INSERT INTO queue_agents (queue_id, extension_id, priority, skills, max_no_answer, is_logged_in)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [input.queue_id, agent.extension_id, agent.priority, JSON.stringify(agent.skills), agent.max_no_answer, agent.is_logged_in]
            );
          }
        });
        await invalidateCache(`queue:${input.queue_id}`);
        await invalidateCache(`dialplan:queue:${tenant.tenantId}:${input.queue_id}`);
        return { ok: true, count: input.agents.length };
      }),

    agentLogin: protectedProcedure
      .input(z.object({ queue_id: z.number(), extension_id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        await requireTenantResource("call_queues", input.queue_id, tenant.tenantId);
        await requireTenantExtensions([input.extension_id], tenant.tenantId);
        await query(
          `UPDATE queue_agents SET is_logged_in = true WHERE queue_id = $1 AND extension_id = $2`,
          [input.queue_id, input.extension_id]
        );
        await invalidateCache(`dialplan:queue:${tenant.tenantId}:${input.queue_id}`);
        return { ok: true };
      }),

    agentLogout: protectedProcedure
      .input(z.object({ queue_id: z.number(), extension_id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        await requireTenantResource("call_queues", input.queue_id, tenant.tenantId);
        await requireTenantExtensions([input.extension_id], tenant.tenantId);
        await query(
          `UPDATE queue_agents SET is_logged_in = false WHERE queue_id = $1 AND extension_id = $2`,
          [input.queue_id, input.extension_id]
        );
        await invalidateCache(`dialplan:queue:${tenant.tenantId}:${input.queue_id}`);
        return { ok: true };
      }),

    stats: protectedProcedure
      .input(z.object({ queue_id: z.number(), hours: z.number().default(24) }))
      .query(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        await requireTenantResource("call_queues", input.queue_id, tenant.tenantId);
        const res = await query(
          `SELECT * FROM queue_stats 
           WHERE queue_id = $1 AND interval_start >= now() - interval '1 hour' * $2
           ORDER BY interval_start DESC`,
          [input.queue_id, input.hours]
        );
        return res.rows;
      }),
  }),

  // ─── Time Conditions ───────────────────────────────────────────────────────
  timeConditions: router({
    list: protectedProcedure
      .input(z.object({ tenant_id: z.number() }))
      .query(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx, input.tenant_id);
        const res = await query(
          `SELECT tc.*, 
            (SELECT count(*) FROM time_condition_rules WHERE time_condition_id = tc.id) as rule_count
           FROM time_conditions tc WHERE tc.tenant_id = $1 ORDER BY tc.name`,
          [tenant.tenantId]
        );
        return res.rows;
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        const tc = await query(`SELECT * FROM time_conditions WHERE id = $1 AND tenant_id = $2`, [input.id, tenant.tenantId]);
        if (!tc.rows[0]) throw new Error("Time condition not found");
        const rules = await query(
          `SELECT * FROM time_condition_rules WHERE time_condition_id = $1 ORDER BY sort_order`,
          [input.id]
        );
        return { ...tc.rows[0], rules: rules.rows };
      }),

    create: protectedProcedure
      .input(z.object({ tenant_id: z.number().int().positive() }).merge(timeConditionInput))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx, input.tenant_id);
        requireSupportedTimezone(input.timezone);
        await requireTimeConditionRoute({ query }, input.match_action, input.match_target, tenant.tenantId);
        await requireTimeConditionRoute({ query }, input.nomatch_action, input.nomatch_target, tenant.tenantId);
        const res = await query(
          `INSERT INTO time_conditions (tenant_id, name, description, timezone, match_action, match_target, nomatch_action, nomatch_target)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [
            tenant.tenantId,
            input.name,
            input.description,
            input.timezone,
            input.match_action,
            input.match_action === "hangup" ? null : input.match_target,
            input.nomatch_action,
            input.nomatch_action === "hangup" ? null : input.nomatch_target,
          ]
        );
        await writeAuditLog({ tenantId: tenant.tenantId, actorUserId: ctx.user.id, action: "time_condition.created", resourceType: "time_condition", resourceId: String(res.rows[0].id), newValue: { name: input.name }, ipAddress: ctx.req.ip });
        await invalidateCache(`timecondition:${res.rows[0].id}`);
        await invalidateCache(`dialplan:timecondition:${tenant.tenantId}:${res.rows[0].id}`);
        return res.rows[0];
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        rules: z.array(timeConditionRuleInput).min(1),
      }).merge(timeConditionInput))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        await requireTenantResource("time_conditions", input.id, tenant.tenantId);
        requireSupportedTimezone(input.timezone);
        let updated: any;
        await withTransaction(async (client) => {
          await requireTimeConditionRoute(client, input.match_action, input.match_target, tenant.tenantId);
          await requireTimeConditionRoute(client, input.nomatch_action, input.nomatch_target, tenant.tenantId);
          const result = await client.query(
            `UPDATE time_conditions
             SET name = $2, description = $3, timezone = $4, match_action = $5, match_target = $6,
                 nomatch_action = $7, nomatch_target = $8, updated_at = now()
             WHERE id = $1 AND tenant_id = $9 RETURNING *`,
            [
              input.id,
              input.name,
              input.description,
              input.timezone,
              input.match_action,
              input.match_action === "hangup" ? null : input.match_target,
              input.nomatch_action,
              input.nomatch_action === "hangup" ? null : input.nomatch_target,
              tenant.tenantId,
            ],
          );
          updated = result.rows[0];
          await client.query(`DELETE FROM time_condition_rules WHERE time_condition_id = $1`, [input.id]);
          for (const rule of input.rules) {
            await client.query(
              `INSERT INTO time_condition_rules (time_condition_id, day_of_week, start_time, end_time, start_date, end_date, is_holiday, label, sort_order)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [input.id, rule.day_of_week || null, rule.start_time || null, rule.end_time || null, rule.start_date || null, rule.end_date || null, rule.is_holiday, rule.label, rule.sort_order],
            );
          }
        });
        await writeAuditLog({ tenantId: tenant.tenantId, actorUserId: ctx.user.id, action: "time_condition.updated", resourceType: "time_condition", resourceId: String(input.id), newValue: { name: input.name }, ipAddress: ctx.req.ip });
        await invalidateCache(`timecondition:${input.id}`);
        await invalidateCache(`dialplan:timecondition:${tenant.tenantId}:${input.id}`);
        return updated;
      }),

    setRules: protectedProcedure
      .input(z.object({
        time_condition_id: z.number().int().positive(),
        rules: z.array(timeConditionRuleInput),
      }))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        await requireTenantResource("time_conditions", input.time_condition_id, tenant.tenantId);
        await withTransaction(async (client) => {
          await client.query(`DELETE FROM time_condition_rules WHERE time_condition_id = $1`, [input.time_condition_id]);
          for (const rule of input.rules) {
            await client.query(
              `INSERT INTO time_condition_rules (time_condition_id, day_of_week, start_time, end_time, start_date, end_date, is_holiday, label, sort_order)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [input.time_condition_id, rule.day_of_week || null, rule.start_time || null, rule.end_time || null, rule.start_date || null, rule.end_date || null, rule.is_holiday, rule.label, rule.sort_order]
            );
          }
        });
        await invalidateCache(`timecondition:${input.time_condition_id}`);
        await invalidateCache(`dialplan:timecondition:${tenant.tenantId}:${input.time_condition_id}`);
        return { ok: true, count: input.rules.length };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const tenant = await requireTenantAdmin(ctx);
        await requireTenantResource("time_conditions", input.id, tenant.tenantId);
        await query(`DELETE FROM time_conditions WHERE id = $1 AND tenant_id = $2`, [input.id, tenant.tenantId]);
        await invalidateCache(`timecondition:${input.id}`);
        await invalidateCache(`dialplan:timecondition:${tenant.tenantId}:${input.id}`);
        return { ok: true };
      }),
  }),
});
