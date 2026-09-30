-- Explicit reviewed migration for Phone11 advanced PBX routing. Never run at
-- application startup. Requires existing tenants and extensions tables in the
-- PostgreSQL database selected by server/pbx/db.ts. It creates no tenants,
-- extensions, routes, assignments, or sample data.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Refuse an unintended database/schema before any DDL. The operator supplies
-- these session settings after independent target review, as for the extension
-- prerequisite. Keep pg_temp last so temporary relation shadows cannot change
-- any unqualified migration DDL or catalog/data validation below.
DO $phone11_target$
DECLARE
  expected_database text := pg_catalog.current_setting('phone11.expected_database', true);
  expected_schema text := pg_catalog.current_setting('phone11.expected_schema', true);
BEGIN
  IF expected_database IS NULL OR expected_database = ''
     OR expected_schema IS NULL OR expected_schema = ''
     OR pg_catalog.current_database() <> expected_database
     OR pg_catalog.current_schema() <> expected_schema
     OR pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Phone11 advanced PBX migration target pin mismatch'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = expected_schema AND c.relname = 'tenants' AND c.relkind = 'r'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = expected_schema AND c.relname = 'extensions' AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'Phone11 advanced PBX migration requires pinned ordinary tenants and extensions tables'
      USING ERRCODE = '55000';
  END IF;
  PERFORM pg_catalog.set_config(
    'search_path', pg_catalog.format('%I,pg_catalog,pg_temp', expected_schema), true
  );
END;
$phone11_target$;

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
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog AS $$
DECLARE
  parent_tenant_id INTEGER;
  extension_tenant_id INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'ring_group_members' THEN
    EXECUTE pg_catalog.format('SELECT tenant_id FROM %I.ring_groups WHERE id = $1', TG_TABLE_SCHEMA)
      INTO parent_tenant_id USING NEW.ring_group_id;
  ELSE
    EXECUTE pg_catalog.format('SELECT tenant_id FROM %I.call_queues WHERE id = $1', TG_TABLE_SCHEMA)
      INTO parent_tenant_id USING NEW.queue_id;
  END IF;

  -- A tenant move updates this same extension row. FOR SHARE conflicts with
  -- that update and holds the lock until the member transaction commits.
  EXECUTE pg_catalog.format(
    'SELECT tenant_id FROM %I.extensions WHERE id = $1 AND deleted_at IS NULL FOR SHARE',
    TG_TABLE_SCHEMA
  ) INTO extension_tenant_id USING NEW.extension_id;
  IF parent_tenant_id IS NULL OR extension_tenant_id IS DISTINCT FROM parent_tenant_id THEN
    RAISE EXCEPTION 'advanced PBX member extension must belong to the parent tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phone11_ring_group_member_tenant ON ring_group_members;
CREATE TRIGGER phone11_ring_group_member_tenant
  AFTER INSERT OR UPDATE ON ring_group_members
  FOR EACH ROW EXECUTE FUNCTION phone11_validate_advanced_pbx_member();

DROP TRIGGER IF EXISTS phone11_queue_agent_tenant ON queue_agents;
CREATE TRIGGER phone11_queue_agent_tenant
  AFTER INSERT OR UPDATE ON queue_agents
  FOR EACH ROW EXECUTE FUNCTION phone11_validate_advanced_pbx_member();

-- An extension tenant move already owns its row lock. A concurrent member
-- insert must take FOR SHARE on that row before it can finish; whichever
-- transaction arrives second therefore sees the first committed decision.
CREATE OR REPLACE FUNCTION phone11_validate_advanced_pbx_extension_move() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog AS $$
DECLARE
  has_member BOOLEAN;
BEGIN
  -- An older REPEATABLE READ snapshot can miss a member inserted while this
  -- transaction waited for the extension row. Fail closed in that isolation;
  -- READ COMMITTED takes a fresh snapshot for this trigger's membership query.
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'advanced PBX extension tenant moves require READ COMMITTED'
      USING ERRCODE = '23514';
  END IF;
  EXECUTE pg_catalog.format(
    'SELECT EXISTS (SELECT 1 FROM %I.ring_group_members WHERE extension_id = $1) OR EXISTS (SELECT 1 FROM %I.queue_agents WHERE extension_id = $1)',
    TG_TABLE_SCHEMA, TG_TABLE_SCHEMA
  ) INTO has_member USING NEW.id;
  IF has_member THEN
    RAISE EXCEPTION 'advanced PBX member extension tenant is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phone11_extension_member_tenant_move ON extensions;
CREATE TRIGGER phone11_extension_member_tenant_move
  AFTER UPDATE ON extensions
  FOR EACH ROW WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
  EXECUTE FUNCTION phone11_validate_advanced_pbx_extension_move();

-- Child rows reference integer parent IDs, so changing a parent workspace would
-- otherwise leave existing members attached to extensions from the old tenant.
-- Tenant moves must be represented by a reviewed export/recreate operation.
CREATE OR REPLACE FUNCTION phone11_advanced_pbx_tenant_immutable() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'advanced PBX parent tenant is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phone11_ring_group_tenant_immutable ON ring_groups;
CREATE TRIGGER phone11_ring_group_tenant_immutable
  AFTER UPDATE ON ring_groups
  FOR EACH ROW WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
  EXECUTE FUNCTION phone11_advanced_pbx_tenant_immutable();

DROP TRIGGER IF EXISTS phone11_queue_tenant_immutable ON call_queues;
CREATE TRIGGER phone11_queue_tenant_immutable
  AFTER UPDATE ON call_queues
  FOR EACH ROW WHEN (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
  EXECUTE FUNCTION phone11_advanced_pbx_tenant_immutable();

-- All member, parent, and extension tables now carry their write guards, and their DDL locks remain
-- held through commit. This READ COMMITTED scan sees the latest committed
-- rows, so replay refuses invalid memberships introduced before the guards.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ring_group_members m
    LEFT JOIN ring_groups g ON g.id = m.ring_group_id
    LEFT JOIN extensions e ON e.id = m.extension_id
    WHERE g.id IS NULL OR e.id IS NULL
      OR e.tenant_id IS DISTINCT FROM g.tenant_id
  ) OR EXISTS (
    SELECT 1 FROM queue_agents a
    LEFT JOIN call_queues q ON q.id = a.queue_id
    LEFT JOIN extensions e ON e.id = a.extension_id
    WHERE q.id IS NULL OR e.id IS NULL
      OR e.tenant_id IS DISTINCT FROM q.tenant_id
  ) THEN
    RAISE EXCEPTION 'advanced PBX has invalid existing member tenant assignments'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

COMMIT;
