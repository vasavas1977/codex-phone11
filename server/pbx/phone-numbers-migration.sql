-- Explicit reviewed migration for Phone11 number inventory. Apply only through
-- the reviewed database process, never at application startup. This creates no
-- numbers, carrier assignments, emergency registrations, or call routes.
-- New numbers remain pending until a separate provider-verified activation.
BEGIN;

DO $$
BEGIN
  IF to_regclass(format('%I.tenants', current_schema())) IS NULL THEN
    RAISE EXCEPTION 'phone_numbers migration requires tenants in the current schema';
  END IF;
END;
$$;

-- This is an address inventory, not proof that a carrier has provisioned E911.
-- Site linking is deliberately unavailable until the optional sites schema is
-- commissioned with a tenant-scoped foreign key.
CREATE TABLE IF NOT EXISTS emergency_addresses (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL
    CONSTRAINT phone11_emergency_tenant_fk REFERENCES tenants(id) ON DELETE CASCADE,
  site_id INTEGER,
  label VARCHAR(100),
  street TEXT NOT NULL,
  city VARCHAR(160) NOT NULL,
  state_province VARCHAR(160),
  postal_code VARCHAR(32),
  country VARCHAR(2) NOT NULL DEFAULT 'TH',
  caller_name VARCHAR(160),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT phone11_emergency_address_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT phone11_emergency_address_fields CHECK (
    btrim(street) <> '' AND btrim(city) <> ''
    AND country ~ '^[A-Z]{2}$'
    AND status IN ('active', 'inactive')
    AND site_id IS NULL
  )
);

