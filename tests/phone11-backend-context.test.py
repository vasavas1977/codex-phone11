"""Owned public fixtures; never reads runtime secrets or builds/starts an app."""
import errno,hashlib,importlib.util,json,os,pathlib,tempfile,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).absolute().parent.parent
spec=importlib.util.spec_from_file_location('backend_context',ROOT/'scripts/prepare-phone11-backend-context.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ContextTests(unittest.TestCase):
 def fixture(self,extra=None):
  root=pathlib.Path(self.enterContext(tempfile.TemporaryDirectory(dir=ROOT/'tests')));self.enterContext(patch.object(m,'PRODUCT_FILES',('server/pbx/pbx-router.ts',)));files={'package.json':b'{"packageManager":"pnpm@9.12.0"}','pnpm-lock.yaml':b'OWNED_LOCK','server/pbx/pbx-router.ts':b'OWNED_PUBLIC_SOURCE'}
  pins={'packageSha256':m.sha(files['package.json']),'lockSha256':m.sha(files['pnpm-lock.yaml']),'patches':{}};files['infra/docker/backend/public-input-pins.json']=json.dumps(pins).encode()
  if extra:files.update(extra)
  names=sorted([*files,'infra/docker/backend/context-files.json']);files['infra/docker/backend/context-files.json']=json.dumps({'schema':'phone11-backend-public-context/v1','files':names}).encode()
  for k,v in files.items():p=root/k;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(v);p.chmod(0o600)
  return root,set(files)
 def collect(self,source,tracked,commit,dirty):
  blobs={leaf:hashlib.sha1(b'blob '+str(len((source.root/leaf).read_bytes())).encode()+b'\0'+(source.root/leaf).read_bytes()).hexdigest() for leaf in tracked}
  return m.collect(source,tracked,commit,dirty,blobs)
 def source(self,root):
  s=m.Source(root);self.addCleanup(s.close);return s
 def test_only_allowlisted_tracked_files_copied_with_exact_manifest(self):
  root,tracked=self.fixture();(root/'UNTRACKED-PRIVATE.txt').write_text('PRIVATE_SENTINEL');s=self.source(root);files,manifest=self.collect(s,tracked,'a'*40,False);destination=root/'new-public-context';m.prepare(s,files,manifest,destination);self.assertTrue(manifest['releaseReady']);self.assertFalse((destination/'UNTRACKED-PRIVATE.txt').exists());self.assertEqual((destination/'server/pbx/pbx-router.ts').read_bytes(),b'OWNED_PUBLIC_SOURCE');self.assertEqual(json.loads((destination/'RELEASE-CONTEXT.json').read_bytes()),manifest);self.assertEqual(destination.stat().st_mode&0o777,0o700)
 def test_dirty_or_untracked_context_never_release_ready(self):
  for dirty,missing in [(True,None),(False,'server/pbx/pbx-router.ts')]:
   root,tracked=self.fixture();s=self.source(root)
   if missing:tracked.remove(missing);self.assertRaises(m.Refused,self.collect,s,tracked,'a'*40,dirty)
   else:_,manifest=self.collect(s,tracked,'a'*40,dirty);self.assertFalse(manifest['releaseReady'])
 def test_env_key_registry_config_and_sdk_bodies_refused_before_read(self):
  for leaf in ('.env','private.pem','.npmrc','modules/phone11-siprix/vendor/sdk.aar'):
   root,tracked=self.fixture({leaf:b'PRIVATE_SENTINEL'});s=self.source(root);original=s.read
   def read(name):
    if name==leaf:self.fail('Sensitive body must not be read')
    return original(name)
   with patch.object(s,'read',side_effect=read):self.assertRaises(m.Refused,self.collect,s,tracked,'a'*40,False)
 def test_clean_status_cannot_hide_bytes_different_from_commit(self):
  root,tracked=self.fixture();s=self.source(root);_,value=m.collect(s,tracked,'a'*40,False,{leaf:'0'*40 for leaf in tracked});self.assertFalse(value['allInputsMatchCommit']);self.assertFalse(value['releaseReady'])
 def test_untracked_named_packaging_exception_is_source_check_only(self):
  root,tracked=self.fixture();tracked.remove('infra/docker/backend/public-input-pins.json');s=self.source(root);_,v=self.collect(s,tracked,'a'*40,False);self.assertFalse(v['allInputsTracked']);self.assertFalse(v['releaseReady'])
 def test_symlink_hardlink_fifo_and_parent_link_refuse(self):
  for mode in ('symlink','hardlink','fifo','parent'):
   root,_=self.fixture();target=root/'server/pbx/pbx-router.ts';s=self.source(root)
   if mode=='symlink':target.rename(root/'retained');target.symlink_to(root/'retained')
   elif mode=='hardlink':os.link(target,root/'second')
   elif mode=='fifo':target.unlink();os.mkfifo(target,0o600)
   else:(root/'server/pbx').rename(root/'retained');(root/'server/pbx').symlink_to(root/'retained',target_is_directory=True)
   self.assertRaises((m.Refused,OSError),s.read,'server/pbx/pbx-router.ts')
 def test_source_replacement_between_plan_and_copy_refuses(self):
  root,tracked=self.fixture();s=self.source(root);files,v=self.collect(s,tracked,'a'*40,False);p=root/'server/pbx/pbx-router.ts';p.rename(root/'retained');p.write_bytes(b'OWNED_PUBLIC_SOURCE');p.chmod(0o600);self.assertRaises(m.Refused,m.prepare,s,files,v,root/'out');self.assertFalse((root/'out').exists())
 def test_late_output_replacement_refuses_not_positive_context(self):
  root,tracked=self.fixture();s=self.source(root);files,v=self.collect(s,tracked,'a'*40,False);original=m.write_file;destination=root/'out'
  def write(path,raw,source):
   snapshot=original(path,raw,source)
   if path.name=='RELEASE-CONTEXT.json':p=destination/'package.json';p.rename(destination/'retained');p.write_bytes(files['package.json']);p.chmod(0o644)
   return snapshot
  with patch.object(m,'write_file',side_effect=write):self.assertRaises(m.Refused,m.prepare,s,files,v,destination)
 def test_fsync_failure_preserves_partial_and_closes_source_fds(self):
  root,tracked=self.fixture();s=self.source(root);files,v=self.collect(s,tracked,'a'*40,False);fds=[x[1] for x in s.items]
  with patch.object(m.os,'fsync',side_effect=OSError('OWNED_FSYNC')):self.assertRaises(OSError,m.prepare,s,files,v,root/'out')
  self.assertTrue((root/'out').exists());s.close()
  for fd in fds:
   with self.assertRaises(OSError) as e:os.fstat(fd)
   self.assertEqual(e.exception.errno,errno.EBADF)
 def test_all_source_closes_attempted_even_one_failure(self):
  root,_=self.fixture();s=m.Source(root);s.read('package.json');s.read('pnpm-lock.yaml');fds=[x[1] for x in s.items];real=os.close;seen=[]
  def close(fd):
   seen.append(fd);real(fd)
   if fd==fds[0]:raise OSError('OWNED_CLOSE')
  with patch.object(m.os,'close',side_effect=close):self.assertRaises(m.Refused,s.close)
  self.assertEqual(seen,fds);self.assertFalse(s.items)
 def test_collision_is_preserved_without_overwrite(self):
  root,tracked=self.fixture();s=self.source(root);files,v=self.collect(s,tracked,'a'*40,False);destination=root/'out';destination.mkdir();(destination/'keep').write_bytes(b'OWNED_RETAINED');self.assertRaises(FileExistsError,m.prepare,s,files,v,destination);self.assertEqual((destination/'keep').read_bytes(),b'OWNED_RETAINED')
if __name__=='__main__':unittest.main(verbosity=2)
