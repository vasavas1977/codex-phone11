#!/usr/bin/env python3
"""Prepare an exact tracked public backend context; no install/build/network."""
import argparse,hashlib,json,os,re,stat,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).absolute().parent.parent
FIELDS=('st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns')
PACKAGING_NEW={'.dockerignore','infra/docker/backend/context-files.json','infra/docker/backend/public-input-pins.json','scripts/build-phone11-backend.mjs','scripts/prepare-phone11-backend-context.py'}
PRODUCT_FILES=('server/pbx/pbx-router.ts','server/pbx/ivr-router.ts','server/pbx/audit.ts')
class Refused(Exception):pass
def need(v):
 if not v:raise Refused('BACKEND_CONTEXT_REFUSED')
sha=lambda b:hashlib.sha256(b).hexdigest()
manifest_bytes=lambda value:(json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
def git_info(root):
 def git(*args):
  r=subprocess.run(['/usr/bin/git','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-C',str(root),*args],capture_output=True,timeout=10,env={'PATH':'/usr/bin:/bin','LANG':'C','HOME':'/nonexistent','GIT_OPTIONAL_LOCKS':'0','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_SYSTEM':'/dev/null'});need(r.returncode==0 and not r.stderr and len(r.stdout)<=1048576);return r.stdout
 commit=git('rev-parse','HEAD').decode().strip();need(re.fullmatch('[a-f0-9]{40}',commit));tree={}
 for item in git('ls-tree','-r','-z','--full-tree','HEAD').decode().split('\0'):
  if item:
   metadata,name=item.split('\t',1);mode,kind,blob=metadata.split(' ');need(kind=='blob' or mode=='160000');tree[name]=blob
 # Do not hash unrelated tracked/private workspace files via git status.
 # Selected public bytes are compared directly with immutable HEAD blobs.
 return commit,tree,False
class Source:
 def __init__(self,root):self.root=Path(root);self.items=[]
 def read(self,leaf):
  need(type(leaf) is str and not leaf.startswith('/') and all(re.fullmatch('[A-Za-z0-9_.@+-]+',x) and x not in ('.','..') for x in leaf.split('/')));p=self.root/leaf
  for parent in (p.parent,*p.parent.parents):need(stat.S_ISDIR(parent.lstat().st_mode))
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
  try:
   s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1 and s.st_mode&0o022==0 and 0<=s.st_size<=8388608);need(len(self.items)<192);self.items.append((p,fd,s));fd=None;raw=b''
   while len(raw)<=8388608:
    part=os.read(self.items[-1][1],min(65536,8388609-len(raw)))
    if not part:break
    raw+=part
   need(len(raw)==s.st_size);self.stable();return raw
  finally:
   if fd is not None:os.close(fd)
 def stable(self):
  for p,fd,s in self.items:
   for parent in (p.parent,*p.parent.parents):need(stat.S_ISDIR(parent.lstat().st_mode))
   need(all(getattr(s,k)==getattr(os.fstat(fd),k)==getattr(p.lstat(),k) for k in FIELDS))
 def close(self):
  errors=[];items=self.items;self.items=[]
  for _,fd,_ in items:
   try:os.close(fd)
   except BaseException:errors.append(fd)
  need(not errors)
