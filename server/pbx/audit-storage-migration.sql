-- Explicit Phone11 PostgreSQL 16/17 audit storage. Not an application startup task.
-- Run this whole file standalone on a fresh idle operator connection; it owns
-- BEGIN/COMMIT and must never commit a caller's existing transaction.
-- Set phone11.expected_database, phone11.expected_schema and
-- phone11.expected_server_major (16 or 17), then select that schema.
-- No tenant/customer rows, runtime grants, roles or permissive policies are made.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $audit_target$
DECLARE
  db text := pg_catalog.current_setting('phone11.expected_database', true);
  ns text := pg_catalog.current_setting('phone11.expected_schema', true);
  selected text := pg_catalog.current_schema();
  tenants_oid oid;
  locked_oid oid;
  id_att smallint;
  audit_oid oid;
BEGIN
  PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
  IF db IS NULL OR db='' OR ns IS NULL OR ns='' OR left(ns,3)='pg_' OR ns='information_schema'
     OR pg_catalog.current_database() IS DISTINCT FROM db OR selected IS DISTINCT FROM ns
     OR pg_catalog.current_setting('phone11.expected_server_major',true) IS NULL
     OR pg_catalog.current_setting('phone11.expected_server_major',true) NOT IN ('16','17')
     OR (pg_catalog.current_setting('server_version_num')::integer / 10000)::text IS DISTINCT FROM pg_catalog.current_setting('phone11.expected_server_major',true)
     OR pg_catalog.current_setting('transaction_isolation')<>'read committed'
     OR pg_catalog.current_setting('session_replication_role')<>'origin'
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger)
  THEN RAISE EXCEPTION 'Phone11 audit target or session is unsupported' USING ERRCODE='55000'; END IF;
  SELECT c.oid INTO tenants_oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=ns AND c.relname='tenants' AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition;
  IF tenants_oid IS NULL OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=tenants_oid OR inhparent=tenants_oid)
  THEN RAISE EXCEPTION 'Phone11 audit requires ordinary tenants' USING ERRCODE='55000'; END IF;
  EXECUTE pg_catalog.format('LOCK TABLE %I.tenants IN SHARE ROW EXCLUSIVE MODE',ns);
  SELECT c.oid INTO locked_oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=ns AND c.relname='tenants' AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition;
  IF locked_oid IS DISTINCT FROM tenants_oid
  THEN RAISE EXCEPTION 'Phone11 audit tenants identity changed' USING ERRCODE='55000'; END IF;
  SELECT attnum INTO id_att FROM pg_catalog.pg_attribute WHERE attrelid=tenants_oid AND attname='id' AND attnum>0
    AND NOT attisdropped AND atttypid='pg_catalog.int4'::pg_catalog.regtype AND attnotnull AND attgenerated='';
  IF id_att IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=tenants_oid
    AND contype='p' AND conkey=ARRAY[id_att]::smallint[] AND convalidated AND NOT condeferrable AND conparentid=0)
  THEN RAISE EXCEPTION 'Phone11 audit tenants key is unsupported' USING ERRCODE='55000'; END IF;
  SELECT c.oid INTO audit_oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=ns AND c.relname='audit_logs';
  IF audit_oid IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=audit_oid AND relkind='r' AND relpersistence='p' AND NOT relispartition)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=audit_oid OR inhparent=audit_oid)
    THEN RAISE EXCEPTION 'Existing audit storage is not ordinary' USING ERRCODE='55000'; END IF;
    EXECUTE pg_catalog.format('LOCK TABLE %I.audit_logs IN ACCESS EXCLUSIVE MODE',ns);
    IF audit_oid IS DISTINCT FROM pg_catalog.to_regclass(pg_catalog.format('%I.audit_logs',ns))
    THEN RAISE EXCEPTION 'Phone11 audit identity changed' USING ERRCODE='55000'; END IF;
  END IF;
  IF pg_catalog.to_regclass('pg_temp.phone11_audit_expected') IS NOT NULL
  THEN RAISE EXCEPTION 'Phone11 audit model name is occupied' USING ERRCODE='55000'; END IF;
  PERFORM pg_catalog.set_config('phone11.audit_prior_oid',coalesce(audit_oid::text,'0'),true);
  PERFORM pg_catalog.set_config('search_path',pg_catalog.format('%I,pg_temp',ns),true);
