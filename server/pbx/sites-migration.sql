-- Explicit reviewed migration for Phone11 sites and tenant-scoped address links.
-- Run AFTER phone-numbers-migration.sql, standalone on a fresh idle connection.
-- Never run at application startup. Creates no sites, addresses or call routes.
-- Supply phone11.expected_database/schema after independent target review.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $target$
DECLARE
  db text := pg_catalog.current_setting('phone11.expected_database', true);
  ns text := pg_catalog.current_setting('phone11.expected_schema', true);
  relation_name text;
  relation_oid oid;
  locked_oid oid;
BEGIN
  IF db IS NULL OR db = '' OR ns IS NULL OR ns = ''
     OR pg_catalog.current_database() <> db OR pg_catalog.current_schema() <> ns
     OR pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Phone11 sites migration target pin mismatch' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_catalog.set_config('search_path', pg_catalog.format('%I, pg_temp', ns), true);
  FOREACH relation_name IN ARRAY ARRAY['tenants','emergency_addresses','sites'] LOOP
    SELECT c.oid INTO relation_oid FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=ns AND c.relname=relation_name;
    IF relation_oid IS NULL THEN
      IF relation_name <> 'sites' THEN
        RAISE EXCEPTION 'Phone11 sites migration requires tenants and phone-number address migration' USING ERRCODE='55000';
      END IF;
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=relation_oid
      AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=relation_oid OR inhparent=relation_oid) THEN
      RAISE EXCEPTION 'Phone11 sites migration requires ordinary non-inherited relations' USING ERRCODE='55000';
    END IF;
    EXECUTE pg_catalog.format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE', ns, relation_name);
    SELECT c.oid INTO locked_oid FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=ns AND c.relname=relation_name;
    IF locked_oid IS DISTINCT FROM relation_oid THEN
      RAISE EXCEPTION 'Phone11 sites relation identity changed while locking' USING ERRCODE='55000';
    END IF;
  END LOOP;
END;
$target$;

CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL CONSTRAINT phone11_site_tenant_fk REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address_line1 TEXT,
  city TEXT,
  state_province TEXT,
  postal_code TEXT,
  country TEXT NOT NULL DEFAULT 'TH',
  timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  is_main BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT phone11_site_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT phone11_site_fields CHECK (
    btrim(name) <> '' AND country ~ '^[A-Z]{2}$'
    AND btrim(timezone) <> '' AND status IN ('active','inactive')
  )
);

-- Source-derived templates compare expressions using this PostgreSQL version's
-- own deparser. No production rows are copied or repaired by this migration.
CREATE TEMP TABLE phone11_sites_contract (
  id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
  name TEXT NOT NULL, address_line1 TEXT, city TEXT, state_province TEXT,
  postal_code TEXT, country TEXT NOT NULL DEFAULT 'TH',
  timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok', is_main BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id,tenant_id),
  CHECK (btrim(name) <> '' AND country ~ '^[A-Z]{2}$'
    AND btrim(timezone) <> '' AND status IN ('active','inactive'))
) ON COMMIT DROP;
CREATE TEMP TABLE phone11_address_contract (
  street TEXT, city VARCHAR(160), country VARCHAR(2), status TEXT, site_id INTEGER,
  CONSTRAINT address_before CHECK (btrim(street) <> '' AND btrim(city) <> ''
    AND country ~ '^[A-Z]{2}$' AND status IN ('active','inactive') AND site_id IS NULL),
  CONSTRAINT address_after CHECK (btrim(street) <> '' AND btrim(city) <> ''
    AND country ~ '^[A-Z]{2}$' AND status IN ('active','inactive'))
) ON COMMIT DROP;
DO $contract$
DECLARE
  s oid := 'sites'::regclass;
  a oid := 'emergency_addresses'::regclass;
  site_id_att smallint;
  site_tenant_att smallint;
  expected_check text;
  actual_check text;
