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
    ring_groups: ["id", "tenant_id", "name", "extension", "strategy", "ring_timeout", "fallback_action", "fallback_target", "is_active"],
    ring_group_members: ["ring_group_id", "extension_id", "priority", "delay_seconds", "is_active"],
  },
  queues: {
    call_queues: ["id", "tenant_id", "name", "extension", "strategy", "overflow_action", "overflow_target", "is_active"],
    queue_agents: ["queue_id", "user_id", "extension_id"],
    queue_stats: ["queue_id"],
  },
  ivr: {
    ivr_menus: ["id", "tenant_id", "name", "greeting_file", "greeting_tts", "exit_action", "exit_target", "is_active"],
    ivr_actions: ["menu_id", "digit", "action_type", "action_target"],
  },
  businessHours: {
    time_conditions: ["id", "tenant_id", "name", "timezone", "match_action", "match_target", "nomatch_action", "nomatch_target"],
    time_condition_rules: ["time_condition_id", "day_of_week", "start_time", "end_time", "start_date", "end_date", "is_holiday", "sort_order"],
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