END
$audit_target$;

-- Native, row-free model: GENERATED ALWAYS id is allocated only by PostgreSQL;
-- actual audit.ts does not insert id/created_at. No actor FK is invented.
CREATE TEMP TABLE phone11_audit_expected (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  tenant_id integer NOT NULL,
  actor_user_id integer,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  old_value jsonb,
  new_value jsonb,
  ip_address inet,
  user_agent text,
  request_id text,
  session_id text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT phone11_audit_tenant_positive CHECK (tenant_id > 0),
  CONSTRAINT phone11_audit_actor_positive CHECK (actor_user_id IS NULL OR actor_user_id > 0),
  CONSTRAINT phone11_audit_action_nonblank CHECK (action !~ '^[[:space:]]*$'),
  CONSTRAINT phone11_audit_resource_nonblank CHECK (resource_type !~ '^[[:space:]]*$')
) ON COMMIT DROP;

DO $audit_create$
DECLARE ns text := pg_catalog.current_setting('phone11.expected_schema');
BEGIN
  IF pg_catalog.current_setting('phone11.audit_prior_oid')='0' THEN
    -- No IF NOT EXISTS race: a concurrent table-name collision refuses rather
    -- than altering a relation that this migration did not create.
    EXECUTE pg_catalog.format('CREATE TABLE %I.audit_logs (
      LIKE pg_temp.phone11_audit_expected INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING IDENTITY,
      CONSTRAINT phone11_audit_pkey PRIMARY KEY(id),
      CONSTRAINT phone11_audit_tenant_fk FOREIGN KEY(tenant_id) REFERENCES %I.tenants(id)
        ON DELETE RESTRICT ON UPDATE NO ACTION NOT DEFERRABLE)',ns,ns);
    EXECUTE pg_catalog.format('CREATE INDEX phone11_audit_tenant_created_idx ON %I.audit_logs USING btree(tenant_id,created_at DESC)',ns);
    EXECUTE pg_catalog.format('ALTER TABLE %I.audit_logs ENABLE ROW LEVEL SECURITY',ns);
    EXECUTE pg_catalog.format('ALTER TABLE %I.audit_logs FORCE ROW LEVEL SECURITY',ns);
  END IF;
END
$audit_create$;

DO $audit_abi$
DECLARE
  ns text := pg_catalog.current_setting('phone11.expected_schema');
  actual_oid oid;
  prior_oid oid := pg_catalog.current_setting('phone11.audit_prior_oid')::oid;
  model_oid oid := 'pg_temp.phone11_audit_expected'::pg_catalog.regclass;
  tenants_oid oid;
  id_att smallint;
  tenant_att smallint;
  time_att smallint;
  tenants_id smallint;
  seq_oid oid;
  fk_oid oid;
