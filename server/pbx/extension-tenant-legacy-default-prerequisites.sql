-- REVIEW CANDIDATE ONLY: operator-only upgrade for the observed nullable
-- int4 extensions.tenant_id DEFAULT 1 without a tenant FK. Supply the exact
-- reviewed target and an action acknowledgement as session settings:
--   SET phone11.expected_database = '<reviewed database>';
--   SET phone11.expected_schema = '<reviewed schema>';
--   SET phone11.allow_reviewed_legacy_tenant_default_removal = 'true';
-- The acknowledgement does not prove writer or rollback compatibility.
-- Never run at application startup. This file assigns no tenants or roles.
-- Run this entire file on a fresh idle operator connection, outside any
-- existing transaction or generic migration runner. Its BEGIN/COMMIT own the
-- transaction; a READ COMMITTED wrapper could commit unrelated caller work.
-- The effective-isolation check rejects stale RR/SERIALIZABLE sessions but
-- does not make a wrapped READ COMMITTED transaction safe.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $phone11$
DECLARE
  expected_database text := pg_catalog.current_setting('phone11.expected_database', true);
  expected_schema text := pg_catalog.current_setting('phone11.expected_schema', true);
  removal_ack text := pg_catalog.current_setting('phone11.allow_reviewed_legacy_tenant_default_removal', true);
  actual_schema text := pg_catalog.current_schema();
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
  extension_id_identity text;
  extension_id_generated text;
  tenants_id_identity text;
  tenants_id_generated text;
  tenant_default text;
  named_fk record;
  tenant_fk_count integer;
  has_invalid_rows boolean;
  is_replay boolean := false;