BEGIN
  IF EXISTS (
    SELECT attname,atttypid,atttypmod,attnotnull,attidentity,attgenerated
      FROM pg_catalog.pg_attribute WHERE attrelid=s AND attnum>0 AND NOT attisdropped
    EXCEPT SELECT attname,atttypid,atttypmod,attnotnull,attidentity,attgenerated
      FROM pg_catalog.pg_attribute WHERE attrelid='pg_temp.phone11_sites_contract'::regclass AND attnum>0 AND NOT attisdropped
  ) OR EXISTS (
    SELECT attname,atttypid,atttypmod,attnotnull,attidentity,attgenerated
      FROM pg_catalog.pg_attribute WHERE attrelid='pg_temp.phone11_sites_contract'::regclass AND attnum>0 AND NOT attisdropped
    EXCEPT SELECT attname,atttypid,atttypmod,attnotnull,attidentity,attgenerated
      FROM pg_catalog.pg_attribute WHERE attrelid=s AND attnum>0 AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Phone11 sites incompatible columns; stop for review' USING ERRCODE='55000';
  END IF;
  SELECT attnum INTO site_id_att FROM pg_catalog.pg_attribute WHERE attrelid=s AND attname='id' AND NOT attisdropped;
  SELECT attnum INTO site_tenant_att FROM pg_catalog.pg_attribute WHERE attrelid=s AND attname='tenant_id' AND NOT attisdropped;
  IF pg_catalog.pg_get_serial_sequence('sites','id') IS NULL
    OR (SELECT pg_catalog.pg_get_expr(d.adbin,d.adrelid) FROM pg_catalog.pg_attrdef d
      JOIN pg_catalog.pg_attribute c ON c.attrelid=d.adrelid AND c.attnum=d.adnum
      WHERE c.attrelid=s AND c.attname='id') IS DISTINCT FROM
      pg_catalog.format('nextval(%L::regclass)', pg_catalog.pg_get_serial_sequence('sites','id')::regclass::text) THEN
    RAISE EXCEPTION 'Phone11 sites requires owned id sequence' USING ERRCODE='55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute e
      JOIN pg_catalog.pg_attribute x ON x.attrelid=s AND x.attname=e.attname
      LEFT JOIN pg_catalog.pg_attrdef ed ON ed.adrelid=e.attrelid AND ed.adnum=e.attnum
      LEFT JOIN pg_catalog.pg_attrdef xd ON xd.adrelid=x.attrelid AND xd.adnum=x.attnum
      WHERE e.attrelid='pg_temp.phone11_sites_contract'::regclass AND e.attnum>0 AND e.attname<>'id'
      AND pg_catalog.pg_get_expr(ed.adbin,ed.adrelid) IS DISTINCT FROM pg_catalog.pg_get_expr(xd.adbin,xd.adrelid)
  ) OR (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid=s AND contype IN ('p','u','c')) <> 3
    OR EXISTS (
      SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
        WHERE conrelid='pg_temp.phone11_sites_contract'::regclass AND contype IN ('p','u','c')
      EXCEPT SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
        WHERE conrelid=s AND contype IN ('p','u','c') AND convalidated AND NOT condeferrable
    ) THEN
    RAISE EXCEPTION 'Phone11 sites incompatible defaults or constraints; stop for review' USING ERRCODE='55000';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid=s AND contype='f') <> 1
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint f
      WHERE f.conrelid=s AND f.conname='phone11_site_tenant_fk' AND f.contype='f'
      AND f.confrelid='tenants'::regclass AND f.conkey=ARRAY[site_tenant_att]::smallint[]
      AND f.confkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid='tenants'::regclass AND attname='id')]::smallint[]
      AND f.confdeltype='c' AND f.confupdtype='a' AND f.confmatchtype='s'
      AND f.convalidated AND NOT f.condeferrable)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_constraint f ON f.oid=t.tgconstraint
      WHERE f.conrelid=s AND f.contype='f' AND t.tgenabled NOT IN ('O','A')) THEN
    RAISE EXCEPTION 'Phone11 sites incompatible tenant foreign key; stop for review' USING ERRCODE='55000';
  END IF;
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO actual_check FROM pg_catalog.pg_constraint
    WHERE conrelid=a AND conname='phone11_emergency_address_fields' AND contype='c' AND convalidated;
  IF actual_check IS NULL OR actual_check NOT IN (
    SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
      WHERE conrelid='pg_temp.phone11_address_contract'::regclass
  ) THEN
    RAISE EXCEPTION 'Phone11 address field guard differs; stop for review' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=a AND contype='f'
    AND (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=a AND attname='site_id')=ANY(conkey)
    AND conname<>'phone11_emergency_site_tenant_fk') THEN
    RAISE EXCEPTION 'Phone11 address has unexpected site foreign key; stop for review' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=a AND conname='phone11_emergency_site_tenant_fk') THEN
    ALTER TABLE emergency_addresses ADD CONSTRAINT phone11_emergency_site_tenant_fk
      FOREIGN KEY (site_id,tenant_id) REFERENCES sites(id,tenant_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint f WHERE f.conrelid=a
    AND f.conname='phone11_emergency_site_tenant_fk' AND f.contype='f' AND f.confrelid=s
    AND f.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=a AND attname='site_id'),
      (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=a AND attname='tenant_id')]::smallint[]
    AND f.confkey=ARRAY[site_id_att,site_tenant_att]::smallint[] AND f.confdeltype='r' AND f.confupdtype='a'
    AND f.confmatchtype='s' AND f.convalidated AND NOT f.condeferrable)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_constraint f ON f.oid=t.tgconstraint
      WHERE f.conrelid=a AND f.conname='phone11_emergency_site_tenant_fk' AND t.tgenabled NOT IN ('O','A')) THEN
    RAISE EXCEPTION 'Phone11 address site foreign key differs; stop for review' USING ERRCODE='55000';
  END IF;
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO expected_check FROM pg_catalog.pg_constraint
    WHERE conrelid='pg_temp.phone11_address_contract'::regclass AND conname='address_after';
  IF actual_check <> expected_check THEN
    ALTER TABLE emergency_addresses DROP CONSTRAINT phone11_emergency_address_fields;
    EXECUTE 'ALTER TABLE emergency_addresses ADD CONSTRAINT phone11_emergency_address_fields ' || expected_check;
  END IF;
END;
$contract$;

CREATE OR REPLACE FUNCTION phone11_site_tenant_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'site tenant is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS phone11_site_tenant_immutable ON sites;
CREATE TRIGGER phone11_site_tenant_immutable BEFORE UPDATE OF tenant_id ON sites
  FOR EACH ROW EXECUTE FUNCTION phone11_site_tenant_immutable();
CREATE INDEX IF NOT EXISTS phone11_sites_tenant_active ON sites(tenant_id,is_main DESC,name) WHERE status='active';
COMMIT;
