import { query } from "./db";

export type ManagementCapabilities = {
  phoneNumbers: boolean;
  sites: boolean;
  ringGroups: boolean;
  queues: boolean;
  ivr: boolean;
  businessHours: boolean;
};

type Execute = typeof query;

export type SchemaRequirements = Record<string, readonly string[]>;

const requirements: Record<keyof ManagementCapabilities, Record<string, readonly string[]>> = {
  phoneNumbers: {
    phone_numbers: ["id", "tenant_id", "number_e164", "number_display", "country", "number_type", "provider", "status", "assigned_route_type", "assigned_route_id", "e911_address_id", "deleted_at", "updated_at"],
    emergency_addresses: ["id", "tenant_id", "street", "city"],
  },
  sites: {
    sites: ["id", "tenant_id", "name", "address_line1", "city", "state_province", "postal_code", "country", "timezone", "is_main", "status"],
  },
  ringGroups: {
    ring_groups: ["id", "tenant_id", "name", "description", "extension", "strategy", "ring_timeout", "caller_id_mode", "caller_id_name", "caller_id_number", "skip_busy", "skip_offline", "enable_pickup", "fallback_action", "fallback_target", "moh_file", "is_active", "created_at", "updated_at"],
    ring_group_members: ["ring_group_id", "extension_id", "priority", "delay_seconds", "is_active", "created_at"],
    extensions: ["id", "tenant_id", "extension_number", "display_name", "first_name", "last_name", "type", "user_id", "status", "deleted_at"],
    sip_accounts: ["extension_id", "tenant_id", "user_id", "status", "deleted_at"],
  },
  queues: {
    call_queues: ["id", "tenant_id", "name", "description", "extension", "strategy", "max_wait_time", "max_callers", "wrap_up_time", "announce_position", "announce_frequency", "moh_file", "join_announcement", "agent_announcement", "overflow_action", "overflow_target", "service_level_secs", "record_calls", "is_active", "created_at", "updated_at"],
    queue_agents: ["queue_id", "extension_id", "priority", "skills", "max_no_answer", "is_logged_in", "last_call_at", "created_at", "updated_at"],
    queue_stats: ["queue_id", "interval_start", "interval_end", "offered_calls", "answered_calls", "abandoned_calls", "overflowed_calls", "service_level_calls", "total_wait_seconds", "total_talk_seconds"],
    extensions: ["id", "tenant_id", "extension_number", "display_name", "type", "user_id", "status", "deleted_at"],
    sip_accounts: ["extension_id", "tenant_id", "user_id", "status", "deleted_at"],
  },
  ivr: {
    ivr_menus: ["id", "tenant_id", "name", "description", "greeting_file", "greeting_tts", "timeout_ms", "max_retries", "digit_timeout_ms", "invalid_sound", "exit_action", "exit_target", "is_active", "created_at", "updated_at"],
    ivr_actions: ["id", "menu_id", "digit", "action_type", "target", "description", "sort_order", "created_at"],
  },
  businessHours: {
    time_conditions: ["id", "tenant_id", "name", "description", "timezone", "match_action", "match_target", "nomatch_action", "nomatch_target", "created_at", "updated_at"],
    time_condition_rules: ["id", "time_condition_id", "day_of_week", "start_time", "end_time", "start_date", "end_date", "is_holiday", "label", "sort_order", "created_at"],
  },
};

export async function readManagementCapabilities(
  execute: Execute = query,
): Promise<ManagementCapabilities> {
  const tableNames = [...new Set(Object.values(requirements).flatMap(Object.keys))];
  const result = await execute(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [tableNames],
  );
  const columns = new Set(
    result.rows.map((row: any) => `${row.table_name}.${row.column_name}`),
  );
  return Object.fromEntries(
    Object.entries(requirements).map(([facility, tables]) => [
      facility,
      Object.entries(tables).every(([table, names]) =>
        names.every((column) => columns.has(`${table}.${column}`)),
      ),
    ]),
  ) as ManagementCapabilities;
}

export async function schemaHasRequiredColumns(
  required: SchemaRequirements,
  execute: Execute = query,
): Promise<boolean> {
  const tableNames = Object.keys(required);
  const result = await execute(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [tableNames],
  );
  const columns = new Set(
    result.rows.map((row: any) => `${row.table_name}.${row.column_name}`),
  );
  return Object.entries(required).every(([table, names]) =>
    names.every((column) => columns.has(`${table}.${column}`)),
  );
}