BEGIN
  PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
  SELECT c.oid INTO actual_oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=ns AND c.relname='audit_logs' AND c.relkind='r' AND c.relpersistence='p'
     AND NOT c.relispartition AND c.relrowsecurity AND c.relforcerowsecurity;
  IF actual_oid IS NULL OR (prior_oid<>0 AND actual_oid<>prior_oid)
  THEN RAISE EXCEPTION 'Phone11 audit identity or forced RLS is incompatible' USING ERRCODE='55000'; END IF;
  EXECUTE pg_catalog.format('LOCK TABLE %I.audit_logs IN ACCESS EXCLUSIVE MODE',ns);
  IF actual_oid IS DISTINCT FROM pg_catalog.to_regclass(pg_catalog.format('%I.audit_logs',ns))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=actual_oid OR inhparent=actual_oid)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=actual_oid)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid=actual_oid AND NOT tgisinternal)
  THEN RAISE EXCEPTION 'Phone11 audit existing policies or triggers need separate review' USING ERRCODE='55000'; END IF;
  IF EXISTS (
    SELECT 1 FROM
      (SELECT a.*,pg_catalog.pg_get_expr(d.adbin,d.adrelid,false) AS default_expr
        FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=actual_oid AND a.attnum>0) actual
      FULL JOIN
      (SELECT a.*,pg_catalog.pg_get_expr(d.adbin,d.adrelid,false) AS default_expr
        FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=model_oid AND a.attnum>0) expected USING(attnum)
    WHERE actual.attname IS DISTINCT FROM expected.attname OR actual.atttypid IS DISTINCT FROM expected.atttypid
      OR actual.atttypmod IS DISTINCT FROM expected.atttypmod OR actual.attnotnull IS DISTINCT FROM expected.attnotnull
      OR actual.attcollation IS DISTINCT FROM expected.attcollation OR actual.attndims IS DISTINCT FROM expected.attndims
      OR actual.attidentity IS DISTINCT FROM expected.attidentity OR actual.attgenerated IS DISTINCT FROM expected.attgenerated
      OR actual.attisdropped IS DISTINCT FROM false OR actual.attislocal IS DISTINCT FROM true OR actual.attinhcount IS DISTINCT FROM 0
      OR actual.default_expr IS DISTINCT FROM expected.default_expr
  ) THEN RAISE EXCEPTION 'Phone11 audit column ABI is incompatible' USING ERRCODE='55000'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid=actual_oid)<>6
     OR EXISTS (SELECT 1 FROM
       (SELECT * FROM pg_catalog.pg_constraint WHERE conrelid=actual_oid AND contype='c') actual
       FULL JOIN (SELECT * FROM pg_catalog.pg_constraint WHERE conrelid=model_oid AND contype='c') expected USING(conname)
       WHERE actual.oid IS NULL OR expected.oid IS NULL OR NOT actual.convalidated OR actual.condeferrable
         OR actual.conparentid<>0 OR actual.connoinherit OR NOT actual.conislocal OR actual.coninhcount<>0
         OR pg_catalog.pg_get_expr(actual.conbin,actual.conrelid,false) IS DISTINCT FROM pg_catalog.pg_get_expr(expected.conbin,expected.conrelid,false))
  THEN RAISE EXCEPTION 'Phone11 audit CHECK ABI is incompatible' USING ERRCODE='55000'; END IF;
  SELECT attnum INTO id_att FROM pg_catalog.pg_attribute WHERE attrelid=actual_oid AND attname='id';
  SELECT attnum INTO tenant_att FROM pg_catalog.pg_attribute WHERE attrelid=actual_oid AND attname='tenant_id';
  SELECT attnum INTO time_att FROM pg_catalog.pg_attribute WHERE attrelid=actual_oid AND attname='created_at';
  tenants_oid := pg_catalog.to_regclass(pg_catalog.format('%I.tenants',ns));
  SELECT attnum INTO tenants_id FROM pg_catalog.pg_attribute WHERE attrelid=tenants_oid AND attname='id';
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_index i ON i.indexrelid=c.conindid
      JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid JOIN pg_catalog.pg_am am ON am.oid=idx.relam
     WHERE c.conrelid=actual_oid AND c.contype='p' AND c.conkey=ARRAY[id_att]::smallint[] AND c.convalidated
       AND NOT c.condeferrable AND c.conparentid=0 AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate
       AND i.indisprimary AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
       AND i.indnkeyatts=1 AND i.indnatts=1 AND am.amname='btree' AND i.indcollation[0]=0 AND i.indoption[0]=0
       AND i.indclass[0]=(SELECT o.oid FROM pg_catalog.pg_opclass o JOIN pg_catalog.pg_namespace n ON n.oid=o.opcnamespace
                          WHERE n.nspname='pg_catalog' AND o.opcname='int8_ops' AND o.opcmethod=am.oid))
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
       JOIN pg_catalog.pg_namespace n ON n.oid=idx.relnamespace JOIN pg_catalog.pg_am am ON am.oid=idx.relam
      WHERE i.indrelid=actual_oid AND n.nspname=ns AND idx.relname='phone11_audit_tenant_created_idx' AND am.amname='btree'
        AND i.indisvalid AND i.indisready AND i.indislive AND NOT i.indisunique AND NOT i.indisprimary
        AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=2 AND i.indnatts=2
        AND i.indkey[0]=tenant_att AND i.indkey[1]=time_att AND i.indoption[0]=0 AND i.indoption[1]=3
        AND i.indcollation[0]=0 AND i.indcollation[1]=0
        AND i.indclass[0]=(SELECT o.oid FROM pg_catalog.pg_opclass o JOIN pg_catalog.pg_namespace n ON n.oid=o.opcnamespace
                          WHERE n.nspname='pg_catalog' AND o.opcname='int4_ops' AND o.opcmethod=am.oid)
        AND i.indclass[1]=(SELECT o.oid FROM pg_catalog.pg_opclass o JOIN pg_catalog.pg_namespace n ON n.oid=o.opcnamespace
                          WHERE n.nspname='pg_catalog' AND o.opcname='timestamptz_ops' AND o.opcmethod=am.oid))
     OR (SELECT count(*) FROM pg_catalog.pg_index WHERE indrelid=actual_oid)<>2
  THEN RAISE EXCEPTION 'Phone11 audit index ABI is incompatible' USING ERRCODE='55000'; END IF;
  SELECT oid INTO fk_oid FROM pg_catalog.pg_constraint WHERE conrelid=actual_oid AND contype='f'
    AND conkey=ARRAY[tenant_att]::smallint[] AND confrelid=tenants_oid AND confkey=ARRAY[tenants_id]::smallint[]
    AND convalidated AND NOT condeferrable AND conparentid=0 AND confdeltype='r' AND confupdtype='a' AND confmatchtype='s';
  IF fk_oid IS NULL OR (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgconstraint=fk_oid)<>4
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgconstraint=fk_oid AND (NOT tgisinternal OR tgenabled<>'O'))
  THEN RAISE EXCEPTION 'Phone11 audit tenant FK is incompatible' USING ERRCODE='55000'; END IF;
  seq_oid := pg_catalog.pg_get_serial_sequence(pg_catalog.format('%I.audit_logs',ns),'id')::pg_catalog.regclass;
  IF seq_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_sequence s JOIN pg_catalog.pg_class c ON c.oid=s.seqrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_class t ON t.oid=actual_oid
     WHERE s.seqrelid=seq_oid AND n.nspname=ns AND c.relkind='S' AND c.relpersistence='p' AND c.relowner=t.relowner
       AND s.seqtypid='pg_catalog.int8'::pg_catalog.regtype AND s.seqstart=1 AND s.seqincrement=1 AND s.seqmin=1
       AND s.seqmax=9223372036854775807 AND s.seqcache=1 AND NOT s.seqcycle)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend WHERE classid='pg_catalog.pg_class'::pg_catalog.regclass
       AND objid=seq_oid AND refclassid='pg_catalog.pg_class'::pg_catalog.regclass AND refobjid=actual_oid AND refobjsubid=id_att AND deptype='i')
  THEN RAISE EXCEPTION 'Phone11 audit identity sequence is incompatible' USING ERRCODE='55000'; END IF;

  -- Default ACLs apply at creation, before this transaction commits. Forced RLS
  -- does not constrain TRUNCATE/TRIGGER or sequence authority. Refuse unexpected
  -- effective table/column ACL entries on new AND existing objects; never repair.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
      WHERE c.oid=actual_oid AND (acl.grantee<>c.relowner OR acl.grantor<>c.relowner))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl
      WHERE a.attrelid=actual_oid AND a.attnum>0 AND (acl.grantee<>c.relowner OR acl.grantor<>c.relowner))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('S',c.relowner))) acl
      WHERE c.oid=seq_oid AND (acl.grantee<>c.relowner OR acl.grantor<>c.relowner))
  THEN RAISE EXCEPTION 'Phone11 audit_logs ownership ACL is incompatible' USING ERRCODE='55000'; END IF;
END
$audit_abi$;
COMMIT;
