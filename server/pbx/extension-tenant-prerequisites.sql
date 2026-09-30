-- Operator-only prerequisite for Phone11 advanced PBX routing. Supply the
-- exact database and schema as session settings before running this file:
--   SET phone11.expected_database = '<reviewed database>';
--   SET phone11.expected_schema = '<reviewed schema>';
-- Never run at application startup. This file assigns no tenants or roles.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $phone11$
DECLARE
  expected_database text := pg_catalog.current_setting('phone11.expected_database', true);
  expected_schema text := pg_catalog.current_setting('phone11.expected_schema', true);
  extensions_oid oid;
  tenants_oid oid;
  locked_extensions_oid oid;
  locked_tenants_oid oid;
  extension_id_att smallint;
  tenant_id_att smallint;
  tenants_id_att smallint;
  tenant_nullable boolean;
  tenant_identity text;
  tenant_generated text;
  named_fk record;
  tenant_fk_count integer;
  has_invalid_rows boolean;
BEGIN
  IF expected_database IS NULL OR expected_database = ''
     OR expected_schema IS NULL OR expected_schema = ''
     OR pg_catalog.current_database() <> expected_database
     OR pg_catalog.current_schema() <> expected_schema
  THEN
    RAISE EXCEPTION 'Phone11 extension prerequisite target pin mismatch'
      USING ERRCODE = '55000';
  END IF;

  -- Target selection is complete; resolve subsequent built-ins in pg_catalog.
  -- Every application relation below remains explicitly schema-qualified.
  PERFORM pg_catalog.set_config('search_path', 'pg_catalog', true);

  SELECT c.oid INTO extensions_oid
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = expected_schema AND c.relname = 'extensions' AND c.relkind = 'r';
  SELECT c.oid INTO tenants_oid
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = expected_schema AND c.relname = 'tenants' AND c.relkind = 'r';
  IF extensions_oid IS NULL OR tenants_oid IS NULL THEN
    RAISE EXCEPTION 'Phone11 extension prerequisite requires ordinary extensions and tenants tables'
      USING ERRCODE = '55000';
  END IF;

  -- Hold both tables through catalog checks, data checks, and constraint
  -- creation. A concurrent insert, tenant deletion, or reassignment cannot
  -- invalidate the pre-DDL checks while this transaction runs.
  EXECUTE format('LOCK TABLE %I.extensions IN ACCESS EXCLUSIVE MODE', expected_schema);
  EXECUTE format('LOCK TABLE %I.tenants IN SHARE ROW EXCLUSIVE MODE', expected_schema);

  -- The names could have been replaced while the locks were pending. Inspect
  -- only the exact relation identities that were resolved before locking.
  SELECT c.oid INTO locked_extensions_oid
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = expected_schema AND c.relname = 'extensions' AND c.relkind = 'r';
  SELECT c.oid INTO locked_tenants_oid
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = expected_schema AND c.relname = 'tenants' AND c.relkind = 'r';
  IF locked_extensions_oid IS DISTINCT FROM extensions_oid
     OR locked_tenants_oid IS DISTINCT FROM tenants_oid THEN
    RAISE EXCEPTION 'Phone11 extension prerequisite relation identity changed while locking'
      USING ERRCODE = '55000';
  END IF;

  SELECT a.attnum INTO extension_id_att FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = extensions_oid AND a.attname = 'id' AND NOT a.attisdropped
     AND a.atttypid = 'pg_catalog.int4'::pg_catalog.regtype;
  SELECT a.attnum, a.attnotnull, a.attidentity, a.attgenerated
    INTO tenant_id_att, tenant_nullable, tenant_identity, tenant_generated
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = extensions_oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     AND a.atttypid = 'pg_catalog.int4'::pg_catalog.regtype;
  SELECT a.attnum INTO tenants_id_att FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = tenants_oid AND a.attname = 'id' AND NOT a.attisdropped
     AND a.atttypid = 'pg_catalog.int4'::pg_catalog.regtype;
  IF extension_id_att IS NULL OR tenant_id_att IS NULL OR tenants_id_att IS NULL
     OR tenant_identity <> '' OR tenant_generated <> ''
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = extensions_oid
         AND c.contype = 'p' AND c.conkey = ARRAY[extension_id_att]::smallint[]
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = tenants_oid
         AND c.contype = 'p' AND c.conkey = ARRAY[tenants_id_att]::smallint[]
     ) OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_attrdef d
        WHERE d.adrelid = extensions_oid AND d.adnum = tenant_id_att
     )
  THEN
    RAISE EXCEPTION 'Phone11 extension prerequisite catalog is incompatible'
      USING ERRCODE = '55000';
  END IF;

  SELECT c.contype, c.confrelid, c.conkey, c.confkey, c.convalidated,
         c.condeferrable, c.confupdtype, c.confdeltype
    INTO named_fk
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = extensions_oid AND c.conname = 'phone11_extensions_tenant_fk';
  SELECT count(*) INTO tenant_fk_count
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = extensions_oid AND c.contype = 'f'
     AND tenant_id_att = ANY(c.conkey);

  IF named_fk IS NULL THEN
    IF tenant_nullable OR tenant_fk_count <> 0 THEN
      RAISE EXCEPTION 'Phone11 extension prerequisite is partially applied or has a foreign-key conflict'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NOT (
    tenant_nullable AND tenant_fk_count = 1 AND named_fk.contype = 'f'
    AND named_fk.confrelid = tenants_oid
    AND named_fk.conkey = ARRAY[tenant_id_att]::smallint[]
    AND named_fk.confkey = ARRAY[tenants_id_att]::smallint[]
    AND named_fk.convalidated AND NOT named_fk.condeferrable
    AND named_fk.confupdtype = 'a' AND named_fk.confdeltype = 'a'
  ) THEN
    RAISE EXCEPTION 'Phone11 extension prerequisite named foreign key is incompatible'
      USING ERRCODE = '55000';
  ELSE
    RETURN; -- exact validated replay state; no DDL
  END IF;

  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM %I.extensions e LEFT JOIN %I.tenants t ON t.id = e.tenant_id WHERE e.tenant_id IS NULL OR t.id IS NULL)',
    expected_schema, expected_schema
  ) INTO has_invalid_rows;
  IF has_invalid_rows THEN
    RAISE EXCEPTION 'Phone11 extension prerequisite found NULL or orphaned tenant assignments'
      USING ERRCODE = '23514';
  END IF;

  EXECUTE format('ALTER TABLE %I.extensions ALTER COLUMN tenant_id SET NOT NULL', expected_schema);
  EXECUTE format(
    'ALTER TABLE %I.extensions ADD CONSTRAINT phone11_extensions_tenant_fk FOREIGN KEY (tenant_id) REFERENCES %I.tenants(id) NOT VALID',
    expected_schema, expected_schema
  );
  EXECUTE format(
    'ALTER TABLE %I.extensions VALIDATE CONSTRAINT phone11_extensions_tenant_fk',
    expected_schema
  );
END;
$phone11$;
COMMIT;
