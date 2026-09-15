-- Explicit reviewed migration for Phone11 advanced PBX routing. Never run at
-- application startup. Requires existing tenants and extensions tables in the
-- PostgreSQL database selected by server/pbx/db.ts. It creates no tenants,
-- extensions, routes, assignments, or sample data.
BEGIN;

-- The advanced ring-group detail query presents these optional contact fields.
-- Older provisioning schemas created extensions without them.
ALTER TABLE extensions ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE extensions ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);

CREATE TABLE IF NOT EXISTS ivr_menus (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  greeting_file TEXT,
  greeting_tts TEXT,
  timeout_ms INTEGER NOT NULL DEFAULT 5000 CHECK (timeout_ms BETWEEN 1000 AND 30000),
  max_retries INTEGER NOT NULL DEFAULT 3 CHECK (max_retries BETWEEN 1 AND 10),
  digit_timeout_ms INTEGER NOT NULL DEFAULT 3000 CHECK (digit_timeout_ms BETWEEN 1000 AND 10000),
  invalid_sound TEXT,
  exit_action TEXT NOT NULL DEFAULT 'hangup' CHECK (exit_action IN ('hangup', 'transfer', 'voicemail')),
  exit_target TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS ivr_menus_tenant_name ON ivr_menus(tenant_id, name);

CREATE TABLE IF NOT EXISTS ivr_actions (
  id SERIAL PRIMARY KEY,
  menu_id INTEGER NOT NULL REFERENCES ivr_menus(id) ON DELETE CASCADE,
  digit VARCHAR(5) NOT NULL CHECK (length(digit) BETWEEN 1 AND 5),
  action_type TEXT NOT NULL CHECK (action_type IN (
    'transfer_ext', 'transfer_queue', 'transfer_ringgroup', 'sub_menu',
    'voicemail', 'hangup', 'repeat', 'dial_by_name', 'time_condition',
    'external_number'
  )),
  target TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (menu_id, digit)
);
CREATE INDEX IF NOT EXISTS ivr_actions_menu_order ON ivr_actions(menu_id, sort_order, digit);

CREATE TABLE IF NOT EXISTS ring_groups (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  extension VARCHAR(32),
  strategy TEXT NOT NULL DEFAULT 'simultaneous' CHECK (strategy IN (
    'simultaneous', 'sequential', 'round_robin', 'longest_idle', 'random'
  )),
  ring_timeout INTEGER NOT NULL DEFAULT 25 CHECK (ring_timeout BETWEEN 5 AND 120),
  caller_id_mode TEXT NOT NULL DEFAULT 'caller' CHECK (caller_id_mode IN ('caller', 'group', 'fixed')),
  caller_id_name VARCHAR(128),
  caller_id_number VARCHAR(64),
  skip_busy BOOLEAN NOT NULL DEFAULT TRUE,
  skip_offline BOOLEAN NOT NULL DEFAULT TRUE,
  enable_pickup BOOLEAN NOT NULL DEFAULT TRUE,
  fallback_action TEXT NOT NULL DEFAULT 'voicemail' CHECK (fallback_action IN ('voicemail', 'transfer', 'ivr', 'hangup')),
  fallback_target TEXT,
  moh_file TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS ring_groups_tenant_name ON ring_groups(tenant_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS ring_groups_tenant_extension
  ON ring_groups(tenant_id, extension) WHERE extension IS NOT NULL;

CREATE TABLE IF NOT EXISTS ring_group_members (
  ring_group_id INTEGER NOT NULL REFERENCES ring_groups(id) ON DELETE CASCADE,
  extension_id INTEGER NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 1,
  delay_seconds INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (ring_group_id, extension_id)
);
CREATE INDEX IF NOT EXISTS ring_group_members_order
  ON ring_group_members(ring_group_id, is_active, priority, delay_seconds);

CREATE TABLE IF NOT EXISTS call_queues (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  extension VARCHAR(32),
  strategy TEXT NOT NULL DEFAULT 'longest_idle' CHECK (strategy IN (
    'longest_idle', 'round_robin', 'ring_all', 'fewest_calls', 'random', 'top_down'
  )),
  max_wait_time INTEGER NOT NULL DEFAULT 300 CHECK (max_wait_time BETWEEN 10 AND 3600),
  max_callers INTEGER NOT NULL DEFAULT 20 CHECK (max_callers BETWEEN 1 AND 100),
  wrap_up_time INTEGER NOT NULL DEFAULT 10 CHECK (wrap_up_time BETWEEN 0 AND 120),
  announce_position BOOLEAN NOT NULL DEFAULT TRUE,
  announce_frequency INTEGER NOT NULL DEFAULT 30 CHECK (announce_frequency BETWEEN 10 AND 300),
  moh_file TEXT,
  join_announcement TEXT,
  agent_announcement TEXT,
  overflow_action TEXT NOT NULL DEFAULT 'voicemail' CHECK (overflow_action IN ('voicemail', 'transfer', 'ivr', 'hangup', 'callback')),
  overflow_target TEXT,
  service_level_secs INTEGER NOT NULL DEFAULT 20 CHECK (service_level_secs BETWEEN 5 AND 120),
  record_calls BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS call_queues_tenant_name ON call_queues(tenant_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS call_queues_tenant_extension
  ON call_queues(tenant_id, extension) WHERE extension IS NOT NULL;

CREATE TABLE IF NOT EXISTS queue_agents (
  queue_id INTEGER NOT NULL REFERENCES call_queues(id) ON DELETE CASCADE,
  extension_id INTEGER NOT NULL REFERENCES extensions(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 1,
  skills JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(skills) = 'array'),
  max_no_answer INTEGER NOT NULL DEFAULT 3,
  is_logged_in BOOLEAN NOT NULL DEFAULT FALSE,
  last_call_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (queue_id, extension_id)
);
CREATE INDEX IF NOT EXISTS queue_agents_dispatch
  ON queue_agents(queue_id, is_logged_in, priority);

CREATE TABLE IF NOT EXISTS queue_stats (
  queue_id INTEGER NOT NULL REFERENCES call_queues(id) ON DELETE CASCADE,
  interval_start TIMESTAMPTZ NOT NULL,
  interval_end TIMESTAMPTZ NOT NULL,
  offered_calls INTEGER NOT NULL DEFAULT 0 CHECK (offered_calls >= 0),
  answered_calls INTEGER NOT NULL DEFAULT 0 CHECK (answered_calls >= 0),
  abandoned_calls INTEGER NOT NULL DEFAULT 0 CHECK (abandoned_calls >= 0),
  overflowed_calls INTEGER NOT NULL DEFAULT 0 CHECK (overflowed_calls >= 0),
  service_level_calls INTEGER NOT NULL DEFAULT 0 CHECK (service_level_calls >= 0),
  total_wait_seconds BIGINT NOT NULL DEFAULT 0 CHECK (total_wait_seconds >= 0),
  total_talk_seconds BIGINT NOT NULL DEFAULT 0 CHECK (total_talk_seconds >= 0),
  PRIMARY KEY (queue_id, interval_start),
  CHECK (interval_end > interval_start)
);
CREATE INDEX IF NOT EXISTS queue_stats_history ON queue_stats(queue_id, interval_start DESC);

CREATE TABLE IF NOT EXISTS time_conditions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  match_action VARCHAR(32) NOT NULL DEFAULT 'transfer',
  match_target TEXT,
  nomatch_action VARCHAR(32) NOT NULL DEFAULT 'voicemail',
  nomatch_target TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS time_conditions_tenant_name ON time_conditions(tenant_id, name);

CREATE TABLE IF NOT EXISTS time_condition_rules (
  id SERIAL PRIMARY KEY,
  time_condition_id INTEGER NOT NULL REFERENCES time_conditions(id) ON DELETE CASCADE,
  day_of_week INTEGER[],
  start_time TIME,
  end_time TIME,
  start_date DATE,
  end_date DATE,
  is_holiday BOOLEAN NOT NULL DEFAULT FALSE,
  label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (day_of_week IS NULL OR day_of_week <@ ARRAY[0,1,2,3,4,5,6]),
  CHECK ((start_time IS NULL) = (end_time IS NULL)),
  CHECK ((start_date IS NULL) = (end_date IS NULL)),
  CHECK (start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS time_condition_rules_order
  ON time_condition_rules(time_condition_id, sort_order);

-- Keep member rows tenant-safe even if a maintenance script bypasses the API's
-- workspace checks. The trigger derives tenancy from the selected parent.
CREATE OR REPLACE FUNCTION phone11_validate_advanced_pbx_member() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_tenant_id INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'ring_group_members' THEN
    SELECT tenant_id INTO parent_tenant_id FROM ring_groups WHERE id = NEW.ring_group_id;
  ELSE
    SELECT tenant_id INTO parent_tenant_id FROM call_queues WHERE id = NEW.queue_id;
  END IF;

  IF parent_tenant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM extensions
    WHERE id = NEW.extension_id
      AND tenant_id = parent_tenant_id
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'advanced PBX member extension must belong to the parent tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phone11_ring_group_member_tenant ON ring_group_members;
CREATE TRIGGER phone11_ring_group_member_tenant
  BEFORE INSERT OR UPDATE ON ring_group_members
  FOR EACH ROW EXECUTE FUNCTION phone11_validate_advanced_pbx_member();

DROP TRIGGER IF EXISTS phone11_queue_agent_tenant ON queue_agents;
CREATE TRIGGER phone11_queue_agent_tenant
  BEFORE INSERT OR UPDATE ON queue_agents
  FOR EACH ROW EXECUTE FUNCTION phone11_validate_advanced_pbx_member();

COMMIT;
