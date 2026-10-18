-- Explicit PostgreSQL fraud-policy storage contract. Never run at application
-- startup. Supply phone11.expected_database and phone11.expected_schema after
-- selecting the reviewed target. Run standalone on a fresh idle connection:
-- this file owns BEGIN/COMMIT. Never wrap it in a caller transaction, whose
-- work COMMIT would also commit. No tenant rows are seeded or modified.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $fraud_target$
DECLARE
  expected_database text := pg_catalog.current_setting('phone11.expected_database', true);
  expected_schema text := pg_catalog.current_setting('phone11.expected_schema', true);
  selected_schema text := pg_catalog.current_schema();
  tenants_oid oid;
  locked_oid oid;
  id_att smallint;
  fraud_oid oid;
BEGIN
  PERFORM pg_catalog.set_config('search_path', 'pg_catalog', true);
  IF expected_database IS NULL OR expected_database = ''
     OR expected_schema IS NULL OR expected_schema = ''
     OR expected_schema IN ('pg_catalog', 'information_schema') OR left(expected_schema, 3) = 'pg_'
     OR pg_catalog.current_database() IS DISTINCT FROM expected_database OR selected_schema IS DISTINCT FROM expected_schema
     OR pg_catalog.current_setting('transaction_isolation') <> 'read committed'
     OR pg_catalog.current_setting('session_replication_role') <> 'origin'
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger)
  THEN RAISE EXCEPTION 'Phone11 fraud migration target or session is unsupported' USING ERRCODE='55000'; END IF;
  SELECT c.oid INTO tenants_oid
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=expected_schema AND c.relname='tenants'
     AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition;
  IF tenants_oid IS NULL OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=tenants_oid OR inhparent=tenants_oid)
  THEN RAISE EXCEPTION 'Phone11 fraud migration requires ordinary tenants' USING ERRCODE='55000'; END IF;
  EXECUTE pg_catalog.format('LOCK TABLE %I.tenants IN SHARE ROW EXCLUSIVE MODE', expected_schema);
  SELECT c.oid INTO locked_oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=expected_schema AND c.relname='tenants' AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition;
  IF locked_oid IS DISTINCT FROM tenants_oid
  THEN RAISE EXCEPTION 'Phone11 tenants identity changed while locking' USING ERRCODE='55000'; END IF;
  SELECT attnum INTO id_att FROM pg_catalog.pg_attribute
   WHERE attrelid=tenants_oid AND attname='id' AND attnum>0 AND NOT attisdropped
     AND atttypid='pg_catalog.int4'::pg_catalog.regtype AND attnotnull AND attidentity='' AND attgenerated='';
  IF id_att IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid=tenants_oid AND contype='p' AND conkey=ARRAY[id_att]::smallint[]
       AND convalidated AND NOT condeferrable AND conparentid=0)
  THEN RAISE EXCEPTION 'Phone11 fraud tenant primary key is unsupported' USING ERRCODE='55000'; END IF;

  SELECT c.oid INTO fraud_oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=expected_schema AND c.relname='fraud_controls';
  IF fraud_oid IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=fraud_oid AND relkind='r' AND relpersistence='p' AND NOT relispartition)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=fraud_oid OR inhparent=fraud_oid)
    THEN RAISE EXCEPTION 'Existing fraud_controls is not an ordinary table' USING ERRCODE='55000'; END IF;
    EXECUTE pg_catalog.format('LOCK TABLE %I.fraud_controls IN ACCESS EXCLUSIVE MODE', expected_schema);
    SELECT c.oid INTO locked_oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=expected_schema AND c.relname='fraud_controls';
    IF locked_oid IS DISTINCT FROM fraud_oid
    THEN RAISE EXCEPTION 'Phone11 fraud identity changed while locking' USING ERRCODE='55000'; END IF;
  END IF;
  IF pg_catalog.to_regclass('pg_temp.phone11_fraud_expected') IS NOT NULL
  THEN RAISE EXCEPTION 'Phone11 fraud model name is already in use' USING ERRCODE='55000'; END IF;
  PERFORM pg_catalog.set_config('search_path', pg_catalog.format('%I,pg_temp', expected_schema), true);
END
$fraud_target$;

