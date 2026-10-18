-- SOURCE contract for ONE fixed-tenant login; NOT the current shared app pool.
-- Standalone fresh idle operator connection only: this file owns BEGIN/COMMIT.
-- Run both maintained storage ABI migrations first and independently bind their
-- results, table OIDs, source bytes and the selected existing principals.
-- Required session pins: phone11.expected_database, phone11.expected_schema,
-- phone11.fixed_tenant_id, phone11.runtime_role, phone11.runtime_role_oid,
-- phone11.lock_owner_role, phone11.lock_owner_role_oid,
-- phone11.expected_fraud_oid, phone11.expected_audit_oid,
-- phone11.expected_audit_sequence_oid, phone11.expected_server_major (16/17).
-- These are operator inputs only; no runtime
-- policy reads a writable GUC. No role, login/password or customer row is created.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $fixed_tenant_permissions$
DECLARE
  db text := pg_catalog.current_setting('phone11.expected_database',true);
  ns text := pg_catalog.current_setting('phone11.expected_schema',true);
  selected text := pg_catalog.current_schema();
  tenant_text text := pg_catalog.current_setting('phone11.fixed_tenant_id',true);
  tenant integer;
  runtime_name text := pg_catalog.current_setting('phone11.runtime_role',true);
  owner_name text := pg_catalog.current_setting('phone11.lock_owner_role',true);
  runtime_oid oid;
  owner_oid oid;
  fraud_oid oid;
  audit_oid oid;
  sequence_oid oid;
  tenants_oid oid;
  membership_oid oid;
  helper_oid oid;
  helper_body text;
  helper_hash text;
  app_owner oid;
  column_shape text[];
  tenant_active boolean;
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
     OR tenant_text IS NULL OR tenant_text !~ '^[1-9][0-9]{0,9}$'
     OR tenant_text::bigint>2147483647
     OR runtime_name IS NULL OR runtime_name='' OR owner_name IS NULL OR owner_name='' OR runtime_name=owner_name
  THEN RAISE EXCEPTION 'Phone11 fixed-tenant pins or session are unsupported' USING ERRCODE='55000'; END IF;
  tenant := tenant_text::integer;
  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles WHERE rolname=runtime_name
    AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb
    AND NOT rolreplication AND NOT rolinherit AND rolconfig IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s WHERE s.setrole=pg_roles.oid)
    AND (rolvaliduntil IS NULL OR rolvaliduntil>CURRENT_TIMESTAMP);
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname=owner_name
    AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb
    AND NOT rolreplication AND NOT rolinherit AND rolconfig IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s WHERE s.setrole=pg_roles.oid);
  IF runtime_oid IS NULL OR owner_oid IS NULL OR runtime_oid=owner_oid
     OR runtime_oid::text IS DISTINCT FROM pg_catalog.current_setting('phone11.runtime_role_oid',true)
     OR owner_oid::text IS DISTINCT FROM pg_catalog.current_setting('phone11.lock_owner_role_oid',true)
     OR runtime_oid=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
     OR owner_oid=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member IN(runtime_oid,owner_oid) OR roleid IN(runtime_oid,owner_oid))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend WHERE refclassid='pg_catalog.pg_authid'::pg_catalog.regclass
                 AND refobjid IN(runtime_oid,owner_oid) AND deptype='o')
  THEN RAISE EXCEPTION 'Phone11 fixed principals are not independent unprivileged identities' USING ERRCODE='55000'; END IF;

  -- Refuse ambient direct, column, inherited-PUBLIC, schema or definer-function
  -- authority. No global revocation or silent repair is performed.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
       AND (pg_catalog.has_schema_privilege(runtime_oid,n.oid,'CREATE') OR pg_catalog.has_schema_privilege(owner_oid,n.oid,'CREATE')))
     OR pg_catalog.has_database_privilege(runtime_oid,pg_catalog.current_database(),'CREATE')
     OR pg_catalog.has_database_privilege(owner_oid,pg_catalog.current_database(),'CREATE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN('r','p','v','m','f')
         AND CASE WHEN c.relkind IN('r','p','v','m','f') THEN (pg_catalog.has_table_privilege(runtime_oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR pg_catalog.has_table_privilege(owner_oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR pg_catalog.has_any_column_privilege(runtime_oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
           OR pg_catalog.has_any_column_privilege(owner_oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) ELSE false END)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind='S'
         AND CASE WHEN c.relkind='S' THEN (pg_catalog.has_sequence_privilege(runtime_oid,c.oid,'USAGE,SELECT,UPDATE')
           OR pg_catalog.has_sequence_privilege(owner_oid,c.oid,'USAGE,SELECT,UPDATE')) ELSE false END)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND p.prosecdef
         AND (pg_catalog.has_function_privilege(runtime_oid,p.oid,'EXECUTE') OR pg_catalog.has_function_privilege(owner_oid,p.oid,'EXECUTE')))
  THEN RAISE EXCEPTION 'Phone11 fixed principals have unreviewed ambient authority' USING ERRCODE='55000'; END IF;

  fraud_oid := pg_catalog.to_regclass(pg_catalog.format('%I.fraud_controls',ns));
  audit_oid := pg_catalog.to_regclass(pg_catalog.format('%I.audit_logs',ns));
  tenants_oid := pg_catalog.to_regclass(pg_catalog.format('%I.tenants',ns));
  membership_oid := pg_catalog.to_regclass(pg_catalog.format('%I.tenant_memberships',ns));
  IF fraud_oid IS NULL OR audit_oid IS NULL OR tenants_oid IS NULL OR membership_oid IS NULL
     OR fraud_oid::text IS DISTINCT FROM pg_catalog.current_setting('phone11.expected_fraud_oid',true)
     OR audit_oid::text IS DISTINCT FROM pg_catalog.current_setting('phone11.expected_audit_oid',true)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN(fraud_oid,audit_oid,tenants_oid,membership_oid)
                AND (relkind<>'r' OR relpersistence<>'p' OR relispartition))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid IN(fraud_oid,audit_oid,tenants_oid,membership_oid)
                OR inhparent IN(fraud_oid,audit_oid,tenants_oid,membership_oid))
  THEN RAISE EXCEPTION 'Phone11 fixed-tenant relation identities are unsupported' USING ERRCODE='55000'; END IF;
  EXECUTE pg_catalog.format('LOCK TABLE %I.tenants,%I.tenant_memberships IN SHARE ROW EXCLUSIVE MODE',ns,ns);
  EXECUTE pg_catalog.format('LOCK TABLE %I.fraud_controls,%I.audit_logs IN ACCESS EXCLUSIVE MODE',ns,ns);
  IF fraud_oid IS DISTINCT FROM pg_catalog.to_regclass(pg_catalog.format('%I.fraud_controls',ns))
     OR audit_oid IS DISTINCT FROM pg_catalog.to_regclass(pg_catalog.format('%I.audit_logs',ns))
     OR tenants_oid IS DISTINCT FROM pg_catalog.to_regclass(pg_catalog.format('%I.tenants',ns))
     OR membership_oid IS DISTINCT FROM pg_catalog.to_regclass(pg_catalog.format('%I.tenant_memberships',ns))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN(tenants_oid,membership_oid) AND (relrowsecurity OR relforcerowsecurity))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid IN(fraud_oid,audit_oid,tenants_oid,membership_oid))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid IN(fraud_oid,audit_oid) AND NOT tgisinternal)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=fraud_oid AND (relrowsecurity OR relforcerowsecurity))
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=audit_oid AND relrowsecurity AND relforcerowsecurity)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname=ns AND p.proname='phone11_lock_fixed_fraud_admin')
  THEN RAISE EXCEPTION 'Phone11 fixed-tenant policies, helper or parent authority are ambiguous' USING ERRCODE='55000'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid=tenants_oid AND attname='id'
        AND atttypid='pg_catalog.int4'::pg_catalog.regtype AND attnum>0 AND NOT attisdropped AND attnotnull AND attgenerated='')<>1
     OR (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid=membership_oid AND attname IN('user_id','tenant_id')
        AND atttypid='pg_catalog.int4'::pg_catalog.regtype AND attnum>0 AND NOT attisdropped AND attnotnull AND attgenerated='')<>2
     OR (SELECT count(*) FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
       WHERE ((a.attrelid=tenants_oid AND a.attname='status') OR (a.attrelid=membership_oid AND a.attname IN('role','status')))
         AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated=''
         AND (a.atttypid IN('pg_catalog.text'::pg_catalog.regtype,'pg_catalog.varchar'::pg_catalog.regtype,'pg_catalog.bpchar'::pg_catalog.regtype) OR t.typtype='e'))<>3
  THEN RAISE EXCEPTION 'Phone11 fixed actor-lock parent ABI is incompatible' USING ERRCODE='55000'; END IF;
  SELECT relowner INTO app_owner FROM pg_catalog.pg_class WHERE oid=fraud_oid;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=audit_oid AND relowner=app_owner)
     OR app_owner IN(runtime_oid,owner_oid)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
                 WHERE c.oid IN(fraud_oid,audit_oid) AND (a.grantee<>c.relowner OR a.grantor<>c.relowner))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid IN(fraud_oid,audit_oid) AND attacl IS NOT NULL)
  THEN RAISE EXCEPTION 'Phone11 storage ownership or ACL is ambiguous' USING ERRCODE='55000'; END IF;

  -- Fresh exact maintained ABI results are an external action prerequisite; these
  -- locked in-file checks additionally refuse drift in the slice's writable shape,
  -- defaults, identity, unique tenant key, RLS state and append-only sequence.
  SELECT array_agg(attname::text||':'||atttypid::pg_catalog.regtype::text ORDER BY attnum) INTO column_shape
    FROM pg_catalog.pg_attribute WHERE attrelid=fraud_oid AND attnum>0 AND NOT attisdropped;
  IF column_shape IS DISTINCT FROM ARRAY['tenant_id:integer','max_concurrent_outbound:double precision','calls_per_minute_limit:double precision',
     'daily_cost_ceiling:double precision','international_enabled:boolean','premium_rate_enabled:boolean','geo_block_list:jsonb','geo_allow_list:jsonb',
     'alert_email:text','alert_on_daily_ceiling:boolean','auto_disable_on_ceiling:boolean','updated_at:timestamp with time zone']
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attname='tenant_id'
       WHERE c.conrelid=fraud_oid AND c.contype='p' AND c.conkey=ARRAY[a.attnum]::smallint[] AND c.convalidated AND NOT c.condeferrable)
     OR (SELECT count(*) FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
       WHERE a.attrelid=fraud_oid AND a.attname IN('international_enabled','premium_rate_enabled') AND a.attnotnull
         AND pg_catalog.pg_get_expr(d.adbin,d.adrelid,false)='false')<>2
  THEN RAISE EXCEPTION 'Phone11 fraud write shape is incompatible' USING ERRCODE='55000'; END IF;
  sequence_oid := pg_catalog.pg_get_serial_sequence(pg_catalog.format('%I.audit_logs',ns),'id')::pg_catalog.regclass;
  IF sequence_oid IS NULL OR sequence_oid::text IS DISTINCT FROM pg_catalog.current_setting('phone11.expected_audit_sequence_oid',true)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=audit_oid AND attname='id' AND attidentity='a'
                      AND atttypid='pg_catalog.int8'::pg_catalog.regtype AND attnotnull)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('S',c.relowner))) a
                 WHERE c.oid=sequence_oid AND (a.grantee<>c.relowner OR a.grantor<>c.relowner))
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=sequence_oid AND relkind='S' AND relpersistence='p' AND relowner=app_owner)
  THEN RAISE EXCEPTION 'Phone11 audit identity sequence pin or ACL is incompatible' USING ERRCODE='55000'; END IF;
  EXECUTE pg_catalog.format('SELECT EXISTS(SELECT 1 FROM %I.tenants WHERE id=$1 AND status::text=''active'')',ns) INTO STRICT tenant_active USING tenant;
  IF NOT tenant_active THEN RAISE EXCEPTION 'Phone11 fixed tenant is not active' USING ERRCODE='55000'; END IF;

  SELECT array_agg(attname::text||':'||atttypid::pg_catalog.regtype::text ORDER BY attnum) INTO column_shape
    FROM pg_catalog.pg_attribute WHERE attrelid=audit_oid AND attnum>0 AND NOT attisdropped;
  IF column_shape IS DISTINCT FROM ARRAY['id:bigint','tenant_id:integer','actor_user_id:integer','action:text','resource_type:text',
       'resource_id:text','old_value:jsonb','new_value:jsonb','ip_address:inet','user_agent:text','request_id:text','session_id:text','created_at:timestamp with time zone']
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
       WHERE a.attrelid IN(fraud_oid,audit_oid) AND NOT (
         (a.attrelid=fraud_oid AND a.attname IN('international_enabled','premium_rate_enabled') AND pg_catalog.pg_get_expr(d.adbin,d.adrelid,false)='false')
         OR (a.attname IN('updated_at','created_at') AND pg_catalog.pg_get_expr(d.adbin,d.adrelid,false)='CURRENT_TIMESTAMP')))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid IN(fraud_oid,audit_oid) AND attnum>0
                  AND (attisdropped OR attgenerated<>'' OR (attidentity<>'' AND NOT(attrelid=audit_oid AND attname='id' AND attidentity='a'))))
     OR (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid=fraud_oid)<>7
     OR (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid=audit_oid)<>6
  THEN RAISE EXCEPTION 'Phone11 maintained audit/fraud ABI precondition is incompatible' USING ERRCODE='55000'; END IF;

  -- This body contains static SQL only. Its tenant, schema and session identity
  -- are compiled once from reviewed operator pins, never from an API GUC.
  helper_body := pg_catalog.format($body$
DECLARE admitted_role text;
BEGIN
  IF session_user::text <> %L OR actor_id <= 0 THEN
    RAISE EXCEPTION 'Fixed tenant actor is not admitted' USING ERRCODE='42501';
  END IF;
  BEGIN
  SELECT tm.role::text INTO STRICT admitted_role
    FROM %I.tenant_memberships tm JOIN %I.tenants t ON t.id=tm.tenant_id
   WHERE tm.user_id=actor_id AND tm.tenant_id=%s AND tm.status::text='active'
     AND tm.role::text IN ('owner','admin') AND t.status::text='active'
   FOR UPDATE OF tm,t;
  EXCEPTION WHEN no_data_found OR too_many_rows THEN
    RAISE EXCEPTION 'Fixed tenant actor is not admitted' USING ERRCODE='42501';
  END;
  RETURN admitted_role;
END
$body$,runtime_name,ns,ns,tenant);
  helper_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(helper_body,'UTF8')),'hex');
  EXECUTE pg_catalog.format('CREATE FUNCTION %I.phone11_lock_fixed_fraud_admin(actor_id integer) RETURNS text
    LANGUAGE plpgsql VOLATILE STRICT PARALLEL UNSAFE SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp AS %L',ns,helper_body);
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %I.phone11_lock_fixed_fraud_admin(integer) FROM PUBLIC',ns);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.phone11_lock_fixed_fraud_admin(integer) OWNER TO %I',ns,owner_name);
  EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA %I TO %I,%I',ns,runtime_name,owner_name);
  EXECUTE pg_catalog.format('GRANT SELECT(id,status),UPDATE(id) ON %I.tenants TO %I',ns,owner_name);
  EXECUTE pg_catalog.format('GRANT SELECT(user_id,tenant_id,role,status),UPDATE(user_id) ON %I.tenant_memberships TO %I',ns,owner_name);
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %I.phone11_lock_fixed_fraud_admin(integer) TO %I',ns,runtime_name);
  helper_oid := pg_catalog.to_regprocedure(pg_catalog.format('%I.phone11_lock_fixed_fraud_admin(integer)',ns));
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    WHERE p.oid=helper_oid AND p.proowner=owner_oid AND p.prosecdef AND NOT p.proleakproof AND p.proisstrict
      AND p.provolatile='v' AND p.proparallel='u' AND p.prokind='f' AND p.pronargs=1
      AND p.proargtypes[0]='pg_catalog.int4'::pg_catalog.regtype AND p.prorettype='pg_catalog.text'::pg_catalog.regtype
      AND l.lanname='plpgsql' AND l.lanpltrusted AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND p.prosrc=helper_body AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=helper_hash)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
       WHERE p.oid=helper_oid AND (a.grantee NOT IN(owner_oid,runtime_oid) OR a.grantor<>owner_oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
     OR NOT pg_catalog.has_function_privilege(runtime_oid,helper_oid,'EXECUTE')
  THEN RAISE EXCEPTION 'Phone11 fixed helper body, owner or ACL is incompatible' USING ERRCODE='55000'; END IF;

  EXECUTE pg_catalog.format('ALTER TABLE %I.fraud_controls ENABLE ROW LEVEL SECURITY',ns);
  EXECUTE pg_catalog.format('ALTER TABLE %I.fraud_controls FORCE ROW LEVEL SECURITY',ns);
  EXECUTE pg_catalog.format('CREATE POLICY phone11_fixed_fraud_read ON %I.fraud_controls FOR SELECT TO %I
    USING (tenant_id=%s AND session_user::text=%L AND current_user::text=%L)',ns,runtime_name,tenant,runtime_name,runtime_name);
  EXECUTE pg_catalog.format('CREATE POLICY phone11_fixed_fraud_insert ON %I.fraud_controls FOR INSERT TO %I
    WITH CHECK (tenant_id=%s AND session_user::text=%L AND current_user::text=%L)',ns,runtime_name,tenant,runtime_name,runtime_name);
  EXECUTE pg_catalog.format('CREATE POLICY phone11_fixed_fraud_update ON %I.fraud_controls FOR UPDATE TO %I
    USING (tenant_id=%s AND session_user::text=%L AND current_user::text=%L)
    WITH CHECK (tenant_id=%s AND session_user::text=%L AND current_user::text=%L)',
    ns,runtime_name,tenant,runtime_name,runtime_name,tenant,runtime_name,runtime_name);
  EXECUTE pg_catalog.format('CREATE POLICY phone11_fixed_audit_append ON %I.audit_logs FOR INSERT TO %I
    WITH CHECK (tenant_id=%s AND session_user::text=%L AND current_user::text=%L
      AND actor_user_id IS NOT NULL AND action=''update'' AND resource_type=''fraud_controls'' AND resource_id=%L
      AND %I.phone11_lock_fixed_fraud_admin(actor_user_id) IN (''owner'',''admin''))',
    ns,runtime_name,tenant,runtime_name,runtime_name,tenant::text,ns);
  EXECUTE pg_catalog.format('GRANT SELECT ON %I.fraud_controls TO %I',ns,runtime_name);
  EXECUTE pg_catalog.format('GRANT INSERT(tenant_id,international_enabled,premium_rate_enabled),
    UPDATE(international_enabled,premium_rate_enabled,updated_at) ON %I.fraud_controls TO %I',ns,runtime_name);
  EXECUTE pg_catalog.format('GRANT INSERT(tenant_id,actor_user_id,action,resource_type,resource_id,old_value,new_value,
    ip_address,user_agent,request_id,session_id) ON %I.audit_logs TO %I',ns,runtime_name);
  EXECUTE pg_catalog.format('GRANT USAGE ON SEQUENCE %s TO %I',sequence_oid::pg_catalog.regclass,runtime_name);

  -- These invariants also document deliberately absent authority. They do not
  -- relabel an operator/superuser test session as the actual runtime principal.
  IF pg_catalog.has_table_privilege(runtime_oid,audit_oid,'SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR pg_catalog.has_any_column_privilege(runtime_oid,audit_oid,'SELECT,UPDATE,REFERENCES')
     OR pg_catalog.has_table_privilege(runtime_oid,fraud_oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR pg_catalog.has_any_column_privilege(runtime_oid,tenants_oid,'SELECT,INSERT,UPDATE,REFERENCES')
     OR pg_catalog.has_any_column_privilege(runtime_oid,membership_oid,'SELECT,INSERT,UPDATE,REFERENCES')
     OR pg_catalog.has_sequence_privilege(runtime_oid,sequence_oid,'SELECT,UPDATE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member IN(runtime_oid,owner_oid) OR roleid IN(runtime_oid,owner_oid))
  THEN RAISE EXCEPTION 'Phone11 fixed runtime has unintended authority' USING ERRCODE='55000'; END IF;
END
$fixed_tenant_permissions$;
COMMIT;
