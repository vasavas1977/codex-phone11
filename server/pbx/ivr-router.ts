/**
 * IVR, Ring Group, and Call Queue Router
 * Phone11 Cloud PBX — Milestone 7
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { query, withTransaction } from "./db";
import { writeAuditLog } from "./audit";
import { invalidateCache } from "./redis";

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
  digit: z.string().min(1).max(5),
  action_type: z.enum([
    "transfer_ext", "transfer_queue", "transfer_ringgroup",
    "sub_menu", "voicemail", "hangup", "repeat", "dial_by_name",
    "time_condition", "external_number"
  ]),
  target: z.string().optional(),
  description: z.string().optional(),
  sort_order: z.number().default(0),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Ring Groups
// ═══════════════════════════════════════════════════════════════════════════════

const ringGroupInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  extension: z.string().optional(),
  strategy: z.enum(["simultaneous", "sequential", "round_robin", "longest_idle", "random"]).default("simultaneous"),
  ring_timeout: z.number().min(5).max(120).default(25),
  caller_id_mode: z.enum(["caller", "group", "fixed"]).default("caller"),
  caller_id_name: z.string().optional(),
  caller_id_number: z.string().optional(),
  skip_busy: z.boolean().default(true),
  skip_offline: z.boolean().default(true),
  enable_pickup: z.boolean().default(true),
  fallback_action: z.enum(["voicemail", "transfer", "ivr", "hangup"]).default("voicemail"),
  fallback_target: z.string().optional(),
  moh_file: z.string().optional(),
  is_active: z.boolean().default(true),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Call Queues
// ═══════════════════════════════════════════════════════════════════════════════

const callQueueInput = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  extension: z.string().optional(),
  strategy: z.enum(["longest_idle", "round_robin", "ring_all", "fewest_calls", "random", "top_down"]).default("longest_idle"),
  max_wait_time: z.number().min(10).max(3600).default(300),
  max_callers: z.number().min(1).max(100).default(20),
  wrap_up_time: z.number().min(0).max(120).default(10),
  announce_position: z.boolean().default(true),
  announce_frequency: z.number().min(10).max(300).default(30),
  moh_file: z.string().optional(),
  join_announcement: z.string().optional(),
  agent_announcement: z.string().optional(),
  overflow_action: z.enum(["voicemail", "transfer", "ivr", "hangup", "callback"]).default("voicemail"),
  overflow_target: z.string().optional(),
  service_level_secs: z.number().min(5).max(120).default(20),
  record_calls: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════════════════════

export const ivrRouter = router({
  // ─── IVR Menus ─────────────────────────────────────────────────────────────
  ivr: router({
    list: protectedProcedure
      .input(z.object({ tenant_id: z.number() }))
      .query(async ({ input }) => {
        const res = await query(
          `SELECT m.*, 
            (SELECT count(*) FROM ivr_actions WHERE menu_id = m.id) as action_count
           FROM ivr_menus m WHERE m.tenant_id = $1 ORDER BY m.name`,
          [input.tenant_id]
        );
        return res.rows;
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const menu = await query(`SELECT * FROM ivr_menus WHERE id = $1`, [input.id]);
        if (!menu.rows[0]) throw new Error("IVR menu not found");
        const actions = await query(
          `SELECT * FROM ivr_actions WHERE menu_id = $1 ORDER BY sort_order, digit`,
          [input.id]
        );
        return { ...menu.rows[0], actions: actions.rows };
      }),

    create: protectedProcedure
      .input(z.object({ tenant_id: z.number() }).merge(ivrMenuInput))
      .mutation(async ({ input }) => {
        const { tenant_id, ...data } = input;
        const res = await query(
          `INSERT INTO ivr_menus (tenant_id, name, description, greeting_file, greeting_tts, timeout_ms, max_retries, digit_timeout_ms, invalid_sound, exit_action, exit_target, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
          [tenant_id, data.name, data.description, data.greeting_file, data.greeting_tts, data.timeout_ms, data.max_retries, data.digit_timeout_ms, data.invalid_sound, data.exit_action, data.exit_target, data.is_active]
        );
        await writeAuditLog({ tenantId: tenant_id, action: "ivr_menu.created", resourceType: "ivr_menu", resourceId: String(res.rows[0].id), newValue: { name: data.name } });
        return res.rows[0];
      }),

    update: protectedProcedure
      .input(z.object({ id: z.number() }).merge(ivrMenuInput.partial()))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const sets = Object.entries(data)
          .filter(([_, v]) => v !== undefined)
          .map(([k], i) => `${k} = $${i + 2}`);
        if (sets.length === 0) return;
        const values = Object.values(data).filter(v => v !== undefined);
        sets.push(`updated_at = now()`);
        const res = await query(
          `UPDATE ivr_menus SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
          [id, ...values]
        );
        await invalidateCache(`ivr:menu:${id}`);
        return res.rows[0];
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await query(`DELETE FROM ivr_menus WHERE id = $1`, [input.id]);
        await invalidateCache(`ivr:menu:${input.id}`);
        return { ok: true };
      }),

    // IVR Actions (digits)
    setActions: protectedProcedure
      .input(z.object({
        menu_id: z.number(),
        actions: z.array(ivrActionInput),
      }))
      .mutation(async ({ input }) => {
        await withTransaction(async (client) => {
          await client.query(`DELETE FROM ivr_actions WHERE menu_id = $1`, [input.menu_id]);
          for (const action of input.actions) {
            await client.query(
              `INSERT INTO ivr_actions (menu_id, digit, action_type, target, description, sort_order)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [input.menu_id, action.digit, action.action_type, action.target, action.description, action.sort_order]
            );
          }
        });
        await invalidateCache(`ivr:menu:${input.menu_id}`);
        return { ok: true, count: input.actions.length };
      }),
  }),

  // ─── Ring Groups ───────────────────────────────────────────────────────────
  ringGroups: router({
    list: protectedProcedure
      .input(z.object({ tenant_id: z.number() }))
      .query(async ({ input }) => {
        const res = await query(
          `SELECT rg.*, 
            (SELECT count(*) FROM ring_group_members WHERE ring_group_id = rg.id AND is_active = true) as member_count
           FROM ring_groups rg WHERE rg.tenant_id = $1 ORDER BY rg.name`,
          [input.tenant_id]
        );
        return res.rows;
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const group = await query(`SELECT * FROM ring_groups WHERE id = $1`, [input.id]);
        if (!group.rows[0]) throw new Error("Ring group not found");
        const members = await query(
          `SELECT rgm.*, e.extension_number, e.display_name, e.first_name, e.last_name
           FROM ring_group_members rgm
           JOIN extensions e ON e.id = rgm.extension_id
           WHERE rgm.ring_group_id = $1 ORDER BY rgm.priority`,
          [input.id]
        );
        return { ...group.rows[0], members: members.rows };
      }),

    create: protectedProcedure
      .input(z.object({ tenant_id: z.number() }).merge(ringGroupInput))
      .mutation(async ({ input }) => {
        const { tenant_id, ...data } = input;
        const res = await query(
          `INSERT INTO ring_groups (tenant_id, name, description, extension, strategy, ring_timeout, caller_id_mode, caller_id_name, caller_id_number, skip_busy, skip_offline, enable_pickup, fallback_action, fallback_target, moh_file, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
          [tenant_id, data.name, data.description, data.extension, data.strategy, data.ring_timeout, data.caller_id_mode, data.caller_id_name, data.caller_id_number, data.skip_busy, data.skip_offline, data.enable_pickup, data.fallback_action, data.fallback_target, data.moh_file, data.is_active]
        );
        await writeAuditLog({ tenantId: tenant_id, action: "ring_group.created", resourceType: "ring_group", resourceId: String(res.rows[0].id), newValue: { name: data.name } });
        return res.rows[0];
      }),

    update: protectedProcedure
      .input(z.object({ id: z.number() }).merge(ringGroupInput.partial()))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const sets = Object.entries(data)
          .filter(([_, v]) => v !== undefined)
          .map(([k], i) => `${k} = $${i + 2}`);
        if (sets.length === 0) return;
        const values = Object.values(data).filter(v => v !== undefined);
        sets.push(`updated_at = now()`);
        const res = await query(
          `UPDATE ring_groups SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
          [id, ...values]
        );
        await invalidateCache(`ringgroup:${id}`);
        return res.rows[0];
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await query(`DELETE FROM ring_groups WHERE id = $1`, [input.id]);
        await invalidateCache(`ringgroup:${input.id}`);
        return { ok: true };
      }),

    setMembers: protectedProcedure
      .input(z.object({
        ring_group_id: z.number(),
        members: z.array(z.object({
          extension_id: z.number(),
          priority: z.number().default(1),
          delay_seconds: z.number().default(0),
          is_active: z.boolean().default(true),
        })),
      }))
      .mutation(async ({ input }) => {
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
        return { ok: true, count: input.members.length };
      }),
  }),

  // ─── Call Queues ───────────────────────────────────────────────────────────
  queues: router({
    list: protectedProcedure
      .input(z.object({ tenant_id: z.number() }))
      .query(async ({ input }) => {
        const res = await query(
          `SELECT q.*, 
            (SELECT count(*) FROM queue_agents WHERE queue_id = q.id AND is_logged_in = true) as agents_online,
            (SELECT count(*) FROM queue_agents WHERE queue_id = q.id) as total_agents
           FROM call_queues q WHERE q.tenant_id = $1 ORDER BY q.name`,
          [input.tenant_id]
        );
        return res.rows;
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const queue = await query(`SELECT * FROM call_queues WHERE id = $1`, [input.id]);
        if (!queue.rows[0]) throw new Error("Queue not found");
        const agents = await query(
          `SELECT qa.*, e.extension_number, e.display_name
           FROM queue_agents qa
           JOIN extensions e ON e.id = qa.extension_id
           WHERE qa.queue_id = $1 ORDER BY qa.priority`,
          [input.id]
        );
        return { ...queue.rows[0], agents: agents.rows };
      }),

    create: protectedProcedure
      .input(z.object({ tenant_id: z.number() }).merge(callQueueInput))
      .mutation(async ({ input }) => {
        const { tenant_id, ...data } = input;
        const res = await query(
          `INSERT INTO call_queues (tenant_id, name, description, extension, strategy, max_wait_time, max_callers, wrap_up_time, announce_position, announce_frequency, moh_file, join_announcement, agent_announcement, overflow_action, overflow_target, service_level_secs, record_calls, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
          [tenant_id, data.name, data.description, data.extension, data.strategy, data.max_wait_time, data.max_callers, data.wrap_up_time, data.announce_position, data.announce_frequency, data.moh_file, data.join_announcement, data.agent_announcement, data.overflow_action, data.overflow_target, data.service_level_secs, data.record_calls, data.is_active]
        );
        await writeAuditLog({ tenantId: tenant_id, action: "queue.created", resourceType: "call_queue", resourceId: String(res.rows[0].id), newValue: { name: data.name } });
        return res.rows[0];
      }),

    update: protectedProcedure
      .input(z.object({ id: z.number() }).merge(callQueueInput.partial()))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const sets = Object.entries(data)
          .filter(([_, v]) => v !== undefined)
          .map(([k], i) => `${k} = $${i + 2}`);
        if (sets.length === 0) return;
        const values = Object.values(data).filter(v => v !== undefined);
        sets.push(`updated_at = now()`);
        const res = await query(
          `UPDATE call_queues SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
          [id, ...values]
        );
        await invalidateCache(`queue:${id}`);
        return res.rows[0];
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await query(`DELETE FROM call_queues WHERE id = $1`, [input.id]);
        await invalidateCache(`queue:${input.id}`);
        return { ok: true };
      }),

    // Agent management
    setAgents: protectedProcedure
      .input(z.object({
        queue_id: z.number(),
        agents: z.array(z.object({
          extension_id: z.number(),
          priority: z.number().default(1),
          skills: z.array(z.string()).default([]),
          max_no_answer: z.number().default(3),
        })),
      }))
      .mutation(async ({ input }) => {
        await withTransaction(async (client) => {
          await client.query(`DELETE FROM queue_agents WHERE queue_id = $1`, [input.queue_id]);
          for (const agent of input.agents) {
            await client.query(
              `INSERT INTO queue_agents (queue_id, extension_id, priority, skills, max_no_answer)
               VALUES ($1, $2, $3, $4, $5)`,
              [input.queue_id, agent.extension_id, agent.priority, JSON.stringify(agent.skills), agent.max_no_answer]
            );
          }
        });
        await invalidateCache(`queue:${input.queue_id}`);
        return { ok: true, count: input.agents.length };
      }),

    agentLogin: protectedProcedure
      .input(z.object({ queue_id: z.number(), extension_id: z.number() }))
      .mutation(async ({ input }) => {
        await query(
          `UPDATE queue_agents SET is_logged_in = true WHERE queue_id = $1 AND extension_id = $2`,
          [input.queue_id, input.extension_id]
        );
        return { ok: true };
      }),

    agentLogout: protectedProcedure
      .input(z.object({ queue_id: z.number(), extension_id: z.number() }))
      .mutation(async ({ input }) => {
        await query(
          `UPDATE queue_agents SET is_logged_in = false WHERE queue_id = $1 AND extension_id = $2`,
          [input.queue_id, input.extension_id]
        );
        return { ok: true };
      }),

    stats: protectedProcedure
      .input(z.object({ queue_id: z.number(), hours: z.number().default(24) }))
      .query(async ({ input }) => {
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
      .query(async ({ input }) => {
        const res = await query(
          `SELECT tc.*, 
            (SELECT count(*) FROM time_condition_rules WHERE time_condition_id = tc.id) as rule_count
           FROM time_conditions tc WHERE tc.tenant_id = $1 ORDER BY tc.name`,
          [input.tenant_id]
        );
        return res.rows;
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const tc = await query(`SELECT * FROM time_conditions WHERE id = $1`, [input.id]);
        if (!tc.rows[0]) throw new Error("Time condition not found");
        const rules = await query(
          `SELECT * FROM time_condition_rules WHERE time_condition_id = $1 ORDER BY sort_order`,
          [input.id]
        );
        return { ...tc.rows[0], rules: rules.rows };
      }),

    create: protectedProcedure
      .input(z.object({
        tenant_id: z.number(),
        name: z.string().min(1).max(100),
        description: z.string().optional(),
        timezone: z.string().default("Asia/Bangkok"),
        match_action: z.string().default("transfer"),
        match_target: z.string().optional(),
        nomatch_action: z.string().default("voicemail"),
        nomatch_target: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const res = await query(
          `INSERT INTO time_conditions (tenant_id, name, description, timezone, match_action, match_target, nomatch_action, nomatch_target)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [input.tenant_id, input.name, input.description, input.timezone, input.match_action, input.match_target, input.nomatch_action, input.nomatch_target]
        );
        return res.rows[0];
      }),

    setRules: protectedProcedure
      .input(z.object({
        time_condition_id: z.number(),
        rules: z.array(z.object({
          day_of_week: z.array(z.number()).optional(),
          start_time: z.string().optional(),
          end_time: z.string().optional(),
          start_date: z.string().optional(),
          end_date: z.string().optional(),
          is_holiday: z.boolean().default(false),
          label: z.string().optional(),
          sort_order: z.number().default(0),
        })),
      }))
      .mutation(async ({ input }) => {
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
        return { ok: true, count: input.rules.length };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await query(`DELETE FROM time_conditions WHERE id = $1`, [input.id]);
        return { ok: true };
      }),
  }),
});