-- A session-local, row-free model lets PostgreSQL compare native type/default/
-- CHECK expressions on both new and existing tables without version-dependent
-- pretty-print literals. It is dropped automatically by this transaction.
CREATE TEMP TABLE phone11_fraud_expected (
  tenant_id integer NOT NULL,
  max_concurrent_outbound double precision,
  calls_per_minute_limit double precision,
  daily_cost_ceiling double precision,
  international_enabled boolean NOT NULL DEFAULT false,
  premium_rate_enabled boolean NOT NULL DEFAULT false,
  geo_block_list jsonb,
  geo_allow_list jsonb,
  alert_email text,
  alert_on_daily_ceiling boolean,
  auto_disable_on_ceiling boolean,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT phone11_fraud_concurrent_range CHECK (max_concurrent_outbound >= 1 AND max_concurrent_outbound <= 100),
  CONSTRAINT phone11_fraud_rate_range CHECK (calls_per_minute_limit >= 1 AND calls_per_minute_limit <= 100),
  CONSTRAINT phone11_fraud_cost_range CHECK (daily_cost_ceiling >= 0 AND daily_cost_ceiling < 'Infinity'::double precision),
  CONSTRAINT phone11_fraud_geo_block_strings CHECK (jsonb_typeof(geo_block_list) = 'array' AND NOT jsonb_path_exists(geo_block_list, '$[*] ? (@.type() != "string")')),
  CONSTRAINT phone11_fraud_geo_allow_strings CHECK (jsonb_typeof(geo_allow_list) = 'array' AND NOT jsonb_path_exists(geo_allow_list, '$[*] ? (@.type() != "string")'))
) ON COMMIT DROP;

