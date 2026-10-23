#!/usr/bin/env python3
"""Offline rendering only. SQL has independent target, freshness and catalogue guards."""
import argparse,datetime,hashlib,json,re
from pathlib import Path
HERE=Path(__file__).resolve().parent
MANIFEST=json.loads((HERE/'runtime-grants.json').read_text())
ROLE=MANIFEST['role']
def need(value,code):
 if not value:raise ValueError(code)
def ident(value):
 need(isinstance(value,str) and re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*',value),'IDENTIFIER_REFUSED')
 return '"'+value+'"'
def lit(value):return "'"+str(value).replace("'","''")+"'"
def load(raw):
 def unique(items):
  d={}
  for k,v in items:need(k not in d,'DUPLICATE_KEY');d[k]=v
  return d
 need(len(raw)<=1048576,'CATALOG_CAP')
 return json.loads(raw,object_pairs_hook=unique)
def render(c,mode):
 need(mode in ('clone','production'),'MODE_REFUSED')
 need(c['schema']=='PHONE11_ORDINARY_DB_CATALOG_V1','CATALOG_SCHEMA')
 need(re.fullmatch('[0-9]{10,22}',c['systemIdentifier']) is not None,'SYSTEM_IDENTIFIER')
 need(c['serverVersion']=='160013' or (mode=='clone' and c['serverVersion'].startswith('17')),'PG_VERSION')
 database=c['database'];ident(database);ident(c['bootstrapRole'])
 if mode=='production':need(database=='phone11ai' and c['systemIdentifier']==MANIFEST['productionSystemIdentifier'],'TARGET_REFUSED')
 else:need(database.startswith('p11_mgmt_grants_') and c['systemIdentifier']!=MANIFEST['productionSystemIdentifier'],'CLONE_TARGET_REFUSED')
 need(isinstance(c['tables'],dict) and len(c['tables'])<=128,'TABLE_CAP')
 need(isinstance(c['auditPolicyHash'],str) and re.fullmatch('[a-f0-9]{64}',c['auditPolicyHash']),'AUDIT_POLICY_HASH')
 need(isinstance(c['observedAt'],str),'OBSERVATION_TIME')
 datetime.datetime.fromisoformat(c['observedAt'].replace('Z','+00:00'))
 grants=[];guards=[];omitted=[];sequence_names=set();selected={};effective=[]
 for table,g in MANIFEST['tables'].items():
  if table not in c['tables']:
   need(not g['required'],'REQUIRED_TABLE_MISSING:'+table);omitted.append(table);continue
  item=c['tables'][table];cols=item['columns'];need(isinstance(cols,list) and 0<len(cols)<=256 and len(set(cols))==len(cols),'COLUMNS_REFUSED')
  for col in cols:ident(col)
  need(item['kind'] in ('r','p'),'RELATION_KIND')
  need(item['owner']!=ROLE,'SUCCESSOR_OWNS_RELATION')
  if table!='audit_logs':need(item['rls'] is False and item['forceRls'] is False,'UNREVIEWED_RLS:'+table)
  else:need(item['rls'] is True and item['forceRls'] is True,'AUDIT_RLS_REQUIRED')
  # Existing unsupported optional columns are observed, never silently created.
  # Grant only implemented columns that actually exist. Required operation probes
  # and all RPC families remain mandatory before cutover.
  desired={op:[col for col in g[op] if col in cols] for op in ('insert','update')}
  missing={op:sorted(set(g[op])-set(cols)) for op in ('insert','update') if set(g[op])-set(cols)}
  selected[table]={'select':g['select'],'insert':desired['insert'],'update':desired['update'],'delete':g['delete'],'missingSourceColumns':missing}
  for col in cols:effective.append('('+','.join([lit(table),lit(col),'true' if g['select'] else 'false','true' if col in desired['insert'] else 'false','true' if col in desired['update'] else 'false'])+')')
  ref='public.'+ident(table)
  # Exact column order, kinds and RLS state are checked again inside mutation transaction.
  guards.append("IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid="+lit(ref)+"::regclass AND relkind="+lit(item['kind'])+" AND relrowsecurity="+('true' if item['rls'] else 'false')+" AND relforcerowsecurity="+('true' if item['forceRls'] else 'false')+") THEN RAISE EXCEPTION 'RELATION_STATE_DRIFT' USING ERRCODE='55000'; END IF; IF (SELECT jsonb_agg(attname::text ORDER BY attnum) FROM pg_catalog.pg_attribute WHERE attrelid="+lit(ref)+"::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM "+lit(json.dumps(cols,separators=(',',':')))+"::jsonb THEN RAISE EXCEPTION 'COLUMN_DRIFT' USING ERRCODE='55000'; END IF;")
  if g['select']:grants.append('GRANT SELECT ('+','.join(map(ident,cols))+') ON '+ref+' TO '+ident(ROLE)+';')
  for op in ('insert','update'):
   if desired[op]:grants.append('GRANT '+op.upper()+' ('+','.join(map(ident,desired[op]))+') ON '+ref+' TO '+ident(ROLE)+';')
  if g['delete']:grants.append('GRANT DELETE ON '+ref+' TO '+ident(ROLE)+';')
  if desired['insert']:
   for seq in item.get('sequences',[]):
    need(set(seq)=={'name','column','owned','defaultBound'},'SEQUENCE_SHAPE')
    ident(seq['name']);need(seq['column'] in cols and seq['owned'] is True and seq['defaultBound'] is True,'SEQUENCE_PROVENANCE')
    need(seq['name'] not in sequence_names,'SHARED_SEQUENCE_REFUSED');sequence_names.add(seq['name'])
    guards.append("IF pg_catalog.pg_get_serial_sequence("+lit(ref)+","+lit(seq['column'])+")::regclass IS DISTINCT FROM "+lit('public.'+ident(seq['name']))+"::regclass THEN RAISE EXCEPTION 'SEQUENCE_DRIFT' USING ERRCODE='55000'; END IF;")
    grants.append('GRANT USAGE ON SEQUENCE public.'+ident(seq['name'])+' TO '+ident(ROLE)+';')
 policy_hash="(SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(COALESCE(string_agg(p.polname||':'||COALESCE(pg_catalog.pg_get_expr(p.polqual,p.polrelid),'')||':'||COALESCE(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid),'')||':'||p.polroles::text||':'||p.polcmd::text||':'||p.polpermissive::text, E'\\n' ORDER BY p.polname),''),'UTF8')),'hex') FROM pg_catalog.pg_policy p WHERE p.polrelid='public.audit_logs'::regclass)"
 sql=f"""-- Source preparation. Execute only through Root's reviewed bounded operator.
-- NOLOGIN successor only; no old-role, fraud-role, credential, HBA or container mutation.
\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='30s';
SET LOCAL search_path=pg_catalog,pg_temp;
DO $preflight$
BEGIN
 IF current_database()<>{lit(database)} OR current_user<>{lit(c['bootstrapRole'])} OR session_user<>current_user
 OR NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user)
 OR current_setting('server_version_num')<>{lit(c['serverVersion'])}
 OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system())<>{lit(c['systemIdentifier'])}
 THEN RAISE EXCEPTION 'TARGET_REFUSED' USING ERRCODE='55000'; END IF;
 IF clock_timestamp() < {lit(c['observedAt'])}::timestamptz OR clock_timestamp()-{lit(c['observedAt'])}::timestamptz>interval '15 minutes'
 THEN RAISE EXCEPTION 'STALE_CATALOG' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname={lit(ROLE)}) THEN RAISE EXCEPTION 'ROLE_EXISTS' USING ERRCODE='55000'; END IF;
 {' '.join('LOCK TABLE public.'+ident(t)+' IN ACCESS SHARE MODE;' for t in selected)}
 -- Policy DDL can commit while these locks wait. Recheck only after every lock.
 IF {policy_hash} <> {lit(c['auditPolicyHash'])} THEN RAISE EXCEPTION 'AUDIT_POLICY_DRIFT' USING ERRCODE='55000'; END IF;
 {' '.join(guards)}
END $preflight$;
CREATE ROLE {ident(ROLE)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 24;
GRANT CONNECT ON DATABASE {ident(database)} TO {ident(ROLE)};
GRANT USAGE ON SCHEMA public TO {ident(ROLE)};
ALTER ROLE {ident(ROLE)} SET search_path=pg_catalog,public,pg_temp;
ALTER ROLE {ident(ROLE)} SET statement_timeout='30s';
ALTER ROLE {ident(ROLE)} SET lock_timeout='5s';
{chr(10).join(grants)}
CREATE POLICY phone11_ordinary_management_append_v1 ON public.audit_logs FOR INSERT TO {ident(ROLE)}
 WITH CHECK (session_user::text={lit(ROLE)} AND current_user::text={lit(ROLE)} AND actor_user_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.tenant_memberships tm JOIN public.tenants t ON t.id=tm.tenant_id
 WHERE tm.tenant_id=audit_logs.tenant_id AND tm.user_id=audit_logs.actor_user_id
 AND tm.status::text='active' AND tm.role::text IN ('owner','admin') AND t.status::text='active'));
CREATE POLICY phone11_ordinary_management_read_v1 ON public.audit_logs FOR SELECT TO {ident(ROLE)}
 USING (session_user::text={lit(ROLE)} AND current_user::text={lit(ROLE)});
DO $postflight$
DECLARE r oid;
BEGIN
 SELECT oid INTO STRICT r FROM pg_catalog.pg_roles WHERE rolname={lit(ROLE)};
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=r AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=r OR roleid=r)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE relowner=r)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE proowner=r)
 OR pg_catalog.has_database_privilege(r,current_database(),'CREATE')
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND pg_catalog.has_schema_privilege(r,n.oid,'CREATE'))
 OR pg_catalog.has_table_privilege(r,'public.audit_logs','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 OR pg_catalog.has_column_privilege(r,'public.audit_logs','id','INSERT')
 OR pg_catalog.has_column_privilege(r,'public.audit_logs','created_at','INSERT')
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p') AND c.oid<>ALL(ARRAY[{','.join(lit('public.'+ident(t))+'::regclass' for t in selected)}]) AND (pg_catalog.has_any_column_privilege(r,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') OR pg_catalog.has_table_privilege(r,c.oid,'DELETE,TRUNCATE,TRIGGER')) )
 OR EXISTS(SELECT 1 FROM (VALUES {','.join('('+lit(t)+','+('true' if g['delete'] else 'false')+')' for t,g in selected.items())}) AS e(t,d)
 JOIN pg_catalog.pg_namespace n ON n.nspname='public' JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.t
 WHERE pg_catalog.has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE') OR pg_catalog.has_table_privilege(r,c.oid,'DELETE') IS DISTINCT FROM e.d)
 OR EXISTS(SELECT 1 FROM (VALUES {','.join(effective)}) AS e(t,c,s,i,u)
 JOIN pg_catalog.pg_namespace n ON n.nspname='public' JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.t
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname=e.c
 WHERE pg_catalog.has_column_privilege(r,c.oid,a.attnum,'SELECT') IS DISTINCT FROM e.s
 OR pg_catalog.has_column_privilege(r,c.oid,a.attnum,'INSERT') IS DISTINCT FROM e.i
 OR pg_catalog.has_column_privilege(r,c.oid,a.attnum,'UPDATE') IS DISTINCT FROM e.u
 OR pg_catalog.has_column_privilege(r,c.oid,a.attnum,'REFERENCES'))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 AND (pg_catalog.has_sequence_privilege(r,c.oid,'SELECT,UPDATE') OR (pg_catalog.has_sequence_privilege(r,c.oid,'USAGE') AND c.oid<>ALL(ARRAY[{','.join(lit('public.'+ident(t))+'::regclass' for t in sorted(sequence_names))}]))))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x WHERE x.grantee=r AND x.is_grantable)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prosecdef AND pg_catalog.has_function_privilege(r,p.oid,'EXECUTE'))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (pg_catalog.has_table_privilege(r,c.oid,'TRUNCATE,REFERENCES,TRIGGER') OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(c.relacl) a WHERE a.grantee=r AND a.is_grantable)))
 THEN RAISE EXCEPTION 'UNEXPECTED_AUTHORITY' USING ERRCODE='42501'; END IF;
END $postflight$;
COMMIT;
"""
 receipt={'schema':'PHONE11_RESTRICTED_RENDER_V1','mode':mode,'sourceSha':MANIFEST['sourceSha'],'catalogSha256':hashlib.sha256(json.dumps(c,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'role':ROLE,'tables':selected,'omittedAbsentOptionalTables':omitted,'sequences':sorted(sequence_names),'successorLoginEnabled':False,'activationAllowed':False,'tenantIsolationAuthority':MANIFEST['appTenantAuthority']}
 return sql,receipt
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--catalog',type=Path,required=True);p.add_argument('--mode',choices=['clone','production'],required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
 sql,receipt=render(load(a.catalog.read_bytes()),a.mode)
 a.out.mkdir(mode=0o700,parents=False,exist_ok=False)
 (a.out/'install.sql').write_text(sql);(a.out/'render-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
 print(json.dumps({'status':'RENDERED_NOT_EXECUTED','sqlSha256':receipt['sqlSha256'],'activationAllowed':False}))