CREATE TABLE IF NOT EXISTS phone_numbers (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL
    CONSTRAINT phone11_number_tenant_fk REFERENCES tenants(id) ON DELETE CASCADE,
  number_e164 VARCHAR(16) NOT NULL,
  number_display TEXT NOT NULL,
  country VARCHAR(2) NOT NULL DEFAULT 'TH',
  number_type TEXT NOT NULL DEFAULT 'local',
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  assigned_route_type TEXT,
  assigned_route_id INTEGER,
  e911_address_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT phone11_number_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT phone11_number_e911_tenant_fk
    FOREIGN KEY (e911_address_id, tenant_id)
    REFERENCES emergency_addresses(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT phone11_number_fields CHECK (
    number_e164 ~ '^\+[1-9][0-9]{1,14}$'
    AND btrim(number_display) <> ''
    AND country ~ '^[A-Z]{2}$'
    AND btrim(provider) <> ''
    AND number_type IN ('local', 'mobile', 'toll_free', 'international')
    AND status IN ('pending', 'active', 'suspended')
    AND ((assigned_route_type IS NULL AND assigned_route_id IS NULL)
      OR (assigned_route_type IN ('extension', 'ring_group', 'queue', 'ivr', 'time_condition')
        AND assigned_route_id > 0))
  )
);

-- Active and suspended numbers remain owned by one tenant. Separate tenants
-- can stage unverified drafts; suspending a number never releases its claim.
CREATE UNIQUE INDEX IF NOT EXISTS phone11_number_owned_e164_unique
  ON phone_numbers(number_e164)
  WHERE status IN ('active', 'suspended') AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS phone11_number_tenant_live_e164_unique
  ON phone_numbers(tenant_id, number_e164) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS phone11_numbers_tenant_active
  ON phone_numbers(tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS phone11_numbers_extension_route
  ON phone_numbers(tenant_id, assigned_route_id)
  WHERE deleted_at IS NULL AND assigned_route_type = 'extension';
CREATE INDEX IF NOT EXISTS phone11_emergency_addresses_tenant_active
  ON emergency_addresses(tenant_id, created_at DESC) WHERE status = 'active';

-- The API's optional-schema probe checks columns only. Refuse to enable it on
-- an existing partial table or one missing the isolation constraints above.
DO $$
DECLARE
  relation_name TEXT;
  required_column TEXT;
  required_constraint TEXT;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['emergency_addresses', 'phone_numbers'] LOOP
    IF to_regclass(format('%I.%I', current_schema(), relation_name)) IS NULL THEN
      RAISE EXCEPTION '% table is missing after migration', relation_name;
    END IF;
  END LOOP;
  FOREACH required_column IN ARRAY ARRAY[
    'id', 'tenant_id', 'number_e164', 'number_display', 'country',
    'number_type', 'provider', 'status', 'assigned_route_type',
    'assigned_route_id', 'e911_address_id', 'deleted_at', 'updated_at'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'phone_numbers' AND column_name = required_column
    ) THEN
      RAISE EXCEPTION 'phone_numbers.% is missing; stop for review', required_column;
    END IF;
  END LOOP;
  FOREACH required_column IN ARRAY ARRAY[
    'id', 'tenant_id', 'site_id', 'street', 'city', 'status', 'created_at'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'emergency_addresses' AND column_name = required_column
    ) THEN
      RAISE EXCEPTION 'emergency_addresses.% is missing; stop for review', required_column;
    END IF;
  END LOOP;
  FOREACH required_constraint IN ARRAY ARRAY[
    'emergency_addresses_pkey',
    'phone_numbers_pkey',
    'phone11_emergency_tenant_fk',
    'phone11_emergency_address_tenant_key',
    'phone11_emergency_address_fields',
    'phone11_number_tenant_fk',
    'phone11_number_tenant_key',
    'phone11_number_e911_tenant_fk',
    'phone11_number_fields'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = required_constraint
        AND connamespace = current_schema()::regnamespace
        AND convalidated
    ) THEN
      RAISE EXCEPTION 'number inventory constraint % is missing; stop for review', required_constraint;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('phone_numbers', 'id', 'integer', 'NO'),
      ('phone_numbers', 'tenant_id', 'integer', 'NO'),
      ('phone_numbers', 'number_e164', 'character varying', 'NO'),
      ('phone_numbers', 'number_display', 'text', 'NO'),
      ('phone_numbers', 'country', 'character varying', 'NO'),
      ('phone_numbers', 'number_type', 'text', 'NO'),
      ('phone_numbers', 'provider', 'text', 'NO'),
      ('phone_numbers', 'status', 'text', 'NO'),
      ('phone_numbers', 'assigned_route_type', 'text', 'YES'),
      ('phone_numbers', 'assigned_route_id', 'integer', 'YES'),
      ('phone_numbers', 'e911_address_id', 'integer', 'YES'),
      ('phone_numbers', 'created_at', 'timestamp with time zone', 'NO'),
      ('phone_numbers', 'updated_at', 'timestamp with time zone', 'NO'),
      ('phone_numbers', 'deleted_at', 'timestamp with time zone', 'YES'),
      ('emergency_addresses', 'id', 'integer', 'NO'),
      ('emergency_addresses', 'tenant_id', 'integer', 'NO'),
      ('emergency_addresses', 'site_id', 'integer', 'YES'),
      ('emergency_addresses', 'street', 'text', 'NO'),
      ('emergency_addresses', 'city', 'character varying', 'NO'),
      ('emergency_addresses', 'status', 'text', 'NO'),
      ('emergency_addresses', 'created_at', 'timestamp with time zone', 'NO')
    ) expected(table_name, column_name, data_type, is_nullable)
    LEFT JOIN information_schema.columns actual
      ON actual.table_schema = current_schema()
     AND actual.table_name = expected.table_name
     AND actual.column_name = expected.column_name
    WHERE actual.data_type IS DISTINCT FROM expected.data_type
       OR actual.is_nullable IS DISTINCT FROM expected.is_nullable
  ) THEN
    RAISE EXCEPTION 'number inventory has incompatible column types or nullability';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'phone_numbers'
      AND column_name = 'status' AND column_default = '''pending''::text'
  ) THEN
    RAISE EXCEPTION 'new phone numbers must default to pending';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class index_relation ON index_relation.oid = i.indexrelid
    JOIN pg_attribute key_column ON key_column.attrelid = i.indrelid
      AND key_column.attname = 'number_e164'
    WHERE index_relation.relnamespace = current_schema()::regnamespace
      AND index_relation.relname = 'phone11_number_owned_e164_unique'
      AND i.indrelid = to_regclass(format('%I.phone_numbers', current_schema()))
      AND i.indisunique AND i.indisvalid AND i.indnkeyatts = 1
      AND i.indkey[0] = key_column.attnum
      AND pg_get_expr(i.indpred, i.indrelid) =
        '((status = ANY (ARRAY[''active''::text, ''suspended''::text])) AND (deleted_at IS NULL))'
  ) THEN
    RAISE EXCEPTION 'global owned E.164 unique index is missing or invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class index_relation ON index_relation.oid = i.indexrelid
    JOIN pg_attribute tenant_key ON tenant_key.attrelid = i.indrelid
      AND tenant_key.attname = 'tenant_id'
    JOIN pg_attribute number_key ON number_key.attrelid = i.indrelid
      AND number_key.attname = 'number_e164'
    WHERE index_relation.relnamespace = current_schema()::regnamespace
      AND index_relation.relname = 'phone11_number_tenant_live_e164_unique'
      AND i.indrelid = to_regclass(format('%I.phone_numbers', current_schema()))
      AND i.indisunique AND i.indisvalid AND i.indnkeyatts = 2
      AND i.indkey[0] = tenant_key.attnum AND i.indkey[1] = number_key.attnum
      AND pg_get_expr(i.indpred, i.indrelid) = '(deleted_at IS NULL)'
  ) THEN
    RAISE EXCEPTION 'tenant-local live E.164 unique index is missing or invalid';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION phone11_number_inventory_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_table TEXT;
  active_predicate TEXT;
  target_id INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'number inventory tenant is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'emergency_addresses' THEN
    RETURN NEW;
  END IF;
  IF NEW.assigned_route_type IS NULL THEN
    RETURN NEW;
  END IF;

  target_table := CASE NEW.assigned_route_type
    WHEN 'extension' THEN 'extensions'
    WHEN 'ring_group' THEN 'ring_groups'
    WHEN 'queue' THEN 'call_queues'
    WHEN 'ivr' THEN 'ivr_menus'
    WHEN 'time_condition' THEN 'time_conditions'
  END;
  active_predicate := CASE NEW.assigned_route_type
    WHEN 'extension' THEN ' AND deleted_at IS NULL AND status = ''active'''
    WHEN 'time_condition' THEN ''
    ELSE ' AND is_active = TRUE'
  END;
  IF target_table IS NULL OR
     to_regclass(format('%I.%I', current_schema(), target_table)) IS NULL THEN
    RAISE EXCEPTION 'PBX destination is unavailable' USING ERRCODE = '23514';
  END IF;
  EXECUTE format(
    'SELECT id FROM %I.%I WHERE id = $1 AND tenant_id = $2%s FOR SHARE',
    current_schema(), target_table, active_predicate
  ) INTO target_id USING NEW.assigned_route_id, NEW.tenant_id;
  IF target_id IS NULL THEN
    RAISE EXCEPTION 'PBX destination must belong to the same active tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phone11_number_inventory_tenant_guard ON phone_numbers;
CREATE TRIGGER phone11_number_inventory_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, assigned_route_type, assigned_route_id
  ON phone_numbers FOR EACH ROW EXECUTE FUNCTION phone11_number_inventory_guard();
DROP TRIGGER IF EXISTS phone11_emergency_address_tenant_guard ON emergency_addresses;
CREATE TRIGGER phone11_emergency_address_tenant_guard
  BEFORE UPDATE OF tenant_id ON emergency_addresses
  FOR EACH ROW EXECUTE FUNCTION phone11_number_inventory_guard();

COMMIT;