CREATE TABLE IF NOT EXISTS fraud_controls (
  LIKE pg_temp.phone11_fraud_expected INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
  CONSTRAINT phone11_fraud_controls_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT phone11_fraud_controls_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

DO $fraud_abi$
DECLARE
  expected_schema text := pg_catalog.current_setting('phone11.expected_schema');
  relation_oid oid;
  tenants_oid oid;
  model_oid oid := 'pg_temp.phone11_fraud_expected'::pg_catalog.regclass;
  tenant_att smallint;
  id_att smallint;
  fk_oid oid;
BEGIN
  PERFORM pg_catalog.set_config('search_path', 'pg_catalog', true);
  SELECT c.oid INTO relation_oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=expected_schema AND c.relname='fraud_controls' AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition;
  IF relation_oid IS NULL THEN RAISE EXCEPTION 'fraud_controls ordinary table is missing' USING ERRCODE='55000'; END IF;
  EXECUTE pg_catalog.format('LOCK TABLE %I.fraud_controls IN ACCESS EXCLUSIVE MODE', expected_schema);
  IF relation_oid IS DISTINCT FROM pg_catalog.to_regclass(pg_catalog.format('%I.fraud_controls', expected_schema))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=relation_oid OR inhparent=relation_oid)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=relation_oid AND (relrowsecurity OR relforcerowsecurity))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=relation_oid)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid=relation_oid AND NOT tgisinternal)
  THEN RAISE EXCEPTION 'Existing fraud_controls identity or policies are unsupported' USING ERRCODE='55000'; END IF;

  -- Refuse partial, extra (including extra NOT NULL), dropped, generated,
  -- reordered or differently defaulted columns instead of silently repairing.
  IF EXISTS (
    SELECT 1 FROM
      (SELECT a.*,pg_catalog.pg_get_expr(d.adbin,d.adrelid,false) AS default_expr
         FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=relation_oid AND a.attnum>0) actual
      FULL JOIN
      (SELECT a.*,pg_catalog.pg_get_expr(d.adbin,d.adrelid,false) AS default_expr
         FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=model_oid AND a.attnum>0) expected USING (attnum)
     WHERE actual.attname IS DISTINCT FROM expected.attname
        OR actual.atttypid IS DISTINCT FROM expected.atttypid OR actual.atttypmod IS DISTINCT FROM expected.atttypmod
        OR actual.attnotnull IS DISTINCT FROM expected.attnotnull OR actual.attcollation IS DISTINCT FROM expected.attcollation
        OR actual.attndims IS DISTINCT FROM expected.attndims OR actual.attidentity IS DISTINCT FROM expected.attidentity
        OR actual.attgenerated IS DISTINCT FROM expected.attgenerated OR actual.attisdropped IS DISTINCT FROM false
        OR actual.attislocal IS DISTINCT FROM true OR actual.attinhcount IS DISTINCT FROM 0
        OR actual.default_expr IS DISTINCT FROM expected.default_expr
  ) THEN RAISE EXCEPTION 'Existing fraud_controls column ABI is incompatible' USING ERRCODE='55000'; END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid=relation_oid AND contype IN ('c','p','f')) <> 7
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=relation_oid AND contype NOT IN ('c','p','f','n'))
     OR EXISTS (
       SELECT 1 FROM
        (SELECT * FROM pg_catalog.pg_constraint WHERE conrelid=relation_oid AND contype='c') actual
        FULL JOIN (SELECT * FROM pg_catalog.pg_constraint WHERE conrelid=model_oid AND contype='c') expected USING (conname)
       WHERE actual.oid IS NULL OR expected.oid IS NULL OR NOT actual.convalidated OR actual.condeferrable OR actual.conparentid<>0
          OR NOT actual.conislocal OR actual.coninhcount<>0 OR actual.connoinherit
          OR pg_catalog.pg_get_expr(actual.conbin,actual.conrelid,false) IS DISTINCT FROM pg_catalog.pg_get_expr(expected.conbin,expected.conrelid,false)
     )
  THEN RAISE EXCEPTION 'Existing fraud_controls CHECK ABI is incompatible' USING ERRCODE='55000'; END IF;
  SELECT attnum INTO tenant_att FROM pg_catalog.pg_attribute WHERE attrelid=relation_oid AND attname='tenant_id' AND NOT attisdropped;
  SELECT pg_catalog.to_regclass(pg_catalog.format('%I.tenants', expected_schema)) INTO tenants_oid;
  SELECT attnum INTO id_att FROM pg_catalog.pg_attribute WHERE attrelid=tenants_oid AND attname='id' AND NOT attisdropped;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_index i ON i.indexrelid=c.conindid
      JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid JOIN pg_catalog.pg_am am ON am.oid=idx.relam
     WHERE c.conrelid=relation_oid AND c.contype='p' AND c.conkey=ARRAY[tenant_att]::smallint[] AND c.convalidated
       AND NOT c.condeferrable AND NOT c.condeferred AND c.conparentid=0 AND c.conislocal AND c.coninhcount=0 AND i.indisvalid AND i.indisready AND i.indislive
       AND i.indisunique AND i.indisprimary AND i.indimmediate AND i.indpred IS NULL AND i.indexprs IS NULL
       AND i.indnkeyatts=1 AND i.indnatts=1 AND am.amname='btree'
       AND i.indcollation[0]=0 AND i.indoption[0]=0
       AND i.indclass[0]=(SELECT o.oid FROM pg_catalog.pg_opclass o JOIN pg_catalog.pg_namespace n ON n.oid=o.opcnamespace
                          WHERE n.nspname='pg_catalog' AND o.opcname='int4_ops' AND o.opcmethod=am.oid))
     OR (SELECT count(*) FROM pg_catalog.pg_index WHERE indrelid=relation_oid) <> 1
  THEN RAISE EXCEPTION 'Existing fraud_controls primary key ABI is incompatible' USING ERRCODE='55000'; END IF;
  SELECT oid INTO fk_oid FROM pg_catalog.pg_constraint
   WHERE conrelid=relation_oid AND contype='f' AND conkey=ARRAY[tenant_att]::smallint[]
     AND confrelid=tenants_oid AND confkey=ARRAY[id_att]::smallint[] AND convalidated
     AND NOT condeferrable AND NOT condeferred AND conparentid=0 AND conislocal AND coninhcount=0 AND confdeltype='c' AND confupdtype='a' AND confmatchtype='s';
  IF fk_oid IS NULL OR (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgconstraint=fk_oid) <> 4
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgconstraint=fk_oid AND (NOT tgisinternal OR tgenabled<>'O'))
  THEN RAISE EXCEPTION 'Existing fraud_controls foreign key ABI is incompatible' USING ERRCODE='55000'; END IF;

  -- Default ACLs apply at creation, before this transaction commits. Forced RLS
  -- does not constrain TRUNCATE/TRIGGER or sequence authority. Refuse unexpected
  -- effective table/column ACL entries on new AND existing objects; never repair.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
      WHERE c.oid=relation_oid AND (acl.grantee<>c.relowner OR acl.grantor<>c.relowner))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl
      WHERE a.attrelid=relation_oid AND a.attnum>0 AND (acl.grantee<>c.relowner OR acl.grantor<>c.relowner))
  THEN RAISE EXCEPTION 'Phone11 fraud_controls ownership ACL is incompatible' USING ERRCODE='55000'; END IF;
END
$fraud_abi$;
COMMIT;
