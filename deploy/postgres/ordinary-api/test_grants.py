#!/usr/bin/env python3
"""Synthetic owned local PostgreSQL ACL/RLS test. Never connects to a supplied target."""
import datetime,hashlib,importlib.util,json,os,secrets,shutil,socket,subprocess,tempfile,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('packet',HERE/'render.py');packet=importlib.util.module_from_spec(spec);spec.loader.exec_module(packet)
PG=Path('/opt/homebrew/opt/postgresql@17/bin')
class Grants(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.root=Path(tempfile.mkdtemp(prefix='p11-mgmt-grants-'));cls.data=cls.root/'data';cls.sock=cls.root/'socket';cls.sock.mkdir(mode=0o700);cls.role=packet.ROLE
  with socket.socket() as s:s.bind(('127.0.0.1',0));cls.port=s.getsockname()[1]
  cls.db='p11_mgmt_grants_'+secrets.token_hex(12);cls.env={**os.environ,'PGHOST':str(cls.sock),'PGPORT':str(cls.port),'PGDATABASE':cls.db,'PGUSER':'p11_fixture_owner','PGCONNECT_TIMEOUT':'3'}
  for k in ['PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGHOSTADDR','DATABASE_URL']:cls.env.pop(k,None)
  def native(args):
   r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
   if r.returncode:raise RuntimeError('LOCAL_FIXTURE_SETUP_FAILED')
  native([str(PG/'initdb'),'-D',str(cls.data),'-U','p11_fixture_owner','--auth-local=trust','--auth-host=scram-sha-256','--no-locale','--encoding=UTF8'])
  native(['openssl','req','-new','-x509','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',str(cls.data/'server.key'),'-out',str(cls.data/'server.crt')]);(cls.data/'server.key').chmod(0o600)
  with (cls.data/'postgresql.conf').open('a') as f:f.write("\nlisten_addresses='127.0.0.1'\nport="+str(cls.port)+"\nunix_socket_directories='"+str(cls.sock)+"'\nssl=on\npassword_encryption='scram-sha-256'\nlogging_collector=off\nlog_statement='none'\n")
  native([str(PG/'pg_ctl'),'-D',str(cls.data),'-l',str(cls.root/'server.log'),'-w','start'])
  cls.prepare_fixture()
 @classmethod
 def prepare_fixture(cls):
  cls.run_sql('CREATE DATABASE '+packet.ident(cls.db),database='postgres')
  cls.run_sql('CREATE ROLE fraud_fixture NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;')
  manifest=packet.MANIFEST
  original=json.loads((HERE/'test-fixture-shape.json').read_text())
  serial=set(original['sequences'])|{'users','did_numbers','call_records','call_legs','call_events'}
  definitions=[]
  for t,g in manifest['tables'].items():
   cols=set(original['columns'].get(t,[]))|set(g['insert'])|set(g['update'])|{'id'}
   # Actual SQL types are deliberately synthetic; only permissions and RLS are tested here.
   if t=='tenants':cols|={'id','status'}
   if t=='tenant_memberships':cols|={'tenant_id','user_id','role','status','created_at'}
   parts=[]
   for col in sorted(cols):
    typ='text'
    if t in ('tenants','tenant_memberships','audit_logs') and col in ('id','tenant_id','user_id','actor_user_id'):typ='integer'
    if col=='id' and t in serial:typ='bigserial'
    if t=='audit_logs' and col=='id':typ='bigint GENERATED ALWAYS AS IDENTITY'
    if col in ('created_at','updated_at'):typ='timestamptz DEFAULT CURRENT_TIMESTAMP'
    parts.append(packet.ident(col)+' '+typ)
   definitions.append('CREATE TABLE public.'+packet.ident(t)+' ('+','.join(parts)+');')
  cls.run_sql('\n'.join(definitions)+"\nALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;CREATE POLICY retained_fraud_fixture ON public.audit_logs FOR INSERT TO fraud_fixture WITH CHECK (false);INSERT INTO public.tenants(id,status) VALUES(7,'active'),(8,'active');INSERT INTO public.tenant_memberships(tenant_id,user_id,role,status) VALUES(7,9,'owner','active'),(8,10,'user','active');")
  cls.policy_before=cls.run_sql("SELECT md5(pg_get_expr(polwithcheck,polrelid)) FROM pg_policy WHERE polname='retained_fraud_fixture'").strip()
  raw=cls.run_sql((HERE/'collect.sql').read_text());cls.catalog=packet.load(raw.encode());sql,receipt=packet.render(cls.catalog,'clone');cls.receipt=receipt
  cls.run_sql(sql)
  cls.run_sql('ALTER ROLE '+packet.ident(cls.role)+' PASSWORD '+packet.lit(secrets.token_urlsafe(32))+';')
  cls.password=secrets.token_urlsafe(32)
  cls.run_sql('ALTER ROLE '+packet.ident(cls.role)+' PASSWORD '+packet.lit(cls.password)+';')
  cls.passfile=cls.root/'pass';cls.passfile.write_text('localhost:'+str(cls.port)+':'+cls.db+':'+cls.role+':'+cls.password+'\n');cls.passfile.chmod(0o600)
  cls.appenv={**cls.env,'PGUSER':cls.role,'PGHOST':'localhost','PGSSLMODE':'verify-full','PGSSLROOTCERT':str(cls.data/'server.crt'),'PGPASSFILE':str(cls.passfile)}
  cls.no_login=cls.app('SELECT 1',expect=False)
  cls.run_sql('ALTER ROLE '+packet.ident(cls.role)+' LOGIN;')
 @classmethod
 def run_sql(cls,sql,database=None):
  env={**cls.env};env['PGDATABASE']=database or cls.db
  r=subprocess.run([str(PG/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1'],input=sql,text=True,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=40)
  if r.returncode:raise RuntimeError('LOCAL_SQL_FAILED:'+r.stderr[:600])
  return r.stdout
 @classmethod
 def app(cls,sql,expect=True):
  r=subprocess.run([str(PG/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1'],input=sql,text=True,env=cls.appenv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=8)
  if (r.returncode==0)!=expect:raise AssertionError('RUNTIME_EXPECTATION_FAILED:'+r.stderr[:600])
  return r.stdout if expect else r.returncode
 @classmethod
 def tearDownClass(cls):
  if hasattr(cls,'data'):subprocess.run([str(PG/'pg_ctl'),'-D',str(cls.data),'-m','immediate','-w','stop'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
  if hasattr(cls,'root'):shutil.rmtree(cls.root)
 def test_01_nologin_stage(self):self.assertNotEqual(self.no_login,0)
 def test_02_actual_restricted_tls_session(self):
  result=self.app("SELECT current_user=session_user AND session_user='"+self.role+"',rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolinherit,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) FROM pg_roles WHERE rolname=current_user")
  self.assertEqual(result.strip(),'t|f|f|f|f|f|f|t')
 def test_03_select_and_row_lock(self):self.app('BEGIN; SELECT user_id FROM public.tenant_memberships WHERE tenant_id=7 FOR UPDATE; ROLLBACK;')
 def test_03b_shared_authority_and_lease_row_locks(self):
  for table in ['tenants','users','phone11_auth_identity','phone11_auth_user','phone11_auth_account','phone11_auth_session','phone11_chat_conversations','phone11_chat_members','phone11_channel_meetings','phone11_plain_video_admission_rooms','phone11_plain_video_admission_members','phone11_plain_video_admission_leases','phone11_recording_routes','phone11_wake_bindings','phone11_wake_terminals']:
   with self.subTest(table=table):self.app('BEGIN;SELECT * FROM public.'+packet.ident(table)+' FOR UPDATE;ROLLBACK;')
 def test_04_site_insert_sequence(self):self.app("BEGIN;INSERT INTO public.sites(tenant_id,name) VALUES('7','synthetic') RETURNING id;ROLLBACK;")
 def test_05_auth_session_lifecycle(self):self.app("BEGIN;INSERT INTO public.phone11_auth_session(id,token,\"userId\") VALUES('fixture','opaque','auth-user');UPDATE public.phone11_auth_session SET \"updatedAt\"='today' WHERE id='fixture';DELETE FROM public.phone11_auth_session WHERE id='fixture';ROLLBACK;")
 def test_06_append_audit_live_admin(self):self.app("BEGIN;INSERT INTO public.audit_logs(tenant_id,actor_user_id,action,resource_type) VALUES(7,9,'create','sites');ROLLBACK;")
 def test_07_append_audit_wrong_tenant_denied(self):self.app("INSERT INTO public.audit_logs(tenant_id,actor_user_id,action,resource_type) VALUES(8,9,'create','sites');",False)
 def test_08_append_audit_nonadmin_denied(self):self.app("INSERT INTO public.audit_logs(tenant_id,actor_user_id,action,resource_type) VALUES(8,10,'create','sites');",False)
 def test_09_audit_mutation_denied(self):
  for sql in ['UPDATE public.audit_logs SET action=\'tamper\'','DELETE FROM public.audit_logs','TRUNCATE public.audit_logs','INSERT INTO public.audit_logs(id) VALUES(1)','INSERT INTO public.audit_logs(created_at) VALUES(now())']:
   with self.subTest(sql=sql):self.app(sql,False)
 def test_10_role_escalation_denied(self):
  for sql in ['SET ROLE p11_fixture_owner','CREATE ROLE rogue','ALTER ROLE '+packet.ident(self.role)+' SUPERUSER','ALTER ROLE '+packet.ident(self.role)+' BYPASSRLS','GRANT SELECT ON public.users TO fraud_fixture']:
   with self.subTest(sql=sql):self.app(sql,False)
 def test_11_persistent_ddl_denied(self):
  for sql in ['CREATE TABLE public.rogue(id integer)','CREATE SCHEMA rogue','ALTER TABLE public.users ADD COLUMN rogue text','DROP TABLE public.users','CREATE DATABASE rogue','CREATE FUNCTION public.rogue() RETURNS integer LANGUAGE sql AS \'SELECT 1\'']:
   with self.subTest(sql=sql):self.app(sql,False)
 def test_12_sequences_usage_only(self):
  self.app("SELECT nextval('public.sites_id_seq');")
  self.app("SELECT setval('public.sites_id_seq',100);",False)
  self.app('SELECT * FROM public.sites_id_seq;',False)
 def test_13_no_identity_authority_updates(self):
  self.app("UPDATE public.users SET role='admin'",False);self.app("UPDATE public.phone11_auth_identity SET legacy_user_id=9",False)
 def test_14_fraud_role_policy_unchanged(self):
  self.assertEqual(self.policy_before,self.run_sql("SELECT md5(pg_get_expr(polwithcheck,polrelid)) FROM pg_policy WHERE polname='retained_fraud_fixture'").strip())
  self.app('SET ROLE fraud_fixture',False)
 def test_15_render_target_and_duplicate_keys_refused(self):
  with self.assertRaises(ValueError):packet.render(self.catalog,'production')
  with self.assertRaises(ValueError):packet.load(b'{"x":1,"x":2}')
 def test_16_public_temp_is_explicitly_retained(self):self.app('CREATE TEMP TABLE fixture_temp(id integer); DROP TABLE fixture_temp;')
 def test_17_temp_relation_does_not_shadow_public(self):
  self.assertEqual(self.app("BEGIN;CREATE TEMP TABLE users(rogue integer);SELECT id FROM users LIMIT 0;SELECT to_regclass('users')='public.users'::regclass;ROLLBACK;").strip(),'t')
 def test_18_policy_drift_committing_while_table_lock_waits_refuses(self):
  import select
  database='p11_mgmt_grants_policy_'+secrets.token_hex(8)
  self.run_sql('CREATE DATABASE '+packet.ident(database)+' TEMPLATE '+packet.ident(self.db),database='postgres')
  old_role=packet.ROLE;blocker=None
  try:
   # Render a fresh first-time role preflight against an owned database copy.
   packet.ROLE=old_role+'_race_fixture'
   catalog=packet.load(self.run_sql((HERE/'collect.sql').read_text(),database=database).encode())
   sql,_=packet.render(catalog,'clone');preflight=sql.split('CREATE ROLE ',1)[0]+'ROLLBACK;'
   if getattr(self,'cid',None):args=['docker','exec','-i',self.cid,'psql','-U','p11_fixture_owner','-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1'];env=None
   else:args=[str(PG/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1'];env={**self.env,'PGDATABASE':database}
   blocker=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
   blocker.stdin.write("BEGIN;SET LOCAL statement_timeout='8s';LOCK TABLE public.audit_logs IN ACCESS EXCLUSIVE MODE;SELECT 'BLOCKER_HELD';SELECT pg_sleep(0.8);ALTER POLICY retained_fraud_fixture ON public.audit_logs WITH CHECK (true);COMMIT;\n");blocker.stdin.flush()
   self.assertTrue(select.select([blocker.stdout],[],[],5)[0],'owned blocker did not acquire lock')
   self.assertEqual(blocker.stdout.readline().strip(),'BLOCKER_HELD')
   with self.assertRaisesRegex(RuntimeError,'AUDIT_POLICY_DRIFT'):self.run_sql(preflight,database=database)
   blocker.stdin.close();blocker.wait(timeout=10);self.assertEqual(blocker.returncode,0)
  finally:
   packet.ROLE=old_role
   if blocker is not None and blocker.poll() is None:
    if blocker.stdin and not blocker.stdin.closed:blocker.stdin.close()
    blocker.wait(timeout=10)
   self.run_sql('DROP DATABASE '+packet.ident(database),database='postgres')

class DockerGrants(Grants):
 IMAGE='sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50'
 @classmethod
 def native(cls,args):
  r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=30)
  if r.returncode:raise RuntimeError('LOCAL_DOCKER_FIXTURE_FAILED:'+r.stderr[:200])
  return r.stdout.strip()
 @classmethod
 def setUpClass(cls):
  import time,ipaddress
  cls.root=Path(tempfile.mkdtemp(prefix='p11-mgmt-grants-pg16-'));cls.data=cls.root/'cert';cls.data.mkdir(mode=0o700);cls.sock=cls.root/'unused';cls.nonce=secrets.token_hex(16);cls.name='p11-management-acl-'+cls.nonce[:12];cls.cid=None
  cls.role=packet.ROLE;cls.db='p11_mgmt_grants_'+secrets.token_hex(12)
  try:
   if cls.native(['docker','image','inspect',cls.IMAGE,'--format','{{.Id}}'])!=cls.IMAGE:raise RuntimeError('IMAGE_PIN_MISMATCH')
   cls.cid=cls.native(['docker','run','-d','--pull=never','--name',cls.name,'--label','phone11.synthetic.management-acl='+cls.nonce,'--memory','512m','--cpus','1','--pids-limit','128','-p','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=256m','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=p11_fixture_owner',cls.IMAGE])
   deadline=time.monotonic()+25
   while subprocess.run(['docker','exec',cls.cid,'pg_isready','-h','127.0.0.1','-U','p11_fixture_owner','-d','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
    if time.monotonic()>deadline:raise RuntimeError('LOCAL_PG16_READINESS_TIMEOUT')
    time.sleep(.2)
   obj=json.loads(cls.native(['docker','inspect',cls.cid]))[0];bind=obj['NetworkSettings']['Ports']['5432/tcp'];assert len(bind)==1 and bind[0]['HostIp']=='127.0.0.1';cls.port=int(bind[0]['HostPort'])
   cls.env={**os.environ,'PGPORT':str(cls.port),'PGDATABASE':cls.db,'PGUSER':'p11_fixture_owner','PGCONNECT_TIMEOUT':'3'}
   for key in ['PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGHOSTADDR','DATABASE_URL']:cls.env.pop(key,None)
   assert cls.run_sql('SHOW server_version',database='postgres').strip()=='16.13'
   cls.native(['openssl','req','-new','-x509','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',str(cls.data/'server.key'),'-out',str(cls.data/'server.crt')]);(cls.data/'server.key').chmod(0o600)
   for leaf in ['server.key','server.crt']:cls.native(['docker','cp',str(cls.data/leaf),cls.cid+':/tmp/p11-'+leaf])
   cls.native(['docker','exec',cls.cid,'chown','postgres:postgres','/tmp/p11-server.key','/tmp/p11-server.crt'])
   cls.native(['docker','exec',cls.cid,'chmod','600','/tmp/p11-server.key'])
   # Determine the VM-forwarded client /32 before replacing synthetic trust rules.
   env={**cls.env,'PGHOST':'127.0.0.1','PGDATABASE':'postgres','PGSSLMODE':'disable'}
   remote=subprocess.run([str(PG/'psql'),'-X','-qAt','-c','SELECT host(inet_client_addr())'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=5);assert remote.returncode==0
   client=remote.stdout.strip();assert ipaddress.ip_address(client).version==4
   hba=cls.root/'pg_hba.conf';hba.write_text('local all all trust\nhostssl '+cls.db+' '+cls.role+' '+client+'/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n')
   # docker cp does not update this container's mounted tmpfs view reliably.
   written=subprocess.run(['docker','exec','-i',cls.cid,'/bin/sh','-c','cat > /var/lib/postgresql/data/pg_hba.conf'],input=hba.read_bytes(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5);assert written.returncode==0
   cls.native(['docker','exec',cls.cid,'chown','postgres:postgres','/var/lib/postgresql/data/pg_hba.conf'])
   cls.run_sql("ALTER SYSTEM SET ssl='on';",database='postgres');cls.run_sql("ALTER SYSTEM SET ssl_cert_file='/tmp/p11-server.crt';",database='postgres');cls.run_sql("ALTER SYSTEM SET ssl_key_file='/tmp/p11-server.key';",database='postgres');cls.run_sql('SELECT pg_reload_conf();',database='postgres');time.sleep(.3)
   cls.prepare_fixture()
  except BaseException:
   cls.tearDownClass();raise
 @classmethod
 def run_sql(cls,sql,database=None):
  r=subprocess.run(['docker','exec','-i',cls.cid,'psql','-U','p11_fixture_owner','-d',database or cls.db,'-X','-qAt','-v','ON_ERROR_STOP=1'],input=sql,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=40)
  if r.returncode:raise RuntimeError('LOCAL_PG16_SQL_FAILED:'+r.stderr[:600])
  return r.stdout
 @classmethod
 def tearDownClass(cls):
  if cls.cid:
   obj=json.loads(cls.native(['docker','inspect',cls.cid]))[0]
   if obj['Id']!=cls.cid or obj['Name']!='/'+cls.name or obj['Config']['Labels'].get('phone11.synthetic.management-acl')!=cls.nonce:raise RuntimeError('CLEANUP_IDENTITY_REFUSED')
   cls.native(['docker','rm','-f',cls.cid]);cls.cid=None
  shutil.rmtree(cls.root)
if __name__=='__main__':
 cls=DockerGrants if os.environ.get('PHONE11_GRANTS_PG16')=='1' else Grants
 suite=unittest.defaultTestLoader.loadTestsFromTestCase(cls)
 result=unittest.TextTestRunner(verbosity=2).run(suite)
 raise SystemExit(0 if result.wasSuccessful() else 1)