def collect(source,tracked,commit,dirty,committed_blobs=None):
 raw=source.read('infra/docker/backend/context-files.json');allow=json.loads(raw);need(set(allow)=={'schema','files'} and allow['schema']=='phone11-backend-public-context/v1' and type(allow['files']) is list and len(allow['files'])==len(set(allow['files'])) and len(allow['files'])<190)
 files={};total=0
 for leaf in allow['files']:
  need(leaf in tracked or leaf in PACKAGING_NEW);need(not any(x.startswith('.env') or x in ('node_modules','.git','vendor') or x.endswith(('.framework','.xcframework')) for x in leaf.split('/')));need(Path(leaf).suffix.lower() not in ('.pem','.key','.p12','.pfx','.aar','.ipa','.mobileprovision','.license') and Path(leaf).name not in ('.npmrc','.pnpmfile.cjs','.yarnrc.yml'));body=raw if leaf=='infra/docker/backend/context-files.json' else source.read(leaf);total+=len(body);need(total<=67108864);files[leaf]=body
 for leaf in PRODUCT_FILES:need(leaf in files)
 matches=committed_blobs is not None and all(committed_blobs.get(k)==hashlib.sha1(b'blob '+str(len(v)).encode()+b'\0'+v).hexdigest() for k,v in files.items())
 pins=json.loads(files['infra/docker/backend/public-input-pins.json']);need(sha(files['package.json'])==pins['packageSha256'] and sha(files['pnpm-lock.yaml'])==pins['lockSha256'])
 for leaf,pin in pins['patches'].items():need(leaf in files and sha(files[leaf])==pin)
 source.stable();manifest={'schema':'phone11-backend-release-context/v1','sourceCommit':commit,'sourceDirty':dirty or not matches,'allInputsTracked':all(k in tracked for k in files),'allInputsMatchCommit':matches,'releaseReady':not dirty and all(k in tracked for k in files) and matches,'publicOnly':True,'fileCount':len(files),'totalBytes':total,'files':{k:{'sha256':sha(v),'bytes':len(v)} for k,v in sorted(files.items())},'productPins':{k:sha(files[k]) for k in PRODUCT_FILES},'lifecycleScriptsAllowed':False,'buildEntries':['server/_core/index.ts','scripts/phone11-auth-admin.ts','scripts/phone11-conference-readiness.ts','scripts/phone11-profile-photo-worker.ts'],'targetPlatform':None,'imageBuilt':False,'runtimeAuthority':False};return files,manifest
def write_file(path,raw,source):
 source.stable()
 for parent in (path.parent,*path.parent.parents):need(stat.S_ISDIR(parent.lstat().st_mode))
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o644)
 try:
  view=memoryview(raw)
  while view:
   n=os.write(fd,view);need(n>0);view=view[n:]
  os.fsync(fd);s=os.fstat(fd);n=path.lstat();need(stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1 and s.st_size==len(raw) and all(getattr(s,k)==getattr(n,k) for k in FIELDS));source.stable();snapshot={k:getattr(s,k) for k in FIELDS}
 finally:os.close(fd)
 return snapshot
def prepare(source,files,manifest,destination):
 destination=Path(destination);need(destination.is_absolute())
 for p in (destination.parent,*destination.parent.parents):need(stat.S_ISDIR(p.lstat().st_mode))
 source.stable();destination.mkdir(mode=0o700);written=[]
 for leaf,raw in sorted(files.items()):
  out=destination/leaf;out.parent.mkdir(mode=0o700,parents=True,exist_ok=True);written.append((out,write_file(out,raw,source)))
 manifest_path=destination/'RELEASE-CONTEXT.json';written.append((manifest_path,write_file(manifest_path,manifest_bytes(manifest),source)))
 for path,before in written:
  for parent in (path.parent,*path.parent.parents):need(stat.S_ISDIR(parent.lstat().st_mode))
  need(all(getattr(path.lstat(),k)==v for k,v in before.items()))
 source.stable();return destination

def main(argv=None):
 ap=argparse.ArgumentParser();mode=ap.add_mutually_exclusive_group(required=True);mode.add_argument('--check',action='store_true');mode.add_argument('--prepare',metavar='ABSOLUTE_NEW_DIRECTORY');args=ap.parse_args(argv);need(sys.flags.optimize==0);source=Source(ROOT)
 try:
  commit,tree,dirty=git_info(ROOT);tracked=set(tree);files,manifest=collect(source,tracked,commit,dirty,tree)
  if args.prepare:need(manifest['releaseReady']);prepare(source,files,manifest,args.prepare)
  source.stable();final_commit,final_tree,final_dirty=git_info(ROOT);need(final_commit==commit and final_tree==tree and final_dirty==dirty);result={'status':'PUBLIC_CONTEXT_PREPARED' if args.prepare else 'PUBLIC_SOURCE_CHECKED','sourceCommit':commit,'sourceDirty':manifest['sourceDirty'],'releaseReady':manifest['releaseReady'],'files':manifest['fileCount'],'bytes':manifest['totalBytes'],'sourceManifestSha256':sha(manifest_bytes(manifest)),'actualBuild':False,'runtimeAuthority':False}
 finally:source.close()
 print(json.dumps(result,sort_keys=True));return 0
if __name__=='__main__':
 try:raise SystemExit(main())
 except (Refused,OSError,ValueError,KeyError):print('{"status":"REFUSED","actualBuild":false,"runtimeAuthority":false}');raise SystemExit(2)
