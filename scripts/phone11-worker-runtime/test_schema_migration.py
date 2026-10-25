"""Owned local PG16/17 schema/SQL proof only; no production or provider I/O."""
import json,os,re,shutil,subprocess,tempfile,unittest
from pathlib import Path
P=Path(__file__).resolve().parent
class Schema(unittest.TestCase):
 @classmethod
 def runpg(cls,name,args,**kw):return subprocess.run([str(cls.bin/name),*args],capture_output=True,text=True,timeout=30,**kw)
 @classmethod
 def sql(cls,text):return cls.runpg('psql',['-X','-w','-q','-h',str(cls.sock),'-p','55441','-U','owned_worker','-d','phone11ai','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],input=text)
 @classmethod
 def setUpClass(cls):
  ctl=shutil.which('pg_ctl');selected=os.environ.get('PHONE11_WORKER_PG_BIN');cls.bin=Path(selected)if selected else(Path(ctl).resolve().parent if ctl else None)
  if cls.bin is None or any(not(cls.bin/n).is_file()for n in ['postgres','initdb','pg_ctl','createdb','psql']):raise unittest.SkipTest('Existing local PostgreSQL16/17 tools required; no setup/install attempted')
  version=cls.runpg('postgres',['--version']).stdout
  if not re.search(r'PostgreSQL\) (16|17)\.',version)or os.geteuid()==0:raise unittest.SkipTest('Non-root owned PostgreSQL16/17 required')
  cls.root=Path(tempfile.mkdtemp(prefix='p11-worker-schema-',dir='/tmp'));cls.root.chmod(0o700);cls.data=cls.root/'data';cls.sock=cls.root/'s';cls.sock.mkdir(mode=0o700);cls.started=False;cls.addClassCleanup(cls.cleanup)
  cls.runpg('initdb',['-D',str(cls.data),'-U','owned_worker','--auth-local=trust','--auth-host=reject','--no-locale','-E','UTF8']).check_returncode()
  cls.started=True;cls.runpg('pg_ctl',['-D',str(cls.data),'-l',str(cls.root/'pg.log'),'-o',"-h '' -k "+str(cls.sock)+' -p 55441','-w','start']).check_returncode()
  cls.runpg('createdb',['-h',str(cls.sock),'-p','55441','-U','owned_worker','phone11ai']).check_returncode()
  matches=re.findall(r'text: `(WITH[\s\S]+?)`,\n    values:',(P/'schema.ts').read_text());assert len(matches)==1;cls.query=matches[0]
 @classmethod
 def cleanup(cls):
  if cls.started:
   status=cls.runpg('pg_ctl',['-D',str(cls.data),'status']).returncode
   if status==0:cls.runpg('pg_ctl',['-D',str(cls.data),'-m','fast','-w','stop']).check_returncode()
   elif status!=3:raise RuntimeError('OWNED_PG_STOP_UNKNOWN_RETAINED')
   assert cls.runpg('pg_ctl',['-D',str(cls.data),'status']).returncode==3
  shutil.rmtree(cls.root)
 def setUp(self):self.sql('DROP TABLE IF EXISTS public.phone11_cloud_recordings;CREATE TABLE public.phone11_cloud_recordings(id integer);').check_returncode()
 def migration(self):return self.sql((P/'cloud-columns-additive.sql').read_text())
 def gate(self,chat=False,retention=False,capture=False,analysis=False,role=None):
  text=('SET ROLE '+role+';'if role else'')+'PREPARE gate(boolean,boolean,boolean,boolean)AS '+self.query+';EXECUTE gate('+','.join(str(v).lower()for v in [chat,retention,capture,analysis])+');'
  result=self.sql(text);self.assertEqual(result.returncode,0,result.stderr);return result.stdout.strip().split('|')
 def test_add_nullable_no_default_idempotence_preserves_existing_rows(self):
  self.sql('INSERT INTO public.phone11_cloud_recordings(id)VALUES(71);').check_returncode();self.migration().check_returncode();self.migration().check_returncode()
  r=self.sql("SELECT id=71 AND capture_stop_requested_at IS NULL AND speaker_identity IS NULL FROM public.phone11_cloud_recordings;SELECT count(*)=2 AND bool_and(NOT a.attnotnull AND d.oid IS NULL)FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.phone11_cloud_recordings'::regclass AND a.attname IN('capture_stop_requested_at','speaker_identity');")
  self.assertEqual(r.stdout.strip().splitlines(),['t','t'])
 def test_wrong_existing_type_nullability_default_refuses_atomically(self):
  for definition in ['speaker_identity text','speaker_identity jsonb NOT NULL',"speaker_identity jsonb DEFAULT '{}'::jsonb"]:
   with self.subTest(definition=definition):
    self.sql('DROP TABLE public.phone11_cloud_recordings;CREATE TABLE public.phone11_cloud_recordings(id integer,'+definition+');').check_returncode()
    result=self.migration();self.assertEqual(result.returncode,3);self.assertRegex(result.stderr,r'ERROR:\s+P0001\b')
    r=self.sql("SELECT NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.phone11_cloud_recordings'::regclass AND attname='capture_stop_requested_at' AND NOT attisdropped);");self.assertEqual(r.stdout.strip(),'t')
 def test_actual_schema_gate_actor_columns_and_individual_privileges(self):
  self.assertEqual(self.gate(),['t','t','t','t']);self.assertEqual(self.gate(retention=True,capture=True),['t','f','f','t'])
  self.migration().check_returncode();self.assertEqual(self.gate(retention=True,capture=True),['t','t','t','t'])
  self.sql('CREATE ROLE owned_reader NOLOGIN;GRANT USAGE ON SCHEMA public TO owned_reader;GRANT SELECT ON public.phone11_cloud_recordings TO owned_reader;').check_returncode()
  self.assertEqual(self.gate(retention=True,capture=True,role='owned_reader'),['t','f','f','t'])
  self.sql('GRANT UPDATE(capture_stop_requested_at,speaker_identity)ON public.phone11_cloud_recordings TO owned_reader;').check_returncode()
  self.assertEqual(self.gate(retention=True,capture=True,role='owned_reader'),['t','t','t','t'])
 def test_analysis_only_requires_cloud_select_without_retention_update(self):
  self.migration().check_returncode()
  self.sql('CREATE ROLE owned_analysis NOLOGIN;GRANT USAGE ON SCHEMA public TO owned_analysis;GRANT SELECT(id)ON public.phone11_cloud_recordings TO owned_analysis;').check_returncode()
  self.assertEqual(self.gate(analysis=True,role='owned_analysis'),['t','t','t','f'])
  self.sql('GRANT SELECT(capture_stop_requested_at,speaker_identity)ON public.phone11_cloud_recordings TO owned_analysis;').check_returncode()
  self.assertEqual(self.gate(analysis=True,role='owned_analysis'),['t','t','t','t'])
 def test_dnd_scope_uses_exact_narrow_select_instead_of_disabling_policy(self):
  self.sql('CREATE TABLE phone11_workspace_profile_status(tenant_id integer,user_id integer,manual_availability text,manual_availability_expires_at timestamptz);CREATE TABLE phone11_workspace_profile_status_settings(tenant_id integer,enabled boolean,dnd_enabled boolean);CREATE ROLE owned_dnd NOLOGIN;GRANT USAGE ON SCHEMA public TO owned_dnd;').check_returncode()
  self.assertEqual(self.gate(chat=True,role='owned_dnd')[0],'f')
  self.sql('GRANT SELECT(tenant_id,user_id,manual_availability,manual_availability_expires_at)ON phone11_workspace_profile_status TO owned_dnd;GRANT SELECT(tenant_id,enabled,dnd_enabled)ON phone11_workspace_profile_status_settings TO owned_dnd;').check_returncode()
  self.assertEqual(self.gate(chat=True,role='owned_dnd')[0],'t')
if __name__=='__main__':unittest.main()
