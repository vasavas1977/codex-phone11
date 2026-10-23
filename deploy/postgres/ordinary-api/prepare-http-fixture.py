#!/usr/bin/env python3
"""Fill missing synthetic fixture relations, then install the exact reviewed grant renderer."""
import importlib.util,json,os,re,subprocess
from pathlib import Path
H=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('grant_render',H/'render.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
def sql(text):
 r=subprocess.run(['/opt/homebrew/opt/postgresql@17/bin/psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=text.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=35)
 if r.returncode:raise RuntimeError('OWNED_FIXTURE_SQL_REFUSED:'+r.stderr.decode()[:300])
 return r.stdout.decode()
assert os.environ.get('PGHOST','').startswith('/tmp/phone11-exact-http-')
assert re.fullmatch(r'p11_mgmt_grants_[0-9a-f]{24}',os.environ.get('PGDATABASE',''))
shape=json.loads((H/'test-fixture-shape.json').read_text());present=set(sql("SELECT tablename FROM pg_tables WHERE schemaname='public'").split())
for table,g in p.MANIFEST['tables'].items():
 if table in present:continue
 cols=set(shape['columns'].get(table,[]))|set(g['insert'])|set(g['update'])|{'id'};parts=[]
 for col in sorted(cols):
  typ='text'
  if col=='id' and table in shape['sequences']:typ='bigserial'
  if col in ('created_at','updated_at'):typ='timestamptz DEFAULT now()'
  parts.append(p.ident(col)+' '+typ)
 sql('CREATE TABLE public.'+p.ident(table)+'('+','.join(parts)+')')
raw=sql((H/'collect.sql').read_text());statement,receipt=p.render(p.load(raw.encode()),'clone');sql(statement)
password=os.environ['PHONE11_EXACT_HTTP_PASSWORD'];assert re.fullmatch('[0-9a-f]{64}',password)
sql('ALTER ROLE '+p.ident(p.ROLE)+' LOGIN PASSWORD '+p.lit(password))
print(json.dumps({'exactManifestInstalled':True,'runtimeRole':p.ROLE,'productionAccess':False,'renderedSha256':receipt.get('sqlSha256'),'missingSourceColumns':receipt.get('missingSourceColumns',{})}))
