-- Explicit migration for the one workspace setting currently consumed by the
-- Phone11 runtime. Apply only through the reviewed database process; the
-- application never runs this file and this migration changes no call routing.
BEGIN;

DO $$
DECLARE
  existing_columns TEXT[];
BEGIN
  IF to_regclass(format('%I.tenants', current_schema())) IS NULL THEN
    RAISE EXCEPTION 'tenant_settings migration requires tenants in the current schema';
  END IF;

  IF to_regclass(format('%I.tenant_settings', current_schema())) IS NOT NULL THEN
    SELECT array_agg(column_name ORDER BY column_name)
      INTO existing_columns
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'tenant_settings';

    IF existing_columns IS DISTINCT FROM ARRAY[
      'business_hours_timezone',
      'created_at',
      'tenant_id',
      'updated_at'
    ] THEN
      RAISE EXCEPTION
        'existing tenant_settings is partial or incompatible; stop for review';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM (VALUES
          ('tenant_id', ARRAY['integer']::TEXT[], 'NO'),
          ('business_hours_timezone', ARRAY['character varying', 'text']::TEXT[], 'NO'),
          ('created_at', ARRAY['timestamp with time zone']::TEXT[], 'NO'),
          ('updated_at', ARRAY['timestamp with time zone']::TEXT[], 'NO')
        ) expected(column_name, allowed_types, is_nullable)
        LEFT JOIN information_schema.columns actual
          ON actual.table_schema = current_schema()
         AND actual.table_name = 'tenant_settings'
         AND actual.column_name = expected.column_name
       WHERE actual.column_name IS NULL
          OR NOT (actual.data_type = ANY(expected.allowed_types))
          OR actual.is_nullable <> expected.is_nullable
    ) THEN
      RAISE EXCEPTION
        'existing tenant_settings has incompatible column types or nullability; stop for review';
    END IF;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  business_hours_timezone VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT phone11_tenant_settings_timezone_nonempty CHECK (
    business_hours_timezone = btrim(business_hours_timezone)
    AND char_length(business_hours_timezone) BETWEEN 1 AND 64
  )
);

DO $$
DECLARE
  tenant_settings_relation REGCLASS;
  tenants_relation REGCLASS;
  tenant_settings_tenant_id_attnum SMALLINT;
  tenants_id_attnum SMALLINT;
BEGIN
  tenant_settings_relation := to_regclass(format('%I.tenant_settings', current_schema()));
  tenants_relation := to_regclass(format('%I.tenants', current_schema()));

  SELECT attnum
    INTO tenant_settings_tenant_id_attnum
    FROM pg_attribute
   WHERE attrelid = tenant_settings_relation
     AND attname = 'tenant_id'
     AND NOT attisdropped;
  SELECT attnum
    INTO tenants_id_attnum
    FROM pg_attribute
   WHERE attrelid = tenants_relation
     AND attname = 'id'
     AND NOT attisdropped;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = tenant_settings_relation
       AND c.contype = 'p'
       AND c.conkey = ARRAY[tenant_settings_tenant_id_attnum]
  ) THEN
    RAISE EXCEPTION 'tenant_settings requires a primary key';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = tenant_settings_relation
       AND c.contype = 'f'
       AND c.conkey = ARRAY[tenant_settings_tenant_id_attnum]
       AND c.confrelid = tenants_relation
       AND c.confkey = ARRAY[tenants_id_attnum]
       AND c.confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'tenant_settings.tenant_id must cascade to tenants.id';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = tenant_settings_relation
       AND c.contype = 'c'
       AND c.conname = 'phone11_tenant_settings_timezone_nonempty'
       AND c.convalidated
       AND pg_get_expr(c.conbin, c.conrelid, true) =
         'business_hours_timezone::text = btrim(business_hours_timezone::text) AND char_length(business_hours_timezone::text) >= 1 AND char_length(business_hours_timezone::text) <= 64'
  ) THEN
    RAISE EXCEPTION 'tenant_settings requires the reviewed timezone constraint';
  END IF;
END;
$$;

COMMIT;