BEGIN
  -- Capture the caller's schema above, then pin operator and function lookup
  -- before any comparisons. A caller-controlled earlier namespace must not
  -- supply text/name operators for the target or acknowledgement checks.
  PERFORM pg_catalog.set_config('search_path', 'pg_catalog', true);

  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Phone11 legacy prerequisite requires READ COMMITTED isolation'
      USING ERRCODE = '55000';
  END IF;
  IF pg_catalog.current_setting('session_replication_role') <> 'origin' THEN
    RAISE EXCEPTION 'Phone11 legacy prerequisite requires origin replication role'
      USING ERRCODE = '55000';
  END IF;
  IF expected_database IS NULL OR expected_database = ''
     OR expected_schema IS NULL OR expected_schema = ''
     OR removal_ack IS DISTINCT FROM 'true'
     OR pg_catalog.current_database() <> expected_database
     OR actual_schema <> expected_schema
  THEN
    RAISE EXCEPTION 'Phone11 legacy prerequisite target pins or acknowledgement missing/mismatched'
      USING ERRCODE = '55000';
  END IF;

  -- Every application relation below remains explicitly schema-qualified.

  SELECT c.oid INTO extensions_oid
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = expected_schema AND c.relname = 'extensions'
     AND c.relkind = 'r' AND c.relpersistence = 'p';
  SELECT c.oid INTO tenants_oid
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = expected_schema AND c.relname = 'tenants'
     AND c.relkind = 'r' AND c.relpersistence = 'p';
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
   WHERE n.nspname = expected_schema AND c.relname = 'extensions'
     AND c.relkind = 'r' AND c.relpersistence = 'p';
  SELECT c.oid INTO locked_tenants_oid
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = expected_schema AND c.relname = 'tenants'
     AND c.relkind = 'r' AND c.relpersistence = 'p';
  IF locked_extensions_oid IS DISTINCT FROM extensions_oid
     OR locked_tenants_oid IS DISTINCT FROM tenants_oid THEN
    RAISE EXCEPTION 'Phone11 extension prerequisite relation identity changed while locking'
      USING ERRCODE = '55000';
  END IF;

  -- FK constraints on traditional inheritance parents do not protect child
  -- inserts. Reject either target as an inheritance parent or child, including
  -- partition leaves. Check only after the table locks and OID recheck so the
  -- catalog decision is tied to the locked relation identities.
  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_inherits i
        WHERE i.inhrelid IN (extensions_oid, tenants_oid)
           OR i.inhparent IN (extensions_oid, tenants_oid)
     ) OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_class c
        WHERE c.oid IN (extensions_oid, tenants_oid) AND c.relispartition
     ) THEN
    RAISE EXCEPTION 'Phone11 legacy prerequisite does not support inherited or partitioned target tables'
      USING ERRCODE = '55000';
  END IF;

  SELECT a.attnum, a.attidentity, a.attgenerated
    INTO extension_id_att, extension_id_identity, extension_id_generated
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = extensions_oid AND a.attname = 'id' AND NOT a.attisdropped
     AND a.atttypid = 'pg_catalog.int4'::pg_catalog.regtype;
  SELECT a.attnum, a.attnotnull, a.attidentity, a.attgenerated
    INTO tenant_id_att, tenant_nullable, tenant_identity, tenant_generated
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = extensions_oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     AND a.atttypid = 'pg_catalog.int4'::pg_catalog.regtype;
  SELECT a.attnum, a.attidentity, a.attgenerated
    INTO tenants_id_att, tenants_id_identity, tenants_id_generated
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = tenants_oid AND a.attname = 'id' AND NOT a.attisdropped
     AND a.atttypid = 'pg_catalog.int4'::pg_catalog.regtype;
  IF extension_id_att IS NULL OR tenant_id_att IS NULL OR tenants_id_att IS NULL
     OR tenant_identity <> '' OR tenant_generated <> ''
     OR extension_id_identity <> '' OR extension_id_generated <> ''
     OR tenants_id_identity <> '' OR tenants_id_generated <> ''
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = extensions_oid
         AND c.contype = 'p' AND c.conkey = ARRAY[extension_id_att]::smallint[]
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = tenants_oid
         AND c.contype = 'p' AND c.conkey = ARRAY[tenants_id_att]::smallint[]
     )
  THEN
    RAISE EXCEPTION 'Phone11 extension prerequisite catalog is incompatible'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    INTO tenant_default
    FROM pg_catalog.pg_attrdef d
   WHERE d.adrelid = extensions_oid AND d.adnum = tenant_id_att;
  IF tenant_default IS NOT NULL AND tenant_default <> '1' THEN
    RAISE EXCEPTION 'Phone11 legacy prerequisite tenant default is not canonical constant 1'
      USING ERRCODE = '55000';
  END IF;

  SELECT c.oid, c.contype, c.confrelid, c.conkey, c.confkey, c.convalidated,
         c.condeferrable, c.condeferred, c.confmatchtype,
         c.confupdtype, c.confdeltype, c.conislocal, c.coninhcount, c.conparentid
    INTO named_fk
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = extensions_oid AND c.conname = 'phone11_extensions_tenant_fk';
  SELECT count(*) INTO tenant_fk_count
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = extensions_oid AND c.contype = 'f'
     AND tenant_id_att = ANY(c.conkey);

  IF named_fk IS NULL THEN
    IF tenant_nullable OR tenant_fk_count <> 0 OR tenant_default IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'Phone11 extension prerequisite is partially applied or has a foreign-key conflict'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NOT coalesce((
    tenant_nullable AND tenant_fk_count = 1 AND tenant_default IS NULL
    AND named_fk.contype = 'f'
    AND named_fk.confrelid = tenants_oid
    AND named_fk.conkey = ARRAY[tenant_id_att]::smallint[]
    AND named_fk.confkey = ARRAY[tenants_id_att]::smallint[]
    AND named_fk.convalidated AND NOT named_fk.condeferrable
    AND NOT named_fk.condeferred AND named_fk.confmatchtype = 's'
    AND named_fk.confupdtype = 'a' AND named_fk.confdeltype = 'a'
    AND named_fk.conislocal AND named_fk.coninhcount = 0
    AND named_fk.conparentid = 0
  ), false) THEN
    RAISE EXCEPTION 'Phone11 extension prerequisite named foreign key is incompatible'
      USING ERRCODE = '55000';
  ELSE
    is_replay := true;
  END IF;

  IF is_replay AND (
    (SELECT count(*) FROM pg_catalog.pg_trigger t
      WHERE t.tgconstraint = named_fk.oid) <> 4
    OR (SELECT count(*) FROM pg_catalog.pg_trigger t
      WHERE t.tgconstraint = named_fk.oid AND t.tgisinternal
        AND t.tgenabled IN ('O', 'A')
        AND t.tgrelid IN (extensions_oid, tenants_oid)) <> 4
    OR (SELECT count(*) FROM pg_catalog.pg_trigger t
      WHERE t.tgconstraint = named_fk.oid AND t.tgrelid = extensions_oid) <> 2
    OR (SELECT count(*) FROM pg_catalog.pg_trigger t
      WHERE t.tgconstraint = named_fk.oid AND t.tgrelid = tenants_oid) <> 2
  ) THEN
    RAISE EXCEPTION 'Phone11 legacy prerequisite named foreign-key triggers are incomplete or disabled'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM %I.extensions e LEFT JOIN %I.tenants t ON t.id = e.tenant_id WHERE e.tenant_id IS NULL OR t.id IS NULL)',
    expected_schema, expected_schema
  ) INTO has_invalid_rows;
  IF has_invalid_rows THEN
    RAISE EXCEPTION 'Phone11 extension prerequisite found NULL or orphaned tenant assignments'
      USING ERRCODE = '23514';
  END IF;

  IF is_replay THEN
    RETURN; -- exact validated replay state and clean data; no DDL
  END IF;

  EXECUTE format('ALTER TABLE %I.extensions ALTER COLUMN tenant_id DROP DEFAULT', expected_schema);
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
